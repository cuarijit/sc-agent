"""Root-cause analysis for allocation / distribution problems.

Handlers map evidence_query IDs declared in the template to deterministic
Python probes over DeliveryRoute, InventoryBatchSnapshot, StoreVelocity, etc.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable

from sqlalchemy.orm import Session

from ...models import (
    DeliveryRoute,
    InventoryBatchSnapshot,
    NetworkInventorySnapshot,
    RamadanCalendar,
    StoreVelocity,
)
from ..inventory_diagnostic.problem_detector import ProblemInstance
from ..inventory_diagnostic.root_cause_analyzer import RootCauseInstance


def _parse_time(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        if "T" in s:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        h, m = s.split(":")[:2]
        base = datetime.now().replace(hour=int(h), minute=int(m), second=0, microsecond=0)
        return base
    except Exception:
        return None


class AllocationRootCauseAnalyzer:
    def __init__(
        self,
        db: Session,
        *,
        templates: list[dict[str, Any]] | None = None,
        disabled_keys: set[str] | None = None,
        iftar_buffer_minutes: int = 15,
    ):
        self.db = db
        self.templates = templates or []
        self.disabled_keys = disabled_keys or set()
        self.iftar_buffer_minutes = int(iftar_buffer_minutes)
        self.handlers: dict[str, Callable[[ProblemInstance, dict[str, Any]], tuple[bool, dict[str, Any]]]] = {
            "route_planned_units_exceed_vehicle_capacity": self._evidence_route_capacity,
            "route_eta_within_iftar_buffer": self._evidence_iftar_conflict,
            "batches_with_rsl_days_le_threshold": self._evidence_rsl_below,
            "allocation_vs_velocity_ratio_outlier": self._evidence_velocity_mismatch,
            "batches_flagged_quality_hold_or_cold_chain_event": self._evidence_cold_chain,
        }

    def analyze(self, problems: list[ProblemInstance]) -> list[RootCauseInstance]:
        if not self.templates or not problems:
            return []
        enabled = [
            t for t in self.templates
            if isinstance(t, dict) and t.get("key") and t.get("key") not in self.disabled_keys
        ]
        out: list[RootCauseInstance] = []
        for problem in problems:
            for template in enabled:
                key = str(template.get("key"))
                handler = self.handlers.get(str(template.get("evidence_query")))
                if handler is None:
                    continue
                fired, evidence = handler(problem, template)
                if not fired:
                    continue
                weight = float(template.get("weight") or 0.0)
                out.append(RootCauseInstance(
                    rc_key=key,
                    problem_ref={
                        "problem_key": problem.problem_key,
                        "sku": problem.sku,
                        "node_id": problem.node_id,
                        "breach_week": problem.breach_week,
                    },
                    fired=True,
                    weight=weight,
                    score=weight,
                    evidence=evidence,
                ))
        out.sort(key=lambda rc: (-rc.score, rc.rc_key))
        return out

    # ------------------------------------------------------ evidence fns

    def _evidence_route_capacity(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        route_id = (problem.evidence or {}).get("route_id")
        if not route_id:
            return False, {"reason": "Problem not bound to a route."}
        row = (
            self.db.query(DeliveryRoute)
            .filter(DeliveryRoute.route_id == route_id)
            .first()
        )
        if row is None:
            return False, {"reason": f"Route {route_id} not found."}
        try:
            stops = json.loads(row.stops_json or "[]")
        except json.JSONDecodeError:
            stops = []
        planned_total = 0.0
        for s in stops:
            planned_total += sum(float(v or 0.0) for v in (s.get("planned_qty_by_sku") or {}).values())
        capacity = float(row.capacity_units or 0.0)
        fired = capacity > 0 and planned_total > capacity
        return fired, {
            "route_id": route_id,
            "planned_units": round(planned_total, 2),
            "capacity_units": capacity,
            "overrun_units": round(max(0.0, planned_total - capacity), 2),
            "vehicle_id": row.vehicle_id,
        }

    def _evidence_iftar_conflict(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        if problem.problem_key not in ("iftar_window_miss_risk", "route_delivery_risk"):
            return False, {}
        ev = problem.evidence or {}
        mvi = ev.get("minutes_vs_iftar")
        if mvi is None:
            return False, {"reason": "No Iftar timing evidence on problem."}
        fired = float(mvi) > -self.iftar_buffer_minutes
        return fired, {
            "route_id": ev.get("route_id"),
            "iftar_local_time": ev.get("iftar_local_time"),
            "planned_eta": ev.get("planned_eta"),
            "minutes_vs_iftar": mvi,
            "buffer_minutes": self.iftar_buffer_minutes,
        }

    def _evidence_rsl_below(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        threshold = 2
        rows = (
            self.db.query(InventoryBatchSnapshot)
            .filter(
                InventoryBatchSnapshot.sku == problem.sku,
                InventoryBatchSnapshot.node_id == problem.node_id,
            )
            .all()
        )
        if not rows:
            return False, {}
        latest_as_of = max(str(r.as_of_date) for r in rows)
        try:
            as_of = date.fromisoformat(latest_as_of)
        except (TypeError, ValueError):
            return False, {}
        flagged: list[dict[str, Any]] = []
        for r in rows:
            if str(r.as_of_date) != latest_as_of:
                continue
            try:
                exp = date.fromisoformat(r.expiry_date)
            except (TypeError, ValueError):
                continue
            rsl = (exp - as_of).days
            if rsl <= threshold and float(r.batch_qty or 0.0) > 0:
                flagged.append({
                    "batch_id": r.batch_id,
                    "qty": float(r.batch_qty or 0.0),
                    "expiry_date": exp.isoformat(),
                    "rsl_days": rsl,
                })
        if not flagged:
            return False, {}
        return True, {
            "as_of_date": latest_as_of,
            "threshold_days": threshold,
            "flagged_batches": flagged[:5],
            "total_at_risk_qty": round(sum(b["qty"] for b in flagged), 2),
        }

    def _evidence_velocity_mismatch(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        if problem.problem_key not in ("allocation_gap", "store_fair_share_deviation"):
            return False, {}
        ev = problem.evidence or {}
        deviation = ev.get("deviation_pct")
        if deviation is None:
            return False, {}
        fired = abs(float(deviation)) >= 0.25
        return fired, {
            "velocity_units_per_hour": ev.get("velocity_units_per_hour"),
            "actual_on_hand_qty": ev.get("actual_on_hand_qty"),
            "fair_share_qty": ev.get("fair_share_qty"),
            "deviation_pct": deviation,
            "note": "Allocation deviates from velocity-weighted fair share.",
        }

    def _evidence_cold_chain(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        rows = (
            self.db.query(InventoryBatchSnapshot)
            .filter(
                InventoryBatchSnapshot.sku == problem.sku,
                InventoryBatchSnapshot.node_id == problem.node_id,
                InventoryBatchSnapshot.quality_hold_flag.is_(True),
            )
            .all()
        )
        if not rows:
            return False, {}
        blocked_qty = sum(float(r.batch_qty or 0.0) for r in rows)
        return True, {
            "blocked_qty": round(blocked_qty, 2),
            "batches": [{"batch_id": r.batch_id, "qty": float(r.batch_qty)} for r in rows[:5]],
        }
