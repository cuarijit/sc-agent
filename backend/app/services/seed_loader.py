from __future__ import annotations

import csv
import json
import math
import os
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.orm import Session
from statistics import NormalDist

from ..database import Base, engine
from ..models import (
    AutonomousAction,
    AutonomousRun,
    AuditLog,
    Document,
    DocumentChunk,
    InventoryLedger,
    InventoryProjectionProductConfig,
    LocationMaster,
    NetworkAgentResult,
    NetworkAlert,
    NetworkBREValue,
    NetworkDemandSignal,
    NetworkForecastWeekly,
    NetworkActualWeekly,
    NetworkInventorySnapshot,
    NetworkLane,
    NetworkNode,
    NetworkNodeProductScope,
    NetworkPosWeekly,
    NetworkScenario,
    NetworkScenarioChange,
    NetworkSimulationMetric,
    NetworkSimulationRun,
    NetworkSkuLocationParameter,
    NetworkSourcingRule,
    ParameterException,
    ParameterValue,
    PlanningRun,
    ProjectionPoint,
    ProductMaster,
    Recommendation,
    ReplenishmentOrder,
    ReplenishmentOrderAlertLink,
    ReplenishmentOrderDetail,
    SupplierMaster,
    SourcingOption,
    SimulationScenario,
    DemandForecast,
    DemandPromotion,
    DemandConsensusEntry,
    DemandForecastAccuracy,
    DemandException,
    SopCycle,
    SopReviewItem,
    FinancialPlan,
    CustomerHierarchy,
)


SEED_DIR = Path(os.getenv("ASC_SEED_DIR", str(Path(__file__).resolve().parents[2] / "data" / "seed")))

REQUIRED_TABLE_COLUMNS = {
    "recommendations": {"run_id", "sku", "product_name", "category", "location", "region", "supplier", "status", "action", "eta"},
    "products": {"sku", "name", "brand", "category"},
    "locations": {"code", "name", "location_type", "region"},
    "suppliers": {"code", "name", "incoterm", "lead_time_days"},
    "documents": {"title", "source_path", "document_type", "vendor", "topic", "content"},
    "network_nodes": {"node_id", "name", "node_type", "region", "default_strategy"},
    "network_lanes": {"lane_id", "origin_node_id", "dest_node_id", "mode", "transit_time_mean_days"},
    "network_sourcing_rules": {"sku", "dest_node_id", "parent_location_node_id", "source_mode", "sourcing_strategy", "is_customer_facing_node"},
    "network_sku_location_parameters": {"sku", "location_node_id", "parent_location_node_id", "parameter_code"},
    "network_alerts": {"alert_id", "alert_type", "severity", "impacted_node_id", "impacted_sku"},
    "network_forecast_weekly": {"sku", "node_id", "week_start", "forecast_qty"},
    "network_actual_weekly": {"sku", "node_id", "week_start", "actual_qty"},
    "network_inventory_snapshot": {"sku", "node_id", "as_of_date", "on_hand_qty"},
    "network_pos_weekly": {"sku", "node_id", "week_start", "pos_qty"},
    "replenishment_orders": {"order_id", "alert_id", "order_type", "is_exception", "ship_to_node_id", "sku", "order_qty"},
    "replenishment_order_details": {"order_id", "sku", "ship_to_node_id", "ship_from_node_id", "order_qty"},
}


def _ensure_inventory_projection_seed(db: Session) -> None:
    if db.query(ProductMaster).count() == 0:
        return

    locations = [item.code for item in db.query(LocationMaster).order_by(LocationMaster.code.asc()).all()]
    skus = [item.sku for item in db.query(ProductMaster).order_by(ProductMaster.sku.asc()).all()]
    if not skus:
        return
    if not locations:
        locations = [None]

    base_monday = date(2026, 3, 9)

    existing_cfg_skus = {row.product_id for row in db.query(InventoryProjectionProductConfig).all()}
    existing_ledger_keys = {
        (row.product_id, row.location_code or "", row.type, row.week_start_date): row.quantity
        for row in db.query(InventoryLedger).all()
    }

    seeded_any = False

    demo_example_map: dict[tuple[int, int], str] = {}
    if skus and locations:
        demo_example_map[(0, 0)] = "low_1"
        if len(skus) > 1 and len(locations) > 1:
            demo_example_map[(1, 1)] = "stockout_1"
        if len(skus) > 2 and len(locations) > 2:
            demo_example_map[(2, 2)] = "stockout_2"
        if len(skus) > 3 and len(locations) > 3:
            demo_example_map[(3, 3)] = "low_2"

    for sku_idx, sku in enumerate(skus):
        lead_time_days = 14 + (sku_idx % 3) * 7
        service_level_target = min(0.99, 0.93 + (sku_idx % 4) * 0.015)
        demand_std_dev = 26 + (sku_idx % 5) * 5
        if sku not in existing_cfg_skus:
            db.add(
                InventoryProjectionProductConfig(
                    product_id=sku,
                    lead_time_days=lead_time_days,
                    service_level_target=service_level_target,
                    demand_std_dev=demand_std_dev,
                )
            )
            seeded_any = True

        for loc_idx, location_code in enumerate(locations):
            loc_key = location_code or ""
            demo_profile = demo_example_map.get((sku_idx, loc_idx))

            opening_stock = max(220.0, 920.0 - sku_idx * 55.0 - loc_idx * 35.0)
            if demo_profile in {"low_1", "low_2"}:
                opening_stock = 300.0 if demo_profile == "low_1" else 520.0
            if demo_profile in {"stockout_1", "stockout_2"}:
                opening_stock = 255.0 if demo_profile == "stockout_1" else 235.0

            forecast_by_week: dict[int, float] = {}
            for week_offset in range(1, 13):
                base_forecast = float(112 + sku_idx * 14 + loc_idx * 6 + week_offset * 4 + (18 if week_offset % 4 == 0 else 0))
                if demo_profile in {"low_1", "low_2"}:
                    base_forecast += 24.0 if week_offset in (2, 3, 5, 7) else 0.0
                if demo_profile == "low_1":
                    base_forecast += 42.0 if week_offset in (3, 5, 7) else 0.0
                if demo_profile in {"stockout_1", "stockout_2"}:
                    base_forecast += 52.0 if demo_profile == "stockout_1" else 64.0
                forecast_by_week[week_offset] = round(base_forecast, 2)

            orders_by_week: dict[int, float] = {}
            if demo_profile:
                bounded_service = min(0.999, max(0.5, service_level_target))
                z = float(NormalDist().inv_cdf(bounded_service))
                lead_time_weeks = max(1.0, lead_time_days / 7.0)
                safety_stock = round(z * demand_std_dev * math.sqrt(lead_time_weeks), 2)
                avg_demand = sum(forecast_by_week.values()) / 12.0
                reorder_point = round((avg_demand * lead_time_weeks) + safety_stock, 2)
                running = opening_stock
                for week_offset in range(1, 13):
                    if week_offset == 1:
                        orders = 0.0
                    elif running < reorder_point:
                        if demo_profile in {"low_1", "low_2"}:
                            orders = 150.0 if demo_profile == "low_1" else 190.0
                        else:
                            orders = 48.0 if demo_profile == "stockout_1" else 30.0
                    else:
                        orders = 0.0
                    forecast = forecast_by_week[week_offset]
                    projected = running - forecast + orders
                    orders_by_week[week_offset] = round(orders, 2)
                    running = round(projected, 2)
            else:
                for week_offset in range(1, 13):
                    if week_offset % 4 == 0:
                        orders_qty = float(290 + sku_idx * 36 + loc_idx * 12)
                    elif week_offset % 2 == 0:
                        orders_qty = float(96 + sku_idx * 12 + loc_idx * 6)
                    else:
                        orders_qty = float(34 + sku_idx * 8 + loc_idx * 4)
                    orders_by_week[week_offset] = round(orders_qty, 2)

            snapshot_key = (sku, loc_key, "on_hand_snapshot", base_monday.isoformat())
            if snapshot_key not in existing_ledger_keys:
                db.add(
                    InventoryLedger(
                        product_id=sku,
                        location_code=location_code,
                        week_start_date=base_monday.isoformat(),
                        type="on_hand_snapshot",
                        quantity=opening_stock,
                    )
                )
                seeded_any = True
            elif demo_profile:
                snapshot_row = db.query(InventoryLedger).filter(
                    InventoryLedger.product_id == sku,
                    InventoryLedger.location_code == location_code,
                    InventoryLedger.type == "on_hand_snapshot",
                    InventoryLedger.week_start_date == base_monday.isoformat(),
                ).first()
                if snapshot_row and float(snapshot_row.quantity) != float(opening_stock):
                    snapshot_row.quantity = float(opening_stock)
                    seeded_any = True

            for week_offset in range(1, 13):
                week_start = (base_monday + timedelta(days=7 * (week_offset - 1))).isoformat()
                forecast_key = (sku, loc_key, "forecast", week_start)
                orders_key = (sku, loc_key, "confirmed_order", week_start)
                forecast_qty = forecast_by_week[week_offset]
                orders_qty = orders_by_week[week_offset]

                if forecast_key not in existing_ledger_keys:
                    db.add(
                        InventoryLedger(
                            product_id=sku,
                            location_code=location_code,
                            week_start_date=week_start,
                            type="forecast",
                            quantity=forecast_qty,
                        )
                    )
                    seeded_any = True
                elif demo_profile:
                    forecast_row = db.query(InventoryLedger).filter(
                        InventoryLedger.product_id == sku,
                        InventoryLedger.location_code == location_code,
                        InventoryLedger.type == "forecast",
                        InventoryLedger.week_start_date == week_start,
                    ).first()
                    if forecast_row and float(forecast_row.quantity) != float(forecast_qty):
                        forecast_row.quantity = float(forecast_qty)
                        seeded_any = True

                if orders_key not in existing_ledger_keys:
                    db.add(
                        InventoryLedger(
                            product_id=sku,
                            location_code=location_code,
                            week_start_date=week_start,
                            type="confirmed_order",
                            quantity=orders_qty,
                        )
                    )
                    seeded_any = True
                elif demo_profile:
                    orders_row = db.query(InventoryLedger).filter(
                        InventoryLedger.product_id == sku,
                        InventoryLedger.location_code == location_code,
                        InventoryLedger.type == "confirmed_order",
                        InventoryLedger.week_start_date == week_start,
                    ).first()
                    if orders_row and float(orders_row.quantity) != float(orders_qty):
                        orders_row.quantity = float(orders_qty)
                        seeded_any = True

    if seeded_any:
        db.commit()


