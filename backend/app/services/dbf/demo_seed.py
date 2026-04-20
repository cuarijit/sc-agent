"""Idempotent DBF demo seed.

Generates 8 SKUs × 5 customers × 52 weeks of correlated driver history,
trains elasticities, composes a consumption forecast, fits a per-SKU ×
Location regression, and seeds one published production scenario plus
one draft "what-if" scenario.

Skips any SKU in PROTECTED_AGENTIC_SKUS so the agentic demos stay
isolated from DBF data.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Iterable

from sqlalchemy.orm import Session

from ...models import (
    DbfAccuracySnapshot,
    DbfConsumptionForecast,
    DbfConsumptionShipmentRegression,
    DbfDriverDisplay,
    DbfDriverDistribution,
    DbfDriverElasticity,
    DbfDriverFeature,
    DbfDriverPrice,
    DbfScenario,
    DbfShipmentForecast,
)
from ..seed_safety import PROTECTED_AGENTIC_SKUS
from .scenarios import PRODUCTION_SCENARIO_ID

# Candidate SKUs — first 8 non-protected SKUs from products.csv ordered
# to give variety of categories. Falls back to whatever is in ProductMaster
# at runtime if some don't exist.
_PREFERRED_SKUS = [
    "CHOC-001", "BAR-002", "SNACK-003", "GUM-004", "CEREAL-005",
    "WATER-006", "PEN-101", "PS5-201",
]
_PREFERRED_CUSTOMERS = [
    "CUST-DIRECT-001", "CUST-DIRECT-002", "CUST-DIRECT-003",
    "CUST-INDIRECT-005", "CUST-INDIRECT-006",
]
# Locations to fan out shipments to. Keep small for demo speed.
_PREFERRED_LOCATIONS = ["DC-ATL", "DC-CHI", "DC-LAX"]

_NOW = date(2026, 4, 13)  # Monday


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat()


def _stable_noise(seed_str: str, amp: float) -> float:
    """Deterministic [-amp, +amp] sample from a string key."""
    seed = sum(ord(c) for c in seed_str) % 2003
    return ((seed / 2003.0) - 0.5) * 2.0 * amp


def _select_skus(db: Session) -> list[str]:
    from ...models import ProductMaster

    available = {p.sku for p in db.query(ProductMaster).all()}
    chosen = [s for s in _PREFERRED_SKUS if s in available and s not in PROTECTED_AGENTIC_SKUS]
    if len(chosen) >= 4:
        return chosen[:8]
    # Fall back to any non-protected SKU
    extra = [
        s for s in sorted(available)
        if s not in PROTECTED_AGENTIC_SKUS and s not in chosen
    ]
    return (chosen + extra)[:8]


def _select_customers(db: Session) -> list[str]:
    from ...models import CustomerHierarchy

    available = {c.customer_id for c in db.query(CustomerHierarchy).all()}
    chosen = [c for c in _PREFERRED_CUSTOMERS if c in available]
    if len(chosen) >= 3:
        return chosen[:5]
    extra = [c for c in sorted(available) if c not in chosen]
    return (chosen + extra)[:5]


def _select_locations(db: Session) -> list[str]:
    from ...models import LocationMaster

    available = {loc.code for loc in db.query(LocationMaster).all()}
    chosen = [loc for loc in _PREFERRED_LOCATIONS if loc in available]
    if chosen:
        return chosen
    return sorted(available)[:3]


def seed_dbf_demo(db: Session) -> dict:
    """Idempotent seed. Returns counts. Skips entirely if production scenario
    already exists."""
    existing = (
        db.query(DbfScenario).filter(DbfScenario.scenario_id == PRODUCTION_SCENARIO_ID).first()
    )
    if existing is not None:
        return {"status": "already_seeded", "scenario_id": PRODUCTION_SCENARIO_ID}

    skus = _select_skus(db)
    customers = _select_customers(db)
    locations = _select_locations(db)
    if not skus or not customers or not locations:
        return {"status": "no_master_data", "skus": skus, "customers": customers, "locations": locations}

    # Build 52 weeks: 26 past (with actuals) + 26 forward.
    history_weeks = 26
    horizon_weeks = 52
    base_week = _NOW - timedelta(days=7 * history_weeks)
    weeks = [(base_week + timedelta(days=7 * i)).isoformat() for i in range(horizon_weeks)]
    today_iso = _NOW.isoformat()

    now = _now_iso()
    db.add(
        DbfScenario(
            scenario_id=PRODUCTION_SCENARIO_ID,
            name="Production baseline",
            description="System-seeded production DBF baseline (do not edit directly).",
            status="published",
            created_by="system",
            parent_scenario_id=None,
            created_at=now,
            updated_at=now,
        )
    )

    # ── 1. Generate driver history per (sku, customer, week) ─────────
    promo_weeks_for_sku = lambda sku: {  # noqa: E731
        (4 + sum(ord(c) for c in sku)) % 13,
        (16 + sum(ord(c) for c in sku)) % 26 + 13,
        (28 + sum(ord(c) for c in sku)) % 13 + 26,
        (40 + sum(ord(c) for c in sku)) % 13 + 39,
    }

    driver_price_rows: list[DbfDriverPrice] = []
    driver_dist_rows: list[DbfDriverDistribution] = []
    driver_disp_rows: list[DbfDriverDisplay] = []
    driver_feat_rows: list[DbfDriverFeature] = []
    elasticities: list[DbfDriverElasticity] = []

    for sku_idx, sku in enumerate(skus):
        promo_set = promo_weeks_for_sku(sku)
        base_price_for_sku = 4.0 + (sku_idx % 5) * 1.25
        for cust_idx, cust in enumerate(customers):
            # Per (sku, customer) base distribution and elasticities.
            base_acv = 78.0 + (cust_idx * 3.0) - (sku_idx % 3) * 2.0
            elasticities.extend([
                DbfDriverElasticity(sku=sku, customer_id=cust, driver_name="price",   elasticity_coef=-1.4 - (sku_idx % 3) * 0.2, confidence=0.78),
                DbfDriverElasticity(sku=sku, customer_id=cust, driver_name="acv",     elasticity_coef= 0.55 + (cust_idx % 2) * 0.1, confidence=0.80),
                DbfDriverElasticity(sku=sku, customer_id=cust, driver_name="display", elasticity_coef= 0.35,                          confidence=0.65),
                DbfDriverElasticity(sku=sku, customer_id=cust, driver_name="feature", elasticity_coef= 0.28,                          confidence=0.62),
            ])
            for wi, week in enumerate(weeks):
                in_promo = wi in promo_set
                # Light "everyday" price activity even outside major promos:
                # most weeks have a small 1-4% off; promo weeks step to 15-25%.
                if in_promo:
                    discount = 0.15 + ((sku_idx + cust_idx) % 4) * 0.025
                else:
                    # 4-week rotating low-level discount: 0%, 2%, 4%, 1%
                    base_discount_cycle = [0.00, 0.02, 0.04, 0.01]
                    discount = base_discount_cycle[(wi + sku_idx) % 4]
                # Per-week base-price drift (cost-of-goods nudges) so base_price
                # isn't a flat line either.
                price_drift = 1.0 + 0.015 * math.sin((wi / 26.0) * math.pi + sku_idx * 0.4)
                base_price_week = round(base_price_for_sku * price_drift, 2)
                promo_price = round(base_price_week * (1.0 - discount), 2)
                driver_price_rows.append(DbfDriverPrice(
                    scenario_id=PRODUCTION_SCENARIO_ID,
                    sku=sku, customer_id=cust, week_start=week,
                    base_price=base_price_week, promo_price=promo_price,
                    discount_pct=round(discount, 3),
                    price_index=round(promo_price / base_price_week, 3),
                ))

                acv = base_acv + 6.0 * math.sin((wi / 26.0) * math.pi + cust_idx) + _stable_noise(f"{sku}{cust}acv{wi}", 1.8)
                # ACV gets a small uplift in promo weeks (extra placements).
                if in_promo:
                    acv += 3.5
                acv = max(40.0, min(98.0, acv))
                tdp = round(120.0 + acv * 0.45 + _stable_noise(f"{sku}{cust}tdp{wi}", 4.0), 1)
                driver_dist_rows.append(DbfDriverDistribution(
                    scenario_id=PRODUCTION_SCENARIO_ID,
                    sku=sku, customer_id=cust, week_start=week,
                    acv_pct=round(acv, 2), tdp=tdp,
                    distribution_index=round(acv / 80.0, 3),
                ))

                # Display: baseline of 0-1 secondary placements always, peaks
                # during promos. Linear feet roughly tracks display count.
                baseline_disp = (sku_idx + cust_idx) % 3 * 0.5  # 0, 0.5, 1.0 baseline
                disp_count = baseline_disp + (3.0 + ((sku_idx * 7 + cust_idx) % 3)) if in_promo else baseline_disp
                disp_count = round(disp_count, 1)
                linear_feet = round(2.0 + disp_count * 1.8 + _stable_noise(f"{sku}{cust}lf{wi}", 0.6), 1)
                driver_disp_rows.append(DbfDriverDisplay(
                    scenario_id=PRODUCTION_SCENARIO_ID,
                    sku=sku, customer_id=cust, week_start=week,
                    display_count=disp_count, linear_feet=linear_feet,
                    end_cap_flag=in_promo,
                ))

                # Feature: rotating media presence. Most weeks have a small
                # always-on digital spend; promo weeks add a bigger campaign.
                if in_promo:
                    feat_count = 2.0 + ((sku_idx + cust_idx) % 3)
                    feat_type = ["digital", "circular", "tv"][(sku_idx + wi) % 3]
                    media_spend = round(feat_count * (1500.0 + cust_idx * 250.0), 1)
                elif (wi + sku_idx) % 5 == 0:
                    # ~20% of off-promo weeks have a small digital-only spend.
                    feat_count = 1.0
                    feat_type = "digital"
                    media_spend = round(350.0 + cust_idx * 75.0, 1)
                else:
                    feat_count = 0.0
                    feat_type = "none"
                    media_spend = 0.0
                driver_feat_rows.append(DbfDriverFeature(
                    scenario_id=PRODUCTION_SCENARIO_ID,
                    sku=sku, customer_id=cust, week_start=week,
                    feature_count=feat_count, feature_type=feat_type,
                    media_spend=media_spend,
                ))

    db.add_all(elasticities)
    db.add_all(driver_price_rows)
    db.add_all(driver_dist_rows)
    db.add_all(driver_disp_rows)
    db.add_all(driver_feat_rows)
    db.flush()

    # ── 2. Compose consumption forecast ──────────────────────────────
    # base_qty per (sku, customer) — small per-customer scale variation.
    customer_scale = {c: 1.0 + i * 0.18 for i, c in enumerate(customers)}
    consumption_rows: list[DbfConsumptionForecast] = []
    for sku_idx, sku in enumerate(skus):
        sku_base = 800.0 + sku_idx * 75.0
        for cust in customers:
            scale = customer_scale[cust]
            for wi, week in enumerate(weeks):
                year_pos = wi / 52.0
                seasonal = 1.0 + 0.10 * math.sin(2 * math.pi * year_pos + sku_idx * 0.6)
                base_qty = round(sku_base * scale * seasonal, 1)
                # Recover the matching driver effects via the same formulas
                # used at runtime so the seeded "production" data already
                # reflects driver impacts.
                discount = next(
                    (r.discount_pct for r in driver_price_rows
                     if r.sku == sku and r.customer_id == cust and r.week_start == week),
                    0.0,
                )
                acv = next(
                    (r.acv_pct for r in driver_dist_rows
                     if r.sku == sku and r.customer_id == cust and r.week_start == week),
                    80.0,
                )
                disp_count = next(
                    (r.display_count for r in driver_disp_rows
                     if r.sku == sku and r.customer_id == cust and r.week_start == week),
                    0.0,
                )
                feat_count = next(
                    (r.feature_count for r in driver_feat_rows
                     if r.sku == sku and r.customer_id == cust and r.week_start == week),
                    0.0,
                )
                price_eff = base_qty * (-1.4) * discount
                acv_eff = base_qty * 0.55 * (acv - 80.0) / 100.0
                disp_eff = base_qty * 0.35 * disp_count * 0.05
                feat_eff = base_qty * 0.28 * feat_count * 0.04
                total = max(0.0, base_qty + price_eff + acv_eff + disp_eff + feat_eff)
                # Past weeks have actuals; future weeks have 0.
                if week < today_iso:
                    actual = round(total * (1.0 + _stable_noise(f"{sku}{cust}act{wi}", 0.06)), 1)
                    last_year = round(total * 0.93, 1)
                    last_known = round(total * 0.96, 1)
                else:
                    actual = 0.0
                    last_year = round(total * 0.96, 1)
                    last_known = round(total * 0.99, 1)

                consumption_rows.append(DbfConsumptionForecast(
                    scenario_id=PRODUCTION_SCENARIO_ID,
                    sku=sku, customer_id=cust, week_start=week,
                    base_qty=base_qty,
                    price_effect=round(price_eff, 1),
                    acv_effect=round(acv_eff, 1),
                    display_effect=round(disp_eff, 1),
                    feature_effect=round(feat_eff, 1),
                    total_qty=round(total, 1),
                    adjustment_qty=0.0,
                    adjusted_qty=round(total, 1),
                    last_year_qty=last_year,
                    last_known_value_qty=last_known,
                    actual_qty=actual,
                ))
    db.add_all(consumption_rows)
    db.flush()

    # ── 3. Per-SKU × Location regression coefficients ────────────────
    # Synthetic: shipment ≈ consumption × 1.05 (cycle-stock build) +
    # alpha (cushion). r² ≈ 0.92 by construction.
    regs: list[DbfConsumptionShipmentRegression] = []
    for sku in skus:
        for loc in locations:
            regs.append(DbfConsumptionShipmentRegression(
                sku=sku, location=loc,
                alpha=round(50.0 + _stable_noise(f"{sku}{loc}a", 20.0), 2),
                beta=round(1.05 + _stable_noise(f"{sku}{loc}b", 0.05), 4),
                gamma=round(-0.02 + _stable_noise(f"{sku}{loc}g", 0.01), 4),
                r_squared=0.92,
                training_window=f"{weeks[0]}..{weeks[history_weeks - 1]}",
            ))
    db.add_all(regs)
    db.flush()

    # ── 4. Shipment forecast per (sku, customer, location, week) ─────
    # Distribute consumption across locations using a fixed split per customer.
    cust_location_split = {
        cust: [0.6 - i * 0.2 if len(locations) > 1 else 1.0 for i in range(len(locations))]
        for cust in customers
    }
    # Normalize splits
    for cust in customers:
        total_w = sum(cust_location_split[cust]) or 1.0
        cust_location_split[cust] = [w / total_w for w in cust_location_split[cust]]

    shipment_rows: list[DbfShipmentForecast] = []
    cons_idx = {(c.sku, c.customer_id, c.week_start): c.adjusted_qty for c in consumption_rows}
    reg_idx = {(r.sku, r.location): (r.alpha, r.beta, r.gamma) for r in regs}
    for sku in skus:
        for cust in customers:
            for li, loc in enumerate(locations):
                share = cust_location_split[cust][li]
                for wi, week in enumerate(weeks):
                    cons = cons_idx.get((sku, cust, week), 0.0) * share
                    coef = reg_idx.get((sku, loc), (0.0, 1.0, 0.0))
                    inv_pos = 200.0 + (sku_idx_lookup(skus, sku) * 30.0)
                    ship = max(0.0, coef[0] + coef[1] * cons + coef[2] * inv_pos)
                    shipment_rows.append(DbfShipmentForecast(
                        scenario_id=PRODUCTION_SCENARIO_ID,
                        sku=sku, customer_id=cust, location=loc, week_start=week,
                        consumption_qty=round(cons, 1),
                        inventory_position=round(inv_pos, 1),
                        shipment_qty=round(ship, 1),
                        regression_residual=0.0,
                    ))
    db.add_all(shipment_rows)
    db.flush()

    # ── 5. Accuracy snapshots for past 26 weeks ──────────────────────
    snaps: list[DbfAccuracySnapshot] = []
    for cons in consumption_rows:
        if cons.actual_qty <= 0:
            continue
        err = abs(cons.adjusted_qty - cons.actual_qty)
        mape = (err / cons.actual_qty) * 100 if cons.actual_qty else 0.0
        bias = ((cons.adjusted_qty - cons.actual_qty) / cons.actual_qty) * 100 if cons.actual_qty else 0.0
        snaps.append(DbfAccuracySnapshot(
            scenario_id=PRODUCTION_SCENARIO_ID,
            tier="consumption", entity=cons.sku, week_start=cons.week_start,
            forecast_qty=cons.adjusted_qty, actual_qty=cons.actual_qty,
            mape=round(mape, 2), bias=round(bias, 2), wmape=round(mape * 0.95, 2),
        ))
    # Driver-tier accuracy: pretend driver-level forecasts = drivers (perfect
    # for current-week, jittered for past weeks).
    for sku in skus:
        for cust in customers:
            for week in weeks[:history_weeks]:
                for driver_name, jitter_amp in (("price", 0.04), ("acv", 0.06), ("display", 0.10), ("feature", 0.08)):
                    err = abs(_stable_noise(f"{sku}{cust}{driver_name}{week}", jitter_amp)) * 100.0
                    snaps.append(DbfAccuracySnapshot(
                        scenario_id=PRODUCTION_SCENARIO_ID,
                        tier="driver", entity=driver_name, week_start=week,
                        forecast_qty=0.0, actual_qty=0.0,
                        mape=round(err, 2), bias=round(_stable_noise(f"{sku}b{driver_name}{week}", jitter_amp) * 50.0, 2),
                        wmape=round(err * 0.92, 2),
                    ))
    # Shipment-tier accuracy
    for ship in shipment_rows[:1000]:  # cap for seed speed
        if ship.week_start >= today_iso:
            continue
        # Synthetic actual ≈ shipment_qty + noise
        actual = ship.shipment_qty * (1.0 + _stable_noise(f"{ship.sku}{ship.location}{ship.week_start}", 0.07))
        if actual <= 0:
            continue
        err = abs(ship.shipment_qty - actual)
        mape = (err / actual) * 100
        bias = ((ship.shipment_qty - actual) / actual) * 100
        snaps.append(DbfAccuracySnapshot(
            scenario_id=PRODUCTION_SCENARIO_ID,
            tier="shipment", entity=ship.sku, week_start=ship.week_start,
            forecast_qty=ship.shipment_qty, actual_qty=round(actual, 1),
            mape=round(mape, 2), bias=round(bias, 2), wmape=round(mape * 0.94, 2),
        ))
    db.add_all(snaps)

    # ── 6. Sample draft scenario ─────────────────────────────────────
    sample = DbfScenario(
        scenario_id="scen-sample-promo-lift",
        name="Q3 promo lift sandbox",
        description="Demo scenario — increase end-cap displays for top SKUs.",
        status="draft",
        created_by="system",
        parent_scenario_id=PRODUCTION_SCENARIO_ID,
        created_at=now,
        updated_at=now,
    )
    db.add(sample)
    # Clone production rows into the sample scenario.
    for src in driver_price_rows:
        db.add(DbfDriverPrice(
            scenario_id=sample.scenario_id, sku=src.sku, customer_id=src.customer_id,
            week_start=src.week_start, base_price=src.base_price, promo_price=src.promo_price,
            discount_pct=src.discount_pct, price_index=src.price_index,
        ))
    for src in driver_dist_rows:
        db.add(DbfDriverDistribution(
            scenario_id=sample.scenario_id, sku=src.sku, customer_id=src.customer_id,
            week_start=src.week_start, acv_pct=src.acv_pct, tdp=src.tdp,
            distribution_index=src.distribution_index,
        ))
    for src in driver_disp_rows:
        db.add(DbfDriverDisplay(
            scenario_id=sample.scenario_id, sku=src.sku, customer_id=src.customer_id,
            week_start=src.week_start, display_count=src.display_count,
            linear_feet=src.linear_feet, end_cap_flag=src.end_cap_flag,
        ))
    for src in driver_feat_rows:
        db.add(DbfDriverFeature(
            scenario_id=sample.scenario_id, sku=src.sku, customer_id=src.customer_id,
            week_start=src.week_start, feature_count=src.feature_count,
            feature_type=src.feature_type, media_spend=src.media_spend,
        ))
    for src in consumption_rows:
        db.add(DbfConsumptionForecast(
            scenario_id=sample.scenario_id, sku=src.sku, customer_id=src.customer_id,
            week_start=src.week_start, base_qty=src.base_qty,
            price_effect=src.price_effect, acv_effect=src.acv_effect,
            display_effect=src.display_effect, feature_effect=src.feature_effect,
            total_qty=src.total_qty, adjustment_qty=src.adjustment_qty,
            adjusted_qty=src.adjusted_qty, last_year_qty=src.last_year_qty,
            last_known_value_qty=src.last_known_value_qty, actual_qty=src.actual_qty,
        ))
    for src in shipment_rows:
        db.add(DbfShipmentForecast(
            scenario_id=sample.scenario_id, sku=src.sku, customer_id=src.customer_id,
            location=src.location, week_start=src.week_start,
            consumption_qty=src.consumption_qty, inventory_position=src.inventory_position,
            shipment_qty=src.shipment_qty, regression_residual=src.regression_residual,
        ))

    db.commit()
    return {
        "status": "seeded",
        "skus": skus,
        "customers": customers,
        "locations": locations,
        "scenarios": [PRODUCTION_SCENARIO_ID, sample.scenario_id],
        "consumption_rows": len(consumption_rows),
        "shipment_rows": len(shipment_rows),
        "accuracy_snapshots": len(snaps),
    }


def sku_idx_lookup(skus: Iterable[str], sku: str) -> int:
    for i, s in enumerate(skus):
        if s == sku:
            return i
    return 0
