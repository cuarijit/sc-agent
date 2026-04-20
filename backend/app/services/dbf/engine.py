"""Driver composition + consumption→shipment regression.

The composer applies each driver's elasticity to the deviation of the
driver value from its baseline. Sum of effects → consumption_qty. The
regressor uses simple OLS to fit shipment = α + β·consumption +
γ·inventory_position per SKU × Location.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy.orm import Session

from ...models import (
    DbfConsumptionForecast,
    DbfConsumptionShipmentRegression,
    DbfDriverDisplay,
    DbfDriverDistribution,
    DbfDriverElasticity,
    DbfDriverFeature,
    DbfDriverPrice,
    DbfShipmentForecast,
)


@dataclass
class DriverBundle:
    """All four drivers for one (sku, customer, week) cell."""

    discount_pct: float = 0.0
    acv_pct: float = 75.0
    display_count: float = 0.0
    feature_count: float = 0.0


def _baseline_for(elasticities: dict[tuple[str, str], dict[str, float]]) -> dict[str, float]:
    # Reference point each driver effect is measured against. Tuned to the
    # mid-range of the demo seed values.
    return {"price": 0.0, "acv": 80.0, "display": 0.0, "feature": 0.0}


def _driver_effect(
    elasticity: float,
    driver_value: float,
    baseline: float,
) -> float:
    """Multiplier-style effect: elasticity × (value − baseline) / baseline_or_1.

    For price (elasticity ~ -1.5), a 10pp discount gives +0.15 lift.
    For ACV (elasticity ~ +0.6), a +10pp distribution gain gives +0.075.
    """
    delta = (driver_value - baseline) / max(abs(baseline), 1.0) if baseline else driver_value / 100.0
    return elasticity * delta


def _load_elasticities(db: Session) -> dict[tuple[str, str], dict[str, float]]:
    rows = db.query(DbfDriverElasticity).all()
    out: dict[tuple[str, str], dict[str, float]] = defaultdict(dict)
    for r in rows:
        out[(r.sku, r.customer_id)][r.driver_name] = r.elasticity_coef
    return out


def _load_drivers_for_scenario(
    db: Session, scenario_id: str
) -> dict[tuple[str, str, str], DriverBundle]:
    """Return {(sku, customer, week) → DriverBundle} for a scenario."""
    cells: dict[tuple[str, str, str], DriverBundle] = defaultdict(DriverBundle)
    for r in db.query(DbfDriverPrice).filter(DbfDriverPrice.scenario_id == scenario_id).all():
        cells[(r.sku, r.customer_id, r.week_start)].discount_pct = r.discount_pct
    for r in db.query(DbfDriverDistribution).filter(
        DbfDriverDistribution.scenario_id == scenario_id
    ).all():
        cells[(r.sku, r.customer_id, r.week_start)].acv_pct = r.acv_pct
    for r in db.query(DbfDriverDisplay).filter(
        DbfDriverDisplay.scenario_id == scenario_id
    ).all():
        cells[(r.sku, r.customer_id, r.week_start)].display_count = r.display_count
    for r in db.query(DbfDriverFeature).filter(
        DbfDriverFeature.scenario_id == scenario_id
    ).all():
        cells[(r.sku, r.customer_id, r.week_start)].feature_count = r.feature_count
    return cells


def compose_consumption(
    base_qty: float,
    drivers: DriverBundle,
    elasticities: dict[str, float],
) -> dict[str, float]:
    """Returns dict with: base_qty, price_effect, acv_effect, display_effect,
    feature_effect, total_qty."""
    baselines = _baseline_for({})
    price_effect_pct = _driver_effect(
        elasticities.get("price", -1.5), drivers.discount_pct * 100.0, baselines["price"]
    ) if False else elasticities.get("price", -1.5) * (drivers.discount_pct)
    # ACV measured against 80% baseline
    acv_effect_pct = elasticities.get("acv", 0.6) * (drivers.acv_pct - baselines["acv"]) / 100.0
    # Display: each end-cap adds elasticity * (display_count) * 0.05
    display_effect_pct = elasticities.get("display", 0.4) * drivers.display_count * 0.05
    feature_effect_pct = elasticities.get("feature", 0.3) * drivers.feature_count * 0.04

    price_q = base_qty * price_effect_pct
    acv_q = base_qty * acv_effect_pct
    display_q = base_qty * display_effect_pct
    feature_q = base_qty * feature_effect_pct
    total = base_qty + price_q + acv_q + display_q + feature_q
    return {
        "base_qty": round(base_qty, 1),
        "price_effect": round(price_q, 1),
        "acv_effect": round(acv_q, 1),
        "display_effect": round(display_q, 1),
        "feature_effect": round(feature_q, 1),
        "total_qty": round(max(0.0, total), 1),
    }


def fit_regression(pairs: Iterable[tuple[float, float, float]]) -> tuple[float, float, float, float]:
    """Fit shipment = α + β·consumption + γ·inv_position via 2-feature OLS.

    Closed-form normal equations on a 3×3 system (intercept + 2 features).
    Returns (alpha, beta, gamma, r_squared).
    """
    pts = [(c, i, s) for c, i, s in pairs if not (c is None or i is None or s is None)]
    n = len(pts)
    if n < 3:
        return (0.0, 1.0, 0.0, 0.0)
    # Build sums for normal equations
    sx1 = sx2 = sy = 0.0
    s11 = s22 = s12 = 0.0
    s1y = s2y = 0.0
    for c, i, s in pts:
        sx1 += c
        sx2 += i
        sy += s
        s11 += c * c
        s22 += i * i
        s12 += c * i
        s1y += c * s
        s2y += i * s
    mean_x1 = sx1 / n
    mean_x2 = sx2 / n
    mean_y = sy / n
    cov11 = s11 - n * mean_x1 * mean_x1
    cov22 = s22 - n * mean_x2 * mean_x2
    cov12 = s12 - n * mean_x1 * mean_x2
    cov1y = s1y - n * mean_x1 * mean_y
    cov2y = s2y - n * mean_x2 * mean_y
    det = cov11 * cov22 - cov12 * cov12
    if abs(det) < 1e-9:
        # Fall back to univariate fit on consumption
        if cov11 < 1e-9:
            return (mean_y, 1.0, 0.0, 0.0)
        beta = cov1y / cov11
        alpha = mean_y - beta * mean_x1
        ss_tot = sum((s - mean_y) ** 2 for _, _, s in pts) or 1.0
        ss_res = sum((s - alpha - beta * c) ** 2 for c, _, s in pts)
        r2 = max(0.0, 1.0 - ss_res / ss_tot)
        return (round(alpha, 3), round(beta, 4), 0.0, round(r2, 3))
    beta = (cov22 * cov1y - cov12 * cov2y) / det
    gamma = (cov11 * cov2y - cov12 * cov1y) / det
    alpha = mean_y - beta * mean_x1 - gamma * mean_x2
    ss_tot = sum((s - mean_y) ** 2 for _, _, s in pts) or 1.0
    ss_res = sum((s - alpha - beta * c - gamma * i) ** 2 for c, i, s in pts)
    r2 = max(0.0, 1.0 - ss_res / ss_tot)
    return (round(alpha, 3), round(beta, 4), round(gamma, 4), round(r2, 3))


def apply_regression(
    coef: tuple[float, float, float],
    consumption: float,
    inv_position: float,
) -> float:
    a, b, g = coef
    return max(0.0, a + b * consumption + g * inv_position)


# ── Recompute consumption + shipment for an entire scenario ───────────────


def recompute_for_scenario(
    db: Session,
    scenario_id: str,
    customer_to_locations: dict[str, list[str]] | None = None,
) -> dict[str, int]:
    """Re-derive `dbf_consumption_forecast` + `dbf_shipment_forecast` for the
    scenario from the current driver tables + elasticity + regression. Used
    after a driver adjustment to flow changes downstream.

    `customer_to_locations` maps customer_id → list of locations to fan out
    shipments to. If None, falls back to the existing distinct mapping in
    `dbf_shipment_forecast` for this scenario or the production baseline.
    """
    elasticities = _load_elasticities(db)
    drivers = _load_drivers_for_scenario(db, scenario_id)
    base_rows = (
        db.query(DbfConsumptionForecast)
        .filter(DbfConsumptionForecast.scenario_id == scenario_id)
        .all()
    )
    base_index = {(r.sku, r.customer_id, r.week_start): r for r in base_rows}

    consumption_updates = 0
    for (sku, customer, week), bundle in drivers.items():
        record = base_index.get((sku, customer, week))
        if record is None:
            continue
        elas = elasticities.get((sku, customer), {})
        out = compose_consumption(record.base_qty, bundle, elas)
        record.price_effect = out["price_effect"]
        record.acv_effect = out["acv_effect"]
        record.display_effect = out["display_effect"]
        record.feature_effect = out["feature_effect"]
        record.total_qty = out["total_qty"]
        record.adjusted_qty = round(record.total_qty + record.adjustment_qty, 1)
        consumption_updates += 1

    # Now recompute shipments. For each shipment row we know location; pull
    # its regression coefficients and the consumption that maps to it.
    regs = {
        (r.sku, r.location): (r.alpha, r.beta, r.gamma)
        for r in db.query(DbfConsumptionShipmentRegression).all()
    }
    cons_index = {
        (r.sku, r.customer_id, r.week_start): r.adjusted_qty
        for r in db.query(DbfConsumptionForecast)
        .filter(DbfConsumptionForecast.scenario_id == scenario_id)
        .all()
    }
    shipment_updates = 0
    for ship in (
        db.query(DbfShipmentForecast)
        .filter(DbfShipmentForecast.scenario_id == scenario_id)
        .all()
    ):
        cons = cons_index.get((ship.sku, ship.customer_id, ship.week_start))
        if cons is None:
            continue
        coef = regs.get((ship.sku, ship.location), (0.0, 1.0, 0.0))
        ship.consumption_qty = round(cons, 1)
        ship.shipment_qty = round(apply_regression(coef, cons, ship.inventory_position), 1)
        shipment_updates += 1

    db.commit()
    return {"consumption_rows_updated": consumption_updates, "shipment_rows_updated": shipment_updates}