def _seed_network_data(db: Session) -> None:
    if db.query(NetworkNode).count():
        return
    regions = ["NORTHEAST", "SOUTHEAST", "FLORIDA", "MIDWEST", "SOUTHWEST"]
    products = [row.sku for row in db.query(ProductMaster).all()]
    if not products:
        products = [f"SKU-{idx:03d}" for idx in range(1, 13)]

    # Demo hierarchy: 1 parent source (plant) -> 2 CDCs -> 2–3 RDCs per CDC (5 RDCs) -> 5–10 stores per RDC (7 each = 35 stores). Single sourcing only.
    nodes: list[NetworkNode] = []
    nodes.append(
        NetworkNode(
            node_id="PLANT-001",
            name="National Plant",
            node_type="plant",
            region=regions[0],
            lat=35.0,
            lon=-90.0,
            status="active",
            storage_capacity=80000,
            throughput_limit=60000,
            crossdock_capable=False,
            holding_cost_per_unit=0.8,
            handling_cost_per_unit=1.1,
            service_level_target=0.96,
            production_batch_size=1000,
            production_freeze_days=2,
            cycle_time_days=3.0,
            shelf_space_limit=0,
            default_strategy="push",
            metadata_json=json.dumps({"site": "owned"}),
        )
    )
    for idx in range(1, 3):
        nodes.append(
            NetworkNode(
                node_id=f"CDC-{idx:03d}",
                name=f"CDC {idx}",
                node_type="cdc",
                region=regions[idx % len(regions)],
                lat=32.0 + idx,
                lon=-88.0 + idx,
                status="active",
                storage_capacity=50000,
                throughput_limit=40000,
                crossdock_capable=(idx % 2 == 0),
                holding_cost_per_unit=1.15,
                handling_cost_per_unit=1.4,
                service_level_target=0.97,
                production_batch_size=0,
                production_freeze_days=0,
                cycle_time_days=0,
                shelf_space_limit=0,
                default_strategy="push",
                metadata_json=json.dumps({"tier": "central"}),
            )
        )
    for idx in range(1, 6):
        nodes.append(
            NetworkNode(
                node_id=f"RDC-{idx:03d}",
                name=f"RDC {idx}",
                node_type="rdc",
                region=regions[idx % len(regions)],
                lat=33.0 + idx,
                lon=-86.0 + idx,
                status="active",
                storage_capacity=28000 + idx * 800,
                throughput_limit=24000 + idx * 600,
                crossdock_capable=True,
                holding_cost_per_unit=1.35,
                handling_cost_per_unit=1.75,
                service_level_target=0.98,
                production_batch_size=0,
                production_freeze_days=0,
                cycle_time_days=0,
                shelf_space_limit=0,
                default_strategy="pull",
                metadata_json=json.dumps({"tier": "regional"}),
            )
        )
    for idx in range(1, 36):
        nodes.append(
            NetworkNode(
                node_id=f"STORE-{idx:03d}",
                name=f"Store {idx}",
                node_type="store",
                region=regions[idx % len(regions)],
                lat=35.0 + (idx % 10) * 0.2,
                lon=-80.0 + (idx % 10) * 0.3,
                status="active",
                storage_capacity=4200 + idx * 90,
                throughput_limit=3500 + idx * 70,
                crossdock_capable=False,
                holding_cost_per_unit=1.9,
                handling_cost_per_unit=0.7,
                service_level_target=0.99,
                production_batch_size=0,
                production_freeze_days=0,
                cycle_time_days=0,
                shelf_space_limit=1500 + idx * 12,
                default_strategy="pull",
                metadata_json=json.dumps({"channel": "retail"}),
            )
        )
    db.add_all(nodes)
    db.flush()

    plant_id = "PLANT-001"
    cdc_ids = ["CDC-001", "CDC-002"]
    # RDC-001, RDC-002 from CDC-001; RDC-003, RDC-004, RDC-005 from CDC-002
    rdc_to_cdc: dict[str, str] = {
        "RDC-001": "CDC-001",
        "RDC-002": "CDC-001",
        "RDC-003": "CDC-002",
        "RDC-004": "CDC-002",
        "RDC-005": "CDC-002",
    }
    rdc_ids = ["RDC-001", "RDC-002", "RDC-003", "RDC-004", "RDC-005"]
    stores_per_rdc = 7
    store_ids = [f"STORE-{i:03d}" for i in range(1, len(rdc_ids) * stores_per_rdc + 1)]

    lanes: list[NetworkLane] = []
    lane_seq = 1
    for cdc in cdc_ids:
        lanes.append(
            NetworkLane(
                lane_id=f"LANE-{lane_seq:04d}",
                origin_node_id=plant_id,
                dest_node_id=cdc,
                mode="tl",
                lane_status="active",
                cost_function_type="linear",
                cost_per_unit=1.5,
                cost_per_mile=0.55,
                fixed_cost=350,
                transit_time_mean_days=3.0,
                transit_time_std_days=0.5,
                capacity_limit=30000,
                is_default_route=True,
            )
        )
        lane_seq += 1
    for rdc, cdc in rdc_to_cdc.items():
        lanes.append(
            NetworkLane(
                lane_id=f"LANE-{lane_seq:04d}",
                origin_node_id=cdc,
                dest_node_id=rdc,
                mode="ltl",
                lane_status="active",
                cost_function_type="linear",
                cost_per_unit=2.0,
                cost_per_mile=0.65,
                fixed_cost=400,
                transit_time_mean_days=1.8,
                transit_time_std_days=0.45,
                capacity_limit=20000,
                is_default_route=True,
            )
        )
        lane_seq += 1
    for rdc_idx, rdc in enumerate(rdc_ids):
        start = rdc_idx * stores_per_rdc
        for i in range(stores_per_rdc):
            store_id = store_ids[start + i]
            lanes.append(
                NetworkLane(
                    lane_id=f"LANE-{lane_seq:04d}",
                    origin_node_id=rdc,
                    dest_node_id=store_id,
                    mode="ltl",
                    lane_status="active",
                    cost_function_type="linear",
                    cost_per_unit=2.6,
                    cost_per_mile=0.4,
                    fixed_cost=100,
                    transit_time_mean_days=1.2,
                    transit_time_std_days=0.25,
                    capacity_limit=5000,
                    is_default_route=True,
                )
            )
            lane_seq += 1
    db.add_all(lanes)

    scope_rows: list[NetworkNodeProductScope] = []
    for node in nodes:
        if node.node_type == "store":
            for sku in products[:6]:
                scope_rows.append(
                    NetworkNodeProductScope(
                        node_id=node.node_id,
                        sku=sku,
                        strategy_override="pull",
                        service_level_override=0.99,
                        stocking_flag=True,
                        sourcing_role="destination",
                    )
                )
        else:
            for sku in products[:6]:
                scope_rows.append(
                    NetworkNodeProductScope(
                        node_id=node.node_id,
                        sku=sku,
                        strategy_override=node.default_strategy,
                        service_level_override=0.97 if node.node_type in {"cdc", "rdc"} else 0.96,
                        stocking_flag=node.node_type != "plant",
                        sourcing_role="source" if node.node_type == "plant" else "buffer",
                    )
                )
    db.add_all(scope_rows)

    demand_rows: list[NetworkDemandSignal] = []
    week_starts = [f"2026-0{month}-{day:02d}" for month in range(4, 10) for day in [1, 8, 15]]
    for store_idx, store_id in enumerate(store_ids):
        for sku_idx, sku in enumerate(products[:8]):
            for week_idx, week in enumerate(week_starts):
                if len(demand_rows) >= 760:
                    break
                forecast = 180 + (store_idx % 8) * 12 + sku_idx * 10 + week_idx * 3
                actual = forecast * (0.9 + (week_idx % 4) * 0.03)
                demand_rows.append(
                    NetworkDemandSignal(
                        sku=sku,
                        dest_node_id=store_id,
                        week_start=week,
                        forecast_qty=forecast,
                        actual_qty=round(actual, 2),
                        volatility_index=0.08 + (store_idx % 5) * 0.02,
                        demand_class="volatile" if store_idx % 4 == 0 else "stable",
                    )
                )
            if len(demand_rows) >= 760:
                break
        if len(demand_rows) >= 760:
            break
    db.add_all(demand_rows)

    sourcing_rows: list[NetworkSourcingRule] = []
    canonical_keys: list[tuple[str, str, str]] = []

    def add_sourcing(
        sku: str,
        dest_node: str,
        parent_node: str,
        strategy: str,
        customer_facing: bool,
    ) -> None:
        sourcing_rows.append(
            NetworkSourcingRule(
                sku=sku,
                dest_node_id=dest_node,
                parent_location_node_id=parent_node,
                source_mode="single_source",
                primary_source_node_id=parent_node,
                secondary_source_node_id=None,
                split_ratio=1.0,
                incoterm="FOB",
                explicit_lead_time_days=2.0 + (abs(hash(f"{sku}|{dest_node}|{parent_node}")) % 5) * 0.3,
                sourcing_strategy=strategy,
                is_customer_facing_node=customer_facing,
            )
        )
        canonical_keys.append((sku, dest_node, parent_node))

    # Single-sourcing demo: Plant -> CDC -> RDC -> Store for all scoped SKUs.
    demo_skus = products[:6]
    for sku in demo_skus:
        for cdc in cdc_ids:
            add_sourcing(sku, cdc, plant_id, "push", False)
        for rdc, cdc in rdc_to_cdc.items():
            add_sourcing(sku, rdc, cdc, "pull", False)
        for rdc_idx, rdc in enumerate(rdc_ids):
            start = rdc_idx * stores_per_rdc
            for i in range(stores_per_rdc):
                store_id = store_ids[start + i]
                add_sourcing(sku, store_id, rdc, "pull", True)

    db.add_all(sourcing_rows)
    # Session uses autoflush=False; flush sourcing rows before deriving alert coverage.
    db.flush()

    parameter_rows: list[NetworkSkuLocationParameter] = []
    for idx, (sku, location_node_id, parent_location_node_id) in enumerate(canonical_keys):
        parameter_rows.extend(
            [
                NetworkSkuLocationParameter(
                    sku=sku,
                    location_node_id=location_node_id,
                    parent_location_node_id=parent_location_node_id,
                    parameter_code="service_level_target",
                    parameter_value=str(round(0.97 + (idx % 3) * 0.01, 3)),
                    source_type="network_seed",
                    reason="Seeded to align with sourcing key.",
                ),
                NetworkSkuLocationParameter(
                    sku=sku,
                    location_node_id=location_node_id,
                    parent_location_node_id=parent_location_node_id,
                    parameter_code="lead_time_days",
                    parameter_value=str(round(2.0 + (idx % 4) * 0.4, 2)),
                    source_type="network_seed",
                    reason="Seeded to align with sourcing key.",
                ),
                NetworkSkuLocationParameter(
                    sku=sku,
                    location_node_id=location_node_id,
                    parent_location_node_id=parent_location_node_id,
                    parameter_code="min_batch_size",
                    parameter_value=str(200 + (idx % 5) * 40),
                    source_type="network_seed",
                    reason="Seeded to align with sourcing key.",
                ),
            ]
        )
    db.add_all(parameter_rows)

    node_sku_pairs = sorted({(sku, location_node_id) for sku, location_node_id, _ in canonical_keys})
    today = date(2026, 3, 8)
    forecast_rows: list[NetworkForecastWeekly] = []
    actual_rows: list[NetworkActualWeekly] = []
    inventory_rows: list[NetworkInventorySnapshot] = []
    pos_rows: list[NetworkPosWeekly] = []
    node_by_id = {item.node_id: item for item in nodes}
    for idx, (sku, node_id) in enumerate(node_sku_pairs):
        base = 80 + (idx % 17) * 7
        inventory_rows.append(
            NetworkInventorySnapshot(
                sku=sku,
                node_id=node_id,
                as_of_date=today.isoformat(),
                on_hand_qty=round(base * 2.8 + (idx % 5) * 35, 2),
            )
        )
        for week in range(13):
            week_start = (today + timedelta(days=7 * week)).isoformat()
            forecast_rows.append(
                NetworkForecastWeekly(
                    sku=sku,
                    node_id=node_id,
                    week_start=week_start,
                    forecast_qty=round(base + week * 4 + (idx % 3) * 6, 2),
                )
            )
        for week in range(52):
            week_start = (today - timedelta(days=7 * (week + 1))).isoformat()
            actual_rows.append(
                NetworkActualWeekly(
                    sku=sku,
                    node_id=node_id,
                    week_start=week_start,
                    actual_qty=round(base * 0.92 + (week % 6) * 3 + (idx % 4) * 2, 2),
                )
            )
        node = node_by_id.get(node_id)
        if node and node.node_type in {"store", "online_rdc"}:
            for week in range(26):
                week_start = (today - timedelta(days=7 * (week + 1))).isoformat()
                pos_rows.append(
                    NetworkPosWeekly(
                        sku=sku,
                        node_id=node_id,
                        week_start=week_start,
                        pos_qty=round(base * 0.55 + (week % 5) * 2.5, 2),
                    )
                )
    db.add_all(forecast_rows)
    db.add_all(actual_rows)
    db.add_all(inventory_rows)
    db.add_all(pos_rows)

    bre_rows: list[NetworkBREValue] = []
    for idx in range(1, 91):
        bre_rows.append(
            NetworkBREValue(
                key="lane_cost_default" if idx % 2 == 0 else "lead_time_default",
                node_type=["supplier", "plant", "cdc", "rdc", "store"][idx % 5],
                region=regions[idx % len(regions)],
                mode=["tl", "ltl", "parcel", "air"][idx % 4],
                supplier=f"SUP-{(idx % 4) + 1:03d}",
                sku=products[idx % len(products)],
                value=1.2 + idx * 0.05,
                unit="usd_per_unit" if idx % 2 == 0 else "days",
            )
        )
    db.add_all(bre_rows)

    _reseed_network_alerts(db)
    # Session uses autoflush=False; flush alerts before deriving replenishment orders.
    db.flush()
    _reseed_replenishment_orders(db)

    scenarios: list[NetworkScenario] = []
    scenario_names = [
        "FY26 Northeast Expansion Plan",
        "Florida Flood Shutdown Mitigation",
        "Mexico Production Shift",
        "Direct Ship Pilot",
        "Push Pull Boundary Redesign",
        "3PL Backup Activation",
        "99 Service Uplift Northeast",
        "Plant Batch Delay LT Derived",
        "Dual Source Recovery",
        "Store Cluster Reallocation",
    ]
    for idx, name in enumerate(scenario_names, start=1):
        scenarios.append(
            NetworkScenario(
                scenario_id=f"NET-SCN-{idx:03d}",
                scenario_name=name,
                base_version="BASELINE-V1",
                status="saved" if idx <= 4 else "draft",
                created_at=f"2026-03-{idx:02d}T09:00:00",
                created_by="planner",
                origin_context="alert" if idx % 2 == 0 else "manual",
                notes="Auto-seeded network scenario.",
            )
        )
    db.add_all(scenarios)
    db.flush()

    changes: list[NetworkScenarioChange] = []
    for idx, scenario in enumerate(scenarios, start=1):
        changes.append(
            NetworkScenarioChange(
                scenario_id=scenario.scenario_id,
                change_type="add_node",
                entity_type="node",
                entity_id=f"RDC-NEW-{idx:03d}",
                payload_json=json.dumps(
                    {
                        "node_id": f"RDC-NEW-{idx:03d}",
                        "name": f"Planned RDC {idx}",
                        "node_type": "rdc",
                        "region": regions[idx % len(regions)],
                        "lat": 36.0 + idx * 0.2,
                        "lon": -79.0 + idx * 0.2,
                        "status": "planned",
                        "storage_capacity": 21000 + idx * 500,
                        "throughput_limit": 18000 + idx * 400,
                        "crossdock_capable": True,
                        "holding_cost_per_unit": 1.3,
                        "handling_cost_per_unit": 1.7,
                        "service_level_target": 0.98,
                        "production_batch_size": 0,
                        "production_freeze_days": 0,
                        "cycle_time_days": 0,
                        "shelf_space_limit": 0,
                        "default_strategy": "pull",
                        "metadata_json": json.dumps({"planned": True}),
                    }
                ),
            )
        )
        changes.append(
            NetworkScenarioChange(
                scenario_id=scenario.scenario_id,
                change_type="add_lane",
                entity_type="lane",
                entity_id=f"LANE-PLAN-{idx:03d}",
                payload_json=json.dumps(
                    {
                        "lane_id": f"LANE-PLAN-{idx:03d}",
                        "origin_node_id": cdc_ids[idx % len(cdc_ids)],
                        "dest_node_id": f"RDC-NEW-{idx:03d}",
                        "mode": "ltl",
                        "lane_status": "active",
                        "cost_function_type": "linear",
                        "cost_per_unit": 2.2,
                        "cost_per_mile": 0.62,
                        "fixed_cost": 420.0,
                        "transit_time_mean_days": 1.9,
                        "transit_time_std_days": 0.3,
                        "capacity_limit": 16000.0,
                        "is_default_route": False,
                    }
                ),
            )
        )
    db.add_all(changes)

    runs: list[NetworkSimulationRun] = []
    metrics: list[NetworkSimulationMetric] = []
    for idx, scenario in enumerate(scenarios[:6], start=1):
        run_id = f"NET-RUN-{idx:04d}"
        runs.append(
            NetworkSimulationRun(
                run_id=run_id,
                scenario_id=scenario.scenario_id,
                run_status="completed",
                started_at=f"2026-03-{idx:02d}T11:00:00",
                completed_at=f"2026-03-{idx:02d}T11:01:00",
                engine_version="network-hybrid-v1",
                summary_json=json.dumps({"seeded": True, "run_id": run_id}),
            )
        )
        for metric_name, base, scn in [
            ("service_level", 0.972, 0.976 - idx * 0.001),
            ("transport_cost", 128000.0, 126500.0 + idx * 800),
            ("inventory_cost", 84000.0, 85200.0 + idx * 500),
            ("margin_delta", 0.0, -1.4 + idx * 0.2),
        ]:
            metrics.append(
                NetworkSimulationMetric(
                    run_id=run_id,
                    metric_name=metric_name,
                    baseline_value=base,
                    scenario_value=scn,
                    delta_value=round(scn - base, 4),
                )
            )
    db.add_all(runs)
    db.add_all(metrics)

    agent_examples = [
        "Show me the impact of Florida DC shutdown due to flood on this quarter margins.",
        "Would a Northeast RDC reduce service risk?",
        "Should we ship direct from plant to store in Southeast?",
        "Move decoupling point from CDC to RDC and compare.",
        "What if we switch Florida to dual source?",
        "How does a 99% service target affect safety stock?",
        "What happens if Plant 3 has a 2 day freeze delay?",
        "Should we activate East Coast 3PL backup?",
        "Can we reduce final mile cost in Midwest?",
        "Which node is best for push pull boundary?",
        "What is the impact of lane congestion on service?",
        "How to recover from supplier outage in Mexico?",
    ]
    for idx, prompt in enumerate(agent_examples, start=1):
        db.add(
            NetworkAgentResult(
                agent_run_id=f"NET-AGENT-{idx:04d}",
                scenario_id=scenarios[idx % len(scenarios)].scenario_id,
                question=prompt,
                response_json=json.dumps({"summary": "Seeded network agent result.", "recommended_option": "opt_3"}),
                staged_changes_json=json.dumps([]),
                recommended_option="opt_3",
                requires_approval=True,
            )
        )


def _read_csv(name: str) -> list[dict[str, str]]:
    path = SEED_DIR / name
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _keywords(text: str) -> str:
    tokens = sorted(set(re.findall(r"[a-zA-Z]{4,}", text.lower())))
    return " ".join(tokens[:32])


def _alert_id_excluded_from_bulk_replenishment_seed(alert_id: str) -> bool:
    """Alerts we pin to dedicated replenishment rows; keep them out of the bulk random assignment."""
    a = str(alert_id or "")
    if a.startswith("ALERT-RDC-REVIEW-"):
        return True
    return a in ("ALERT-SKUNODE-001", "ALERT-004", "ALERT-016", "ALERT-STORE17-SNACK003")


# Pinned demo orders + alert links (same order as appended after bulk reseed).
_DEMO_PINNED_ORDER_ALERT_IDS: tuple[str, ...] = (
    "ALERT-RDC-REVIEW-001",
    "ALERT-RDC-REVIEW-002",
    "ALERT-RDC-REVIEW-003",
    "ALERT-SKUNODE-001",
    "ALERT-004",
    "ALERT-016",
    "ALERT-STORE17-SNACK003",
)


