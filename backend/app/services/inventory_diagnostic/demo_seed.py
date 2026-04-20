"""Opinionated demo dataset for the Inventory Diagnostic Agent.

Populates a believable multi-echelon network + inventory state so every
capability fires at least once when the planner asks the three flagship
prompts. Idempotent — safe to call repeatedly.

Demo narrative:
- 5 SKUs (A/B/C classes, varied unit economics)
- 3 echelons: 2 stores → 1 CDC → 1 RDC
- One **critical stockout** (BAR-002 @ STORE-EAST) driven by LATE supply
- One **below-safety-stock risk** (WATER-001 @ STORE-WEST) driven by NETWORK imbalance
- One **promotion-driven gap** (SNACK-007 @ STORE-EAST) for promo_uplift RC
- One **in-transit order** mis-routed (BAR-002 to STORE-WEST that STORE-EAST needs)
  → enables reroute_intransit
- One **delayed supply signal** (CHOC-DB1 supplier delay)
- One **healthy** SKU (TEA-050) so empty-state paths are exercised

After seeding, the function also creates/updates the `inventory-diagnostic-demo`
instance and its 11 slot bindings, then warms up the capability snapshot.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from ...database import engine
from ...models import (
    AgentInstanceRecord,
    AgentTemplateRecord,
    DeliveryRoute,
    InventoryBatchSnapshot,
    InventoryProjectionProductConfig,
    LocationMaster,
    NetworkActualWeekly,
    NetworkForecastWeekly,
    NetworkInventorySnapshot,
    NetworkLane,
    NetworkNode,
    NetworkSourcingRule,
    ParameterValue,
    PosHourlyActual,
    ProductMaster,
    PromotionPlanWeekly,
    RamadanCalendar,
    ReplenishmentOrder,
    ReplenishmentOrderDetail,
    StoreVelocity,
)
from ..agent_config_service import AgentConfigService
from .capability_check import CapabilityCheck


DEMO_INSTANCE_ID = "inventory-diagnostic-demo"
DEMO_BASE_WEEK = date(2026, 3, 8)  # aligns with InventoryProjectionService.DEFAULT_BASE_WEEK

# Reference instances shipped as JSON under config/agent/instances/. The seeder
# ensures they exist after a fresh seed so the planner sees 4 distinct agents.
REFERENCE_INSTANCE_IDS = (
    "inventory-diagnostic-demo",
    "stockout-resolver",
    "excess-optimizer",
    "promo-readiness",
    "perishable-dairy-diagnostic",
    "dairy-allocation-distribution",
    "dairy-pos-sensing",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def seed_inventory_diagnostic_demo(
    db: Session,
    *,
    include_network: bool = True,
    include_instance: bool = True,
) -> dict[str, Any]:
    """Idempotent demo seeder. Returns a summary of rows upserted."""
    summary: dict[str, Any] = {"rows": {}}
    if include_network:
        _upsert_products(db)
        _upsert_locations(db)
        _upsert_sourcing_rules(db)
        _upsert_inventory_snapshot(db)
        _upsert_demand_plan(db)
        _upsert_actual_demand(db)
        _upsert_supply_plan(db)
        _upsert_inventory_policy(db)
        _upsert_promotion_plan(db)
        _upsert_perishable_dairy_fixture(db)
        db.commit()
    if include_instance:
        _ensure_instance_and_bindings(db)
        _ensure_reference_instance_bindings(db)
        for instance_id in REFERENCE_INSTANCE_IDS:
            if db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == instance_id).first() is not None:
                CapabilityCheck(db, engine=engine).evaluate_instance(instance_id, force=True)
    summary["rows"] = _row_counts(db)
    summary["instances"] = [
        i for i in REFERENCE_INSTANCE_IDS
        if db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == i).first() is not None
    ]
    return summary


_ALLOCATION_BINDINGS = [
    ("item_master",       "sql_table", "products",
     {"sku": "sku"}),
    ("location_master",   "sql_table", "locations",
     {"node_id": "code"}),
    ("opening_inventory", "sql_table", "network_inventory_snapshot",
     {"sku": "sku", "node_id": "node_id", "on_hand_qty": "on_hand_qty"}),
    ("sourcing_network",  "sql_table", "network_sourcing_rules",
     {"sku": "sku", "dest_node_id": "dest_node_id", "source_node_id": "primary_source_node_id"}),
    ("batch_inventory",   "sql_table", "inventory_batch_snapshot",
     {"sku": "sku", "node_id": "node_id", "batch_id": "batch_id", "batch_qty": "batch_qty",
      "expiry_date": "expiry_date", "received_date": "received_date",
      "quality_hold_flag": "quality_hold_flag", "as_of_date": "as_of_date"}),
    ("delivery_routes",   "sql_table", "delivery_routes",
     {"route_id": "route_id", "scheduled_date": "scheduled_date", "stops_json": "stops_json",
      "departure_time": "departure_time", "capacity_units": "capacity_units",
      "window_end_time": "window_end_time", "vehicle_id": "vehicle_id",
      "origin_node_id": "origin_node_id"}),
    ("store_velocity",    "sql_table", "store_velocity",
     {"sku": "sku", "node_id": "node_id", "units_per_hour_avg": "units_per_hour_avg",
      "date": "date", "peak_hour_local": "peak_hour_local"}),
    ("demand_plan",       "sql_table", "network_forecast_weekly",
     {"sku": "sku", "node_id": "node_id", "week_start": "week_start", "forecast_qty": "forecast_qty"}),
    ("actual_demand",     "sql_table", "network_actual_weekly",
     {"sku": "sku", "node_id": "node_id", "week_start": "week_start", "actual_qty": "actual_qty"}),
]


def _ensure_reference_instance_bindings(db: Session) -> None:
    """For each shipped reference instance (if already loaded from filesystem),
    make sure all semantic slots are bound so capability_check yields green."""
    svc = AgentConfigService(db)
    for instance_id in ("stockout-resolver", "excess-optimizer", "promo-readiness", "perishable-dairy-diagnostic"):
        row = (
            db.query(AgentInstanceRecord)
            .filter(AgentInstanceRecord.instance_id == instance_id)
            .first()
        )
        if row is None:
            continue
        for slot_key, kind, source_ref, field_map in _BINDINGS:
            svc.upsert_instance_binding(instance_id, {
                "slot_key": slot_key,
                "binding_kind": kind,
                "source_ref": source_ref,
                "field_map": field_map,
            })
        # Perishable instance also binds batch_inventory plus the four slots
        # that are natively owned by the allocation and demand-sensing agents.
        # Seeding them here lets the perishable-dairy-diagnostic capability
        # check light up all slots green without invoking the other agents.
        if instance_id == "perishable-dairy-diagnostic":
            perishable_extras: list[tuple[str, str, str, dict[str, str]]] = [
                ("batch_inventory", "sql_table", "inventory_batch_snapshot", {
                    "sku": "sku",
                    "node_id": "node_id",
                    "batch_id": "batch_id",
                    "batch_qty": "batch_qty",
                    "expiry_date": "expiry_date",
                    "received_date": "received_date",
                    "quality_hold_flag": "quality_hold_flag",
                    "as_of_date": "as_of_date",
                }),
                ("delivery_routes", "sql_table", "delivery_routes", {
                    "route_id": "route_id",
                    "scheduled_date": "scheduled_date",
                    "stops_json": "stops_json",
                    "departure_time": "departure_time",
                    "capacity_units": "capacity_units",
                    "window_end_time": "window_end_time",
                    "vehicle_id": "vehicle_id",
                    "origin_node_id": "origin_node_id",
                }),
                ("store_velocity", "sql_table", "store_velocity", {
                    "sku": "sku",
                    "node_id": "node_id",
                    "units_per_hour_avg": "units_per_hour_avg",
                    "date": "date",
                    "peak_hour_local": "peak_hour_local",
                }),
                ("pos_hourly", "sql_table", "pos_hourly_actual", {
                    "sku": "sku",
                    "node_id": "node_id",
                    "timestamp_hour": "timestamp_hour",
                    "units_sold": "units_sold",
                    "on_hand_snapshot_qty": "on_hand_snapshot_qty",
                }),
                ("ramadan_calendar", "sql_table", "ramadan_calendar", {
                    "calendar_date": "calendar_date",
                    "ramadan_day": "ramadan_day",
                    "iftar_local_time": "iftar_local_time",
                }),
            ]
            for slot_key, kind, source_ref, field_map in perishable_extras:
                svc.upsert_instance_binding(instance_id, {
                    "slot_key": slot_key,
                    "binding_kind": kind,
                    "source_ref": source_ref,
                    "field_map": field_map,
                })

    # Allocation instance has a different agent_type + slot set.
    alloc_row = (
        db.query(AgentInstanceRecord)
        .filter(AgentInstanceRecord.instance_id == "dairy-allocation-distribution")
        .first()
    )
    if alloc_row is not None:
        for slot_key, kind, source_ref, field_map in _ALLOCATION_BINDINGS:
            svc.upsert_instance_binding("dairy-allocation-distribution", {
                "slot_key": slot_key,
                "binding_kind": kind,
                "source_ref": source_ref,
                "field_map": field_map,
            })

    # Demand sensing instance.
    sensing_row = (
        db.query(AgentInstanceRecord)
        .filter(AgentInstanceRecord.instance_id == "dairy-pos-sensing")
        .first()
    )
    if sensing_row is not None:
        for slot_key, kind, source_ref, field_map in _DEMAND_SENSING_BINDINGS:
            svc.upsert_instance_binding("dairy-pos-sensing", {
                "slot_key": slot_key,
                "binding_kind": kind,
                "source_ref": source_ref,
                "field_map": field_map,
            })


_DEMAND_SENSING_BINDINGS = [
    ("item_master",       "sql_table", "products",
     {"sku": "sku"}),
    ("location_master",   "sql_table", "locations",
     {"node_id": "code"}),
    ("opening_inventory", "sql_table", "network_inventory_snapshot",
     {"sku": "sku", "node_id": "node_id", "on_hand_qty": "on_hand_qty"}),
    ("demand_plan",       "sql_table", "network_forecast_weekly",
     {"sku": "sku", "node_id": "node_id", "week_start": "week_start", "forecast_qty": "forecast_qty"}),
    ("pos_hourly",        "sql_table", "pos_hourly_actual",
     {"sku": "sku", "node_id": "node_id", "timestamp_hour": "timestamp_hour",
      "units_sold": "units_sold", "on_hand_snapshot_qty": "on_hand_snapshot_qty"}),
    ("ramadan_calendar",  "sql_table", "ramadan_calendar",
     {"calendar_date": "calendar_date", "ramadan_day": "ramadan_day",
      "iftar_local_time": "iftar_local_time"}),
    ("actual_demand",     "sql_table", "network_actual_weekly",
     {"sku": "sku", "node_id": "node_id", "week_start": "week_start", "actual_qty": "actual_qty"}),
    ("batch_inventory",   "sql_table", "inventory_batch_snapshot",
     {"sku": "sku", "node_id": "node_id", "batch_id": "batch_id", "batch_qty": "batch_qty",
      "expiry_date": "expiry_date", "received_date": "received_date",
      "quality_hold_flag": "quality_hold_flag", "as_of_date": "as_of_date"}),
    ("sourcing_network",  "sql_table", "network_sourcing_rules",
     {"sku": "sku", "dest_node_id": "dest_node_id", "source_node_id": "primary_source_node_id"}),
]


def _row_counts(db: Session) -> dict[str, int]:
    return {
        "products_demo": db.query(ProductMaster).filter(ProductMaster.sku.in_(_DEMO_SKUS)).count(),
        "locations_demo": db.query(LocationMaster).filter(LocationMaster.code.in_(_DEMO_NODES)).count(),
        "sourcing_rules_demo": db.query(NetworkSourcingRule).filter(NetworkSourcingRule.sku.in_(_DEMO_SKUS)).count(),
        "forecasts_demo": db.query(NetworkForecastWeekly).filter(NetworkForecastWeekly.sku.in_(_DEMO_SKUS)).count(),
        "orders_demo": db.query(ReplenishmentOrder).filter(ReplenishmentOrder.sku.in_(_DEMO_SKUS)).count(),
        "snapshots_demo": db.query(NetworkInventorySnapshot).filter(NetworkInventorySnapshot.sku.in_(_DEMO_SKUS)).count(),
        "parameter_values_demo": db.query(ParameterValue).filter(ParameterValue.sku.in_(_DEMO_SKUS)).count(),
        "promotions_demo": db.query(PromotionPlanWeekly).filter(PromotionPlanWeekly.sku.in_(_DEMO_SKUS)).count(),
    }


# ----------------------------------------------------- canonical demo records

_DEMO_SKUS = [
    "BAR-002", "WATER-001", "SNACK-007", "CHOC-DB1", "TEA-050",
    # Phase 7 additions covering excess + substitution + blocked-stock stories.
    "COFFEE-088", "ENERGY-110", "ENERGY-110X", "JUICE-044",
]
_DEMO_NODES = ["STORE-EAST", "STORE-WEST", "CDC-NORTH", "RDC-CENTRAL"]


_PRODUCTS = [
    # (sku, name, brand, category, abc, demand_std_dev)
    ("BAR-002",     "Protein Bar Dark Chocolate", "Zebra", "Snacks",    "A", 10.0),
    ("WATER-001",   "Spring Water 1L",            "Zebra", "Beverages", "B",  5.0),
    ("SNACK-007",   "Trail Mix Supreme",          "Zebra", "Snacks",    "A", 12.0),
    ("CHOC-DB1",    "Dark Chocolate Bar",         "Zebra", "Confection","B",  8.0),
    ("TEA-050",     "Green Tea 20ct",             "Zebra", "Beverages", "C",  4.0),
    # Overstocked SKU \u2014 drives excess_inventory_risk.
    ("COFFEE-088",  "Cold Brew Concentrate",      "Zebra", "Beverages", "B",  6.0),
    # Substitution pair: ENERGY-110 decline, ENERGY-110X spike.
    ("ENERGY-110",  "Energy Drink Original",      "Zebra", "Beverages", "A", 11.0),
    ("ENERGY-110X", "Energy Drink Zero-Sugar",    "Zebra", "Beverages", "A", 10.0),
    # Policy-issue SKU: ROP intentionally under-sized.
    ("JUICE-044",   "Orange Juice 64oz",          "Zebra", "Beverages", "B",  7.0),
]


def _upsert_products(db: Session) -> None:
    for sku, name, brand, category, abc, std in _PRODUCTS:
        existing = db.query(ProductMaster).filter(ProductMaster.sku == sku).first()
        if existing is None:
            db.add(ProductMaster(
                sku=sku, name=name, brand=brand, category=category,
                abc_class=abc, temperature_zone="ambient",
                primary_supplier="SUP-ZEBRA-01",
                description=f"Demo seed for {sku}",
            ))
        else:
            existing.name = name
            existing.abc_class = abc
            existing.category = category
        cfg = db.query(InventoryProjectionProductConfig).filter(
            InventoryProjectionProductConfig.product_id == sku
        ).first()
        if cfg is None:
            db.add(InventoryProjectionProductConfig(
                product_id=sku, lead_time_days=14,
                service_level_target=0.95, demand_std_dev=std,
            ))
        else:
            cfg.demand_std_dev = std


# Each row: (code, name, location_type, region, city, state, echelon)
_LOCATIONS = [
    ("STORE-EAST",   "East Flagship Store",  "store",  "Northeast", "New York",   "NY", "retail"),
    ("STORE-WEST",   "West Flagship Store",  "store",  "West",      "Los Angeles","CA", "retail"),
    ("CDC-NORTH",    "North CDC",            "cdc",    "Northeast", "Newark",     "NJ", "regional"),
    ("RDC-CENTRAL",  "Central RDC",          "rdc",    "Central",   "Columbus",   "OH", "national"),
]


def _upsert_locations(db: Session) -> None:
    for code, name, loc_type, region, city, state, echelon in _LOCATIONS:
        existing = db.query(LocationMaster).filter(LocationMaster.code == code).first()
        if existing is None:
            db.add(LocationMaster(
                code=code, name=name, location_type=loc_type,
                region=region, city=city, state=state, echelon=echelon,
                description=f"Demo location {code}",
            ))
        else:
            existing.name = name
            existing.location_type = loc_type


# Store ← CDC ← RDC. Same CDC parent for both stores so they're siblings.
_SOURCING_RULES = [
    # sku, dest, parent, primary_source, customer_facing
    ("BAR-002",     "STORE-EAST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("BAR-002",     "STORE-WEST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("BAR-002",     "CDC-NORTH",   "RDC-CENTRAL", "RDC-CENTRAL", False),
    ("WATER-001",   "STORE-EAST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("WATER-001",   "STORE-WEST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("WATER-001",   "CDC-NORTH",   "RDC-CENTRAL", "RDC-CENTRAL", False),
    ("SNACK-007",   "STORE-EAST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("SNACK-007",   "CDC-NORTH",   "RDC-CENTRAL", "RDC-CENTRAL", False),
    ("CHOC-DB1",    "STORE-EAST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("CHOC-DB1",    "CDC-NORTH",   "RDC-CENTRAL", "RDC-CENTRAL", False),
    ("TEA-050",     "STORE-EAST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("TEA-050",     "STORE-WEST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("COFFEE-088",  "STORE-EAST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("COFFEE-088",  "STORE-WEST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("COFFEE-088",  "CDC-NORTH",   "RDC-CENTRAL", "RDC-CENTRAL", False),
    ("ENERGY-110",  "STORE-EAST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("ENERGY-110X", "STORE-EAST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("JUICE-044",   "STORE-EAST",  "CDC-NORTH",   "CDC-NORTH",   True),
    ("JUICE-044",   "CDC-NORTH",   "RDC-CENTRAL", "RDC-CENTRAL", False),
]


def _upsert_sourcing_rules(db: Session) -> None:
    for sku, dest, parent, primary, cfacing in _SOURCING_RULES:
        existing = db.query(NetworkSourcingRule).filter(
            NetworkSourcingRule.sku == sku,
            NetworkSourcingRule.dest_node_id == dest,
        ).first()
        if existing is None:
            db.add(NetworkSourcingRule(
                sku=sku, dest_node_id=dest,
                parent_location_node_id=parent,
                source_mode="single_source",
                primary_source_node_id=primary,
                sourcing_strategy="pull",
                is_customer_facing_node=cfacing,
            ))
        else:
            existing.parent_location_node_id = parent
            existing.primary_source_node_id = primary
            existing.is_customer_facing_node = cfacing


# Opening on-hand tuned so specific stories hit specific SKU/node pairs.
# Demand is typically 60 units/week. ROP=160, SS=120 at stores (set below).
# BAR-002 @ STORE-EAST: 40 → stockout week 1 (critical, late supply)
# WATER-001 @ STORE-WEST: 110 → below SS by week 1 (warning, network imbalance)
# SNACK-007 @ STORE-EAST: 400 → healthy until promo weeks hit (promo gap)
# CHOC-DB1 @ STORE-EAST: 50 → critical breach, triggers supply_delay_signal RC
# TEA-050 @ STORE-EAST: 1200 → healthy throughout
# (sku, node, on_hand_qty, quality_hold_flag)
_OPENING: list[tuple[str, str, float, bool]] = [
    ("BAR-002",     "STORE-EAST",   40.0,    False),
    ("BAR-002",     "STORE-WEST",   800.0,   False),
    ("BAR-002",     "CDC-NORTH",    5000.0,  False),
    ("BAR-002",     "RDC-CENTRAL",  12000.0, False),
    ("WATER-001",   "STORE-EAST",   500.0,   False),
    ("WATER-001",   "STORE-WEST",   110.0,   False),
    ("WATER-001",   "CDC-NORTH",    6000.0,  False),
    ("WATER-001",   "RDC-CENTRAL",  12000.0, False),
    ("SNACK-007",   "STORE-EAST",   400.0,   False),
    ("SNACK-007",   "CDC-NORTH",    3000.0,  False),
    ("SNACK-007",   "RDC-CENTRAL",  8000.0,  False),
    ("CHOC-DB1",    "STORE-EAST",   50.0,    False),
    ("CHOC-DB1",    "CDC-NORTH",    4000.0,  False),
    ("CHOC-DB1",    "RDC-CENTRAL",  10000.0, False),
    ("TEA-050",     "STORE-EAST",   1200.0,  False),
    # TEA-050 @ STORE-WEST: 200 units on quality hold → blocked_inventory RC + release_blocked_stock.
    ("TEA-050",     "STORE-WEST",   200.0,   True),
    ("TEA-050",     "CDC-NORTH",    2000.0,  False),
    # COFFEE-088 @ STORE-EAST: 3200 on-hand vs 60/wk demand ≈ 53 weeks of cover → excess_inventory_risk.
    ("COFFEE-088",  "STORE-EAST",   3200.0,  False),
    ("COFFEE-088",  "STORE-WEST",   80.0,    False),  # sibling below ROP → transfer_out_to_sibling
    ("COFFEE-088",  "CDC-NORTH",    6000.0,  False),
    ("COFFEE-088",  "RDC-CENTRAL",  10000.0, False),
    # ENERGY substitution pair.
    ("ENERGY-110",  "STORE-EAST",   650.0,   False),
    ("ENERGY-110X", "STORE-EAST",   180.0,   False),
    # JUICE-044: under-sized ROP story.
    ("JUICE-044",   "STORE-EAST",   90.0,    False),
    ("JUICE-044",   "CDC-NORTH",    2000.0,  False),
    ("JUICE-044",   "RDC-CENTRAL",  6000.0,  False),
]


def _upsert_inventory_snapshot(db: Session) -> None:
    as_of = (DEMO_BASE_WEEK - timedelta(days=1)).isoformat()
    db.query(NetworkInventorySnapshot).filter(
        NetworkInventorySnapshot.sku.in_(_DEMO_SKUS),
    ).delete(synchronize_session=False)
    for sku, node, qty, hold in _OPENING:
        db.add(NetworkInventorySnapshot(
            sku=sku, node_id=node, as_of_date=as_of,
            on_hand_qty=qty, quality_hold_flag=hold,
        ))


_DEMAND_PER_WEEK = {
    "BAR-002":     60.0,
    "WATER-001":   60.0,
    "SNACK-007":   80.0,
    "CHOC-DB1":    60.0,
    "TEA-050":     30.0,
    "COFFEE-088":  60.0,   # low demand vs 3200 on-hand → excess.
    "ENERGY-110":  40.0,   # post-substitution; actuals will run ~15/wk.
    "ENERGY-110X": 40.0,   # post-substitution; actuals will run ~65/wk.
    "JUICE-044":   50.0,
}


def _upsert_demand_plan(db: Session) -> None:
    db.query(NetworkForecastWeekly).filter(
        NetworkForecastWeekly.sku.in_(_DEMO_SKUS),
    ).delete(synchronize_session=False)
    # Only stock some SKUs at STORE-WEST per the story arcs (demand_plan needs
    # a row at each node the SKU is stocked).
    west_only = {"BAR-002", "WATER-001", "TEA-050", "COFFEE-088"}
    east_only = {"SNACK-007", "CHOC-DB1", "ENERGY-110", "ENERGY-110X", "JUICE-044"}
    for sku, qty in _DEMAND_PER_WEEK.items():
        for node in ("STORE-EAST", "STORE-WEST", "CDC-NORTH", "RDC-CENTRAL"):
            if node == "STORE-WEST" and sku in east_only:
                continue
            if node == "STORE-WEST" and sku not in west_only and sku not in east_only:
                continue
            if node == "RDC-CENTRAL" and sku in ("ENERGY-110", "ENERGY-110X"):
                continue  # these live only at stores for demo simplicity
            for w in range(12):
                week_start = (DEMO_BASE_WEEK + timedelta(days=7 * w)).isoformat()
                db.add(NetworkForecastWeekly(
                    sku=sku, node_id=node,
                    week_start=week_start, forecast_qty=qty,
                ))


# Actual demand for the past 6 weeks — drives forecast_overstated RC (actual
# < 70% of forecast sustained) and substitution_cannibalization RC
# (ENERGY-110 declining, ENERGY-110X rising).
def _upsert_actual_demand(db: Session) -> None:
    db.query(NetworkActualWeekly).filter(
        NetworkActualWeekly.sku.in_(_DEMO_SKUS),
    ).delete(synchronize_session=False)
    # COFFEE-088 actuals run ~40% of forecast → triggers forecast_overstated.
    coffee_actuals = [25.0, 22.0, 20.0, 18.0, 18.0, 15.0]
    # ENERGY-110 declining trend (substitution being eaten by ENERGY-110X).
    energy_decline  = [52.0, 45.0, 32.0, 22.0, 15.0, 12.0]
    energy_sub_rise = [28.0, 40.0, 55.0, 65.0, 72.0, 80.0]
    for offset, coffee_actual, e110, e110x in zip(
        range(-6, 0), coffee_actuals, energy_decline, energy_sub_rise
    ):
        week_start = (DEMO_BASE_WEEK + timedelta(days=7 * offset)).isoformat()
        db.add(NetworkActualWeekly(sku="COFFEE-088", node_id="STORE-EAST",
                                    week_start=week_start, actual_qty=coffee_actual))
        db.add(NetworkActualWeekly(sku="ENERGY-110", node_id="STORE-EAST",
                                    week_start=week_start, actual_qty=e110))
        db.add(NetworkActualWeekly(sku="ENERGY-110X", node_id="STORE-EAST",
                                    week_start=week_start, actual_qty=e110x))
    # Forecasts for the same weeks so ratio is computable.
    for offset in range(-6, 0):
        week_start = (DEMO_BASE_WEEK + timedelta(days=7 * offset)).isoformat()
        db.add(NetworkForecastWeekly(sku="COFFEE-088", node_id="STORE-EAST",
                                      week_start=week_start, forecast_qty=60.0))
        db.add(NetworkForecastWeekly(sku="ENERGY-110", node_id="STORE-EAST",
                                      week_start=week_start, forecast_qty=40.0))
        db.add(NetworkForecastWeekly(sku="ENERGY-110X", node_id="STORE-EAST",
                                      week_start=week_start, forecast_qty=40.0))


# Open orders: some late, some in-transit, some with delay signal.
# Format: order_id, sku, ship_from, ship_to, qty, status, eta_week_offset,
#         delivery_delay_days, lead_time_days
_OPEN_ORDERS = [
    # Late: BAR-002 order meant for STORE-EAST but arrives week 8 (way too late)
    ("RO-DEMO-LATE-BAR-EAST",     "BAR-002",   "CDC-NORTH",   "STORE-EAST", 400.0, "open",       7, 0.0,   14.0),
    # In-transit to STORE-WEST but STORE-EAST is the one starving → reroute candidate
    ("RO-DEMO-INTRANSIT-BAR",     "BAR-002",   "CDC-NORTH",   "STORE-WEST", 300.0, "in_transit", 0, 0.0,    3.0),
    # Supply delay signal: CHOC-DB1 supplier is 5 days late
    ("RO-DEMO-DELAY-CHOC",        "CHOC-DB1",  "RDC-CENTRAL", "STORE-EAST", 400.0, "open",       4, 5.0,   14.0),
    # Normal expedite-candidate for WATER: eta week 6, breach at STORE-WEST at week 1
    ("RO-DEMO-EXPEDITE-WATER",    "WATER-001", "CDC-NORTH",   "STORE-WEST", 500.0, "open",       5, 0.0,   14.0),
    # SNACK-007: a future order arriving week 6 (too late for promo weeks 3-4)
    ("RO-DEMO-SNACK-LATE",        "SNACK-007", "CDC-NORTH",   "STORE-EAST", 500.0, "open",       5, 2.0,   14.0),
]


def _upsert_supply_plan(db: Session) -> None:
    db.query(ReplenishmentOrderDetail).filter(
        ReplenishmentOrderDetail.order_id.like("RO-DEMO-%"),
    ).delete(synchronize_session=False)
    db.query(ReplenishmentOrder).filter(
        ReplenishmentOrder.order_id.like("RO-DEMO-%"),
    ).delete(synchronize_session=False)
    created = (DEMO_BASE_WEEK - timedelta(days=14)).isoformat()
    for order_id, sku, src, dest, qty, status, week_offset, delay, lead in _OPEN_ORDERS:
        eta = (DEMO_BASE_WEEK + timedelta(days=7 * week_offset)).isoformat()
        db.add(ReplenishmentOrder(
            order_id=order_id, alert_id="", order_type="replenishment",
            status=status, is_exception=False, alert_action_taken="",
            order_created_by="demo-seed",
            ship_to_node_id=dest, ship_from_node_id=src,
            sku=sku, product_count=1, order_qty=qty,
            region="Demo", order_cost=qty * 2.0,
            lead_time_days=lead, delivery_delay_days=delay,
            created_at=created, eta=eta,
        ))
        db.add(ReplenishmentOrderDetail(
            order_id=order_id, sku=sku,
            ship_to_node_id=dest, ship_from_node_id=src,
            order_qty=qty,
        ))


# Policy: safety stock 120, reorder point 160 at stores.
_POLICY = [
    ("BAR-002",     "STORE-EAST", 120.0, 160.0),
    ("BAR-002",     "STORE-WEST", 120.0, 160.0),
    ("WATER-001",   "STORE-EAST", 120.0, 160.0),
    ("WATER-001",   "STORE-WEST", 120.0, 160.0),
    ("SNACK-007",   "STORE-EAST", 150.0, 200.0),
    ("CHOC-DB1",    "STORE-EAST", 120.0, 160.0),
    ("TEA-050",     "STORE-EAST",  60.0,  90.0),
    ("TEA-050",     "STORE-WEST",  60.0,  90.0),
    # COFFEE-088: small SS / ROP relative to the 3200 on-hand → amplifies excess story.
    ("COFFEE-088",  "STORE-EAST", 100.0, 160.0),
    ("COFFEE-088",  "STORE-WEST", 100.0, 160.0),
    # ENERGY pair.
    ("ENERGY-110",  "STORE-EAST",  80.0, 120.0),
    ("ENERGY-110X", "STORE-EAST",  80.0, 120.0),
    # JUICE-044: intentionally under-sized ROP — demand * 2w = 100, ROP = 70.
    ("JUICE-044",   "STORE-EAST",  40.0,  70.0),
]


def _upsert_inventory_policy(db: Session) -> None:
    db.query(ParameterValue).filter(ParameterValue.sku.in_(_DEMO_SKUS)).delete(
        synchronize_session=False
    )
    for sku, loc, ss, rop in _POLICY:
        for code, qty in (("safety_stock_qty", ss), ("reorder_point_qty", rop)):
            db.add(ParameterValue(
                sku=sku, location=loc, parameter_code=code,
                parameter_name=code.replace("_", " ").title(),
                inherited_from="demo-seed",
                effective_value=str(qty), explicit_value=str(qty),
                source_type="demo", reason="Inventory diagnostic demo",
            ))


# SNACK-007 promo in weeks 3-4 (+25% uplift) — drives promotion_supply_gap
# + promo_uplift + phase_promotion.
_PROMOS = [
    ("SNACK-007", "STORE-EAST", 2, 0.25, "bogo"),    # week 3 (offset 2)
    ("SNACK-007", "STORE-EAST", 3, 0.25, "bogo"),    # week 4
    ("BAR-002",   "STORE-EAST", 4, 0.15, "discount"), # week 5
]


def _upsert_promotion_plan(db: Session) -> None:
    db.query(PromotionPlanWeekly).filter(
        PromotionPlanWeekly.sku.in_(_DEMO_SKUS)
    ).delete(synchronize_session=False)
    for sku, node, offset, uplift, promo_type in _PROMOS:
        week_start = (DEMO_BASE_WEEK + timedelta(days=7 * offset)).isoformat()
        db.add(PromotionPlanWeekly(
            sku=sku, node_id=node, week_start=week_start,
            uplift_pct=uplift, promo_type=promo_type,
            created_at=_now_iso(),
        ))


# ------------------------------------------------------- instance + bindings

_BINDINGS = [
    ("item_master",         "sql_table",        "products",
     {"sku": "sku"}),
    ("location_master",     "sql_table",        "locations",
     {"node_id": "code"}),
    ("opening_inventory",   "sql_table",        "network_inventory_snapshot",
     {"sku": "sku", "node_id": "node_id", "on_hand_qty": "on_hand_qty"}),
    ("demand_plan",         "sql_table",        "network_forecast_weekly",
     {"sku": "sku", "node_id": "node_id", "week_start": "week_start", "forecast_qty": "forecast_qty"}),
    ("supply_plan",         "config_declared",  "replenishment_orders_weekly_view",
     {}),
    ("sourcing_network",    "sql_table",        "network_sourcing_rules",
     {"sku": "sku", "dest_node_id": "dest_node_id", "source_node_id": "primary_source_node_id"}),
    ("inventory_policy",    "sql_table",        "parameter_values",
     {"sku": "sku", "node_id": "location"}),
    ("calendar",            "config_declared",  "iso_week_from_demand_plan",
     {}),
    ("promotion_plan",      "sql_table",        "promotion_plan_weekly",
     {"sku": "sku", "node_id": "node_id", "week_start": "week_start", "uplift_pct": "uplift_pct"}),
    ("in_transit_inventory","view",             "replenishment_order_details",
     {"sku": "sku", "source_node_id": "ship_from_node_id", "dest_node_id": "ship_to_node_id", "qty": "order_qty"}),
    ("supply_delay_signal", "view",             "replenishment_orders",
     {"sku": "sku", "source_node_id": "ship_from_node_id", "delay_days": "delivery_delay_days"}),
    ("actual_demand",       "sql_table",        "network_actual_weekly",
     {"sku": "sku", "node_id": "node_id", "week_start": "week_start", "actual_qty": "actual_qty"}),
]


def _ensure_instance_and_bindings(db: Session) -> None:
    svc = AgentConfigService(db)
    template = (
        db.query(AgentTemplateRecord)
        .filter(AgentTemplateRecord.type_key == "inventory_diagnostic_agent")
        .first()
    )
    if template is None:
        return
    if template.status != "active":
        svc.publish_agent_template("inventory_diagnostic_agent")
    # Create if missing.
    existing = (
        db.query(AgentInstanceRecord)
        .filter(AgentInstanceRecord.instance_id == DEMO_INSTANCE_ID)
        .first()
    )
    if existing is None:
        svc.create_agent_instance({
            "instance_id": DEMO_INSTANCE_ID,
            "agent_type": "inventory_diagnostic_agent",
            "display_name": "Inventory Diagnostic Demo",
            "module_slug": "meio-replenishment",
            "description": "Demo instance preloaded with multi-echelon data.",
        })
    else:
        # Re-sync default_config changes from the template.
        svc.sync_template_instances("inventory_diagnostic_agent")

    for slot_key, kind, source_ref, field_map in _BINDINGS:
        svc.upsert_instance_binding(DEMO_INSTANCE_ID, {
            "slot_key": slot_key,
            "binding_kind": kind,
            "source_ref": source_ref,
            "field_map": field_map,
        })


# ============================================================================
# Perishable Dairy fixture — distributor → CDC → retail store network with
# batch-grain inventory so shelf-life-aware projection, expiring_batch_risk,
# shelf_life_shortfall, RSL-driven resolutions, and LLM explanation all fire
# against realistic data.
# ============================================================================

_DAIRY_SKUS = [
    # sku, name, brand, category, abc, shelf_life_days, demand_std, unit_price (SAR — illustrative)
    ("MILK-FULL-1L",        "Full-Cream Milk 1L",        "Zebra Dairy", "Dairy",     "A",  7, 20.0,  4.50),
    ("MILK-LOW-1L",         "Low-Fat Milk 1L",           "Zebra Dairy", "Dairy",     "A",  7, 15.0,  4.50),
    ("LABAN-500ML",         "Laban 500ml",               "Zebra Dairy", "Dairy",     "A", 14, 25.0,  3.00),
    ("YOGURT-PLAIN-500G",   "Plain Yogurt 500g",         "Zebra Dairy", "Dairy",     "A", 21, 18.0,  6.50),
    ("YOGURT-FRUIT-4P",     "Fruit Yogurt 4-pack",       "Zebra Dairy", "Dairy",     "B", 21, 14.0, 12.00),
    ("CHEESE-SLICE-200G",   "Cheese Slices 200g",        "Zebra Dairy", "Dairy",     "B", 30, 10.0, 18.00),
    ("CHEESE-FETA-400G",    "Feta Cheese 400g",          "Zebra Dairy", "Dairy",     "A", 30, 12.0, 28.00),
    ("JUICE-ORANGE-1L",     "Orange Juice 1L (Chilled)", "Zebra Dairy", "Beverages", "A", 14, 18.0,  8.00),
    ("JUICE-MANGO-1L",      "Mango Juice 1L (Chilled)",  "Zebra Dairy", "Beverages", "B", 14, 15.0,  8.00),
]

_DAIRY_LOCATIONS = [
    # code, name, type, region, city, state, echelon
    ("PLANT-DAIRY-01",    "Dairy Plant 01",        "plant",  "Central",   "Riyadh",    "RY", "plant"),
    ("RDC-DAIRY-NORTH",   "Dairy RDC North",       "rdc",    "North",     "Al Khobar", "EP", "regional"),
    ("RDC-DAIRY-SOUTH",   "Dairy RDC South",       "rdc",    "South",     "Jeddah",    "MK", "regional"),
    ("CDC-DAIRY-01",      "Dairy CDC 01",          "cdc",    "Central",   "Riyadh",    "RY", "central"),
    ("CDC-DAIRY-02",      "Dairy CDC 02",          "cdc",    "North",     "Dammam",    "EP", "central"),
    ("STORE-EAST",        "East Flagship Store",   "store",  "East",      "Al Khobar", "EP", "retail"),
    ("STORE-WEST",        "West Flagship Store",   "store",  "West",      "Jeddah",    "MK", "retail"),
    ("STORE-MALL-01",     "Riyadh Mall Store 01",  "store",  "Central",   "Riyadh",    "RY", "retail"),
    ("STORE-MALL-02",     "Riyadh Mall Store 02",  "store",  "Central",   "Riyadh",    "RY", "retail"),
    ("STORE-CITY",        "City Center Store",     "store",  "Central",   "Riyadh",    "RY", "retail"),
    ("STORE-AIRPORT",     "Airport Outlet",        "store",  "Central",   "Riyadh",    "RY", "retail"),
]

_DAIRY_STORES = ["STORE-EAST", "STORE-WEST", "STORE-MALL-01", "STORE-MALL-02", "STORE-CITY", "STORE-AIRPORT"]
_DAIRY_CDCS = ["CDC-DAIRY-01", "CDC-DAIRY-02"]


def _upsert_dairy_products(db: Session) -> None:
    for sku, name, brand, category, abc, shelf_life, std, unit_price in _DAIRY_SKUS:
        existing = db.query(ProductMaster).filter(ProductMaster.sku == sku).first()
        if existing is None:
            db.add(ProductMaster(
                sku=sku, name=name, brand=brand, category=category,
                abc_class=abc, temperature_zone="refrigerated",
                primary_supplier="SUP-DAIRY-PLANT",
                description=f"Perishable dairy demo seed: {name}",
                shelf_life_days=shelf_life,
                cold_chain_flag=True,
                category_perishable=True,
                unit_price=unit_price,
            ))
        else:
            existing.name = name
            existing.category = category
            existing.abc_class = abc
            existing.temperature_zone = "refrigerated"
            existing.shelf_life_days = shelf_life
            existing.cold_chain_flag = True
            existing.category_perishable = True
            existing.unit_price = unit_price
        cfg = db.query(InventoryProjectionProductConfig).filter(
            InventoryProjectionProductConfig.product_id == sku
        ).first()
        if cfg is None:
            db.add(InventoryProjectionProductConfig(
                product_id=sku, lead_time_days=2,
                service_level_target=0.98, demand_std_dev=std,
            ))
        else:
            cfg.lead_time_days = 2
            cfg.service_level_target = 0.98
            cfg.demand_std_dev = std


def _upsert_dairy_locations(db: Session) -> None:
    for code, name, loc_type, region, city, state, echelon in _DAIRY_LOCATIONS:
        existing = db.query(LocationMaster).filter(LocationMaster.code == code).first()
        if existing is None:
            db.add(LocationMaster(
                code=code, name=name, location_type=loc_type,
                region=region, city=city, state=state, echelon=echelon,
                description=f"Perishable dairy demo location {code}",
            ))
        else:
            existing.name = name
            existing.location_type = loc_type


# Geographic spread for the dairy KSA network — illustrative coordinates.
_DAIRY_NODE_COORDS: dict[str, tuple[float, float]] = {
    "PLANT-DAIRY-01":   (24.7136, 46.6753),  # Riyadh
    "RDC-DAIRY-NORTH":  (26.4207, 50.0888),  # Al Khobar
    "RDC-DAIRY-SOUTH":  (21.4858, 39.1925),  # Jeddah
    "CDC-DAIRY-01":     (24.6877, 46.7219),  # Riyadh
    "CDC-DAIRY-02":     (26.4282, 50.1031),  # Dammam
    "STORE-EAST":       (26.2854, 50.2078),  # Al Khobar
    "STORE-WEST":       (21.5433, 39.1728),  # Jeddah
    "STORE-MALL-01":    (24.7741, 46.7386),  # Riyadh
    "STORE-MALL-02":    (24.6680, 46.6900),
    "STORE-CITY":       (24.7244, 46.6406),
    "STORE-AIRPORT":    (24.9576, 46.6988),
}

# Per-tier defaults for storage / throughput / handling cost so the agents can
# quote real numbers in their narratives.
_DAIRY_NODE_TIER: dict[str, dict[str, float | int | bool | str]] = {
    "plant": {"storage_capacity": 80000.0, "throughput_limit": 60000.0, "handling_cost_per_unit": 0.20, "holding_cost_per_unit": 0.10},
    "rdc":   {"storage_capacity": 25000.0, "throughput_limit": 18000.0, "handling_cost_per_unit": 0.30, "holding_cost_per_unit": 0.15},
    "cdc":   {"storage_capacity": 12000.0, "throughput_limit":  9000.0, "handling_cost_per_unit": 0.40, "holding_cost_per_unit": 0.18},
    "store": {"storage_capacity":   800.0, "throughput_limit":   400.0, "handling_cost_per_unit": 0.60, "holding_cost_per_unit": 0.25},
}


def _upsert_dairy_network_nodes(db: Session) -> None:
    """Insert dairy locations into network_nodes so lanes can FK-reference them.

    The dairy fixture historically only seeded LocationMaster; the agents that
    rely on network_lanes (allocation cost narrative) need the same code in
    network_nodes. Idempotent.
    """
    for code, name, loc_type, region, _city, _state, _echelon in _DAIRY_LOCATIONS:
        lat, lon = _DAIRY_NODE_COORDS.get(code, (24.7136, 46.6753))
        tier = _DAIRY_NODE_TIER.get(loc_type, _DAIRY_NODE_TIER["store"])
        existing = db.query(NetworkNode).filter(NetworkNode.node_id == code).first()
        if existing is None:
            db.add(NetworkNode(
                node_id=code, name=name, node_type=loc_type, region=region,
                lat=lat, lon=lon, status="active",
                storage_capacity=float(tier["storage_capacity"]),
                throughput_limit=float(tier["throughput_limit"]),
                crossdock_capable=(loc_type in ("rdc", "cdc")),
                holding_cost_per_unit=float(tier["holding_cost_per_unit"]),
                handling_cost_per_unit=float(tier["handling_cost_per_unit"]),
                service_level_target=0.97,
                production_batch_size=(1000.0 if loc_type == "plant" else 0.0),
                production_freeze_days=(2 if loc_type == "plant" else 0),
                cycle_time_days=(3.0 if loc_type == "plant" else 1.0),
                shelf_space_limit=float(tier["storage_capacity"]) * 0.6,
                default_strategy=("push" if loc_type == "plant" else "pull"),
                metadata_json='{"site": "dairy_demo", "country": "SA"}',
            ))
        else:
            existing.lat = lat
            existing.lon = lon
            existing.region = region
            existing.node_type = loc_type


# Lanes: PLANT → both RDCs, each RDC → its CDC, each CDC → its served stores.
# Cost / transit numbers are illustrative SAR values.
_DAIRY_LANES: list[tuple[str, str, str, float, float]] = [
    # (origin, dest, mode, cost_per_unit, transit_time_mean_days)
    ("PLANT-DAIRY-01",   "RDC-DAIRY-NORTH",  "truck",  0.45, 1.0),
    ("PLANT-DAIRY-01",   "RDC-DAIRY-SOUTH",  "truck",  0.55, 1.5),
    ("RDC-DAIRY-NORTH",  "CDC-DAIRY-02",     "truck",  0.30, 0.5),
    ("RDC-DAIRY-SOUTH",  "CDC-DAIRY-01",     "truck",  0.35, 0.6),
    # CDC-01 → its 5 stores
    ("CDC-DAIRY-01",     "STORE-WEST",       "truck",  0.40, 0.8),
    ("CDC-DAIRY-01",     "STORE-MALL-01",    "truck",  0.20, 0.2),
    ("CDC-DAIRY-01",     "STORE-MALL-02",    "truck",  0.20, 0.2),
    ("CDC-DAIRY-01",     "STORE-CITY",       "truck",  0.18, 0.2),
    ("CDC-DAIRY-01",     "STORE-AIRPORT",    "truck",  0.22, 0.3),
    # CDC-02 → its 1 store (East)
    ("CDC-DAIRY-02",     "STORE-EAST",       "truck",  0.25, 0.3),
    # Cross-CDC backup lanes (sibling rebalance)
    ("CDC-DAIRY-01",     "CDC-DAIRY-02",     "truck",  0.50, 0.8),
    ("CDC-DAIRY-02",     "CDC-DAIRY-01",     "truck",  0.50, 0.8),
    # Inter-store transfers used by intra_day_emergency_transfer
    ("STORE-MALL-01",    "STORE-EAST",       "van",    0.80, 0.2),
    ("STORE-MALL-01",    "STORE-CITY",       "van",    0.60, 0.1),
    ("STORE-CITY",       "STORE-MALL-01",    "van",    0.60, 0.1),
    ("STORE-MALL-02",    "STORE-MALL-01",    "van",    0.50, 0.1),
]


def _upsert_dairy_lanes(db: Session) -> None:
    """Insert dairy lanes so allocation + sourcing narratives can quote cost.
    Idempotent — replaces only the lanes whose lane_id has the DAIRY-* prefix.
    """
    db.query(NetworkLane).filter(NetworkLane.lane_id.like("DAIRY-LANE-%")).delete(
        synchronize_session=False
    )
    for idx, (origin, dest, mode, cost, transit) in enumerate(_DAIRY_LANES, start=1):
        db.add(NetworkLane(
            lane_id=f"DAIRY-LANE-{idx:03d}",
            origin_node_id=origin, dest_node_id=dest,
            mode=mode, lane_status="active",
            cost_function_type="linear",
            cost_per_unit=cost, cost_per_mile=0.0, fixed_cost=0.0,
            transit_time_mean_days=transit, transit_time_std_days=0.1,
            capacity_limit=15000.0, is_default_route=True,
        ))


def _upsert_dairy_sourcing(db: Session) -> None:
    # Every store sources from one of the two CDCs; CDCs from their RDC; RDCs from plant.
    store_to_cdc = {
        "STORE-EAST": "CDC-DAIRY-02",
        "STORE-WEST": "CDC-DAIRY-01",
        "STORE-MALL-01": "CDC-DAIRY-01",
        "STORE-MALL-02": "CDC-DAIRY-01",
        "STORE-CITY": "CDC-DAIRY-01",
        "STORE-AIRPORT": "CDC-DAIRY-01",
    }
    cdc_to_rdc = {
        "CDC-DAIRY-01": "RDC-DAIRY-SOUTH",
        "CDC-DAIRY-02": "RDC-DAIRY-NORTH",
    }
    for sku, *_ in _DAIRY_SKUS:
        for store, cdc in store_to_cdc.items():
            _upsert_sourcing_rule(db, sku=sku, dest=store, parent=cdc, primary=cdc, cfacing=True)
        for cdc, rdc in cdc_to_rdc.items():
            _upsert_sourcing_rule(db, sku=sku, dest=cdc, parent=rdc, primary=rdc, cfacing=False)
        for rdc in cdc_to_rdc.values():
            _upsert_sourcing_rule(db, sku=sku, dest=rdc, parent="PLANT-DAIRY-01", primary="PLANT-DAIRY-01", cfacing=False)


def _upsert_sourcing_rule(db: Session, *, sku: str, dest: str, parent: str, primary: str, cfacing: bool) -> None:
    existing = db.query(NetworkSourcingRule).filter(
        NetworkSourcingRule.sku == sku,
        NetworkSourcingRule.dest_node_id == dest,
    ).first()
    if existing is None:
        db.add(NetworkSourcingRule(
            sku=sku, dest_node_id=dest,
            parent_location_node_id=parent,
            source_mode="single_source",
            primary_source_node_id=primary,
            sourcing_strategy="pull",
            is_customer_facing_node=cfacing,
            explicit_lead_time_days=1.0,
        ))
    else:
        existing.parent_location_node_id = parent
        existing.primary_source_node_id = primary
        existing.is_customer_facing_node = cfacing


# Weekly store-level demand baseline (units / week).
_DAIRY_DEMAND = {
    "MILK-FULL-1L":      280.0,
    "MILK-LOW-1L":       180.0,
    "LABAN-500ML":       320.0,
    "YOGURT-PLAIN-500G": 160.0,
    "YOGURT-FRUIT-4P":    90.0,
    "CHEESE-SLICE-200G":  60.0,
    "CHEESE-FETA-400G":   75.0,
    "JUICE-ORANGE-1L":   140.0,
    "JUICE-MANGO-1L":     90.0,
}


def _upsert_dairy_demand_plan(db: Session) -> None:
    # Delete prior dairy rows so the fixture is idempotent.
    db.query(NetworkForecastWeekly).filter(
        NetworkForecastWeekly.sku.in_([s[0] for s in _DAIRY_SKUS]),
    ).delete(synchronize_session=False)
    # Ramadan ramp uplifts per SKU family for weeks 2-4.
    ramadan_uplift = {
        "MILK-FULL-1L": 1.25,
        "MILK-LOW-1L":  1.20,
        "LABAN-500ML":  1.45,
        "YOGURT-PLAIN-500G": 1.30,
        "YOGURT-FRUIT-4P":   1.30,
        "JUICE-ORANGE-1L":   1.60,
        "JUICE-MANGO-1L":    1.60,
        "CHEESE-SLICE-200G": 1.10,
        "CHEESE-FETA-400G":  1.20,
    }
    for sku, base_qty in _DAIRY_DEMAND.items():
        for node in _DAIRY_STORES + _DAIRY_CDCS:
            # CDCs aggregate their served stores; we approximate at 3x store level.
            node_qty = base_qty * (3.0 if node in _DAIRY_CDCS else 1.0)
            for w in range(12):
                week_start = (DEMO_BASE_WEEK + timedelta(days=7 * w)).isoformat()
                qty = node_qty
                if 2 <= w <= 4:
                    qty *= ramadan_uplift.get(sku, 1.0)
                db.add(NetworkForecastWeekly(
                    sku=sku, node_id=node,
                    week_start=week_start, forecast_qty=round(qty, 1),
                ))


def _upsert_dairy_actuals(db: Session) -> None:
    """Last 6 weeks of actuals. Deliberate POS divergence for LABAN-500ML at
    STORE-EAST (+35%) so pos_signal_divergence / forecast_overstated analyses
    have real data to bite on."""
    db.query(NetworkActualWeekly).filter(
        NetworkActualWeekly.sku.in_([s[0] for s in _DAIRY_SKUS]),
    ).delete(synchronize_session=False)
    for sku, _, _, _, _, _, _, _ in _DAIRY_SKUS:
        base = _DAIRY_DEMAND[sku]
        for offset in range(-6, 0):
            week_start = (DEMO_BASE_WEEK + timedelta(days=7 * offset)).isoformat()
            # Mild noise so RCA handlers have variance.
            mult = 1.0 if offset != -1 else 1.05
            # Laban divergence at STORE-EAST — drives pos_signal_divergence.
            if sku == "LABAN-500ML":
                db.add(NetworkActualWeekly(
                    sku=sku, node_id="STORE-EAST",
                    week_start=week_start, actual_qty=round(base * 1.35 * mult, 1),
                ))
                continue
            # YOGURT-FRUIT-4P at CDC-DAIRY-02 runs slow (~55% of forecast).
            if sku == "YOGURT-FRUIT-4P":
                db.add(NetworkActualWeekly(
                    sku=sku, node_id="CDC-DAIRY-02",
                    week_start=week_start, actual_qty=round(base * 3.0 * 0.55 * mult, 1),
                ))
                continue
            # Default: seed one row per store at the forecast level (so handlers see data).
            for node in _DAIRY_STORES:
                db.add(NetworkActualWeekly(
                    sku=sku, node_id=node,
                    week_start=week_start, actual_qty=round(base * mult, 1),
                ))


# Opening on-hand snapshot (aggregate) tuned to amplify perishable stories.
_DAIRY_OPENING: list[tuple[str, str, float, bool]] = [
    # MILK: STORE-EAST with 300 on-hand but 60% (180) expiring in 1 day → shelf_life_shortfall
    ("MILK-FULL-1L",       "STORE-EAST",    300.0, False),
    ("MILK-FULL-1L",       "STORE-WEST",    220.0, False),
    ("MILK-FULL-1L",       "STORE-MALL-01", 240.0, False),
    ("MILK-FULL-1L",       "CDC-DAIRY-01",  1400.0, False),
    ("MILK-FULL-1L",       "CDC-DAIRY-02",  1200.0, False),
    ("MILK-FULL-1L",       "RDC-DAIRY-NORTH", 3600.0, False),
    ("MILK-FULL-1L",       "RDC-DAIRY-SOUTH", 3800.0, False),
    ("MILK-LOW-1L",        "STORE-EAST",    160.0, False),
    ("MILK-LOW-1L",        "STORE-MALL-01", 180.0, False),
    ("MILK-LOW-1L",        "CDC-DAIRY-01",  900.0, False),
    ("MILK-LOW-1L",        "CDC-DAIRY-02",  800.0, False),
    # LABAN-500ML: STORE-EAST below what's needed given +35% velocity → projected_stockout
    ("LABAN-500ML",        "STORE-EAST",    240.0, False),
    ("LABAN-500ML",        "STORE-WEST",    380.0, False),
    ("LABAN-500ML",        "STORE-MALL-01", 360.0, False),
    ("LABAN-500ML",        "CDC-DAIRY-01",  1500.0, False),
    ("LABAN-500ML",        "CDC-DAIRY-02",  1400.0, False),
    ("LABAN-500ML",        "RDC-DAIRY-NORTH", 4200.0, False),
    ("YOGURT-PLAIN-500G",  "STORE-WEST",    90.0, False),  # shortfall Day 3 — triggers projected_stockout
    ("YOGURT-PLAIN-500G",  "STORE-EAST",    200.0, False),
    ("YOGURT-PLAIN-500G",  "CDC-DAIRY-01",  900.0, False),
    ("YOGURT-FRUIT-4P",    "CDC-DAIRY-02",  700.0, False),  # low velocity, 3-day RSL → redirect
    ("YOGURT-FRUIT-4P",    "STORE-MALL-01", 90.0, False),
    ("YOGURT-FRUIT-4P",    "STORE-AIRPORT", 40.0, False),
    ("CHEESE-SLICE-200G",  "CDC-DAIRY-01",  420.0, False),
    ("CHEESE-SLICE-200G",  "STORE-MALL-01", 80.0, False),
    ("CHEESE-FETA-400G",   "CDC-DAIRY-01",  540.0, False),  # RSL=1d batch here → expiring_batch_risk
    ("CHEESE-FETA-400G",   "STORE-MALL-02", 70.0, False),
    ("JUICE-ORANGE-1L",    "STORE-EAST",    180.0, False),
    ("JUICE-ORANGE-1L",    "STORE-WEST",    160.0, False),
    ("JUICE-ORANGE-1L",    "CDC-DAIRY-01",  900.0, False),
    ("JUICE-MANGO-1L",     "STORE-EAST",    140.0, False),
    ("JUICE-MANGO-1L",     "CDC-DAIRY-01",  720.0, False),
]


def _upsert_dairy_inventory_snapshot(db: Session) -> None:
    skus = [s[0] for s in _DAIRY_SKUS]
    as_of = (DEMO_BASE_WEEK - timedelta(days=1)).isoformat()
    db.query(NetworkInventorySnapshot).filter(
        NetworkInventorySnapshot.sku.in_(skus),
    ).delete(synchronize_session=False)
    for sku, node, qty, hold in _DAIRY_OPENING:
        db.add(NetworkInventorySnapshot(
            sku=sku, node_id=node, as_of_date=as_of,
            on_hand_qty=qty, quality_hold_flag=hold,
        ))


# Batch-grain inventory that exactly sums to the aggregate on-hand above, but
# with staggered received_date and expiry_date so RSL-driven detectors fire.
# Each row: (sku, node_id, batch_id, qty, received_offset_days, expiry_offset_days, quality_hold)
_DAIRY_BATCHES: list[tuple[str, str, str, float, int, int, bool]] = [
    # MILK-FULL-1L @ STORE-EAST: 180 on a batch expiring tomorrow (RSL=1), 120 fresh (RSL=6)
    ("MILK-FULL-1L", "STORE-EAST", "MILK-E-B1", 180.0, -5, 1, False),
    ("MILK-FULL-1L", "STORE-EAST", "MILK-E-B2", 120.0, -1, 6, False),
    # MILK-FULL-1L elsewhere (healthy multi-batch)
    ("MILK-FULL-1L", "STORE-WEST", "MILK-W-B1", 90.0, -4, 2, False),
    ("MILK-FULL-1L", "STORE-WEST", "MILK-W-B2", 130.0, -1, 5, False),
    ("MILK-FULL-1L", "STORE-MALL-01", "MILK-M1-B1", 120.0, -3, 3, False),
    ("MILK-FULL-1L", "STORE-MALL-01", "MILK-M1-B2", 120.0, -1, 5, False),
    ("MILK-FULL-1L", "CDC-DAIRY-01", "MILK-C1-B1", 700.0, -2, 4, False),
    ("MILK-FULL-1L", "CDC-DAIRY-01", "MILK-C1-B2", 700.0, 0, 6, False),
    ("MILK-FULL-1L", "CDC-DAIRY-02", "MILK-C2-B1", 600.0, -2, 4, False),
    ("MILK-FULL-1L", "CDC-DAIRY-02", "MILK-C2-B2", 600.0, 0, 6, False),
    ("MILK-FULL-1L", "RDC-DAIRY-NORTH", "MILK-RN-B1", 1800.0, -1, 5, False),
    ("MILK-FULL-1L", "RDC-DAIRY-NORTH", "MILK-RN-B2", 1800.0, 0, 6, False),
    ("MILK-FULL-1L", "RDC-DAIRY-SOUTH", "MILK-RS-B1", 1900.0, -1, 5, False),
    ("MILK-FULL-1L", "RDC-DAIRY-SOUTH", "MILK-RS-B2", 1900.0, 0, 6, False),
    # MILK-LOW-1L
    ("MILK-LOW-1L", "STORE-EAST", "MLOW-E-B1", 160.0, -2, 4, False),
    ("MILK-LOW-1L", "STORE-MALL-01", "MLOW-M1-B1", 180.0, -2, 4, False),
    ("MILK-LOW-1L", "CDC-DAIRY-01", "MLOW-C1-B1", 450.0, -1, 5, False),
    ("MILK-LOW-1L", "CDC-DAIRY-01", "MLOW-C1-B2", 450.0, 0, 6, False),
    ("MILK-LOW-1L", "CDC-DAIRY-02", "MLOW-C2-B1", 800.0, -1, 5, False),
    # LABAN-500ML
    ("LABAN-500ML", "STORE-EAST", "LAB-E-B1", 80.0, -6, 7, False),
    ("LABAN-500ML", "STORE-EAST", "LAB-E-B2", 160.0, -2, 11, False),
    ("LABAN-500ML", "STORE-WEST", "LAB-W-B1", 180.0, -3, 10, False),
    ("LABAN-500ML", "STORE-WEST", "LAB-W-B2", 200.0, -1, 12, False),
    ("LABAN-500ML", "STORE-MALL-01", "LAB-M1-B1", 360.0, -2, 11, False),
    ("LABAN-500ML", "CDC-DAIRY-01", "LAB-C1-B1", 700.0, -2, 11, False),
    ("LABAN-500ML", "CDC-DAIRY-01", "LAB-C1-B2", 800.0, 0, 13, False),
    ("LABAN-500ML", "CDC-DAIRY-02", "LAB-C2-B1", 700.0, -1, 12, False),
    ("LABAN-500ML", "CDC-DAIRY-02", "LAB-C2-B2", 700.0, 0, 13, False),
    ("LABAN-500ML", "RDC-DAIRY-NORTH", "LAB-RN-B1", 2100.0, -1, 12, False),
    ("LABAN-500ML", "RDC-DAIRY-NORTH", "LAB-RN-B2", 2100.0, 0, 13, False),
    # YOGURT-PLAIN-500G (WEST shortfall by Day 3)
    ("YOGURT-PLAIN-500G", "STORE-WEST", "YPL-W-B1", 90.0, -6, 14, False),
    ("YOGURT-PLAIN-500G", "STORE-EAST", "YPL-E-B1", 200.0, -3, 17, False),
    ("YOGURT-PLAIN-500G", "CDC-DAIRY-01", "YPL-C1-B1", 450.0, -2, 18, False),
    ("YOGURT-PLAIN-500G", "CDC-DAIRY-01", "YPL-C1-B2", 450.0, 0, 20, False),
    # YOGURT-FRUIT-4P (slow at CDC-02, 3-day RSL → redirect)
    ("YOGURT-FRUIT-4P", "CDC-DAIRY-02", "YFR-C2-B1", 400.0, -18, 3, False),
    ("YOGURT-FRUIT-4P", "CDC-DAIRY-02", "YFR-C2-B2", 300.0, -14, 7, False),
    ("YOGURT-FRUIT-4P", "STORE-MALL-01", "YFR-M1-B1", 90.0, -5, 16, False),
    ("YOGURT-FRUIT-4P", "STORE-AIRPORT", "YFR-A-B1", 40.0, -7, 14, False),
    # CHEESE-SLICE-200G
    ("CHEESE-SLICE-200G", "CDC-DAIRY-01", "CSL-C1-B1", 220.0, -10, 20, False),
    ("CHEESE-SLICE-200G", "CDC-DAIRY-01", "CSL-C1-B2", 200.0, -4, 26, False),
    ("CHEESE-SLICE-200G", "STORE-MALL-01", "CSL-M1-B1", 80.0, -8, 22, False),
    # CHEESE-FETA-400G: 120 with RSL=1 at CDC-DAIRY-01 → expiring_batch_risk critical
    ("CHEESE-FETA-400G", "CDC-DAIRY-01", "CFT-C1-B1", 120.0, -28, 1, False),
    # 120 on quality hold → cold_chain_break RC fires
    ("CHEESE-FETA-400G", "CDC-DAIRY-01", "CFT-C1-B2", 120.0, -15, 15, True),
    # 300 fresh
    ("CHEESE-FETA-400G", "CDC-DAIRY-01", "CFT-C1-B3", 300.0, -2, 28, False),
    ("CHEESE-FETA-400G", "STORE-MALL-02", "CFT-M2-B1", 70.0, -7, 23, False),
    # JUICE-ORANGE-1L — deliberate aged_receipt at STORE-EAST (received 10d ago with 11d total shelf life)
    ("JUICE-ORANGE-1L", "STORE-EAST", "JOR-E-B1", 80.0, -10, 4, False),  # span=14d, normal
    ("JUICE-ORANGE-1L", "STORE-EAST", "JOR-E-B2", 100.0, -10, 1, False),  # span=11d < 14*0.5? No: 11/14>0.5. Tweak below.
    ("JUICE-ORANGE-1L", "STORE-WEST", "JOR-W-B1", 160.0, -3, 11, False),
    ("JUICE-ORANGE-1L", "CDC-DAIRY-01", "JOR-C1-B1", 900.0, -2, 12, False),
    # JUICE-MANGO-1L
    ("JUICE-MANGO-1L", "STORE-EAST", "JMG-E-B1", 140.0, -4, 10, False),
    ("JUICE-MANGO-1L", "CDC-DAIRY-01", "JMG-C1-B1", 720.0, -1, 13, False),
]


def _upsert_dairy_batches(db: Session) -> None:
    skus = [s[0] for s in _DAIRY_SKUS]
    as_of = (DEMO_BASE_WEEK - timedelta(days=1)).isoformat()
    # Idempotent — clear and rebuild our dairy rows only.
    db.query(InventoryBatchSnapshot).filter(
        InventoryBatchSnapshot.sku.in_(skus),
    ).delete(synchronize_session=False)
    for sku, node, batch_id, qty, rec_off, exp_off, hold in _DAIRY_BATCHES:
        received = (DEMO_BASE_WEEK + timedelta(days=rec_off)).isoformat()
        expiry = (DEMO_BASE_WEEK + timedelta(days=exp_off)).isoformat()
        db.add(InventoryBatchSnapshot(
            batch_id=batch_id,
            sku=sku,
            node_id=node,
            as_of_date=as_of,
            batch_qty=qty,
            received_date=received,
            expiry_date=expiry,
            quality_hold_flag=hold,
        ))


# Safety stock / reorder point per SKU/location for stores.
_DAIRY_POLICY: list[tuple[str, str, float, float]] = []


def _build_dairy_policy_rows() -> None:
    rows: list[tuple[str, str, float, float]] = []
    for sku, *_ in _DAIRY_SKUS:
        base = _DAIRY_DEMAND[sku]
        for node in _DAIRY_STORES:
            ss = round(base * 0.3, 1)
            rop = round(base * 0.6, 1)
            rows.append((sku, node, ss, rop))
        for node in _DAIRY_CDCS:
            ss = round(base * 0.8, 1)
            rop = round(base * 1.5, 1)
            rows.append((sku, node, ss, rop))
    _DAIRY_POLICY.clear()
    _DAIRY_POLICY.extend(rows)


def _upsert_dairy_policy(db: Session) -> None:
    _build_dairy_policy_rows()
    skus = [s[0] for s in _DAIRY_SKUS]
    db.query(ParameterValue).filter(ParameterValue.sku.in_(skus)).delete(
        synchronize_session=False
    )
    for sku, loc, ss, rop in _DAIRY_POLICY:
        for code, qty in (("safety_stock_qty", ss), ("reorder_point_qty", rop)):
            db.add(ParameterValue(
                sku=sku, location=loc, parameter_code=code,
                parameter_name=code.replace("_", " ").title(),
                inherited_from="dairy-demo-seed",
                effective_value=str(qty), explicit_value=str(qty),
                source_type="demo", reason="Perishable dairy demo",
            ))


# Two supply orders: one delayed MILK to RDC-NORTH (→ late_supply), one in-transit LABAN.
_DAIRY_ORDERS = [
    ("RO-DAIRY-LATE-MILK", "MILK-FULL-1L", "PLANT-DAIRY-01", "RDC-DAIRY-NORTH", 2000.0, "open", 3, 4.0, 2.0),
    ("RO-DAIRY-INTRANSIT-LABAN", "LABAN-500ML", "RDC-DAIRY-NORTH", "CDC-DAIRY-02", 1200.0, "in_transit", 0, 0.0, 1.0),
    ("RO-DAIRY-OPEN-YOGURT", "YOGURT-PLAIN-500G", "CDC-DAIRY-01", "STORE-WEST", 300.0, "open", 1, 0.0, 2.0),
]


def _upsert_dairy_supply_plan(db: Session) -> None:
    db.query(ReplenishmentOrderDetail).filter(
        ReplenishmentOrderDetail.order_id.like("RO-DAIRY-%"),
    ).delete(synchronize_session=False)
    db.query(ReplenishmentOrder).filter(
        ReplenishmentOrder.order_id.like("RO-DAIRY-%"),
    ).delete(synchronize_session=False)
    created = (DEMO_BASE_WEEK - timedelta(days=7)).isoformat()
    for order_id, sku, src, dest, qty, status, week_offset, delay, lead in _DAIRY_ORDERS:
        eta = (DEMO_BASE_WEEK + timedelta(days=7 * week_offset)).isoformat()
        db.add(ReplenishmentOrder(
            order_id=order_id, alert_id="", order_type="replenishment",
            status=status, is_exception=False, alert_action_taken="",
            order_created_by="dairy-demo-seed",
            ship_to_node_id=dest, ship_from_node_id=src,
            sku=sku, product_count=1, order_qty=qty,
            region="Dairy Demo", order_cost=qty * 3.0,
            lead_time_days=lead, delivery_delay_days=delay,
            created_at=created, eta=eta,
        ))
        db.add(ReplenishmentOrderDetail(
            order_id=order_id, sku=sku,
            ship_to_node_id=dest, ship_from_node_id=src,
            order_qty=qty,
        ))


def _upsert_perishable_dairy_fixture(db: Session) -> None:
    """Top-level entrypoint — order matters so FKs resolve."""
    db.flush()
    _upsert_dairy_products(db)
    db.flush()
    _upsert_dairy_locations(db)
    _upsert_dairy_network_nodes(db)  # mirror locations into network_nodes for lane FKs
    db.flush()
    _upsert_dairy_lanes(db)  # PLANT → RDC → CDC → STORE + inter-CDC + inter-store
    db.flush()
    _upsert_dairy_sourcing(db)
    db.flush()
    _upsert_dairy_inventory_snapshot(db)
    _upsert_dairy_batches(db)
    _upsert_dairy_demand_plan(db)
    _upsert_dairy_actuals(db)
    _upsert_dairy_supply_plan(db)
    _upsert_dairy_policy(db)
    # Allocation-agent additions: delivery routes, store velocity, Ramadan calendar.
    _upsert_store_velocity(db)
    _upsert_ramadan_calendar(db)
    _upsert_delivery_routes(db)
    # Demand-sensing addition: 7 days of hourly POS per sku/store with
    # embedded Ramadan ramp, Iftar-hour spike, and laban divergence.
    _upsert_pos_hourly(db)
    db.flush()


# --------------------------------------------------------- store velocity

# units-per-hour averages per sku/store. Intentionally skewed so
# CDC-DAIRY-02's YOGURT-FRUIT-4P looks slow vs siblings (drives
# store_fair_share_deviation + redirect_to_high_velocity_store).
_STORE_VELOCITY: list[tuple[str, str, float, int]] = [
    # (sku, node, units_per_hour_avg, peak_hour_local)
    ("MILK-FULL-1L",      "STORE-EAST",    14.0, 8),
    ("MILK-FULL-1L",      "STORE-WEST",    11.0, 8),
    ("MILK-FULL-1L",      "STORE-MALL-01", 13.0, 18),
    ("MILK-FULL-1L",      "STORE-MALL-02", 10.0, 18),
    ("MILK-FULL-1L",      "STORE-CITY",     9.0, 8),
    ("MILK-FULL-1L",      "STORE-AIRPORT",  7.0, 10),
    ("LABAN-500ML",       "STORE-EAST",    18.0, 17),
    ("LABAN-500ML",       "STORE-WEST",    12.0, 17),
    ("LABAN-500ML",       "STORE-MALL-01", 16.0, 17),
    ("LABAN-500ML",       "STORE-MALL-02", 13.0, 17),
    ("LABAN-500ML",       "STORE-CITY",    12.0, 17),
    ("LABAN-500ML",       "STORE-AIRPORT",  9.0, 17),
    ("YOGURT-PLAIN-500G", "STORE-EAST",     8.0, 18),
    ("YOGURT-PLAIN-500G", "STORE-WEST",     6.0, 18),
    ("YOGURT-PLAIN-500G", "STORE-MALL-01",  9.0, 18),
    ("YOGURT-FRUIT-4P",   "STORE-EAST",     6.0, 19),
    ("YOGURT-FRUIT-4P",   "STORE-MALL-01", 10.0, 19),  # fastest
    ("YOGURT-FRUIT-4P",   "STORE-MALL-02",  5.5, 19),
    ("YOGURT-FRUIT-4P",   "STORE-AIRPORT",  3.0, 19),
    ("YOGURT-FRUIT-4P",   "CDC-DAIRY-02",   1.5, 0),   # slow → over-allocated
    ("CHEESE-SLICE-200G", "STORE-EAST",     4.0, 12),
    ("CHEESE-SLICE-200G", "STORE-MALL-01",  5.0, 12),
    ("CHEESE-FETA-400G",  "STORE-EAST",     4.5, 18),
    ("CHEESE-FETA-400G",  "STORE-MALL-01",  7.0, 18),  # fastest
    ("CHEESE-FETA-400G",  "STORE-MALL-02",  4.0, 18),
    ("CHEESE-FETA-400G",  "CDC-DAIRY-01",   0.5, 0),   # slow
    ("JUICE-ORANGE-1L",   "STORE-EAST",     9.0, 17),
    ("JUICE-ORANGE-1L",   "STORE-WEST",     8.0, 17),
    ("JUICE-ORANGE-1L",   "STORE-MALL-01", 10.0, 17),
    ("JUICE-MANGO-1L",    "STORE-EAST",     7.0, 17),
    ("JUICE-MANGO-1L",    "STORE-MALL-01",  9.0, 17),
    ("JUICE-MANGO-1L",    "STORE-MALL-02",  6.0, 17),
    ("JUICE-MANGO-1L",    "STORE-AIRPORT",  5.0, 17),
]


def _upsert_store_velocity(db: Session) -> None:
    today = date.today().isoformat()
    db.query(StoreVelocity).filter(
        StoreVelocity.sku.in_([s[0] for s in _DAIRY_SKUS])
    ).delete(synchronize_session=False)
    for sku, node, uph, peak in _STORE_VELOCITY:
        db.add(StoreVelocity(
            sku=sku, node_id=node, date=today,
            units_per_hour_avg=uph, peak_hour_local=peak,
            peak_hour_multiplier=1.5,
        ))


# --------------------------------------------------------- Ramadan calendar

def _upsert_ramadan_calendar(db: Session) -> None:
    """Seed a Ramadan window that covers DEMO_BASE_WEEK AND today(), so the
    allocation agent's 'routes today' view resolves iftar_local_time correctly
    whether the demo is replayed in March or months later.
    """
    iftar = "18:05"
    today = date.today()
    # Cover a wide window: from min(base_week, today-10) to max(base_week+45, today+45).
    start = min(DEMO_BASE_WEEK - timedelta(days=3), today - timedelta(days=10))
    end = max(DEMO_BASE_WEEK + timedelta(days=45), today + timedelta(days=45))
    total_days = (end - start).days + 1
    for i in range(total_days):
        d = (start + timedelta(days=i)).isoformat()
        existing = (
            db.query(RamadanCalendar)
            .filter(RamadanCalendar.calendar_date == d)
            .first()
        )
        # Mark Ramadan days 1-30 for a 30-day window starting at DEMO_BASE_WEEK,
        # AND a second 30-day window centered on today() so test queries for
        # "today" always resolve to a Ramadan date.
        dt = start + timedelta(days=i)
        ramadan_day: int | None = None
        offset_base = (dt - DEMO_BASE_WEEK).days
        if 0 <= offset_base < 30:
            ramadan_day = offset_base + 1
        offset_today = (dt - (today - timedelta(days=15))).days
        if ramadan_day is None and 0 <= offset_today < 30:
            ramadan_day = offset_today + 1
        if existing is None:
            db.add(RamadanCalendar(
                calendar_date=d,
                ramadan_day=ramadan_day,
                iftar_local_time=iftar if ramadan_day else None,
                notes="Demo Ramadan calendar for allocation agent.",
            ))
        else:
            existing.ramadan_day = ramadan_day
            existing.iftar_local_time = iftar if ramadan_day else None


# --------------------------------------------------------- delivery routes

def _upsert_delivery_routes(db: Session) -> None:
    """Seed today's delivery routes covering all 6 stores + 2 CDCs. Route-03 is
    deliberately tight against Iftar (ETA 18:15 vs iftar 18:05) → triggers
    iftar_window_miss_risk. Route-05 has slack capacity usable for swap."""
    today_iso = date.today().isoformat()
    db.query(DeliveryRoute).filter(DeliveryRoute.scheduled_date == today_iso).delete(
        synchronize_session=False
    )
    routes = [
        {
            "route_id": "ROUTE-DAIRY-01",
            "vehicle_id": "VEH-01",
            "capacity_units": 1200,
            "departure_time": "05:30",
            "window_end_time": "18:00",
            "origin_node_id": "CDC-DAIRY-01",
            "stops": [
                {"node_id": "STORE-MALL-01", "eta": "07:00", "planned_qty_by_sku": {"MILK-FULL-1L": 240, "LABAN-500ML": 360, "YOGURT-FRUIT-4P": 90}},
                {"node_id": "STORE-MALL-02", "eta": "09:30", "planned_qty_by_sku": {"MILK-FULL-1L": 180, "LABAN-500ML": 280, "CHEESE-FETA-400G": 70}},
                {"node_id": "STORE-CITY",    "eta": "12:30", "planned_qty_by_sku": {"MILK-FULL-1L": 140, "LABAN-500ML": 200}},
            ],
        },
        {
            "route_id": "ROUTE-DAIRY-02",
            "vehicle_id": "VEH-02",
            "capacity_units": 900,
            "departure_time": "06:00",
            "window_end_time": "18:00",
            "origin_node_id": "CDC-DAIRY-01",
            "stops": [
                {"node_id": "STORE-WEST", "eta": "10:00", "planned_qty_by_sku": {"MILK-FULL-1L": 220, "LABAN-500ML": 260, "YOGURT-PLAIN-500G": 90}},
                {"node_id": "STORE-AIRPORT", "eta": "14:00", "planned_qty_by_sku": {"JUICE-MANGO-1L": 80, "MILK-LOW-1L": 80}},
            ],
        },
        {
            "route_id": "ROUTE-DAIRY-03",  # TIGHT vs Iftar — planned 18:15 ETA
            "vehicle_id": "VEH-03",
            "capacity_units": 700,
            "departure_time": "12:00",
            "window_end_time": "18:00",
            "origin_node_id": "CDC-DAIRY-02",
            "stops": [
                {"node_id": "STORE-EAST", "eta": "18:15", "planned_qty_by_sku": {"LABAN-500ML": 200, "JUICE-ORANGE-1L": 100, "MILK-FULL-1L": 150}},
            ],
        },
        {
            "route_id": "ROUTE-DAIRY-04",
            "vehicle_id": "VEH-04",
            "capacity_units": 600,
            "departure_time": "07:00",
            "window_end_time": "18:00",
            "origin_node_id": "CDC-DAIRY-02",
            "stops": [
                {"node_id": "CDC-DAIRY-01", "eta": "11:00", "planned_qty_by_sku": {"LABAN-500ML": 500}},
            ],
        },
        {
            "route_id": "ROUTE-DAIRY-05",  # slack capacity — swap target
            "vehicle_id": "VEH-05",
            "capacity_units": 1100,
            "departure_time": "06:00",
            "window_end_time": "18:00",
            "origin_node_id": "CDC-DAIRY-01",
            "stops": [
                {"node_id": "STORE-MALL-01", "eta": "09:00", "planned_qty_by_sku": {"YOGURT-FRUIT-4P": 120, "CHEESE-SLICE-200G": 60}},
            ],
        },
        {
            "route_id": "ROUTE-DAIRY-06",
            "vehicle_id": "VEH-06",
            "capacity_units": 800,
            "departure_time": "08:00",
            "window_end_time": "18:00",
            "origin_node_id": "RDC-DAIRY-SOUTH",
            "stops": [
                {"node_id": "CDC-DAIRY-01", "eta": "11:30", "planned_qty_by_sku": {"MILK-FULL-1L": 700, "YOGURT-PLAIN-500G": 100}},
            ],
        },
    ]
    for r in routes:
        db.add(DeliveryRoute(
            route_id=r["route_id"],
            scheduled_date=today_iso,
            vehicle_id=r["vehicle_id"],
            capacity_units=r["capacity_units"],
            departure_time=r["departure_time"],
            window_end_time=r["window_end_time"],
            origin_node_id=r["origin_node_id"],
            stops_json=json.dumps(r["stops"]),
            status="planned",
        ))


# --------------------------------------------------------- hourly POS
# Seven days of hourly POS per sku/store with:
#   - a daytime base rate (velocity-driven, peaks 10-14h and 17-19h)
#   - an Iftar-hour spike (17-19h) when today is a Ramadan day
#   - a deliberate +35% surge on LABAN-500ML at STORE-EAST for the last 72h
#     → triggers pos_signal_divergence and pos_velocity_surge RC
# The latest hour row also carries on_hand_snapshot_qty so project_hourly can
# use it as the starting inventory.

_POS_STORES = ("STORE-EAST", "STORE-WEST", "STORE-MALL-01", "STORE-MALL-02", "STORE-CITY", "STORE-AIRPORT")


def _hourly_base_rate(sku: str, hour: int) -> float:
    """Return units/hour for (sku, hour_of_day)."""
    # Store-level hourly rate derived from _DAIRY_DEMAND (weekly) and a typical
    # 12-waking-hour retail day. baseline = weekly_demand / 7 / 12h.
    weekly = _DAIRY_DEMAND.get(sku, 70.0)
    daily = weekly / 7.0
    base = daily / 12.0
    if 10 <= hour <= 14:
        return base * 1.4
    if 17 <= hour <= 19:
        return base * 1.8  # pre-Iftar / evening spike
    if 7 <= hour <= 9:
        return base * 1.2
    if 0 <= hour <= 5 or hour >= 22:
        return base * 0.1
    return base


def _upsert_pos_hourly(db: Session) -> None:
    skus = [s[0] for s in _DAIRY_SKUS]
    # Flush pending adds from prior helpers (session is autoflush=False) so
    # queries below see the inventory snapshot + Ramadan calendar we just
    # inserted.
    db.flush()
    db.query(PosHourlyActual).filter(
        PosHourlyActual.sku.in_(skus)
    ).delete(synchronize_session=False)
    now = datetime.now().replace(minute=0, second=0, microsecond=0)
    hours_to_seed = 24 * 7  # 7 days
    # Pre-fetch opening on-hand per (sku, node) to spread into on_hand_snapshot.
    from ...models import NetworkInventorySnapshot as _Inv
    inv_rows = (
        db.query(_Inv)
        .filter(_Inv.sku.in_(skus))
        .all()
    )
    latest_oh: dict[tuple[str, str], float] = {}
    latest_date: dict[tuple[str, str], str] = {}
    for r in inv_rows:
        key = (r.sku, r.node_id)
        if key not in latest_date or str(r.as_of_date) > latest_date[key]:
            latest_date[key] = str(r.as_of_date)
            latest_oh[key] = float(r.on_hand_qty or 0.0)
    # Build the hourly series per (sku, store).
    for sku in skus:
        for store in _POS_STORES:
            opening = latest_oh.get((sku, store))
            if opening is None:
                # Skip SKU/store combos we didn't seed on-hand for.
                continue
            running = float(opening)
            for i in range(hours_to_seed, 0, -1):
                ts = now - timedelta(hours=i)
                rate = _hourly_base_rate(sku, ts.hour)
                # Laban divergence for last 72h at STORE-EAST: boost 35%.
                if sku == "LABAN-500ML" and store == "STORE-EAST" and i <= 72:
                    rate *= 1.35
                # Iftar spike if Ramadan day.
                day_iso = ts.date().isoformat()
                ramadan_row = (
                    db.query(RamadanCalendar)
                    .filter(RamadanCalendar.calendar_date == day_iso)
                    .first()
                )
                is_ramadan = ramadan_row is not None and ramadan_row.ramadan_day
                if is_ramadan and 17 <= ts.hour <= 19:
                    rate *= 1.35
                units = max(0.0, round(rate, 2))
                # Run the on-hand counter *down* by units, with mock replenishment
                # every 24h: bump by 80% of daily velocity to keep it stable.
                running = running - units
                if ts.hour == 5:
                    running += (_DAIRY_DEMAND.get(sku, 70.0) / 7.0) * 0.8
                running = max(0.0, round(running, 2))
                db.add(PosHourlyActual(
                    sku=sku,
                    node_id=store,
                    timestamp_hour=ts.isoformat(),
                    units_sold=units,
                    on_hand_snapshot_qty=running,
                ))
            # Final "as of now" row — sets the on-hand the Demand Sensing Agent
            # will pick up as starting inventory.
            db.add(PosHourlyActual(
                sku=sku,
                node_id=store,
                timestamp_hour=now.isoformat(),
                units_sold=0.0,
                on_hand_snapshot_qty=running,
            ))
