"""Scenario CRUD + adjustment + publish for Puls8 DBF.

Each scenario is a copy-on-write fork of the production baseline. The
production baseline has parent_scenario_id IS NULL and status='published'.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Iterable

from sqlalchemy.orm import Session

from ...models import (
    DbfConsumptionForecast,
    DbfDriverDisplay,
    DbfDriverDistribution,
    DbfDriverFeature,
    DbfDriverPrice,
    DbfScenario,
    DbfShipmentForecast,
    DemandForecast,
)
from .engine import recompute_for_scenario

PRODUCTION_SCENARIO_ID = "production"


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat()


class DbfScenarios:
    def __init__(self, db: Session) -> None:
        self.db = db

    # ── CRUD ─────────────────────────────────────────────────────────
    def list_scenarios(self) -> list[dict]:
        rows = self.db.query(DbfScenario).order_by(DbfScenario.created_at.desc()).all()
        return [self._serialize(r) for r in rows]

    def get(self, scenario_id: str) -> dict | None:
        r = (
            self.db.query(DbfScenario)
            .filter(DbfScenario.scenario_id == scenario_id)
            .first()
        )
        return self._serialize(r) if r else None

    def create(
        self,
        name: str,
        description: str = "",
        parent_scenario_id: str | None = None,
        created_by: str = "system",
    ) -> dict:
        parent = parent_scenario_id or PRODUCTION_SCENARIO_ID
        new_id = f"scen-{uuid.uuid4().hex[:8]}"
        now = _now_iso()
        rec = DbfScenario(
            scenario_id=new_id,
            name=name.strip() or "Untitled scenario",
            description=description,
            status="draft",
            created_by=created_by,
            parent_scenario_id=parent,
            created_at=now,
            updated_at=now,
        )
        self.db.add(rec)
        # Copy-on-write all driver + consumption + shipment rows from parent.
        self._clone_scenario_data(parent, new_id)
        self.db.commit()
        return self._serialize(rec)

    def delete(self, scenario_id: str) -> bool:
        if scenario_id == PRODUCTION_SCENARIO_ID:
            raise ValueError("Cannot delete production baseline scenario")
        rec = (
            self.db.query(DbfScenario)
            .filter(DbfScenario.scenario_id == scenario_id)
            .first()
        )
        if rec is None:
            return False
        for model in (
            DbfDriverPrice,
            DbfDriverDistribution,
            DbfDriverDisplay,
            DbfDriverFeature,
            DbfConsumptionForecast,
            DbfShipmentForecast,
        ):
            self.db.query(model).filter(model.scenario_id == scenario_id).delete()
        self.db.delete(rec)
        self.db.commit()
        return True

    # ── Adjustments ──────────────────────────────────────────────────
    def apply_driver_adjustments(
        self,
        scenario_id: str,
        adjustments: Iterable[dict],
    ) -> dict:
        """Apply a batch of driver overrides. Each adjustment is:
        {sku, customer, week, driver: 'price'|'acv'|'display'|'feature', value}.
        Updates the matching driver row, then recomputes consumption + shipment.
        """
        if not self._scenario_exists(scenario_id):
            raise ValueError(f"Scenario {scenario_id!r} not found")
        if scenario_id == PRODUCTION_SCENARIO_ID:
            raise ValueError("Cannot edit production baseline directly — create a scenario fork")

        applied = 0
        for adj in adjustments:
            sku = adj.get("sku")
            customer = adj.get("customer") or adj.get("customer_id")
            week = adj.get("week") or adj.get("week_start")
            driver = adj.get("driver")
            value = adj.get("value")
            if not (sku and customer and week and driver) or value is None:
                continue
            updated = self._update_driver_cell(scenario_id, sku, customer, week, driver, float(value))
            if updated:
                applied += 1

        recomputed = recompute_for_scenario(self.db, scenario_id)
        self._touch(scenario_id)
        return {"adjustments_applied": applied, **recomputed}

    def apply_consumption_adjustments(
        self,
        scenario_id: str,
        adjustments: Iterable[dict],
    ) -> dict:
        """Apply direct consumption adjustments (delta on top of total_qty).
        adjustments: [{sku, customer, week, delta}].
        """
        if not self._scenario_exists(scenario_id):
            raise ValueError(f"Scenario {scenario_id!r} not found")

        applied = 0
        for adj in adjustments:
            sku = adj.get("sku")
            customer = adj.get("customer") or adj.get("customer_id")
            week = adj.get("week") or adj.get("week_start")
            delta = adj.get("delta", 0)
            if not (sku and customer and week):
                continue
            row = (
                self.db.query(DbfConsumptionForecast)
                .filter(
                    DbfConsumptionForecast.scenario_id == scenario_id,
                    DbfConsumptionForecast.sku == sku,
                    DbfConsumptionForecast.customer_id == customer,
                    DbfConsumptionForecast.week_start == week,
                )
                .first()
            )
            if row is None:
                continue
            row.adjustment_qty = round(float(delta), 1)
            row.adjusted_qty = round(row.total_qty + row.adjustment_qty, 1)
            applied += 1

        # Re-flow shipment forecasts for any rows we touched.
        from .engine import recompute_for_scenario as _re

        recomputed = _re(self.db, scenario_id)
        self._touch(scenario_id)
        return {"adjustments_applied": applied, **recomputed}

    # ── Publish ──────────────────────────────────────────────────────
    def publish(self, scenario_id: str) -> dict:
        """Push this scenario's shipment forecast into demand_forecast as a
        new ``forecast_source='puls8_dbf'`` series (non-destructive — does
        not overwrite the statistical baseline)."""
        if not self._scenario_exists(scenario_id):
            raise ValueError(f"Scenario {scenario_id!r} not found")

        # Aggregate scenario shipment forecast at SKU × Location × Week.
        agg: dict[tuple[str, str, str], float] = {}
        for ship in (
            self.db.query(DbfShipmentForecast)
            .filter(DbfShipmentForecast.scenario_id == scenario_id)
            .all()
        ):
            key = (ship.sku, ship.location, ship.week_start)
            agg[key] = agg.get(key, 0.0) + ship.shipment_qty

        # Remove any prior puls8_dbf rows for this scenario so re-publish
        # doesn't duplicate.
        self.db.query(DemandForecast).filter(
            DemandForecast.forecast_source == "puls8_dbf",
            DemandForecast.updated_by == f"dbf:{scenario_id}",
        ).delete(synchronize_session=False)

        now = _now_iso()
        rows = []
        for (sku, loc, week), qty in agg.items():
            rows.append(
                DemandForecast(
                    sku=sku,
                    location=loc,
                    week_start=week,
                    baseline_qty=0.0,
                    promo_lift_qty=0.0,
                    consensus_qty=round(qty, 1),
                    final_forecast_qty=round(qty, 1),
                    actual_qty=0.0,
                    forecast_source="puls8_dbf",
                    updated_by=f"dbf:{scenario_id}",
                    updated_at=now,
                )
            )
        if rows:
            self.db.add_all(rows)

        # Mark scenario as published
        rec = (
            self.db.query(DbfScenario)
            .filter(DbfScenario.scenario_id == scenario_id)
            .first()
        )
        if rec is not None:
            rec.status = "published"
            rec.updated_at = now
        self.db.commit()
        return {"published_rows": len(rows), "scenario_id": scenario_id}

    # ── Internals ────────────────────────────────────────────────────
    def _scenario_exists(self, scenario_id: str) -> bool:
        return (
            self.db.query(DbfScenario)
            .filter(DbfScenario.scenario_id == scenario_id)
            .first()
            is not None
        )

    def _touch(self, scenario_id: str) -> None:
        rec = (
            self.db.query(DbfScenario)
            .filter(DbfScenario.scenario_id == scenario_id)
            .first()
        )
        if rec is not None:
            rec.updated_at = _now_iso()

    def _serialize(self, r: DbfScenario) -> dict:
        return {
            "scenario_id": r.scenario_id,
            "name": r.name,
            "description": r.description,
            "status": r.status,
            "created_by": r.created_by,
            "parent_scenario_id": r.parent_scenario_id,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
            "is_production": r.scenario_id == PRODUCTION_SCENARIO_ID,
        }

    def _update_driver_cell(
        self,
        scenario_id: str,
        sku: str,
        customer: str,
        week: str,
        driver: str,
        value: float,
    ) -> bool:
        if driver == "price":
            row = (
                self.db.query(DbfDriverPrice)
                .filter(
                    DbfDriverPrice.scenario_id == scenario_id,
                    DbfDriverPrice.sku == sku,
                    DbfDriverPrice.customer_id == customer,
                    DbfDriverPrice.week_start == week,
                )
                .first()
            )
            if row is None:
                return False
            row.discount_pct = value
            return True
        if driver == "acv":
            row = (
                self.db.query(DbfDriverDistribution)
                .filter(
                    DbfDriverDistribution.scenario_id == scenario_id,
                    DbfDriverDistribution.sku == sku,
                    DbfDriverDistribution.customer_id == customer,
                    DbfDriverDistribution.week_start == week,
                )
                .first()
            )
            if row is None:
                return False
            row.acv_pct = value
            return True
        if driver == "display":
            row = (
                self.db.query(DbfDriverDisplay)
                .filter(
                    DbfDriverDisplay.scenario_id == scenario_id,
                    DbfDriverDisplay.sku == sku,
                    DbfDriverDisplay.customer_id == customer,
                    DbfDriverDisplay.week_start == week,
                )
                .first()
            )
            if row is None:
                return False
            row.display_count = value
            return True
        if driver == "feature":
            row = (
                self.db.query(DbfDriverFeature)
                .filter(
                    DbfDriverFeature.scenario_id == scenario_id,
                    DbfDriverFeature.sku == sku,
                    DbfDriverFeature.customer_id == customer,
                    DbfDriverFeature.week_start == week,
                )
                .first()
            )
            if row is None:
                return False
            row.feature_count = value
            return True
        return False

    def _clone_scenario_data(self, parent_scenario_id: str, new_scenario_id: str) -> None:
        """Copy every per-scenario row from parent to new_scenario."""
        models = [
            DbfDriverPrice,
            DbfDriverDistribution,
            DbfDriverDisplay,
            DbfDriverFeature,
            DbfConsumptionForecast,
            DbfShipmentForecast,
        ]
        for model in models:
            for r in self.db.query(model).filter(model.scenario_id == parent_scenario_id).all():
                kwargs = {
                    col.name: getattr(r, col.name)
                    for col in r.__table__.columns
                    if col.name != "id"
                }
                kwargs["scenario_id"] = new_scenario_id
                self.db.add(model(**kwargs))
        self.db.flush()