def _build_network_alert_rows(
    canonical_keys: list[tuple[str, str, str]],
    lanes: list[NetworkLane],
) -> list[dict[str, str | None]]:
    # canonical key = (sku, location_node_id, parent_location_node_id)
    parent_to_skus: dict[str, set[str]] = {}
    location_to_skus: dict[str, set[str]] = {}
    sku_to_nodes: dict[str, set[str]] = {}
    for sku, location_node, parent_node in canonical_keys:
        parent_to_skus.setdefault(parent_node, set()).add(sku)
        location_to_skus.setdefault(location_node, set()).add(sku)
        sku_to_nodes.setdefault(sku, set()).add(location_node)

    parent_nodes = sorted(parent_to_skus.keys())
    location_nodes = sorted(location_to_skus.keys())
    multi_node_skus = sorted([sku for sku, nodes in sku_to_nodes.items() if len(nodes) >= 2]) or sorted(sku_to_nodes.keys())
    lane_ids = [item.lane_id for item in lanes] or ["LANE-0001"]

    node_only_node = parent_nodes[0] if parent_nodes else (location_nodes[0] if location_nodes else "UNKNOWN-NODE")
    sku_node_location = location_nodes[0] if location_nodes else "UNKNOWN-NODE"
    sku_node_sku = sorted(location_to_skus.get(sku_node_location, {"SKU-000"}))[0]
    sku_only_sku = multi_node_skus[0] if multi_node_skus else sku_node_sku

    rows: list[dict[str, str | None]] = [
        {
            "alert_id": "ALERT-NODE-001",
            "alert_type": "capacity",
            "severity": "warning",
            "title": f"Capacity Constraint - {node_only_node}",
            "description": "Node-level alert; all SKUs sourced through this node are impacted.",
            "impacted_node_id": node_only_node,
            "impacted_sku": None,
            "impacted_lane_id": lane_ids[0],
            "effective_from": "2026-03-08",
            "effective_to": None,
            "recommended_action_json": json.dumps({"association": "node", "action": "review_all_skus_for_node"}),
        },
        {
            "alert_id": "ALERT-SKUNODE-001",
            "alert_type": "service_risk",
            "severity": "critical",
            "title": f"SKU-Node Service Risk - {sku_node_sku} @ {sku_node_location}",
            "description": "SKU + node specific alert; only this SKU at this node is impacted.",
            "impacted_node_id": sku_node_location,
            "impacted_sku": sku_node_sku,
            "impacted_lane_id": lane_ids[1 % len(lane_ids)],
            "effective_from": "2026-03-08",
            "effective_to": None,
            "recommended_action_json": json.dumps({"association": "sku_node", "action": "focus_single_sku_node"}),
        },
        {
            "alert_id": "ALERT-SKU-001",
            "alert_type": "demand_spike",
            "severity": "warning",
            "title": f"SKU Demand Spike - {sku_only_sku}",
            "description": "SKU-level alert; all nodes sourcing this SKU are impacted.",
            "impacted_node_id": None,
            "impacted_sku": sku_only_sku,
            "impacted_lane_id": None,
            "effective_from": "2026-03-08",
            "effective_to": "2026-03-31",
            "recommended_action_json": json.dumps({"association": "sku", "action": "review_all_nodes_for_sku"}),
        },
        {
            "alert_id": "ALERT-INV-LOW-001",
            "alert_type": "service_risk",
            "severity": "warning",
            "title": f"Projected Inventory Below Safety Stock - {multi_node_skus[0] if multi_node_skus else sku_only_sku}",
            "description": "Inventory projection demo: projected on-hand drops below safety stock in future weeks.",
            "impacted_node_id": None,
            "impacted_sku": multi_node_skus[0] if multi_node_skus else sku_only_sku,
            "impacted_lane_id": None,
            "effective_from": "2026-03-09",
            "effective_to": "2026-06-01",
            "recommended_action_json": json.dumps({"association": "sku", "action": "review_projection_below_safety_stock"}),
        },
        {
            "alert_id": "ALERT-INV-STOCKOUT-001",
            "alert_type": "service_risk",
            "severity": "critical",
            "title": f"Projected Inventory Stockout - {multi_node_skus[1] if len(multi_node_skus) > 1 else sku_only_sku}",
            "description": "Inventory projection demo: projected on-hand becomes negative (stockout) in future weeks.",
            "impacted_node_id": None,
            "impacted_sku": multi_node_skus[1] if len(multi_node_skus) > 1 else sku_only_sku,
            "impacted_lane_id": None,
            "effective_from": "2026-03-09",
            "effective_to": "2026-06-01",
            "recommended_action_json": json.dumps({"association": "sku", "action": "trigger_stockout_mitigation"}),
        },
        {
            "alert_id": "ALERT-INV-LOW-002",
            "alert_type": "service_risk",
            "severity": "warning",
            "title": f"Projected Inventory Below Safety Stock (Demo 2) - {multi_node_skus[2] if len(multi_node_skus) > 2 else sku_only_sku}",
            "description": "Inventory projection demo 2: projected on-hand drops below safety stock in future weeks.",
            "impacted_node_id": None,
            "impacted_sku": multi_node_skus[2] if len(multi_node_skus) > 2 else sku_only_sku,
            "impacted_lane_id": None,
            "effective_from": "2026-03-09",
            "effective_to": "2026-06-01",
            "recommended_action_json": json.dumps({"association": "sku", "action": "review_projection_below_safety_stock"}),
        },
        {
            "alert_id": "ALERT-INV-STOCKOUT-002",
            "alert_type": "service_risk",
            "severity": "critical",
            "title": f"Projected Inventory Stockout (Demo 2) - {multi_node_skus[3] if len(multi_node_skus) > 3 else sku_only_sku}",
            "description": "Inventory projection demo 2: projected on-hand becomes negative (stockout) in future weeks.",
            "impacted_node_id": None,
            "impacted_sku": multi_node_skus[3] if len(multi_node_skus) > 3 else sku_only_sku,
            "impacted_lane_id": None,
            "effective_from": "2026-03-09",
            "effective_to": "2026-06-01",
            "recommended_action_json": json.dumps({"association": "sku", "action": "trigger_stockout_mitigation"}),
        },
    ]

    for idx in range(4, 25):
        association = idx % 3
        lane_id = lane_ids[idx % len(lane_ids)]
        if association == 0:
            target_node = parent_nodes[idx % len(parent_nodes)] if parent_nodes else location_nodes[idx % len(location_nodes)]
            rows.append(
                {
                    "alert_id": f"ALERT-{idx:03d}",
                    "alert_type": "capacity",
                    "severity": "warning" if idx % 2 == 0 else "info",
                    "title": f"Capacity Watch - {target_node}",
                    "description": "Node-level seeded alert.",
                    "impacted_node_id": target_node,
                    "impacted_sku": None,
                    "impacted_lane_id": lane_id,
                    "effective_from": "2026-03-08",
                    "effective_to": None,
                    "recommended_action_json": json.dumps({"association": "node", "action": "review_all_skus_for_node"}),
                }
            )
        elif association == 1:
            target_location = location_nodes[idx % len(location_nodes)]
            target_sku = sorted(location_to_skus[target_location])[idx % len(location_to_skus[target_location])]
            # Keep ALERT-004 / ALERT-016 active (not date-archived) for network + replenishment demos.
            sku_node_effective_to = None if idx in (4, 16) else "2026-03-25"
            rows.append(
                {
                    "alert_id": f"ALERT-{idx:03d}",
                    "alert_type": "service_risk",
                    "severity": "critical" if idx % 4 == 0 else "warning",
                    "title": f"SKU-Node Risk - {target_sku} @ {target_location}",
                    "description": "SKU+node seeded alert.",
                    "impacted_node_id": target_location,
                    "impacted_sku": target_sku,
                    "impacted_lane_id": lane_id,
                    "effective_from": "2026-03-08",
                    "effective_to": sku_node_effective_to,
                    "recommended_action_json": json.dumps({"association": "sku_node", "action": "focus_single_sku_node"}),
                }
            )
        else:
            target_sku = multi_node_skus[idx % len(multi_node_skus)] if multi_node_skus else sorted(sku_to_nodes.keys())[0]
            rows.append(
                {
                    "alert_id": f"ALERT-{idx:03d}",
                    "alert_type": "demand_spike",
                    "severity": "warning",
                    "title": f"SKU Demand Alert - {target_sku}",
                    "description": "SKU-level seeded alert.",
                    "impacted_node_id": None,
                    "impacted_sku": target_sku,
                    "impacted_lane_id": lane_id,
                    "effective_from": "2026-03-08",
                    "effective_to": "2026-03-31",
                    "recommended_action_json": json.dumps({"association": "sku", "action": "review_all_nodes_for_sku"}),
                }
            )

    # Dedicated alert: SNACK-003 @ STORE-017
    rows.append(
        {
            "alert_id": "ALERT-STORE17-SNACK003",
            "alert_type": "service_risk",
            "severity": "critical",
            "title": "Service Risk — SNACK-003 @ Store 17",
            "description": "Critical service risk for Savory Crunch Mix at Store 17 (Florida). Immediate replenishment review required.",
            "impacted_node_id": "STORE-017",
            "impacted_sku": "SNACK-003",
            "impacted_lane_id": lane_ids[0] if lane_ids else None,
            "effective_from": "2026-03-10",
            "effective_to": None,
            "recommended_action_json": json.dumps(
                {"association": "sku_node", "action": "store_critical_review", "demo": True}
            ),
        }
    )

    return rows


def _rdc_sku_lane_tuples_for_review_alerts(
    db: Session,
    lanes: list[NetworkLane],
    max_pairs: int = 4,
) -> list[tuple[str, str, str]]:
    """Distinct (sku, rdc_dest_node_id, lane_id) pairs where dest is an RDC (sourcing coverage for sku-node alerts)."""
    node_type_by_id = {row.node_id: str(row.node_type or "").lower() for row in db.query(NetworkNode).all()}
    lane_ids = [item.lane_id for item in lanes] or ["LANE-0001"]
    # Prefer distinct SKUs first so demo alerts span multiple products, then fill with extra RDC nodes.
    rows = (
        db.query(NetworkSourcingRule)
        .order_by(NetworkSourcingRule.sku.asc(), NetworkSourcingRule.dest_node_id.asc())
        .all()
    )
    rdc_rows = [
        row
        for row in rows
        if str(node_type_by_id.get(row.dest_node_id, "")).startswith("rdc")
    ]
    out: list[tuple[str, str, str]] = []
    seen_pair: set[tuple[str, str]] = set()
    used_skus: set[str] = set()

    def try_append(row: NetworkSourcingRule) -> bool:
        key = (row.sku, row.dest_node_id)
        if key in seen_pair:
            return False
        seen_pair.add(key)
        lane_id = lane_ids[len(out) % len(lane_ids)]
        out.append((row.sku, row.dest_node_id, lane_id))
        used_skus.add(row.sku)
        return True

    for row in rdc_rows:
        if row.sku in used_skus:
            continue
        if try_append(row) and len(out) >= max_pairs:
            return out
    for row in rdc_rows:
        if try_append(row) and len(out) >= max_pairs:
            break
    return out


def _append_rdc_critical_review_alert_rows(
    db: Session,
    rows: list[dict[str, str | None]],
    lanes: list[NetworkLane],
) -> None:
    """Extra critical SKU@RDC alerts for replenishment 'needs review' demo; requires matching sourcing rows."""
    pairs = _rdc_sku_lane_tuples_for_review_alerts(db, lanes, max_pairs=3)
    if not pairs:
        return
    fixed_ids = [
        "ALERT-RDC-REVIEW-001",
        "ALERT-RDC-REVIEW-002",
        "ALERT-RDC-REVIEW-003",
    ]
    existing = {str(r.get("alert_id")) for r in rows}
    for idx, alert_id in enumerate(fixed_ids):
        if idx >= len(pairs):
            break
        if alert_id in existing:
            continue
        sku, rdc_node, lane_id = pairs[idx]
        rows.append(
            {
                "alert_id": alert_id,
                "alert_type": "service_risk",
                "severity": "critical",
                "title": f"Critical RDC service risk — {sku} @ {rdc_node}",
                "description": (
                    "Seeded critical alert at an RDC: review open replenishment exceptions tied to this SKU and node."
                ),
                "impacted_node_id": rdc_node,
                "impacted_sku": sku,
                "impacted_lane_id": lane_id,
                "effective_from": "2026-03-10",
                "effective_to": "2026-04-15",
                "recommended_action_json": json.dumps(
                    {"association": "sku_node", "action": "rdc_critical_review", "demo": True}
                ),
            }
        )
        existing.add(alert_id)


def _alert_has_coverage(alert: NetworkAlert, source_rows: list[NetworkSourcingRule]) -> bool:
    if alert.impacted_node_id and alert.impacted_sku:
        return any(
            row.sku == alert.impacted_sku and row.dest_node_id == alert.impacted_node_id
            for row in source_rows
        )
    if alert.impacted_node_id:
        return any(row.dest_node_id == alert.impacted_node_id for row in source_rows)
    if alert.impacted_sku:
        return any(row.sku == alert.impacted_sku for row in source_rows)
    return False


def _reseed_network_alerts(db: Session) -> None:
    source_rows = db.query(NetworkSourcingRule).all()
    lanes = db.query(NetworkLane).all()
    canonical_keys = sorted({(row.sku, row.dest_node_id, row.parent_location_node_id or "") for row in source_rows})
    if not canonical_keys:
        return
    db.query(NetworkAlert).delete()
    rows = _build_network_alert_rows(canonical_keys, lanes)
    _append_rdc_critical_review_alert_rows(db, rows, lanes)
    db.add_all(
        [
            NetworkAlert(
                alert_id=str(row["alert_id"]),
                alert_type=str(row["alert_type"]),
                severity=str(row["severity"]),
                title=str(row["title"]),
                description=str(row["description"]),
                impacted_node_id=row["impacted_node_id"],
                impacted_sku=row["impacted_sku"],
                impacted_lane_id=row["impacted_lane_id"],
                effective_from=str(row["effective_from"]),
                effective_to=row["effective_to"],
                recommended_action_json=row["recommended_action_json"],
            )
            for row in rows
        ]
    )
    # SessionLocal uses autoflush=False, so flush here to make freshly reseeded
    # alerts queryable by downstream alignment/update helpers in the same tx.
    db.flush()


