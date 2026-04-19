"""Deterministic signal detection for the demand sensing agent.

Five problem types:
  - short_term_demand_spike          (POS last 24h / trailing 7d mean ≥ threshold)
  - pos_signal_divergence            (POS last 72h vs weekly forecast pro-rata)
  - event_pattern_shift              (Ramadan day approaching within lookahead)
  - real_time_shortage_at_current_pos (hourly projection runs negative in N hours)
  - cold_chain_prepos_gap            (event in 7d but on-hand < expected demand)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ...models import (
    NetworkForecastWeekly,
    NetworkInventorySnapshot,
    PosHourlyActual,
    ProductMaster,
    RamadanCalendar,
)
from ..inventory_diagnostic.problem_detector import ProblemInstance
from ..inventory_projection_service import InventoryProjectionService


@dataclass
class DemandSensingScope:
    skus: list[str] = field(default_factory=list)
    nodes: list[str] = field(default_factory=list)
    ramadan_day_filter: int | None = None
    simulation_delta: dict[str, Any] = field(default_factory=dict)


class DemandSensingDetector:
    def __init__(
        self,
        db: Session,
        *,
        problem_templates: list[dict[str, Any]] | None = None,
        disabled_keys: set[str] | None = None,
        sensing_horizon_hours: int = 6,
        divergence_threshold_pct: float = 20.0,
        ramadan_event_lookahead_days: int = 14,
    ):
        self.db = db
        self.problem_templates = problem_templates or []
        self.disabled_keys = disabled_keys or set()
        self.sensing_horizon_hours = int(sensing_horizon_hours)
        self.divergence_threshold_pct = float(divergence_threshold_pct)
        self.ramadan_event_lookahead_days = int(ramadan_event_lookahead_days)
        self.projection = InventoryProjectionService(db)

    # ----------------------------------------------------------------- public

    def detect(self, scope: DemandSensingScope) -> list[ProblemInstance]:
        enabled_keys = {
            t["key"] for t in self.problem_templates
            if isinstance(t, dict) and t.get("key") and t.get("key") not in self.disabled_keys
        }
        pairs = self._sku_node_pairs(scope)
        now = datetime.now().replace(second=0, microsecond=0)

        problems: list[ProblemInstance] = []
        if "pos_signal_divergence" in enabled_keys:
            problems.extend(self._pos_divergence(pairs, now))
        if "short_term_demand_spike" in enabled_keys:
            problems.extend(self._demand_spike(pairs, now))
        if "real_time_shortage_at_current_pos" in enabled_keys:
            problems.extend(self._realtime_shortage(pairs, now, scope))
        if "event_pattern_shift" in enabled_keys:
            problems.extend(self._event_pattern_shift(scope, now))
        if "cold_chain_prepos_gap" in enabled_keys:
            problems.extend(self._cold_chain_prepos_gap(pairs, now))
        return problems

    # ------------------------------------------------------- sku/node pairs

    def _sku_node_pairs(self, scope: DemandSensingScope) -> list[tuple[str, str]]:
        q = self.db.query(PosHourlyActual.sku, PosHourlyActual.node_id).distinct()
        if scope.skus:
            q = q.filter(PosHourlyActual.sku.in_(scope.skus))
        if scope.nodes:
            q = q.filter(PosHourlyActual.node_id.in_(scope.nodes))
        rows = q.all()
        if rows:
            return sorted({(r[0], r[1]) for r in rows if r[0] and r[1]})
        # Fall back to NetworkInventorySnapshot when POS hasn't been seeded for
        # some SKUs — ensures the agent still surfaces event-pattern signals.
        inv_q = self.db.query(
            NetworkInventorySnapshot.sku, NetworkInventorySnapshot.node_id
        ).distinct()
        if scope.skus:
            inv_q = inv_q.filter(NetworkInventorySnapshot.sku.in_(scope.skus))
        if scope.nodes:
            inv_q = inv_q.filter(NetworkInventorySnapshot.node_id.in_(scope.nodes))
        return sorted({(r[0], r[1]) for r in inv_q.all() if r[0] and r[1]})

    # --------------------------------------------------- pos_signal_divergence

    def _pos_divergence(
        self, pairs: list[tuple[str, str]], now: datetime
    ) -> list[ProblemInstance]:
        out: list[ProblemInstance] = []
        for sku, node in pairs:
            pos_rows = (
                self.db.query(PosHourlyActual)
                .filter(
                    PosHourlyActual.sku == sku,
                    PosHourlyActual.node_id == node,
                )
                .order_by(PosHourlyActual.timestamp_hour.desc())
                .limit(72)
                .all()
            )
            if len(pos_rows) < 12:
                continue
            recent_units = sum(float(r.units_sold or 0.0) for r in pos_rows)
            # Pro-rate weekly forecast to the observed window (hours).
            forecast_weekly = self._latest_forecast_qty(sku, node)
            if forecast_weekly <= 0:
                continue
            forecast_pro_rata = forecast_weekly * (len(pos_rows) / (7 * 24.0))
            if forecast_pro_rata <= 0:
                continue
            deviation_pct = ((recent_units - forecast_pro_rata) / forecast_pro_rata) * 100.0
            if abs(deviation_pct) < self.divergence_threshold_pct:
                continue
            severity = "critical" if abs(deviation_pct) >= 30 else "warning"
            out.append(ProblemInstance(
                problem_key="pos_signal_divergence",
                sku=sku,
                node_id=node,
                breach_week=None,
                breach_week_date=now.date().isoformat(),
                severity=severity,
                shortage_qty=round(abs(recent_units - forecast_pro_rata), 2),
                projected_on_hand_actual_qty=float(recent_units),
                safety_stock_qty=0.0,
                reorder_point_qty=0.0,
                evidence={
                    "window_hours": len(pos_rows),
                    "recent_pos_units": round(recent_units, 2),
                    "forecast_pro_rata_units": round(forecast_pro_rata, 2),
                    "forecast_weekly_qty": round(forecast_weekly, 2),
                    "deviation_pct": round(deviation_pct, 2),
                    "threshold_pct": self.divergence_threshold_pct,
                    "direction": "over" if deviation_pct > 0 else "under",
                },
            ))
        return out

    # ------------------------------------------------- short_term_demand_spike

    def _demand_spike(
        self, pairs: list[tuple[str, str]], now: datetime
    ) -> list[ProblemInstance]:
        out: list[ProblemInstance] = []
        for sku, node in pairs:
            pos_rows = (
                self.db.query(PosHourlyActual)
                .filter(
                    PosHourlyActual.sku == sku,
                    PosHourlyActual.node_id == node,
                )
                .order_by(PosHourlyActual.timestamp_hour.desc())
                .limit(168)  # 7 days
                .all()
            )
            if len(pos_rows) < 48:
                continue
            last24 = [float(r.units_sold or 0.0) for r in pos_rows[:24]]
            prior = [float(r.units_sold or 0.0) for r in pos_rows[24:]]
            if not prior:
                continue
            mean_prior = sum(prior) / len(prior) * 24
            total_last24 = sum(last24)
            if mean_prior <= 0:
                continue
            pct = ((total_last24 - mean_prior) / mean_prior) * 100.0
            if pct < 25.0:
                continue
            severity = "critical" if pct >= 40 else "warning"
            out.append(ProblemInstance(
                problem_key="short_term_demand_spike",
                sku=sku,
                node_id=node,
                breach_week=None,
                breach_week_date=now.date().isoformat(),
                severity=severity,
                shortage_qty=round(total_last24 - mean_prior, 2),
                projected_on_hand_actual_qty=total_last24,
                safety_stock_qty=0.0,
                reorder_point_qty=0.0,
                evidence={
                    "last_24h_units": round(total_last24, 2),
                    "trailing_mean_24h_units": round(mean_prior, 2),
                    "spike_pct": round(pct, 2),
                    "window_hours_trailing": len(prior),
                },
            ))
        return out

    # ------------------------------------------- real_time_shortage_at_current_pos

    def _realtime_shortage(
        self,
        pairs: list[tuple[str, str]],
        now: datetime,
        scope: DemandSensingScope,
    ) -> list[ProblemInstance]:
        out: list[ProblemInstance] = []
        uplift = 1.0
        sim = scope.simulation_delta or {}
        try:
            uplift = float(sim.get("velocity_multiplier") or 1.0)
        except (TypeError, ValueError):
            uplift = 1.0
        horizon = int(sim.get("horizon_hours") or self.sensing_horizon_hours)
        for sku, node in pairs:
            try:
                proj = self.projection.project_hourly(
                    sku, node,
                    horizon_hours=horizon,
                    as_of=now,
                    uplift_multiplier=uplift,
                )
            except Exception:
                continue
            shortage_hour = proj.get("predicted_shortage_hour")
            if shortage_hour is None:
                continue
            shortage_qty = float(proj.get("predicted_shortage_qty") or 0.0)
            severity = "critical" if int(shortage_hour) <= 2 else "warning"
            out.append(ProblemInstance(
                problem_key="real_time_shortage_at_current_pos",
                sku=sku,
                node_id=node,
                breach_week=None,
                breach_week_date=proj["hours"][int(shortage_hour)]["hour_start_iso"] if proj.get("hours") else None,
                severity=severity,
                shortage_qty=round(shortage_qty, 2),
                projected_on_hand_actual_qty=float(proj.get("on_hand_start") or 0.0),
                safety_stock_qty=0.0,
                reorder_point_qty=0.0,
                evidence={
                    "on_hand_start": proj.get("on_hand_start"),
                    "baseline_units_per_hour": proj.get("baseline_units_per_hour"),
                    "uplift_multiplier": uplift,
                    "horizon_hours": horizon,
                    "shortage_hour_offset": shortage_hour,
                    "shortage_hour_start_iso": proj["hours"][int(shortage_hour)]["hour_start_iso"] if proj.get("hours") else None,
                    "iftar_local_time": proj.get("iftar_local_time"),
                    "ramadan_day": proj.get("ramadan_day"),
                    "hours_preview": proj.get("hours", [])[:horizon],
                },
            ))
        return out

    # ------------------------------------------------- event_pattern_shift

    def _event_pattern_shift(
        self, scope: DemandSensingScope, now: datetime
    ) -> list[ProblemInstance]:
        lookahead = self.ramadan_event_lookahead_days
        rows = (
            self.db.query(RamadanCalendar)
            .filter(
                RamadanCalendar.calendar_date >= now.date().isoformat(),
                RamadanCalendar.calendar_date <= (now.date() + timedelta(days=lookahead)).isoformat(),
                RamadanCalendar.ramadan_day.isnot(None),
            )
            .order_by(RamadanCalendar.calendar_date.asc())
            .all()
        )
        if not rows:
            return []
        # Collapse into a single event_pattern_shift marker per SKU so the ranker
        # gets a reasonable-sized set.
        first = rows[0]
        days_out = (date.fromisoformat(first.calendar_date) - now.date()).days
        # Emit one per SKU in the product catalog so every dairy SKU picks up
        # the Ramadan signal in its results view.
        product_q = self.db.query(ProductMaster)
        if scope.skus:
            product_q = product_q.filter(ProductMaster.sku.in_(scope.skus))
        products = product_q.all()
        # If perishable SKUs exist, restrict to those so we don't flood all.
        perishable = [p for p in products if getattr(p, "category_perishable", False)]
        products = perishable if perishable else products[:10]
        out: list[ProblemInstance] = []
        for p in products[:20]:
            out.append(ProblemInstance(
                problem_key="event_pattern_shift",
                sku=p.sku,
                node_id="",
                breach_week=None,
                breach_week_date=first.calendar_date,
                severity="warning",
                shortage_qty=0.0,
                projected_on_hand_actual_qty=0.0,
                safety_stock_qty=0.0,
                reorder_point_qty=0.0,
                evidence={
                    "event": "Ramadan",
                    "first_event_date": first.calendar_date,
                    "days_until_event": days_out,
                    "ramadan_day_at_first": first.ramadan_day,
                    "iftar_local_time": first.iftar_local_time,
                    "lookahead_days": lookahead,
                },
            ))
        return out

    # ------------------------------------------------- cold_chain_prepos_gap

    def _cold_chain_prepos_gap(
        self, pairs: list[tuple[str, str]], now: datetime
    ) -> list[ProblemInstance]:
        # Fire for the subset of SKU/node pairs where, with Ramadan within 7
        # days, current on-hand < expected uplifted weekly forecast * 0.5
        # (i.e. less than half a week of pre-positioning).
        lookahead_date = (now.date() + timedelta(days=7)).isoformat()
        ramadan = (
            self.db.query(RamadanCalendar)
            .filter(
                RamadanCalendar.calendar_date >= now.date().isoformat(),
                RamadanCalendar.calendar_date <= lookahead_date,
                RamadanCalendar.ramadan_day.isnot(None),
            )
            .first()
        )
        if ramadan is None:
            return []
        out: list[ProblemInstance] = []
        seen: set[tuple[str, str]] = set()
        for sku, node in pairs:
            if (sku, node) in seen:
                continue
            seen.add((sku, node))
            forecast_weekly = self._latest_forecast_qty(sku, node)
            if forecast_weekly <= 0:
                continue
            expected_uplifted = forecast_weekly * 1.3
            on_hand = self.projection._opening_stock(sku, node, now.date())
            if on_hand >= expected_uplifted * 0.5:
                continue
            shortfall = expected_uplifted * 0.5 - on_hand
            out.append(ProblemInstance(
                problem_key="cold_chain_prepos_gap",
                sku=sku,
                node_id=node,
                breach_week=None,
                breach_week_date=ramadan.calendar_date,
                severity="warning",
                shortage_qty=round(shortfall, 2),
                projected_on_hand_actual_qty=on_hand,
                safety_stock_qty=0.0,
                reorder_point_qty=round(expected_uplifted, 2),
                evidence={
                    "first_ramadan_date": ramadan.calendar_date,
                    "iftar_local_time": ramadan.iftar_local_time,
                    "forecast_weekly_qty": round(forecast_weekly, 2),
                    "expected_uplifted_weekly_qty": round(expected_uplifted, 2),
                    "on_hand_qty": round(on_hand, 2),
                    "prepos_shortfall_qty": round(shortfall, 2),
                },
            ))
        return out

    # ----------------------------------------------------------------- helpers

    def _latest_forecast_qty(self, sku: str, node: str) -> float:
        row = (
            self.db.query(NetworkForecastWeekly)
            .filter(
                NetworkForecastWeekly.sku == sku,
                NetworkForecastWeekly.node_id == node,
            )
            .order_by(NetworkForecastWeekly.week_start.desc())
            .first()
        )
        if row is None:
            return 0.0
        return float(row.forecast_qty or 0.0)
