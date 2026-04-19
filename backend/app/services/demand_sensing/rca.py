"""Root-cause analysis for demand sensing problems.

Handlers mapped to evidence_query IDs declared in the template.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Callable

from sqlalchemy.orm import Session

from ...models import (
    NetworkInventorySnapshot,
    PosHourlyActual,
    RamadanCalendar,
)
from ..inventory_diagnostic.problem_detector import ProblemInstance
from ..inventory_diagnostic.root_cause_analyzer import RootCauseInstance


class DemandSensingRootCauseAnalyzer:
    def __init__(
        self,
        db: Session,
        *,
        templates: list[dict[str, Any]] | None = None,
        disabled_keys: set[str] | None = None,
    ):
        self.db = db
        self.templates = templates or []
        self.disabled_keys = disabled_keys or set()
        self.handlers: dict[str, Callable[[ProblemInstance, dict[str, Any]], tuple[bool, dict[str, Any]]]] = {
            "rolling_pos_vs_trailing_mean": self._evidence_pos_velocity_surge,
            "ramadan_day_active_or_approaching": self._evidence_ramadan,
            "on_hand_cover_hours_below_next_delivery": self._evidence_supply_lag,
            "weather_event_signal_present": self._evidence_weather_stub,
            "competitor_outage_signal_present": self._evidence_competitor_stub,
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

    # ------------------------------------------------------ handlers

    def _evidence_pos_velocity_surge(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        if problem.problem_key not in (
            "short_term_demand_spike",
            "pos_signal_divergence",
            "real_time_shortage_at_current_pos",
        ):
            return False, {}
        pos_rows = (
            self.db.query(PosHourlyActual)
            .filter(
                PosHourlyActual.sku == problem.sku,
                PosHourlyActual.node_id == problem.node_id,
            )
            .order_by(PosHourlyActual.timestamp_hour.desc())
            .limit(168)
            .all()
        )
        if len(pos_rows) < 24:
            return False, {}
        last24 = sum(float(r.units_sold or 0.0) for r in pos_rows[:24])
        trailing = pos_rows[24:]
        trailing_mean = (sum(float(r.units_sold or 0.0) for r in trailing) / len(trailing) * 24) if trailing else 0.0
        if trailing_mean <= 0:
            return False, {}
        pct = ((last24 - trailing_mean) / trailing_mean) * 100.0
        if pct < 20:
            return False, {}
        return True, {
            "last_24h_units": round(last24, 2),
            "trailing_mean_24h_units": round(trailing_mean, 2),
            "surge_pct": round(pct, 2),
            "window_hours_trailing": len(trailing),
        }

    def _evidence_ramadan(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        today = date.today()
        lookahead = 14
        row = (
            self.db.query(RamadanCalendar)
            .filter(
                RamadanCalendar.calendar_date >= today.isoformat(),
                RamadanCalendar.calendar_date <= (today + timedelta(days=lookahead)).isoformat(),
                RamadanCalendar.ramadan_day.isnot(None),
            )
            .order_by(RamadanCalendar.calendar_date.asc())
            .first()
        )
        if row is None:
            return False, {}
        days_out = (date.fromisoformat(row.calendar_date) - today).days
        return True, {
            "first_ramadan_date": row.calendar_date,
            "ramadan_day_at_first": row.ramadan_day,
            "iftar_local_time": row.iftar_local_time,
            "days_until_event": days_out,
            "note": "Cultural event window active or within lookahead — expect Iftar-hour spike.",
        }

    def _evidence_supply_lag(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        if problem.problem_key not in ("real_time_shortage_at_current_pos",):
            return False, {}
        ev = problem.evidence or {}
        shortage_hour = ev.get("shortage_hour_offset")
        on_hand_start = ev.get("on_hand_start")
        baseline_uph = ev.get("baseline_units_per_hour")
        if shortage_hour is None or not on_hand_start or not baseline_uph:
            return False, {}
        cover_hours = (float(on_hand_start) / float(baseline_uph)) if float(baseline_uph) > 0 else 0.0
        return True, {
            "cover_hours_at_current_velocity": round(cover_hours, 2),
            "shortage_hour_offset": shortage_hour,
            "on_hand_start": on_hand_start,
            "baseline_units_per_hour": baseline_uph,
            "note": "On-hand cover falls below the shortage hour — upstream pull or transfer needed before next delivery.",
        }

    def _evidence_weather_stub(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        # Stub: no weather signal source wired yet.
        return False, {"note": "Weather signal source not wired."}

    def _evidence_competitor_stub(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        return False, {"note": "Competitor signal source not wired."}