def _ensure_inventory_projection_demo_alerts(db: Session) -> bool:
    skus = [row.sku for row in db.query(ProductMaster).order_by(ProductMaster.sku.asc()).all()]
    if not skus:
        return False
    sourcing_rows = db.query(NetworkSourcingRule).all()
    node_type_by_id = {row.node_id: str(row.node_type or "").lower() for row in db.query(NetworkNode).all()}
    sku_to_nodes: dict[str, list[str]] = {}
    for row in sourcing_rows:
        sku_to_nodes.setdefault(row.sku, []).append(row.dest_node_id)
    for key in list(sku_to_nodes.keys()):
        sku_to_nodes[key] = sorted(set(sku_to_nodes[key]))

    def pick_node_for_sku(sku: str) -> str | None:
        nodes = sku_to_nodes.get(sku, [])
        if not nodes:
            return None
        preferred_store = next((node for node in nodes if node_type_by_id.get(node, "").startswith("store")), None)
        if preferred_store:
            return preferred_store
        preferred_rdc = next((node for node in nodes if node_type_by_id.get(node, "").startswith("rdc")), None)
        if preferred_rdc:
            return preferred_rdc
        return nodes[0]

    low_ss_sku_1 = skus[0]
    stockout_sku_1 = skus[1] if len(skus) > 1 else skus[0]
    low_ss_sku_2 = skus[3] if len(skus) > 3 else skus[-1]
    stockout_sku_2 = skus[2] if len(skus) > 2 else skus[-1]
    low_ss_node_1 = pick_node_for_sku(low_ss_sku_1)
    stockout_node_1 = pick_node_for_sku(stockout_sku_1)
    low_ss_node_2 = pick_node_for_sku(low_ss_sku_2)
    stockout_node_2 = pick_node_for_sku(stockout_sku_2)
    payloads = [
        {
            "alert_id": "ALERT-INV-LOW-001",
            "alert_type": "service_risk",
            "severity": "warning",
            "title": f"Projected Inventory Below Safety Stock - {low_ss_sku_1}",
            "description": "Inventory projection demo: projected on-hand drops below safety stock in future weeks.",
            "impacted_node_id": low_ss_node_1,
            "impacted_sku": low_ss_sku_1,
            "recommended_action_json": json.dumps({"association": "sku", "action": "review_projection_below_safety_stock"}),
        },
        {
            "alert_id": "ALERT-INV-STOCKOUT-001",
            "alert_type": "service_risk",
            "severity": "critical",
            "title": f"Projected Inventory Stockout - {stockout_sku_1}",
            "description": "Inventory projection demo: projected on-hand becomes negative (stockout) in future weeks.",
            "impacted_node_id": stockout_node_1,
            "impacted_sku": stockout_sku_1,
            "recommended_action_json": json.dumps({"association": "sku", "action": "trigger_stockout_mitigation"}),
        },
        {
            "alert_id": "ALERT-INV-LOW-002",
            "alert_type": "service_risk",
            "severity": "warning",
            "title": f"Projected Inventory Below Safety Stock (Demo 2) - {low_ss_sku_2}",
            "description": "Inventory projection demo 2: projected on-hand drops below safety stock in future weeks.",
            "impacted_node_id": low_ss_node_2,
            "impacted_sku": low_ss_sku_2,
            "recommended_action_json": json.dumps({"association": "sku", "action": "review_projection_below_safety_stock"}),
        },
        {
            "alert_id": "ALERT-INV-STOCKOUT-002",
            "alert_type": "service_risk",
            "severity": "critical",
            "title": f"Projected Inventory Stockout (Demo 2) - {stockout_sku_2}",
            "description": "Inventory projection demo 2: projected on-hand becomes negative (stockout) in future weeks.",
            "impacted_node_id": stockout_node_2,
            "impacted_sku": stockout_sku_2,
            "recommended_action_json": json.dumps({"association": "sku", "action": "trigger_stockout_mitigation"}),
        },
    ]
    changed = False
    for payload in payloads:
        row = db.query(NetworkAlert).filter(NetworkAlert.alert_id == payload["alert_id"]).first()
        if row is None:
            db.add(
                NetworkAlert(
                    alert_id=str(payload["alert_id"]),
                    alert_type=str(payload["alert_type"]),
                    severity=str(payload["severity"]),
                    title=str(payload["title"]),
                    description=str(payload["description"]),
                    impacted_node_id=(str(payload["impacted_node_id"]) if payload["impacted_node_id"] else None),
                    impacted_sku=str(payload["impacted_sku"]),
                    impacted_lane_id=None,
                    effective_from="2026-03-09",
                    effective_to="2026-06-01",
                    recommended_action_json=str(payload["recommended_action_json"]),
                )
            )
            changed = True
            continue
        if (
            row.alert_type != payload["alert_type"]
            or row.severity != payload["severity"]
            or row.title != payload["title"]
            or row.description != payload["description"]
            or (str(row.impacted_node_id or "") != str(payload["impacted_node_id"] or ""))
            or row.impacted_sku != payload["impacted_sku"]
            or (row.effective_from or "") != "2026-03-09"
            or (row.effective_to or "") != "2026-06-01"
        ):
            row.alert_type = str(payload["alert_type"])
            row.severity = str(payload["severity"])
            row.title = str(payload["title"])
            row.description = str(payload["description"])
            row.impacted_node_id = (str(payload["impacted_node_id"]) if payload["impacted_node_id"] else None)
            row.impacted_sku = str(payload["impacted_sku"])
            row.impacted_lane_id = None
            row.effective_from = "2026-03-09"
            row.effective_to = "2026-06-01"
            row.recommended_action_json = str(payload["recommended_action_json"])
            changed = True
    return changed


def _matching_sourcing_rows_for_alert(
    alert: NetworkAlert,
    source_rows: list[NetworkSourcingRule],
) -> list[NetworkSourcingRule]:
    if alert.impacted_node_id and alert.impacted_sku:
        return [
            row
            for row in source_rows
            if row.sku == alert.impacted_sku
            and (row.dest_node_id == alert.impacted_node_id or (row.parent_location_node_id or "") == alert.impacted_node_id)
        ]
    if alert.impacted_node_id:
        return [
            row
            for row in source_rows
            if row.dest_node_id == alert.impacted_node_id or (row.parent_location_node_id or "") == alert.impacted_node_id
        ]
    if alert.impacted_sku:
        return [row for row in source_rows if row.sku == alert.impacted_sku]
    return source_rows


def _reseed_replenishment_orders(db: Session) -> None:
    source_rows = db.query(NetworkSourcingRule).all()
    all_alerts = db.query(NetworkAlert).order_by(NetworkAlert.alert_id.asc()).all()
    main_alerts = [item for item in all_alerts if not _alert_id_excluded_from_bulk_replenishment_seed(item.alert_id)]
    # Reserve pinned demo alerts for dedicated replenishment rows (not the bulk generator).
    alerts = main_alerts if main_alerts else all_alerts
    nodes = {row.node_id: row for row in db.query(NetworkNode).all()}
    if not source_rows or not alerts:
        return
    all_skus = sorted({row.sku for row in source_rows})
    skus_by_ship_to: dict[str, list[str]] = {}
    for row in source_rows:
        skus_by_ship_to.setdefault(row.dest_node_id, []).append(row.sku)
    for key in list(skus_by_ship_to.keys()):
        skus_by_ship_to[key] = sorted(set(skus_by_ship_to[key]))
    alert_to_sources = {
        alert.alert_id: (_matching_sourcing_rows_for_alert(alert, source_rows) or source_rows)
        for alert in alerts
    }
    order_types = [
        "Stock Transfer",
        "Purchase Order",
        "Production Order",
        "Direct to Store",
        "Store to Store Transfer",
    ]
    exception_reasons = [
        "delivery_delays",
        "logistics_impact",
        "production_issue",
        "transit_issue",
        "order_update_not_possible",
    ]
    normal_statuses = ["created", "released", "in_transit", "delivered"]
    creators = ["manual", "agent", "autonomous"]
    action_map = {
        "delivery_delays": "expedite_shipment",
        "logistics_impact": "reroute_lane",
        "production_issue": "shift_production",
        "transit_issue": "activate_backup_3pl",
        "order_update_not_possible": "create_new_order",
    }

    exception_target = 640
    non_exception_target = 1120
    total_target = exception_target + non_exception_target

    def allocate_counts(total: int, weights: tuple[float, ...]) -> list[int]:
        raw = [total * weight for weight in weights]
        counts = [int(value) for value in raw]
        remainder = total - sum(counts)
        ranked = sorted(range(len(weights)), key=lambda idx: (raw[idx] - counts[idx]), reverse=True)
        for idx in ranked[:remainder]:
            counts[idx] += 1
        return counts

    # Weighted distributions so dashboard cards show varied counts (single source: exception rows)
    # Status: open > in_progress > blocked > escalated
    exception_statuses = ["open", "in_progress", "blocked", "escalated"]
    status_counts = allocate_counts(exception_target, (0.38, 0.28, 0.21, 0.13))
    status_list: list[str] = []
    for st, cnt in zip(exception_statuses, status_counts):
        status_list.extend([st] * cnt)

    # Reason (drives action + update_possible): varied so "By Actions" and "Update Not Possible" differ
    # delivery_delays 28%, logistics_impact 24%, production_issue 22%, transit_issue 18%, order_update_not_possible 8%
    reason_counts = allocate_counts(exception_target, (0.28, 0.24, 0.22, 0.18, 0.08))
    reason_list: list[str] = []
    for r, cnt in zip(exception_reasons, reason_counts):
        reason_list.extend([r] * cnt)

    # Delivery delay: ~42% of exception rows have delay > 0 so "Delayed Orders" card is distinct
    def is_delayed_exception(exception_idx: int) -> bool:
        return (exception_idx * 7 + 13) % 100 < 42

    db.query(ReplenishmentOrderAlertLink).delete()
    db.query(ReplenishmentOrderDetail).delete()
    db.query(ReplenishmentOrder).delete()
    records: list[ReplenishmentOrder] = []
    detail_records: list[ReplenishmentOrderDetail] = []
    for idx in range(total_target):
        is_exception = idx < exception_target
        alert_index = idx % len(alerts) if is_exception else (idx * 7 + 3) % len(alerts)
        alert = alerts[alert_index]
        candidates = alert_to_sources.get(alert.alert_id) or source_rows
        source = candidates[(idx * 3 + alert_index) % len(candidates)]
        ship_to = source.dest_node_id
        ship_from = source.primary_source_node_id or source.parent_location_node_id or source.secondary_source_node_id
        if not ship_from:
            ship_from = source_rows[(idx * 5 + 1) % len(source_rows)].parent_location_node_id or "PLANT-001"
        region = nodes[ship_to].region if ship_to in nodes else "UNKNOWN"
        if is_exception:
            reason = reason_list[idx]
            status = status_list[idx]
            action = action_map.get(reason, "execute_planned_replenishment")
            delivery_delay_days = float((idx % 6) + 1) if is_delayed_exception(idx) else 0.0
            update_possible = reason != "order_update_not_possible"
        else:
            reason = None
            status = normal_statuses[idx % len(normal_statuses)]
            action = "execute_planned_replenishment"
            delivery_delay_days = 0.0
            update_possible = True
        lead_time = float(source.explicit_lead_time_days or (2.0 + (idx % 6) * 0.5))
        created_day = (idx % 28) + 1
        eta_day = ((idx + 7) % 28) + 1
        order_seq = idx + 1
        detail_count = 1 + (idx % 6)
        detail_candidates = skus_by_ship_to.get(ship_to) or all_skus or [source.sku]
        start_idx = idx % max(1, len(detail_candidates))
        selected_skus: list[str] = []
        for offset in range(len(detail_candidates)):
            candidate = detail_candidates[(start_idx + offset) % len(detail_candidates)]
            if candidate not in selected_skus:
                selected_skus.append(candidate)
            if len(selected_skus) >= detail_count:
                break
        if len(selected_skus) < detail_count:
            for candidate in all_skus:
                if candidate not in selected_skus:
                    selected_skus.append(candidate)
                if len(selected_skus) >= detail_count:
                    break
        if len(selected_skus) < detail_count:
            selected_skus.extend([source.sku] * (detail_count - len(selected_skus)))
        total_order_qty = round(120.0 + (idx % 40) * 6.5 + (35.0 if is_exception else 0.0), 2)
        per_sku_qty = round(total_order_qty / detail_count, 2)
        detail_qtys = [per_sku_qty] * detail_count
        detail_qtys[-1] = round(total_order_qty - sum(detail_qtys[:-1]), 2)
        order_id_value = f"RO-{order_seq:05d}"
        records.append(
            ReplenishmentOrder(
                order_id=order_id_value,
                alert_id=alert.alert_id,
                order_type=order_types[idx % len(order_types)],
                status=status,
                is_exception=is_exception,
                exception_reason=reason,
                alert_action_taken=action,
                order_created_by=creators[idx % len(creators)],
                ship_to_node_id=ship_to,
                ship_from_node_id=ship_from,
                sku=selected_skus[0],
                product_count=detail_count,
                order_qty=total_order_qty,
                region=region,
                order_cost=round(820.0 + (idx % 150) * 18.5 + (140.0 if is_exception else 0.0), 2),
                lead_time_days=round(lead_time + (0.8 if is_exception and reason == "delivery_delays" else 0.0), 2),
                delivery_delay_days=delivery_delay_days,
                logistics_impact="high" if is_exception and reason == "logistics_impact" else ("medium" if is_exception else "low"),
                production_impact="high" if is_exception and reason == "production_issue" else ("medium" if is_exception else "low"),
                transit_impact="high" if is_exception and reason == "transit_issue" else ("medium" if is_exception else "low"),
                update_possible=update_possible,
                created_at=f"2026-03-{created_day:02d}T{8 + (idx % 10):02d}:{idx % 60:02d}:00",
                eta=f"2026-04-{eta_day:02d}",
            )
        )
        for detail_idx, detail_sku in enumerate(selected_skus):
            detail_records.append(
                ReplenishmentOrderDetail(
                    order_id=order_id_value,
                    sku=detail_sku,
                    ship_to_node_id=ship_to,
                    ship_from_node_id=ship_from,
                    order_qty=detail_qtys[detail_idx],
                )
            )
    db.add_all(records)
    db.add_all(detail_records)
    _append_pinned_demo_alert_orders(db, total_target)


def _append_pinned_demo_alert_orders(db: Session, base_order_count: int) -> None:
    """Exception orders pinned to demo alerts (RDC review + selected network alerts) with matching sourcing + links."""
    alert_ids = list(_DEMO_PINNED_ORDER_ALERT_IDS)
    alerts = {row.alert_id: row for row in db.query(NetworkAlert).filter(NetworkAlert.alert_id.in_(alert_ids)).all()}
    if not alerts:
        return
    source_rows = db.query(NetworkSourcingRule).all()
    nodes = {row.node_id: row for row in db.query(NetworkNode).all()}
    action_map = {
        "delivery_delays": "expedite_shipment",
        "logistics_impact": "reroute_lane",
        "production_issue": "shift_production",
    }
    # open / blocked / escalated read as "needs review" in the replenishment UI
    review_statuses = ["open", "blocked", "escalated"]
    review_reasons = ["delivery_delays", "logistics_impact", "production_issue"]
    now_iso = datetime.utcnow().replace(microsecond=0).isoformat()
    extra_orders: list[ReplenishmentOrder] = []
    extra_details: list[ReplenishmentOrderDetail] = []
    extra_links: list[ReplenishmentOrderAlertLink] = []
    pin_idx = 0
    for alert_id in alert_ids:
        alert = alerts.get(alert_id)
        if not alert or not alert.impacted_node_id or not alert.impacted_sku:
            continue
        source = next(
            (
                r
                for r in source_rows
                if r.sku == alert.impacted_sku and r.dest_node_id == alert.impacted_node_id
            ),
            None,
        )
        if not source:
            continue
        ship_to = source.dest_node_id
        ship_from = source.primary_source_node_id or source.parent_location_node_id or source.secondary_source_node_id
        if not ship_from:
            ship_from = next((r.parent_location_node_id for r in source_rows if r.parent_location_node_id), "PLANT-001")
        region = nodes[ship_to].region if ship_to in nodes else "UNKNOWN"
        seq = base_order_count + pin_idx + 1
        order_id_value = f"RO-{seq:05d}"
        status = review_statuses[pin_idx % len(review_statuses)]
        reason = review_reasons[pin_idx % len(review_reasons)]
        action = action_map.get(reason, "execute_planned_replenishment")
        sku = alert.impacted_sku
        total_order_qty = round(185.0 + pin_idx * 22.5, 2)
        extra_orders.append(
            ReplenishmentOrder(
                order_id=order_id_value,
                alert_id=alert.alert_id,
                order_type="Stock Transfer",
                status=status,
                is_exception=True,
                exception_reason=reason,
                alert_action_taken=action,
                order_created_by="agent",
                ship_to_node_id=ship_to,
                ship_from_node_id=ship_from,
                sku=sku,
                product_count=1,
                order_qty=total_order_qty,
                region=region,
                order_cost=round(980.0 + pin_idx * 41.0, 2),
                lead_time_days=round(float(source.explicit_lead_time_days or 3.5) + 1.2, 2),
                delivery_delay_days=float(2 + pin_idx),
                logistics_impact="high",
                production_impact="medium",
                transit_impact="medium",
                update_possible=True,
                created_at=f"2026-03-{12 + pin_idx:02d}T10:15:00",
                eta=f"2026-04-{18 + pin_idx:02d}",
            )
        )
        extra_details.append(
            ReplenishmentOrderDetail(
                order_id=order_id_value,
                sku=sku,
                ship_to_node_id=ship_to,
                ship_from_node_id=ship_from,
                order_qty=total_order_qty,
            )
        )
        extra_links.append(
            ReplenishmentOrderAlertLink(
                order_id=order_id_value,
                alert_id=alert.alert_id,
                link_status="active",
                linked_scope="order",
                source_node_id=ship_to,
                created_at=now_iso,
            )
        )
        pin_idx += 1
    if extra_orders:
        db.add_all(extra_orders)
    if extra_details:
        db.add_all(extra_details)
    if extra_links:
        db.add_all(extra_links)


