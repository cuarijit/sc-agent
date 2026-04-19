"""Enumerate resolution candidates for demand sensing problems."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Callable

from sqlalchemy.orm import Session

from ...models import (
    NetworkInventorySnapshot,
    NetworkSourcingRule,
    PosHourlyActual,
    RamadanCalendar,
)
from ..inventory_diagnostic.problem_detector import ProblemInstance
from ..inventory_diagnostic.resolution_generator import ResolutionCandidate, _problem_ref


class DemandSensingResolver:
    def __init__(
        self,
        db: Session,
        *,
        families: list[dict[str, Any]] | None = None,
        disabled_keys: set[str] | None = None,
    ):
        self.db = db
        self.families = families or []
        self.disabled_keys = disabled_keys or set()
        self.handlers: dict[str, Callable[[ProblemInstance, dict[str, Any]], list[ResolutionCandidate]]] = {
            "apply_rolling_pos_uplift_to_short_horizon_forecast": self._reforecast,
            "request_pull_from_primary_source": self._trigger_replen_pull,
            "stage_product_mix_upstream_before_event": self._cold_chain_pre_position,
            "rebalance_production_toward_surging_skus": self._shift_production_mix,
            "pick_sibling_with_surplus_for_hour_level_transfer": self._intra_day_emergency_transfer,
        }

    def enumerate(self, problems: list[ProblemInstance]) -> list[ResolutionCandidate]:
        if not self.families or not problems:
            return []
        enabled = [
            f for f in self.families
            if isinstance(f, dict) and f.get("key") and f.get("key") not in self.disabled_keys
        ]
        out: list[ResolutionCandidate] = []
        for problem in problems:
            for family in enabled:
                handler = self.handlers.get(str(family.get("enumeration_rule")))
                if handler is None:
                    continue
                for c in handler(problem, family):
                    out.append(c)
        return out

    # --------------------------------------------------- reforecast_short_horizon

    def _reforecast(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in (
            "pos_signal_divergence",
            "short_term_demand_spike",
            "real_time_shortage_at_current_pos",
        ):
            return []
        ev = problem.evidence or {}
        surge_pct = ev.get("deviation_pct") or ev.get("spike_pct") or 0
        qty = float(problem.shortage_qty or 0.0)
        if qty <= 0:
            return []
        return [ResolutionCandidate(
            family_key=str(family.get("key")),
            problem_ref=_problem_ref(problem),
            from_node=None,
            to_node=problem.node_id,
            sku=problem.sku,
            qty=round(qty, 2),
            feasible=True,
            lead_time_days=0.0,
            incremental_cost=0.0,
            evidence={
                "suggested_uplift_pct": round(float(surge_pct), 1),
                "horizon_hours": ev.get("horizon_hours") or 6,
                "rationale": "Apply rolling POS uplift to short-horizon forecast.",
            },
        )]

    # ------------------------------------------------ trigger_replen_pull

    def _trigger_replen_pull(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in (
            "real_time_shortage_at_current_pos",
            "short_term_demand_spike",
            "cold_chain_prepos_gap",
        ):
            return []
        rule = (
            self.db.query(NetworkSourcingRule)
            .filter(
                NetworkSourcingRule.sku == problem.sku,
                NetworkSourcingRule.dest_node_id == problem.node_id,
            )
            .first()
        )
        if rule is None or not rule.primary_source_node_id:
            return []
        qty = float(problem.shortage_qty or 0.0) or float((problem.evidence or {}).get("prepos_shortfall_qty") or 0.0)
        if qty <= 0:
            return []
        return [ResolutionCandidate(
            family_key=str(family.get("key")),
            problem_ref=_problem_ref(problem),
            from_node=rule.primary_source_node_id,
            to_node=problem.node_id,
            sku=problem.sku,
            qty=round(qty, 2),
            feasible=True,
            lead_time_days=float(rule.explicit_lead_time_days or 1.0),
            incremental_cost=0.0,
            evidence={
                "source_node": rule.primary_source_node_id,
                "rationale": "Request an expedited replenishment pull from the primary source.",
            },
        )]

    # --------------------------------------------- cold_chain_pre_position

    def _cold_chain_pre_position(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in ("event_pattern_shift", "cold_chain_prepos_gap"):
            return []
        ev = problem.evidence or {}
        # Without a shortfall qty (event_pattern_shift), propose a placeholder
        # qty = 20% of the expected uplifted weekly demand.
        qty = float(problem.shortage_qty or 0.0)
        if qty <= 0:
            qty = float(ev.get("expected_uplifted_weekly_qty") or 0.0) * 0.2
        if qty <= 0:
            qty = 100.0  # minimum visible qty so the resolver isn't silent on event_pattern_shift
        rule = (
            self.db.query(NetworkSourcingRule)
            .filter(
                NetworkSourcingRule.sku == problem.sku,
                NetworkSourcingRule.dest_node_id == problem.node_id,
            )
            .first()
        ) if problem.node_id else None
        source = (rule.primary_source_node_id if rule else None) or "PLANT-DAIRY-01"
        return [ResolutionCandidate(
            family_key=str(family.get("key")),
            problem_ref=_problem_ref(problem),
            from_node=source,
            to_node=problem.node_id or "NETWORK",
            sku=problem.sku,
            qty=round(qty, 2),
            feasible=True,
            lead_time_days=2.0,
            incremental_cost=0.0,
            evidence={
                "event": ev.get("event", "Ramadan"),
                "first_event_date": ev.get("first_event_date") or ev.get("first_ramadan_date"),
                "days_until_event": ev.get("days_until_event"),
                "rationale": "Pre-position cold-chain stock upstream before the event window.",
            },
        )]

    # ----------------------------------------------- shift_production_mix

    def _shift_production_mix(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in (
            "pos_signal_divergence",
            "short_term_demand_spike",
            "event_pattern_shift",
        ):
            return []
        ev = problem.evidence or {}
        direction = ev.get("direction") or ("over" if (ev.get("deviation_pct") or 0) > 0 else None)
        if direction is None:
            return []
        qty = float(problem.shortage_qty or 0.0)
        if qty <= 0:
            qty = float(ev.get("recent_pos_units") or 0.0) * 0.15  # 15% mix shift as a starting point
        if qty <= 0:
            return []
        return [ResolutionCandidate(
            family_key=str(family.get("key")),
            problem_ref=_problem_ref(problem),
            from_node="PLANT-DAIRY-01",
            to_node=problem.node_id or "NETWORK",
            sku=problem.sku,
            qty=round(qty, 2),
            feasible=True,
            lead_time_days=3.0,
            incremental_cost=0.0,
            evidence={
                "direction": direction,
                "rationale": f"Shift plant production mix {'up' if direction == 'over' else 'down'} for this SKU next cycle.",
            },
        )]

    # ------------------------------------- intra_day_emergency_transfer

    def _intra_day_emergency_transfer(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in (
            "real_time_shortage_at_current_pos",
            "short_term_demand_spike",
        ):
            return []
        if not problem.node_id:
            return []
        # Siblings under the same parent via NetworkSourcingRule.
        parent_rule = (
            self.db.query(NetworkSourcingRule)
            .filter(
                NetworkSourcingRule.sku == problem.sku,
                NetworkSourcingRule.dest_node_id == problem.node_id,
            )
            .first()
        )
        if parent_rule is None or not parent_rule.parent_location_node_id:
            return []
        siblings = (
            self.db.query(NetworkSourcingRule.dest_node_id)
            .filter(
                NetworkSourcingRule.sku == problem.sku,
                NetworkSourcingRule.parent_location_node_id == parent_rule.parent_location_node_id,
                NetworkSourcingRule.dest_node_id != problem.node_id,
            )
            .all()
        )
        sibling_nodes = [r[0] for r in siblings if r[0]]
        if not sibling_nodes:
            return []
        # Pull latest on-hand for each sibling; pick the one with biggest surplus.
        rows = (
            self.db.query(NetworkInventorySnapshot)
            .filter(
                NetworkInventorySnapshot.sku == problem.sku,
                NetworkInventorySnapshot.node_id.in_(sibling_nodes),
            )
            .all()
        )
        if not rows:
            return []
        best: tuple[str, float] | None = None
        for r in rows:
            q = float(r.on_hand_qty or 0.0)
            if best is None or q > best[1]:
                best = (r.node_id, q)
        if best is None or best[1] <= 0:
            return []
        shortage_qty = float(problem.shortage_qty or 0.0)
        # Take min(sibling_on_hand, shortage_qty). Bound by 50% of sibling on-hand
        # so we don't strip it bare.
        qty = min(best[1] * 0.5, shortage_qty if shortage_qty > 0 else best[1] * 0.5)
        if qty <= 0:
            return []
        return [ResolutionCandidate(
            family_key=str(family.get("key")),
            problem_ref=_problem_ref(problem),
            from_node=best[0],
            to_node=problem.node_id,
            sku=problem.sku,
            qty=round(qty, 2),
            feasible=True,
            lead_time_days=0.25,  # ~6h truck
            incremental_cost=0.0,
            evidence={
                "source_on_hand_qty": round(best[1], 2),
                "rationale": "Emergency intra-day transfer from highest-surplus sibling.",
            },
        )]