def _ensure_replenishment_order_details(db: Session) -> None:
    source_rows = db.query(NetworkSourcingRule).all()
    all_skus = sorted({row.sku for row in source_rows}) or sorted({row.sku for row in db.query(ProductMaster).all()})
    skus_by_ship_to: dict[str, list[str]] = {}
    for row in source_rows:
        skus_by_ship_to.setdefault(row.dest_node_id, []).append(row.sku)
    for key in list(skus_by_ship_to.keys()):
        skus_by_ship_to[key] = sorted(set(skus_by_ship_to[key]))

    existing_details = db.query(ReplenishmentOrderDetail).all()
    details_by_order: dict[str, list[ReplenishmentOrderDetail]] = {}
    for detail in existing_details:
        details_by_order.setdefault(detail.order_id, []).append(detail)

    for idx, order in enumerate(db.query(ReplenishmentOrder).order_by(ReplenishmentOrder.order_id.asc()).all()):
        required_count = max(1, int(order.product_count))
        target_qty = round(float(order.order_qty or 0.0), 2)
        current = details_by_order.get(order.order_id, [])
        current_qty = round(sum(float(item.order_qty or 0.0) for item in current), 2)
        current_unique = len({item.sku for item in current})
        needs_rebuild = (
            len(current) != required_count
            or abs(current_qty - target_qty) > 0.01
            or current_unique != len(current)
        )
        if not needs_rebuild:
            continue
        if current:
            db.query(ReplenishmentOrderDetail).filter(ReplenishmentOrderDetail.order_id == order.order_id).delete(synchronize_session=False)

        detail_candidates = skus_by_ship_to.get(order.ship_to_node_id) or all_skus or [order.sku]
        start_idx = idx % max(1, len(detail_candidates))
        selected_skus: list[str] = []
        # Keep the original header SKU as first detail line when available.
        if order.sku and order.sku in detail_candidates:
            selected_skus.append(order.sku)
        for offset in range(len(detail_candidates)):
            candidate = detail_candidates[(start_idx + offset) % len(detail_candidates)]
            if candidate not in selected_skus:
                selected_skus.append(candidate)
            if len(selected_skus) >= required_count:
                break
        if len(selected_skus) < required_count:
            for candidate in all_skus:
                if candidate not in selected_skus:
                    selected_skus.append(candidate)
                if len(selected_skus) >= required_count:
                    break
        if len(selected_skus) < required_count:
            selected_skus.extend([order.sku or "SKU-UNKNOWN"] * (required_count - len(selected_skus)))

        per_sku_qty = round(target_qty / required_count, 2) if required_count else 0.0
        qtys = [per_sku_qty] * required_count
        if required_count:
            qtys[-1] = round(target_qty - sum(qtys[:-1]), 2)
        for detail_idx, detail_sku in enumerate(selected_skus[:required_count]):
            db.add(
                ReplenishmentOrderDetail(
                    order_id=order.order_id,
                    sku=detail_sku,
                    ship_to_node_id=order.ship_to_node_id,
                    ship_from_node_id=order.ship_from_node_id,
                    order_qty=qtys[detail_idx],
                )
            )


def _seed_demand_planning(db: Session) -> None:
    """Seed demand planning / IBP tables using existing master data."""
    if db.query(DemandForecast).count() > 0:
        return

    products = db.query(ProductMaster).all()
    locations = db.query(LocationMaster).all()
    if not products or not locations:
        return

    skus = [p.sku for p in products]
    locs = [loc.code for loc in locations]
    # Expand the horizon from 12 → 52 weeks so Demand Forecasting / Accuracy /
    # Analytics pages can render a full year of history + forward forecast.
    # The first 26 weeks are historical (have actuals); the next 26 weeks are
    # forward forecast (actual_qty=0).
    history_weeks = 26
    horizon_weeks = 52
    base_week = date(2025, 10, 5)  # Sunday — 26 weeks before 2026-04-05
    weeks = [(base_week + timedelta(days=7 * i)).isoformat() for i in range(horizon_weeks)]
    months = sorted({ws[:7] for ws in weeks})  # noqa: F841 — kept for downstream callers

    customers = [
        ("CUST-DIRECT-001", "Costco Wholesale", None, "direct", "club", "West", "BT-001", "ST-001", "direct"),
        ("CUST-DIRECT-002", "Whole Foods Market", None, "direct", "grocery", "Southeast", "BT-002", "ST-002", "direct"),
        ("CUST-DIRECT-003", "Target", None, "direct", "mass", "Midwest", "BT-003", "ST-003", "direct"),
        ("CUST-DIRECT-004", "Sprouts Farmers Market", None, "direct", "specialty", "West", "BT-004", "ST-004", "direct"),
        ("CUST-INDIRECT-005", "Costco Southwest Region", "CUST-DIRECT-001", "indirect", "club", "South", "BT-001", "ST-005", "indirect"),
        ("CUST-INDIRECT-006", "Costco Northwest Region", "CUST-DIRECT-001", "indirect", "club", "West", "BT-001", "ST-006", "indirect"),
        ("CUST-INDIRECT-007", "Whole Foods Northeast", "CUST-DIRECT-002", "indirect", "grocery", "Northeast", "BT-002", "ST-007", "indirect"),
        ("CUST-INDIRECT-008", "Target Midwest Stores", "CUST-DIRECT-003", "indirect", "mass", "Midwest", "BT-003", "ST-008", "indirect"),
        ("CUST-BROKER-009", "UNFI Distribution", None, "broker", "natural", "Northeast", "BT-009", "ST-009", "direct"),
        ("CUST-BROKER-010", "KeHE Distributors", None, "broker", "natural", "West", "BT-010", "ST-010", "direct"),
    ]
    for cid, cname, parent, ctype, channel, region, bt, st, plevel in customers:
        db.add(CustomerHierarchy(
            customer_id=cid, customer_name=cname, parent_customer_id=parent,
            customer_type=ctype, channel=channel, region=region,
            bill_to=bt, sold_to=st, planning_level=plevel,
        ))
    db.flush()

    # Forecast-source rotation so the data shows a real mix (statistical,
    # ML/DL, consensus override, customer collaboration) — every page that
    # filters/groups by source now has > 1 bucket to chart.
    forecast_sources = ["statistical", "ml_xgboost", "dl_lstm", "consensus", "customer_input"]

    forecast_records = []
    accuracy_records = []
    for si, sku in enumerate(skus):
        sku_seed = sum(ord(c) for c in sku) % 11
        # Per-SKU annual seasonality phase (so different SKUs peak in
        # different quarters, giving the analytics charts variety).
        seasonal_phase = (si * 0.7) % (2 * math.pi)
        # Slow secular trend: half the SKUs grow ~10% / year, half decline ~5%.
        annual_trend = 0.10 if si % 2 == 0 else -0.05
        for li, loc in enumerate(locs):
            demand_base = 80.0 + sku_seed * 3.5 + li * 2.0
            # Per-(sku,loc) source assignment so each combination has a
            # consistent "source of truth" — but the mix across the catalog
            # is even.
            source = forecast_sources[(si + li) % len(forecast_sources)]
            for wi, ws in enumerate(weeks):
                # Annual seasonality (52-week period) + small intra-quarter
                # ripple, both phase-shifted per-SKU.
                year_pos = wi / 52.0
                annual_season = 1.0 + 0.18 * math.sin(2 * math.pi * year_pos + seasonal_phase)
                qtr_ripple = 1.0 + 0.05 * math.sin((wi + sku_seed) * (math.pi / 6))
                trend_factor = 1.0 + annual_trend * year_pos
                # 4 promotions per year per SKU — at weeks 8-9, 21-22, 34-35, 47-48.
                promo_window = wi % 13 in (8, 9)
                promo_in_week = promo_window and (si + li) % 3 == 0
                lift = 0.25 if promo_in_week else 0.0
                baseline = round(demand_base * annual_season * qtr_ripple * trend_factor, 1)
                promo_lift = round(baseline * lift, 1)
                # Forecast bias depends on source — ML is the most accurate,
                # customer-input the noisiest.
                bias_factor = {
                    "statistical": 0.04,
                    "ml_xgboost": 0.02,
                    "dl_lstm": 0.025,
                    "consensus": 0.05,
                    "customer_input": 0.10,
                }.get(source, 0.05)
                # Historical weeks have actuals; forward weeks do not.
                is_history = wi < history_weeks
                if is_history:
                    noise_amp = max(2.0, baseline * bias_factor)
                    noise = ((si + li * 3 + wi * 7) % 11 - 5) * (noise_amp / 5)
                    actual = round(max(0, baseline + promo_lift + noise), 1)
                else:
                    actual = 0.0
                consensus = round(baseline + promo_lift * 0.9, 1)
                final = round(baseline + promo_lift, 1)
                forecast_records.append(DemandForecast(
                    sku=sku, location=loc, week_start=ws,
                    baseline_qty=baseline, promo_lift_qty=promo_lift,
                    consensus_qty=consensus, final_forecast_qty=final,
                    actual_qty=actual, forecast_source=source,
                    updated_by="system", updated_at=f"{ws}T08:00:00",
                ))
                if is_history and actual > 0:
                    error = abs(final - actual) / actual * 100
                    bias_val = (final - actual) / actual * 100
                    accuracy_records.append(DemandForecastAccuracy(
                        sku=sku, location=loc, week_start=ws,
                        forecast_qty=final, actual_qty=actual,
                        mape=round(error, 1), bias=round(bias_val, 1),
                        wmape=round(error * 0.95, 1),
                        tracking_signal=round(bias_val / max(1, error) * 2.0, 2),
                    ))
    db.add_all(forecast_records)
    db.add_all(accuracy_records)
    db.flush()

    promo_records = []
    promo_configs = [
        ("PROMO-001", "Spring Club Display", "CHOC-001", "DC-ATL", "CUST-DIRECT-001", "direct", "club"),
        ("PROMO-002", "Protein Bar BOGO", "BAR-002", "DC-CHI", "CUST-DIRECT-003", "direct", "mass"),
        ("PROMO-003", "Savory Snack Endcap", "SNACK-003", "DC-LAX", "CUST-DIRECT-004", "direct", "specialty"),
        ("PROMO-004", "Mint Gum Checkout Display", "GUM-004", "DC-NJ", "CUST-DIRECT-002", "direct", "grocery"),
        ("PROMO-005", "Summer Hydration Push", "WATER-006", "DC-MIA", "CUST-DIRECT-002", "direct", "grocery"),
        ("PROMO-006", "Granola Family Pack Feature", "CEREAL-005", "STORE-DEN", "CUST-BROKER-009", "broker", "natural"),
        ("PROMO-007", "Club Holiday Promo", "CHOC-001", "DC-ATL", "CUST-INDIRECT-005", "indirect", "club"),
        ("PROMO-008", "Protein Bar Shipper", "BAR-002", "DC-CHI", "CUST-INDIRECT-008", "indirect", "mass"),
    ]
    statuses = ["active", "planned", "completed", "planned", "active", "completed", "planned", "active"]
    for idx, (pid, pname, sku, loc, cust, ctype, chan) in enumerate(promo_configs):
        base_vol = 500.0 + idx * 120
        lift_pct = 15.0 + idx * 3.0
        promo_records.append(DemandPromotion(
            promo_id=pid, promo_name=pname, sku=sku, location=loc,
            customer=cust, customer_type=ctype, channel=chan,
            start_week=weeks[4], end_week=weeks[6],
            base_volume=base_vol, lift_percent=lift_pct,
            lift_volume=round(base_vol * lift_pct / 100, 0),
            trade_spend=round(2000 + idx * 500, 0),
            roi=round(1.2 + idx * 0.15, 2),
            status=statuses[idx],
            syndicated_source="IRI" if idx % 2 == 0 else "Nielsen",
            historical_performance=round(0.85 + (idx % 4) * 0.03, 2),
        ))
    db.add_all(promo_records)
    db.flush()

    sop_cycles = [
        ("SOP-2026-03", "March 2026 S&OP Cycle", "2026-03", "completed", "2026-03-03", "2026-03-10", "2026-03-14", "2026-03-17", True, "VP Supply Chain"),
        ("SOP-2026-04", "April 2026 S&OP Cycle", "2026-04", "in_review", "2026-04-01", "2026-04-08", "2026-04-12", "2026-04-15", False, None),
        ("SOP-2026-05", "May 2026 S&OP Cycle", "2026-05", "planning", None, None, None, None, False, None),
    ]
    for cid, cname, cmonth, cstatus, dr, sr, ps, es, approved, approver in sop_cycles:
        db.add(SopCycle(
            cycle_id=cid, cycle_name=cname, cycle_month=cmonth, status=cstatus,
            demand_review_date=dr, supply_review_date=sr, pre_sop_date=ps,
            exec_sop_date=es, consensus_approved=approved, approved_by=approver,
            notes=f"Standard monthly {cname}",
        ))
    db.flush()

    consensus_records = []
    for si, sku in enumerate(skus[:4]):
        for li, loc in enumerate(locs[:3]):
            for wi in range(4):
                ws = weeks[wi]
                base = 80.0 + si * 15 + li * 5
                sales = round(base * (1.05 + (si + wi) % 3 * 0.02), 1)
                customer_inp = round(base * (0.95 + (li + wi) % 3 * 0.03), 1)
                sc_inp = round(base * (1.0 + (si + li) % 3 * 0.01), 1)
                mkt_inp = round(base * (1.08 + wi % 2 * 0.04), 1)
                consensus = round((sales + customer_inp + sc_inp + mkt_inp) / 4, 1)
                var_pct = round((max(sales, customer_inp, sc_inp, mkt_inp) - min(sales, customer_inp, sc_inp, mkt_inp)) / consensus * 100, 1)
                consensus_records.append(DemandConsensusEntry(
                    cycle_id="SOP-2026-04", sku=sku, location=loc, week_start=ws,
                    sales_input=sales, customer_input=customer_inp,
                    supply_chain_input=sc_inp, marketing_input=mkt_inp,
                    consensus_qty=consensus, variance_pct=var_pct,
                    status="draft" if wi > 2 else "approved",
                    notes=f"Auto-generated consensus for {sku} at {loc}",
                ))
    db.add_all(consensus_records)
    db.flush()

    review_items = []
    review_topics = [
        ("demand_review", "Forecast variance exceeds threshold", "Demand Planner"),
        ("supply_review", "Capacity constraint at source node", "Supply Planner"),
        ("pre_sop", "Gap between demand and supply plan", "S&OP Lead"),
        ("exec_sop", "Executive decision required on allocation", "VP Operations"),
    ]
    for si, sku in enumerate(skus[:3]):
        for ri, (rtype, topic, owner) in enumerate(review_topics):
            review_items.append(SopReviewItem(
                cycle_id="SOP-2026-04", review_type=rtype,
                sku=sku, location=locs[ri % len(locs)],
                topic=f"{topic} - {sku}",
                gap_qty=round(50 + si * 20 + ri * 15, 0),
                action_required=f"Review and resolve {rtype.replace('_', ' ')} item for {sku}",
                owner=owner,
                status="open" if ri > 1 else "resolved",
                due_date=f"2026-04-{10 + ri * 3:02d}",
            ))
    db.add_all(review_items)
    db.flush()

    exception_records = []
    exc_types = ["high_deviation", "trend_break", "new_product_miss", "promo_miss", "bias_alert", "tracking_signal_breach"]
    severities = ["critical", "high", "medium", "low"]
    for ei in range(24):
        sku = skus[ei % len(skus)]
        loc = locs[ei % len(locs)]
        exc_type = exc_types[ei % len(exc_types)]
        sev = severities[ei % len(severities)]
        week = weeks[ei % len(weeks)]
        forecast_qty = 100.0 + ei * 8
        dev = 25.0 + ei * 3
        actual_qty = round(forecast_qty * (1 + (dev if ei % 2 == 0 else -dev) / 100), 1)
        exception_records.append(DemandException(
            exception_id=f"DEXC-{ei + 1:03d}",
            sku=sku, location=loc, week_start=week,
            exception_type=exc_type, severity=sev,
            deviation_pct=round(dev, 1),
            forecast_qty=forecast_qty, actual_qty=actual_qty,
            root_cause="Under investigation" if ei % 3 != 0 else f"Root cause identified: {exc_type}",
            resolution=None if ei % 2 == 0 else "Adjusted forecast in next cycle",
            status="open" if ei % 3 != 2 else "resolved",
            assigned_to=["Demand Planner", "S&OP Lead", "Supply Planner", "Marketing"][ei % 4],
            created_at=f"2026-03-{(ei % 28) + 1:02d}T09:{ei % 60:02d}:00",
        ))
    db.add_all(exception_records)
    db.flush()

    fin_records = []
    price_per_unit = {"CHOC-001": 8.50, "BAR-002": 12.00, "SNACK-003": 6.75, "GUM-004": 4.25, "CEREAL-005": 9.00, "WATER-006": 5.50}
    cogs_pct = {"CHOC-001": 0.52, "BAR-002": 0.48, "SNACK-003": 0.55, "GUM-004": 0.42, "CEREAL-005": 0.58, "WATER-006": 0.45}
    for sku in skus:
        price = price_per_unit.get(sku, 7.0)
        cpct = cogs_pct.get(sku, 0.50)
        for loc in locs:
            for month in months:
                vol = round(300 + sum(ord(c) for c in sku + loc) % 200 + (months.index(month)) * 20, 0)
                rev = round(vol * price, 2)
                cogs_val = round(rev * cpct, 2)
                margin = round(rev - cogs_val, 2)
                margin_pct_val = round(margin / rev * 100, 1) if rev else 0.0
                tspend = round(vol * 0.05 * price, 2)
                for ptype in ("forecast", "actual"):
                    multiplier = 1.0 if ptype == "forecast" else (0.92 + (ord(sku[0]) % 5) * 0.03)
                    fin_records.append(FinancialPlan(
                        sku=sku, location=loc, month=month,
                        volume_units=round(vol * multiplier, 0),
                        revenue=round(rev * multiplier, 2),
                        cogs=round(cogs_val * multiplier, 2),
                        gross_margin=round(margin * multiplier, 2),
                        margin_pct=margin_pct_val,
                        trade_spend=round(tspend * multiplier, 2),
                        net_revenue=round((rev - tspend) * multiplier, 2),
                        plan_type=ptype, version="working",
                    ))
    db.add_all(fin_records)
    db.flush()


def _schema_is_compatible() -> bool:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    for table_name, required_columns in REQUIRED_TABLE_COLUMNS.items():
        if table_name not in table_names:
            return False
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        if not required_columns.issubset(existing_columns):
            return False
    return True


def _rebuild_schema(db: Session) -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def init_database(db: Session) -> None:
    Base.metadata.create_all(bind=engine)
    if not _schema_is_compatible():
        _rebuild_schema(db)
    _ensure_inventory_projection_seed(db)
    network_node_count = db.query(NetworkNode).count()
    network_lane_count = db.query(NetworkLane).count()
    network_alert_count = db.query(NetworkAlert).count()
    network_sourcing_count = db.query(NetworkSourcingRule).count()
    network_parameter_count = db.query(NetworkSkuLocationParameter).count()
    network_forecast_count = db.query(NetworkForecastWeekly).count()
    network_actual_count = db.query(NetworkActualWeekly).count()
    network_inventory_count = db.query(NetworkInventorySnapshot).count()
    network_pos_count = db.query(NetworkPosWeekly).count()
    replenishment_order_count = db.query(ReplenishmentOrder).count()
    replenishment_exception_count = db.query(ReplenishmentOrder).filter(ReplenishmentOrder.is_exception.is_(True)).count()
    network_seed_missing = (
        network_node_count == 0
        or network_lane_count == 0
        or network_alert_count == 0
        or network_sourcing_count == 0
        or network_parameter_count == 0
        or network_forecast_count == 0
        or network_actual_count == 0
        or network_inventory_count == 0
        or network_pos_count == 0
        or replenishment_order_count == 0
    )
    if (
        db.query(Recommendation).count()
        and db.query(ProductMaster).count()
        and db.query(LocationMaster).count()
        and db.query(SupplierMaster).count()
        and db.query(Document).count()
    ):
        if network_seed_missing:
            has_core_network = (
                network_node_count > 0
                and network_lane_count > 0
                and network_sourcing_count > 0
                and network_parameter_count > 0
                and network_forecast_count > 0
                and network_actual_count > 0
                and network_inventory_count > 0
                and network_pos_count > 0
            )
            if has_core_network:
                if network_alert_count == 0:
                    _reseed_network_alerts(db)
                _ensure_inventory_projection_demo_alerts(db)
                _reseed_replenishment_orders(db)
                _align_projection_source_of_truth(db)
                _ensure_replenishment_order_details(db)
                db.commit()
            elif (
                network_node_count == 0
                and network_lane_count == 0
                and network_sourcing_count == 0
                and network_parameter_count == 0
                and network_forecast_count == 0
                and network_actual_count == 0
                and network_inventory_count == 0
                and network_pos_count == 0
            ):
                _seed_network_data(db)
                _ensure_critical_alerts_active_and_linked(db)
                db.commit()
            else:
                reset_and_seed(db)
        else:
            source_rows = db.query(NetworkSourcingRule).all()
            alerts = db.query(NetworkAlert).all()
            changed = False
            if not alerts or any(not _alert_has_coverage(item, source_rows) for item in alerts):
                _reseed_network_alerts(db)
                changed = True
            if _ensure_inventory_projection_demo_alerts(db):
                changed = True
            if replenishment_order_count < 1500 or replenishment_exception_count < 500:
                _reseed_replenishment_orders(db)
                changed = True
            if network_forecast_count == 0 or network_actual_count == 0 or network_inventory_count == 0 or network_pos_count == 0:
                reset_and_seed(db)
                return
            if changed:
                db.commit()
            _align_projection_source_of_truth(db)
            _ensure_replenishment_order_details(db)
            _seed_demand_planning(db)
            db.commit()
        return
    if (
        db.query(Recommendation).count()
        or db.query(ProductMaster).count()
        or db.query(LocationMaster).count()
        or db.query(SupplierMaster).count()
    ):
        reset_and_seed(db)
        return

    for row in _read_csv("products.csv"):
        db.add(
            ProductMaster(
                sku=row["sku"],
                name=row["name"],
                brand=row["brand"],
                category=row["category"],
                abc_class=row["abc_class"],
                temperature_zone=row["temperature_zone"],
                primary_supplier=row["primary_supplier"],
                description=row["description"],
            )
        )

    for row in _read_csv("locations.csv"):
        db.add(
            LocationMaster(
                code=row["code"],
                name=row["name"],
                location_type=row["location_type"],
                region=row["region"],
                city=row["city"],
                state=row["state"],
                echelon=row["echelon"],
                description=row["description"],
            )
        )

    for row in _read_csv("suppliers.csv"):
        db.add(
            SupplierMaster(
                code=row["code"],
                name=row["name"],
                region=row["region"],
                incoterm=row["incoterm"],
                reliability_score=float(row["reliability_score"]),
                lead_time_days=int(row["lead_time_days"]),
                description=row["description"],
            )
        )

    for row in _read_csv("planning_runs.csv"):
        db.add(
            PlanningRun(
                id=row["id"],
                run_type=row["run_type"],
                base_run_id=row["base_run_id"] or None,
                scenario_name=row["scenario_name"] or None,
                created_at=row["created_at"],
                scope_json=row["scope_json"] or None,
                changes_json=row["changes_json"] or None,
            )
        )
    db.flush()

    recommendation_map: dict[str, Recommendation] = {}
    for row in _read_csv("recommendations.csv"):
        recommendation = Recommendation(
            run_id=row["run_id"],
            sku=row["sku"],
            product_name=row["product_name"],
            category=row["category"],
            location=row["location"],
            region=row["region"],
            supplier=row["supplier"],
            status=row["status"],
            action=row["action"],
            eta=row["eta"],
            incremental_cost=float(row["incremental_cost"]),
            risk_score=float(row["risk_score"]),
            confidence_score=float(row["confidence_score"]),
            projected_stockout_week=row["projected_stockout_week"] or None,
            shortage_qty=int(row["shortage_qty"]),
            excess_qty=int(row["excess_qty"]),
            rationale=row["rationale"],
        )
        db.add(recommendation)
        db.flush()
        recommendation_map[f"{row['run_id']}|{row['sku']}|{row['location']}"] = recommendation

    for row in _read_csv("sourcing_options.csv"):
        parent = recommendation_map[f"{row['run_id']}|{row['sku']}|{row['location']}"]
        db.add(
            SourcingOption(
                recommendation_id=parent.id,
                option_type=row["option_type"],
                supplier=row["supplier"] or None,
                from_location=row["from_location"] or None,
                recommended_qty=int(row["recommended_qty"]),
                earliest_arrival_date=row["earliest_arrival_date"],
                incremental_cost=float(row["incremental_cost"]),
                risk_score=float(row["risk_score"]),
                feasible_flag=row["feasible_flag"].lower() == "true",
                rationale=row["rationale"],
            )
        )

    for row in _read_csv("inventory_projection.csv"):
        parent = recommendation_map[f"{row['run_id']}|{row['sku']}|{row['location']}"]
        db.add(
            ProjectionPoint(
                recommendation_id=parent.id,
                week_index=int(row["week_index"]),
                week_start=row["week_start"],
                beginning_qty=int(row["beginning_qty"]),
                inbound_qty=int(row["inbound_qty"]),
                demand_qty=int(row["demand_qty"]),
                ending_qty=int(row["ending_qty"]),
                safety_stock_qty=int(row["safety_stock_qty"]),
                stockout_flag=row["stockout_flag"].lower() == "true",
                shortage_qty=int(row["shortage_qty"]),
            )
        )

    for row in _read_csv("parameter_values.csv"):
        db.add(
            ParameterValue(
                sku=row["sku"],
                location=row["location"],
                parameter_code=row["parameter_code"],
                parameter_name=row["parameter_name"],
                inherited_from=row["inherited_from"],
                effective_value=row["effective_value"],
                explicit_value=row["explicit_value"] or None,
                source_type=row["source_type"],
                reason=row["reason"],
            )
        )

    for row in _read_csv("parameter_exceptions.csv"):
        db.add(
            ParameterException(
                recommendation_id=row["recommendation_id"],
                sku=row["sku"],
                product_name=row["product_name"],
                location=row["location"],
                parameter_code=row["parameter_code"],
                issue_type=row["issue_type"],
                current_effective_value=row["current_effective_value"],
                recommended_value=row["recommended_value"],
                impact_summary=row["impact_summary"],
                confidence_score=float(row["confidence_score"]),
                status=row["status"],
            )
        )

    db.flush()
    docs_dir = SEED_DIR / "policy_docs"
    for path in sorted(docs_dir.glob("*.txt")):
        content = path.read_text(encoding="utf-8").strip()
        document = Document(
            title=path.stem.replace("_", " ").title(),
            source_path=str(path),
            document_type="policy",
            vendor=None,
            topic="policy",
            content=content,
        )
        db.add(document)
        db.flush()
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", content) if part.strip()]
        for index, paragraph in enumerate(paragraphs):
            db.add(
                DocumentChunk(
                    document_id=document.id,
                    chunk_index=index,
                    content=paragraph,
                    keyword_blob=_keywords(paragraph),
                )
            )

    for row in _read_csv("vendor_documents.csv"):
        document = Document(
            title=row["title"],
            source_path=row["source_path"],
            document_type="vendor_pdf",
            vendor=row["vendor"],
            topic=row["topic"],
            content=row["extracted_text"],
        )
        db.add(document)
        db.flush()
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", row["extracted_text"]) if part.strip()]
        for index, paragraph in enumerate(paragraphs):
            db.add(
                DocumentChunk(
                    document_id=document.id,
                    chunk_index=index,
                    content=paragraph,
                    keyword_blob=_keywords(paragraph),
            )
        )

    _seed_network_data(db)
    _sync_parameter_data_from_sourcing(db)
    _align_projection_source_of_truth(db)
    _seed_demand_planning(db)
    db.commit()


def _sync_parameter_data_from_sourcing(db: Session) -> None:
    """Ensure parameter_values and parameter_exceptions align with the sourcing table (single source of truth).
    Adds ParameterValue rows for every (sku, location) from network_sourcing_rules for standard parameter codes,
    and adds more ParameterException demo rows from the same (sku, location) set.
    """
    db.flush()
    sourcing_rows = db.query(NetworkSourcingRule).all()
    if not sourcing_rows:
        return
    sku_location_pairs = sorted({(r.sku, r.dest_node_id) for r in sourcing_rows})
    product_by_sku = {p.sku: p.name for p in db.query(ProductMaster).all()}

    PARAMETER_SPECS: list[tuple[str, str, str, str]] = [
        ("lead_time_days", "Lead Time (days)", "2", "sourcing_sync"),
        ("service_level_target", "Service Level Target", "0.97", "sourcing_sync"),
        ("safety_stock_qty", "Safety Stock Qty", "150", "sourcing_sync"),
        ("min_batch_size", "Min Batch Size", "200", "sourcing_sync"),
        ("reorder_point_qty", "Reorder Point Qty", "120", "sourcing_sync"),
        ("service_level", "Target Service Level", "95%", "sourcing_sync"),
    ]
    existing_keys: set[tuple[str, str, str]] = {
        (r.sku, r.location, r.parameter_code)
        for r in db.query(ParameterValue).all()
    }
    new_values: list[ParameterValue] = []
    for sku, location in sku_location_pairs:
        for parameter_code, parameter_name, default_val, source_type in PARAMETER_SPECS:
            key = (sku, location, parameter_code)
            if key in existing_keys:
                continue
            existing_keys.add(key)
            new_values.append(
                ParameterValue(
                    sku=sku,
                    location=location,
                    parameter_code=parameter_code,
                    parameter_name=parameter_name,
                    inherited_from=f"GLOBAL > {location} > {sku}",
                    effective_value=default_val,
                    explicit_value=default_val,
                    source_type=source_type,
                    reason="Seeded from sourcing table (single source of truth).",
                )
            )
    if new_values:
        db.add_all(new_values)
    db.flush()

    issue_types = ["missing", "stale", "invalid", "misaligned"]
    param_codes_for_exceptions = ["lead_time_days", "safety_stock_qty", "service_level_target", "reorder_point_qty", "min_batch_size"]
    existing_rec_ids = {r.recommendation_id for r in db.query(ParameterException).all()}
    next_id = 2001
    new_exceptions: list[ParameterException] = []
    for idx, (sku, location) in enumerate(sku_location_pairs):
        if len(new_exceptions) >= 45:
            break
        for param_idx, parameter_code in enumerate(param_codes_for_exceptions):
            if len(new_exceptions) >= 45:
                break
            rec_id = f"PR-{next_id}"
            next_id += 1
            if rec_id in existing_rec_ids:
                continue
            existing_rec_ids.add(rec_id)
            issue_type = issue_types[(idx + param_idx) % len(issue_types)]
            current_val = "missing" if issue_type == "missing" else str(100 + (idx + param_idx) * 7)
            recommended_val = str(120 + (idx + param_idx) * 10)
            impact = (
                "Required for planning; value missing in hierarchy."
                if issue_type == "missing"
                else "Value out of date versus latest policy."
                if issue_type == "stale"
                else "Value fails validation rules."
                if issue_type == "invalid"
                else "Value misaligned with network and service targets."
            )
            product_name = product_by_sku.get(sku, sku)
            new_exceptions.append(
                ParameterException(
                    recommendation_id=rec_id,
                    sku=sku,
                    product_name=product_name,
                    location=location,
                    parameter_code=parameter_code,
                    issue_type=issue_type,
                    current_effective_value=current_val,
                    recommended_value=recommended_val,
                    impact_summary=impact,
                    confidence_score=round(0.82 + (idx % 5) * 0.02, 2),
                    status="open" if (idx + param_idx) % 4 != 0 else "accepted",
                )
            )
    if new_exceptions:
        db.add_all(new_exceptions)
    db.flush()


def _align_projection_source_of_truth(db: Session) -> None:
    """Align projection-driving data across sourcing pairs (single source of truth).

    Sources used by projection:
    - forecast: network_forecast_weekly
    - on-hand: network_inventory_snapshot
    - SS/ROP: parameter_values
    - future orders: replenishment_orders (eta date is future delivery date)
    """
    base_week = date(2026, 3, 8)
    sourcing_rows = db.query(NetworkSourcingRule).order_by(NetworkSourcingRule.sku.asc(), NetworkSourcingRule.dest_node_id.asc()).all()
    if not sourcing_rows:
        return

    node_type_by_id = {row.node_id: row.node_type for row in db.query(NetworkNode).all()}
    region_by_id = {row.node_id: row.region for row in db.query(NetworkNode).all()}
    product_by_sku = {row.sku: row for row in db.query(ProductMaster).all()}
    param_cache = {(row.sku, row.location, row.parameter_code): row for row in db.query(ParameterValue).all()}

    pairs = [(row.sku, row.dest_node_id, row.parent_location_node_id or "", row.primary_source_node_id or "") for row in sourcing_rows]
    unique_pairs = sorted(set((sku, node, parent, source) for sku, node, parent, source in pairs))

    def upsert_param(sku: str, node: str, code: str, name: str, value: float) -> None:
        key = (sku, node, code)
        str_val = str(round(value, 2))
        existing = param_cache.get(key)
        if existing is None:
            existing = ParameterValue(
                sku=sku,
                location=node,
                parameter_code=code,
                parameter_name=name,
                inherited_from=f"GLOBAL > {node} > {sku}",
                effective_value=str_val,
                explicit_value=str_val,
                source_type="projection_alignment",
                reason="Aligned from projection source-of-truth seeding.",
            )
            db.add(existing)
            param_cache[key] = existing
            return
        existing.effective_value = str_val
        existing.explicit_value = str_val
        existing.source_type = "projection_alignment"
        existing.reason = "Aligned from projection source-of-truth seeding."

    # choose explicit help/demo profiles across CPG + retail patterns
    store_pairs = [item for item in unique_pairs if str(item[1]).startswith("STORE")]
    rdc_pairs = [item for item in unique_pairs if str(item[1]).startswith("RDC")]
    cdc_pairs = [item for item in unique_pairs if str(item[1]).startswith("CDC")]
    example_profiles: dict[tuple[str, str], str] = {}
    if store_pairs:
        example_profiles[(store_pairs[0][0], store_pairs[0][1])] = "stockout_retail"
    if len(store_pairs) > 1:
        example_profiles[(store_pairs[1][0], store_pairs[1][1])] = "stockout_retail_2"
    if cdc_pairs:
        example_profiles[(cdc_pairs[0][0], cdc_pairs[0][1])] = "excess_low_forecast_1"
    if len(cdc_pairs) > 1:
        example_profiles[(cdc_pairs[1][0], cdc_pairs[1][1])] = "excess_low_forecast_2"
    if rdc_pairs:
        example_profiles[(rdc_pairs[0][0], rdc_pairs[0][1])] = "below_rop_no_orders_1"
    if len(rdc_pairs) > 1:
        example_profiles[(rdc_pairs[1][0], rdc_pairs[1][1])] = "below_rop_no_orders_2"

    # Rebuild only projection-demo orders/details; keep replenishment workbench exception data.
    db.query(ReplenishmentOrderDetail).filter(ReplenishmentOrderDetail.order_id.like("RO-PROJ-%")).delete(synchronize_session=False)
    db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id.like("RO-PROJ-%")).delete(synchronize_session=False)

    for idx, (sku, node, parent_node, source_node) in enumerate(unique_pairs):
        node_type = (node_type_by_id.get(node) or "").lower()
        product = product_by_sku.get(sku)
        sku_seed = sum(ord(ch) for ch in sku) % 11

        if node_type == "store":
            demand_base = 42.0 + sku_seed * 2.5
            lt_days = 2.0
            service_target = 0.98
        elif node_type == "rdc":
            demand_base = 86.0 + sku_seed * 4.0
            lt_days = 4.0
            service_target = 0.97
        elif node_type == "cdc":
            demand_base = 132.0 + sku_seed * 5.5
            lt_days = 6.0
            service_target = 0.96
        else:
            demand_base = 78.0 + sku_seed * 3.0
            lt_days = 5.0
            service_target = 0.95

        weekly_forecast: dict[int, float] = {}
        for week_offset in range(1, 13):
            season = 1.0 + 0.06 * math.sin((week_offset + sku_seed) * (math.pi / 6))
            promo = 1.18 if week_offset in (5, 6) and node_type in {"store", "rdc"} else 1.0
            forecast_qty = max(1.0, round(demand_base * season * promo, 2))
            profile = example_profiles.get((sku, node))
            if profile in {"excess_low_forecast_1", "excess_low_forecast_2"}:
                forecast_qty = 0.0 if week_offset <= 6 else max(2.0, round(demand_base * 0.1, 2))
            elif profile in {"stockout_retail", "stockout_retail_2"}:
                forecast_qty = round(forecast_qty * 1.25, 2)
            elif profile in {"below_rop_no_orders_1", "below_rop_no_orders_2"}:
                forecast_qty = round(max(8.0, forecast_qty * 0.28), 2)
            weekly_forecast[week_offset] = forecast_qty
            week_start = (base_week + timedelta(days=7 * (week_offset - 1))).isoformat()
            row = db.query(NetworkForecastWeekly).filter(
                NetworkForecastWeekly.sku == sku,
                NetworkForecastWeekly.node_id == node,
                NetworkForecastWeekly.week_start == week_start,
            ).first()
            if row is None:
                db.add(
                    NetworkForecastWeekly(
                        sku=sku,
                        node_id=node,
                        week_start=week_start,
                        forecast_qty=forecast_qty,
                    )
                )
            else:
                row.forecast_qty = forecast_qty

        values = list(weekly_forecast.values())
        avg_demand = sum(values) / len(values)
        variance = sum((item - avg_demand) ** 2 for item in values) / max(1, len(values))
        std_demand = max(1.0, math.sqrt(variance))
        lead_time_weeks = max(1.0, lt_days / 7.0)
        z = float(NormalDist().inv_cdf(min(0.999, max(0.5, service_target))))
        safety_stock = max(20.0, round(z * std_demand * math.sqrt(lead_time_weeks), 2))
        reorder_point = max(safety_stock + 10.0, round(avg_demand * lead_time_weeks + safety_stock, 2))
        profile = example_profiles.get((sku, node))
        if profile is None and node_type == "rdc":
            profile = "rdc_sawtooth"
        if profile is None and node_type == "cdc":
            profile = "cdc_sawtooth"
        if profile in {"below_rop_no_orders_1", "below_rop_no_orders_2"}:
            safety_stock = max(safety_stock, 75.0)
            reorder_point = max(reorder_point, 170.0)
        if profile == "rdc_sawtooth":
            safety_stock = max(safety_stock, 52.0)
            reorder_point = max(reorder_point, round(avg_demand * 1.02 + safety_stock, 2))
        if profile == "cdc_sawtooth":
            safety_stock = max(safety_stock, 68.0)
            reorder_point = max(reorder_point, round(avg_demand * 0.96 + safety_stock, 2))

        opening_factor = 3.2
        if profile in {"below_rop_no_orders_1", "below_rop_no_orders_2"}:
            opening_factor = 2.5
        if profile in {"stockout_retail", "stockout_retail_2"}:
            opening_factor = 0.55
        if profile in {"excess_low_forecast_1", "excess_low_forecast_2"}:
            opening_factor = 4.6
        if profile == "rdc_sawtooth":
            opening_factor = 2.45
        if profile == "cdc_sawtooth":
            opening_factor = 1.35
        opening_on_hand = round(reorder_point * opening_factor, 2)

        inv_row = db.query(NetworkInventorySnapshot).filter(
            NetworkInventorySnapshot.sku == sku,
            NetworkInventorySnapshot.node_id == node,
            NetworkInventorySnapshot.as_of_date == base_week.isoformat(),
        ).first()
        if inv_row is None:
            db.add(
                NetworkInventorySnapshot(
                    sku=sku,
                    node_id=node,
                    as_of_date=base_week.isoformat(),
                    on_hand_qty=opening_on_hand,
                )
            )
        else:
            inv_row.on_hand_qty = opening_on_hand

        upsert_param(sku, node, "lead_time_days", "Lead Time (days)", lt_days)
        upsert_param(sku, node, "service_level_target", "Service Level Target", service_target)
        upsert_param(sku, node, "safety_stock_qty", "Safety Stock Qty", safety_stock)
        upsert_param(sku, node, "reorder_point_qty", "Reorder Point Qty", reorder_point)
        upsert_param(sku, node, "min_batch_size", "Min Batch Size", 120.0 if node_type == "store" else 220.0)

        # one-week lag replenishment trigger when projected inventory falls below ROP
        running = opening_on_hand
        orders_created = 0
        max_orders = 12 if profile in {"rdc_sawtooth", "cdc_sawtooth"} else 2
        for week_offset in range(1, 13):
            if week_offset == 1:
                order_qty = 0.0
            elif profile in {"rdc_sawtooth", "cdc_sawtooth"}:
                high_target = reorder_point * (3.8 if profile == "rdc_sawtooth" else 1.45)
                should_replenish = running < reorder_point
                if should_replenish:
                    projected_no_order = running - weekly_forecast[week_offset]
                    order_qty = round(max(0.0, high_target - projected_no_order), 2)
                else:
                    order_qty = 0.0
            else:
                trigger = running < reorder_point
                if trigger and orders_created < max_orders:
                    if profile in {"stockout_retail", "stockout_retail_2"}:
                        order_qty = round(max(25.0, reorder_point * 0.32), 2)
                    elif profile in {"below_rop_no_orders_1", "below_rop_no_orders_2"}:
                        order_qty = 0.0
                    elif profile in {"excess_low_forecast_1", "excess_low_forecast_2"}:
                        order_qty = 0.0
                    elif profile == "rdc_sawtooth":
                        order_qty = round(max(avg_demand * 1.35, reorder_point * 0.88), 2)
                    elif profile == "cdc_sawtooth":
                        order_qty = round(max(avg_demand * 1.3, reorder_point * 0.82), 2)
                    else:
                        order_qty = round(max(35.0, reorder_point * 1.0), 2)
                else:
                    order_qty = 0.0

            projected = round(running - weekly_forecast[week_offset] + order_qty, 2)
            if profile in {"rdc_sawtooth", "cdc_sawtooth"} and projected < 5.0 and week_offset > 1:
                # Keep saw-tooth behavior realistic while preventing stockout for CDC/RDC projections.
                order_qty = round(order_qty + abs(projected) + 8.0, 2)
                projected = round(running - weekly_forecast[week_offset] + order_qty, 2)
            eta_day = (base_week + timedelta(days=7 * (week_offset - 1))).isoformat()
            if order_qty > 0 and orders_created < max_orders:
                orders_created += 1
                is_stockout_profile = profile in {"stockout_retail", "stockout_retail_2"}
                db.add(
                    ReplenishmentOrder(
                        order_id=f"RO-PROJ-{idx:04d}-{orders_created:02d}",
                        alert_id="ALERT-INV-STOCKOUT-001" if is_stockout_profile else "ALERT-INV-LOW-001",
                        order_type="Stock Transfer",
                        status="open" if is_stockout_profile else "created",
                        is_exception=is_stockout_profile,
                        exception_reason="delivery_delays" if is_stockout_profile else None,
                        alert_action_taken="execute_planned_replenishment",
                        order_created_by="agent",
                        ship_to_node_id=node,
                        ship_from_node_id=source_node or parent_node or "CDC-001",
                        sku=sku,
                        product_count=1,
                        order_qty=order_qty,
                        region=region_by_id.get(node),
                        order_cost=round(order_qty * 4.5, 2),
                        lead_time_days=lt_days,
                        delivery_delay_days=2.0 if is_stockout_profile else 0.0,
                        logistics_impact="medium" if is_stockout_profile else "low",
                        production_impact="low",
                        transit_impact="medium" if is_stockout_profile else "low",
                        update_possible=not is_stockout_profile,
                        created_at=f"{base_week.isoformat()}T08:00:00",
                        eta=eta_day,
                    )
                )
                db.add(
                    ReplenishmentOrderDetail(
                        order_id=f"RO-PROJ-{idx:04d}-{orders_created:02d}",
                        sku=sku,
                        ship_to_node_id=node,
                        ship_from_node_id=source_node or parent_node or "CDC-001",
                        order_qty=order_qty,
                    )
                )

            running = projected

        # ensure at least one future order exists for each SKU-node except explicit no-order/excess examples
        if orders_created == 0 and profile not in {"below_rop_no_orders_1", "below_rop_no_orders_2", "excess_low_forecast_1", "excess_low_forecast_2"}:
            week_offset = 8
            eta_day = (base_week + timedelta(days=7 * (week_offset - 1))).isoformat()
            fallback_qty = round(max(30.0, reorder_point * 0.9), 2)
            db.add(
                ReplenishmentOrder(
                    order_id=f"RO-PROJ-{idx:04d}-01",
                    alert_id="ALERT-INV-LOW-001",
                    order_type="Stock Transfer",
                    status="created",
                    is_exception=False,
                    exception_reason=None,
                    alert_action_taken="execute_planned_replenishment",
                    order_created_by="agent",
                    ship_to_node_id=node,
                    ship_from_node_id=source_node or parent_node or "CDC-001",
                    sku=sku,
                    product_count=1,
                    order_qty=fallback_qty,
                    region=region_by_id.get(node),
                    order_cost=round(fallback_qty * 4.5, 2),
                    lead_time_days=lt_days,
                    delivery_delay_days=0.0,
                    logistics_impact="low",
                    production_impact="low",
                    transit_impact="low",
                    update_possible=True,
                    created_at=f"{base_week.isoformat()}T08:00:00",
                    eta=eta_day,
                )
            )
            db.add(
                ReplenishmentOrderDetail(
                    order_id=f"RO-PROJ-{idx:04d}-01",
                    sku=sku,
                    ship_to_node_id=node,
                    ship_from_node_id=source_node or parent_node or "CDC-001",
                    order_qty=fallback_qty,
                )
            )

    # keep demo inventory alerts aligned to generated stockout / below-rop examples
    stockout_pairs = [pair for pair, profile in example_profiles.items() if profile in {"stockout_retail", "stockout_retail_2"}]
    low_pairs = [pair for pair, profile in example_profiles.items() if profile in {"below_rop_no_orders_1", "below_rop_no_orders_2"}]
    if not low_pairs and rdc_pairs:
        low_pairs.append((rdc_pairs[0][0], rdc_pairs[0][1]))
        if len(rdc_pairs) > 1:
            low_pairs.append((rdc_pairs[1][0], rdc_pairs[1][1]))
    if stockout_pairs:
        row = db.query(NetworkAlert).filter(NetworkAlert.alert_id == "ALERT-INV-STOCKOUT-001").first()
        if row:
            row.impacted_sku = stockout_pairs[0][0]
            row.impacted_node_id = stockout_pairs[0][1]
    if len(stockout_pairs) > 1:
        row = db.query(NetworkAlert).filter(NetworkAlert.alert_id == "ALERT-INV-STOCKOUT-002").first()
        if row:
            row.impacted_sku = stockout_pairs[1][0]
            row.impacted_node_id = stockout_pairs[1][1]
    if low_pairs:
        row = db.query(NetworkAlert).filter(NetworkAlert.alert_id == "ALERT-INV-LOW-001").first()
        if row:
            row.impacted_sku = low_pairs[0][0]
            row.impacted_node_id = low_pairs[0][1]
    if len(low_pairs) > 1:
        row = db.query(NetworkAlert).filter(NetworkAlert.alert_id == "ALERT-INV-LOW-002").first()
        if row:
            row.impacted_sku = low_pairs[1][0]
            row.impacted_node_id = low_pairs[1][1]

    # Ensure a deterministic demo exception row requested by planners exists in projection orders.
    db.flush()

    target_projection_order_id = "RO-PROJ-0172-01"
    target_order = db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id == target_projection_order_id).first()
    if target_order is None:
        fallback_source = sourcing_rows[0]
        target_order = ReplenishmentOrder(
            order_id=target_projection_order_id,
            alert_id="ALERT-INV-LOW-001",
            order_type="Stock Transfer",
            status="open",
            is_exception=True,
            exception_reason="service_risk",
            alert_action_taken="service_risk_mitigation",
            order_created_by="agent",
            ship_to_node_id=fallback_source.dest_node_id,
            ship_from_node_id=fallback_source.primary_source_node_id or fallback_source.parent_location_node_id or "CDC-001",
            sku=fallback_source.sku,
            product_count=1,
            order_qty=160.0,
            region=region_by_id.get(fallback_source.dest_node_id),
            order_cost=720.0,
            lead_time_days=float(fallback_source.explicit_lead_time_days or 4.0),
            delivery_delay_days=1.0,
            logistics_impact="high",
            production_impact="medium",
            transit_impact="medium",
            update_possible=False,
            created_at=f"{base_week.isoformat()}T08:00:00",
            eta=(base_week + timedelta(days=14)).isoformat(),
        )
        db.add(target_order)
    else:
        target_order.status = "open"
        target_order.is_exception = True
        target_order.exception_reason = "service_risk"
        target_order.alert_action_taken = "service_risk_mitigation"
        target_order.logistics_impact = "high"
        target_order.production_impact = "medium"
        target_order.transit_impact = "medium"
        target_order.update_possible = False
    target_detail = db.query(ReplenishmentOrderDetail).filter(ReplenishmentOrderDetail.order_id == target_projection_order_id).first()
    if target_detail is None:
        db.add(
            ReplenishmentOrderDetail(
                order_id=target_projection_order_id,
                sku=target_order.sku,
                ship_to_node_id=target_order.ship_to_node_id,
                ship_from_node_id=target_order.ship_from_node_id,
                order_qty=target_order.order_qty,
            )
        )
    else:
        target_detail.sku = target_order.sku
        target_detail.ship_to_node_id = target_order.ship_to_node_id
        target_detail.ship_from_node_id = target_order.ship_from_node_id
        target_detail.order_qty = target_order.order_qty

    # Associate projection order RO-PROJ-0004-01 with RDC critical review alert 003 (sourcing-aligned).
    proj_rdc_order_id = "RO-PROJ-0004-01"
    proj_rdc_alert_id = "ALERT-RDC-REVIEW-003"
    rda = db.query(NetworkAlert).filter(NetworkAlert.alert_id == proj_rdc_alert_id).first()
    po = db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id == proj_rdc_order_id).first()
    if rda and po and rda.impacted_sku and rda.impacted_node_id:
        src = next(
            (
                r
                for r in sourcing_rows
                if r.sku == rda.impacted_sku and r.dest_node_id == rda.impacted_node_id
            ),
            None,
        )
        if src:
            po.alert_id = proj_rdc_alert_id
            po.ship_to_node_id = src.dest_node_id
            ship_from = src.primary_source_node_id or src.parent_location_node_id or src.secondary_source_node_id
            po.ship_from_node_id = ship_from or "CDC-001"
            po.sku = rda.impacted_sku
            po.region = region_by_id.get(src.dest_node_id)
            pd_row = db.query(ReplenishmentOrderDetail).filter(ReplenishmentOrderDetail.order_id == proj_rdc_order_id).first()
            if pd_row:
                pd_row.sku = rda.impacted_sku
                pd_row.ship_to_node_id = src.dest_node_id
                pd_row.ship_from_node_id = po.ship_from_node_id
            db.query(ReplenishmentOrderAlertLink).filter(ReplenishmentOrderAlertLink.order_id == proj_rdc_order_id).delete(
                synchronize_session=False
            )
            db.add(
                ReplenishmentOrderAlertLink(
                    order_id=proj_rdc_order_id,
                    alert_id=proj_rdc_alert_id,
                    link_status="active",
                    linked_scope="order",
                    source_node_id=src.dest_node_id,
                    created_at=datetime.utcnow().replace(microsecond=0).isoformat(),
                )
            )

    # Associate projection order RO-PROJ-0044-01 with RDC critical review alert 001 (mark as exception so it renders red).
    proj_rdc2_order_id = "RO-PROJ-0044-01"
    proj_rdc2_alert_id = "ALERT-RDC-REVIEW-001"
    rda2 = db.query(NetworkAlert).filter(NetworkAlert.alert_id == proj_rdc2_alert_id).first()
    po2 = db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id == proj_rdc2_order_id).first()
    if rda2 and po2:
        po2.alert_id = proj_rdc2_alert_id
        po2.is_exception = True
        po2.exception_reason = "service_risk"
        po2.alert_action_taken = "rdc_critical_review"
        po2.logistics_impact = "high"
        po2.update_possible = False
        if rda2.impacted_sku and rda2.impacted_node_id:
            src2 = next(
                (r for r in sourcing_rows if r.sku == rda2.impacted_sku and r.dest_node_id == rda2.impacted_node_id),
                None,
            )
            if src2:
                po2.ship_to_node_id = src2.dest_node_id
                ship_from2 = src2.primary_source_node_id or src2.parent_location_node_id or src2.secondary_source_node_id
                po2.ship_from_node_id = ship_from2 or "CDC-001"
                po2.sku = rda2.impacted_sku
                po2.region = region_by_id.get(src2.dest_node_id)
                pd2 = db.query(ReplenishmentOrderDetail).filter(ReplenishmentOrderDetail.order_id == proj_rdc2_order_id).first()
                if pd2:
                    pd2.sku = rda2.impacted_sku
                    pd2.ship_to_node_id = src2.dest_node_id
                    pd2.ship_from_node_id = po2.ship_from_node_id
        db.query(ReplenishmentOrderAlertLink).filter(ReplenishmentOrderAlertLink.order_id == proj_rdc2_order_id).delete(
            synchronize_session=False
        )
        db.add(
            ReplenishmentOrderAlertLink(
                order_id=proj_rdc2_order_id,
                alert_id=proj_rdc2_alert_id,
                link_status="active",
                linked_scope="order",
                source_node_id=po2.ship_to_node_id,
                created_at=datetime.utcnow().replace(microsecond=0).isoformat(),
            )
        )

    # Parameter exception examples for profile pairs shown in projection parameter panel.
    profile_exception_map = {
        "stockout_retail": ("lead_time_days", "stale", "2", "4"),
        "stockout_retail_2": ("service_level_target", "invalid", "0.90", "0.98"),
        "below_rop_no_orders_1": ("reorder_point_qty", "misaligned", "low", "raise by 20%"),
        "below_rop_no_orders_2": ("safety_stock_qty", "stale", "old", "recalculate"),
        "excess_low_forecast_1": ("min_batch_size", "misaligned", "high", "reduce"),
        "excess_low_forecast_2": ("safety_stock_qty", "misaligned", "too high", "optimize"),
    }
    for i, ((sku, node), profile) in enumerate(sorted(example_profiles.items()), start=1):
        if profile not in profile_exception_map:
            continue
        parameter_code, issue_type, current_value, recommended_value = profile_exception_map[profile]
        rec_id = f"PR-PROJ-{i:04d}"
        existing = db.query(ParameterException).filter(ParameterException.recommendation_id == rec_id).first()
        product_name = product_by_sku.get(sku).name if product_by_sku.get(sku) else sku
        impact = f"Projection demo scenario ({profile}) indicates parameter review required."
        if existing is None:
            db.add(
                ParameterException(
                    recommendation_id=rec_id,
                    sku=sku,
                    product_name=product_name,
                    location=node,
                    parameter_code=parameter_code,
                    issue_type=issue_type,
                    current_effective_value=str(current_value),
                    recommended_value=str(recommended_value),
                    impact_summary=impact,
                    confidence_score=0.91,
                    status="open",
                )
            )
        else:
            existing.sku = sku
            existing.product_name = product_name
            existing.location = node
            existing.parameter_code = parameter_code
            existing.issue_type = issue_type
            existing.current_effective_value = str(current_value)
            existing.recommended_value = str(recommended_value)
            existing.impact_summary = impact
            existing.status = "open"

    _ensure_critical_alerts_active_and_linked(db)
    db.commit()


def _ensure_critical_alerts_active_and_linked(db: Session) -> None:
    critical_alerts = (
        db.query(NetworkAlert)
        .filter(NetworkAlert.severity.isnot(None))
        .all()
    )
    critical_alerts = [row for row in critical_alerts if str(row.severity or "").strip().lower() == "critical"]
    if not critical_alerts:
        return

    orders = db.query(ReplenishmentOrder).order_by(ReplenishmentOrder.created_at.desc(), ReplenishmentOrder.order_id.asc()).all()
    if not orders:
        return

    orders_by_sku_node: dict[tuple[str, str], ReplenishmentOrder] = {}
    orders_by_sku: dict[str, ReplenishmentOrder] = {}
    for order in orders:
        sku = str(order.sku or "").strip()
        node = str(order.ship_to_node_id or "").strip()
        if sku and node and (sku, node) not in orders_by_sku_node:
            orders_by_sku_node[(sku, node)] = order
        if sku and sku not in orders_by_sku:
            orders_by_sku[sku] = order

    changed = False
    now_iso = datetime.utcnow().replace(microsecond=0).isoformat()
    for alert in critical_alerts:
        alert_id = str(alert.alert_id or "").strip()
        if not alert_id:
            continue

        if alert.effective_to:
            alert.effective_to = None
            changed = True

        links = (
            db.query(ReplenishmentOrderAlertLink)
            .filter(ReplenishmentOrderAlertLink.alert_id == alert_id)
            .order_by(ReplenishmentOrderAlertLink.created_at.asc(), ReplenishmentOrderAlertLink.id.asc())
            .all()
        )
        active_links = [item for item in links if str(item.link_status or "").strip().lower() == "active"]
        if active_links:
            continue

        if links:
            first = links[0]
            first.link_status = "active"
            first.fixed_at = None
            first.fixed_by = None
            first.created_at = first.created_at or now_iso
            changed = True
            continue

        sku = str(alert.impacted_sku or "").strip()
        node = str(alert.impacted_node_id or "").strip()
        candidate = orders_by_sku_node.get((sku, node)) or (orders_by_sku.get(sku) if sku else None) or orders[0]
        db.add(
            ReplenishmentOrderAlertLink(
                order_id=candidate.order_id,
                alert_id=alert_id,
                link_status="active",
                linked_scope="order",
                source_node_id=node or candidate.ship_to_node_id,
                created_at=now_iso,
            )
        )
        changed = True

    if changed:
        db.flush()


def reseed_network_only(db: Session) -> dict[str, int]:
    """Clear all network-related tables and repopulate with demo data (1 plant, 2 CDCs, 5 RDCs, 35 stores, single sourcing)."""
    for model in [
        AutonomousAction,
        AutonomousRun,
        ReplenishmentOrderAlertLink,
        NetworkSimulationMetric,
        NetworkSimulationRun,
        NetworkScenarioChange,
        NetworkScenario,
        NetworkAgentResult,
        ReplenishmentOrderDetail,
        ReplenishmentOrder,
        NetworkAlert,
        NetworkBREValue,
        NetworkSkuLocationParameter,
        NetworkPosWeekly,
        NetworkInventorySnapshot,
        NetworkActualWeekly,
        NetworkForecastWeekly,
        NetworkSourcingRule,
        NetworkDemandSignal,
        NetworkNodeProductScope,
        NetworkLane,
        NetworkNode,
    ]:
        db.query(model).delete()
    db.commit()
    _seed_network_data(db)
    _sync_parameter_data_from_sourcing(db)
    _align_projection_source_of_truth(db)
    _ensure_replenishment_order_details(db)
    db.commit()
    return {
        "network_nodes": db.query(NetworkNode).count(),
        "network_lanes": db.query(NetworkLane).count(),
        "network_sourcing_rows": db.query(NetworkSourcingRule).count(),
        "network_demands": db.query(NetworkDemandSignal).count(),
        "network_parameter_rows": db.query(NetworkSkuLocationParameter).count(),
        "network_forecast_rows": db.query(NetworkForecastWeekly).count(),
        "network_actual_rows": db.query(NetworkActualWeekly).count(),
        "network_inventory_rows": db.query(NetworkInventorySnapshot).count(),
        "network_pos_rows": db.query(NetworkPosWeekly).count(),
        "network_alerts": db.query(NetworkAlert).count(),
        "replenishment_orders": db.query(ReplenishmentOrder).count(),
        "replenishment_order_details": db.query(ReplenishmentOrderDetail).count(),
    }


def reset_and_seed(db: Session) -> dict[str, int]:
    if not _schema_is_compatible():
        _rebuild_schema(db)
    for model in [
        AutonomousAction,
        AutonomousRun,
        ReplenishmentOrderAlertLink,
        AuditLog,
        SimulationScenario,
        InventoryLedger,
        InventoryProjectionProductConfig,
        NetworkSimulationMetric,
        NetworkSimulationRun,
        NetworkScenarioChange,
        NetworkScenario,
        NetworkAgentResult,
        ReplenishmentOrderDetail,
        ReplenishmentOrder,
        NetworkAlert,
        NetworkBREValue,
        NetworkSkuLocationParameter,
        NetworkPosWeekly,
        NetworkInventorySnapshot,
        NetworkActualWeekly,
        NetworkForecastWeekly,
        NetworkSourcingRule,
        NetworkDemandSignal,
        NetworkNodeProductScope,
        NetworkLane,
        NetworkNode,
        DocumentChunk,
        Document,
        ProjectionPoint,
        SourcingOption,
        Recommendation,
        ParameterValue,
        ParameterException,
        PlanningRun,
        ProductMaster,
        LocationMaster,
        SupplierMaster,
        DemandForecast,
        DemandPromotion,
        DemandConsensusEntry,
        DemandForecastAccuracy,
        DemandException,
        SopCycle,
        SopReviewItem,
        FinancialPlan,
        CustomerHierarchy,
    ]:
        db.query(model).delete()
    db.commit()
    init_database(db)
    return {
        "recommendations": db.query(Recommendation).count(),
        "products": db.query(ProductMaster).count(),
        "locations": db.query(LocationMaster).count(),
        "suppliers": db.query(SupplierMaster).count(),
        "documents": db.query(Document).count(),
        "chunks": db.query(DocumentChunk).count(),
        "network_nodes": db.query(NetworkNode).count(),
        "network_lanes": db.query(NetworkLane).count(),
        "network_demands": db.query(NetworkDemandSignal).count(),
        "network_sourcing_rows": db.query(NetworkSourcingRule).count(),
        "network_parameter_rows": db.query(NetworkSkuLocationParameter).count(),
        "network_forecast_rows": db.query(NetworkForecastWeekly).count(),
        "network_actual_rows": db.query(NetworkActualWeekly).count(),
        "network_inventory_rows": db.query(NetworkInventorySnapshot).count(),
        "network_pos_rows": db.query(NetworkPosWeekly).count(),
        "replenishment_orders": db.query(ReplenishmentOrder).count(),
        "replenishment_order_details": db.query(ReplenishmentOrderDetail).count(),
        "replenishment_order_alert_links": db.query(ReplenishmentOrderAlertLink).count(),
        "autonomous_runs": db.query(AutonomousRun).count(),
        "autonomous_actions": db.query(AutonomousAction).count(),
    }
