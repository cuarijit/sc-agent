"""Enumerate candidate resolutions for each detected problem.

For every enabled resolution family, the module runs the declarative
`enumeration_rule` by dispatching to a Python handler. Each handler returns a
list of ResolutionCandidate records. Candidates are later simulated + ranked
by `simulation_ranker`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable

from sqlalchemy.orm import Session

from ...models import (
    InventoryBatchSnapshot,
    NetworkActualWeekly,
    NetworkInventorySnapshot,
    NetworkSourcingRule,
    ParameterValue,
    ProductMaster,
    PromotionPlanWeekly,
    ReplenishmentOrder,
    ReplenishmentOrderDetail,
)
from ..inventory_projection_service import DEFAULT_BASE_WEEK
from .problem_detector import ProblemInstance


@dataclass
class ResolutionCandidate:
    family_key: str
    problem_ref: dict[str, Any]
    from_node: str | None
    to_node: str
    sku: str
    qty: float
    feasible: bool
    lead_time_days: float | None
    incremental_cost: float | None
    evidence: dict[str, Any] = field(default_factory=dict)
    simulated_ending_qty: float | None = None
    resolves_breach: bool | None = None
    simulation_score: float | None = None
    rank: int | None = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "family_key": self.family_key,
            "problem_ref": self.problem_ref,
            "from_node": self.from_node,
            "to_node": self.to_node,
            "sku": self.sku,
            "qty": self.qty,
            "feasible": self.feasible,
            "lead_time_days": self.lead_time_days,
            "incremental_cost": self.incremental_cost,
            "evidence": self.evidence,
            "simulated_ending_qty": self.simulated_ending_qty,
            "resolves_breach": self.resolves_breach,
            "simulation_score": (
                round(self.simulation_score, 4) if self.simulation_score is not None else None
            ),
            "rank": self.rank,
        }


class ResolutionGenerator:
    def __init__(
        self,
        db: Session,
        *,
        families: list[dict[str, Any]] | None = None,
        disabled_keys: set[str] | None = None,
        horizon_weeks: int = 12,
    ):
        self.db = db
        self.families = families or []
        self.disabled_keys = disabled_keys or set()
        self.base_week = DEFAULT_BASE_WEEK
        self.horizon_weeks = max(1, int(horizon_weeks or 12))
        self.handlers: dict[
            str,
            Callable[[ProblemInstance, dict[str, Any]], list[ResolutionCandidate]],
        ] = {
            "walk_sourcing_network_siblings_with_excess": self._enum_transfer_excess,
            "in_transit_with_eta_lte_breach_and_reroute_feasible": self._enum_reroute_intransit,
            "open_orders_with_eta_after_breach_and_expedite_possible": self._enum_expedite_inbound,
            "shift_forecast_between_sibling_nodes_with_same_parent": self._enum_reallocate_demand,
            "delay_or_taper_promo_uplift_until_week_of_recovery": self._enum_phase_promotion,
            "blocked_stock_with_quality_hold_release_eligible": self._enum_release_blocked_stock,
            "flexible_orders_pull_forward_up_to_lead_time": self._enum_pull_forward_supply,
            "propose_markdown_uplift_for_overstocked_skus": self._enum_markdown_promo,
            "push_excess_to_sibling_below_rop": self._enum_transfer_out_to_sibling,
            "open_orders_on_overstocked_skus": self._enum_pause_inbound,
            "propose_earlier_replenishment_before_promo_window": self._enum_pre_build_inventory,
            "propose_markdown_for_batches_with_rsl_below_threshold": self._enum_accelerated_markdown,
            "terminal_action_for_batches_with_rsl_le_critical": self._enum_donate_or_scrap,
            "pull_fresh_batch_from_upstream_to_cover_shortfall": self._enum_expedite_fresh_batch,
            "push_aged_batches_to_fastest_selling_sibling": self._enum_redirect_to_high_velocity_store,
        }

    def enumerate(self, problems: list[ProblemInstance]) -> list[ResolutionCandidate]:
        if not self.families or not problems:
            return []
        enabled = [
            f for f in self.families
            if isinstance(f, dict) and f.get("key") and f.get("key") not in self.disabled_keys
        ]
        candidates: list[ResolutionCandidate] = []
        for problem in problems:
            for family in enabled:
                handler = self.handlers.get(str(family.get("enumeration_rule")))
                if handler is None:
                    continue
                for candidate in handler(problem, family):
                    candidates.append(candidate)
        return candidates

    # -------------------------------------------------- transfer_excess

    def _enum_transfer_excess(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        siblings = self._sibling_nodes(problem.sku, problem.node_id)
        # Parent / upstream node is always considered a transfer source too.
        parent = self._parent_node(problem.sku, problem.node_id)
        source_candidates = list(dict.fromkeys(siblings + ([parent] if parent else [])))
        if not source_candidates:
            return []

        safety_map = self._safety_stock_map(problem.sku, source_candidates)
        on_hand_map = self._on_hand_map(problem.sku, source_candidates)

        results: list[ResolutionCandidate] = []
        for source in source_candidates:
            on_hand = on_hand_map.get(source, 0.0)
            sibling_safety = safety_map.get(source, 0.0)
            sibling_excess = max(0.0, on_hand - sibling_safety)
            if sibling_excess <= 0 or problem.shortage_qty <= 0:
                continue
            qty = min(problem.shortage_qty, sibling_excess)
            lane_transit_days = 2.0  # default when no lane model exists
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=source,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=True,
                    lead_time_days=lane_transit_days,
                    incremental_cost=0.0,
                    evidence={
                        "source_on_hand_qty": on_hand,
                        "source_safety_stock": sibling_safety,
                        "source_excess_qty": sibling_excess,
                    },
                )
            )
        return results

    # --------------------------------------------- reroute_intransit

    def _enum_reroute_intransit(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        breach_week = problem.breach_week or 1
        breach_date = self.base_week + timedelta(days=7 * (breach_week - 1))
        siblings = self._sibling_nodes(problem.sku, problem.node_id)
        # Find orders for this SKU destined to any node other than ours that
        # arrive on or before breach_week. These are divert candidates.
        rows = (
            self.db.query(ReplenishmentOrder, ReplenishmentOrderDetail)
            .join(
                ReplenishmentOrderDetail,
                ReplenishmentOrderDetail.order_id == ReplenishmentOrder.order_id,
            )
            .filter(
                ReplenishmentOrder.sku == problem.sku,
                ReplenishmentOrder.status.in_(("in_transit", "shipped")),
                ReplenishmentOrder.ship_to_node_id != problem.node_id,
            )
            .all()
        )
        results: list[ResolutionCandidate] = []
        for header, detail in rows:
            eta_raw = (header.eta or "").split("T")[0]
            try:
                eta_date = date.fromisoformat(eta_raw)
            except ValueError:
                continue
            if eta_date > breach_date:
                continue
            qty = min(problem.shortage_qty, float(detail.order_qty or header.order_qty or 0.0))
            if qty <= 0:
                continue
            # Only reroute if the original destination is a known sibling / parent
            # — otherwise we'd be stealing stock from an unrelated demand.
            original_dest = header.ship_to_node_id
            if original_dest not in siblings and original_dest != problem.node_id:
                # Allow rerouting from any sibling of our node for now; mark the
                # candidate infeasible otherwise so planners see the warning.
                feasible = False
            else:
                feasible = True
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=header.ship_from_node_id,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=feasible,
                    lead_time_days=float(header.lead_time_days or 0.0),
                    incremental_cost=0.0,
                    evidence={
                        "order_id": header.order_id,
                        "original_destination": original_dest,
                        "status": header.status,
                        "eta": eta_raw,
                    },
                )
            )
        return results

    # ---------------------------------------------- expedite_inbound

    def _enum_expedite_inbound(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        breach_week = problem.breach_week or 1
        breach_date = self.base_week + timedelta(days=7 * (breach_week - 1))
        rows = (
            self.db.query(ReplenishmentOrder)
            .filter(
                ReplenishmentOrder.sku == problem.sku,
                ReplenishmentOrder.ship_to_node_id == problem.node_id,
                ReplenishmentOrder.status.in_(("open", "planned", "in_transit")),
            )
            .all()
        )
        results: list[ResolutionCandidate] = []
        for row in rows:
            eta_raw = (row.eta or "").split("T")[0]
            try:
                eta_date = date.fromisoformat(eta_raw)
            except ValueError:
                continue
            if eta_date < breach_date:
                continue  # already arrives before breach — nothing to expedite
            qty = min(problem.shortage_qty, float(row.order_qty or 0.0))
            if qty <= 0:
                continue
            feasible = bool(row.update_possible)
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=row.ship_from_node_id,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=feasible,
                    lead_time_days=float(row.lead_time_days or 0.0),
                    incremental_cost=float(row.order_cost or 0.0) * 0.15,
                    evidence={
                        "order_id": row.order_id,
                        "original_eta": eta_raw,
                        "status": row.status,
                    },
                )
            )
        return results

    # ---------------------------------------------- reallocate_demand

    def _enum_reallocate_demand(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        siblings = self._sibling_nodes(problem.sku, problem.node_id)
        if not siblings:
            return []
        on_hand_map = self._on_hand_map(problem.sku, siblings)
        results: list[ResolutionCandidate] = []
        for sibling in siblings:
            on_hand = on_hand_map.get(sibling, 0.0)
            if on_hand <= 0:
                continue
            qty = min(problem.shortage_qty, on_hand)
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=sibling,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=True,
                    lead_time_days=None,
                    incremental_cost=None,
                    evidence={
                        "sibling_on_hand_qty": on_hand,
                        "note": "Propose shifting forecast demand; requires planner approval.",
                    },
                )
            )
        return results

    # -------------------------------------------- Phase 4 / optional handlers

    def _enum_phase_promotion(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        # Phase-promotion candidates exist anywhere in the planning horizon —
        # not just the breach week.
        window_start = self.base_week
        window_end = self.base_week + timedelta(days=7 * self.horizon_weeks)
        rows = (
            self.db.query(PromotionPlanWeekly)
            .filter(
                PromotionPlanWeekly.sku == problem.sku,
                PromotionPlanWeekly.node_id == problem.node_id,
            )
            .all()
        )
        results: list[ResolutionCandidate] = []
        for row in rows:
            try:
                ws = date.fromisoformat(str(row.week_start))
            except (TypeError, ValueError):
                continue
            if not (window_start <= ws <= window_end and float(row.uplift_pct or 0.0) > 0):
                continue
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=None,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(problem.shortage_qty, 2),
                    feasible=True,
                    lead_time_days=0.0,
                    incremental_cost=0.0,
                    evidence={
                        "promo_week_start": ws.isoformat(),
                        "uplift_pct": float(row.uplift_pct or 0.0),
                        "promo_type": row.promo_type,
                        "recommendation": "delay_or_taper",
                    },
                )
            )
        return results

    def _enum_release_blocked_stock(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        rows = (
            self.db.query(NetworkInventorySnapshot)
            .filter(
                NetworkInventorySnapshot.sku == problem.sku,
                NetworkInventorySnapshot.node_id == problem.node_id,
                NetworkInventorySnapshot.quality_hold_flag.is_(True),
            )
            .all()
        )
        results: list[ResolutionCandidate] = []
        for row in rows:
            blocked = float(row.on_hand_qty or 0.0)
            if blocked <= 0:
                continue
            qty = min(problem.shortage_qty, blocked) if problem.shortage_qty > 0 else blocked
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=problem.node_id,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=True,
                    lead_time_days=0.0,
                    incremental_cost=0.0,
                    evidence={"blocked_snapshot_id": row.id, "as_of_date": row.as_of_date},
                )
            )
        return results

    def _enum_pull_forward_supply(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        return []

    # ----------------------------------------------- new Phase 7 resolutions

    def _enum_markdown_promo(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        # Applies only to excess_inventory_risk problems — propose a markdown
        # promotion to burn through excess stock.
        if problem.problem_key != "excess_inventory_risk":
            return []
        on_hand = float(problem.projected_on_hand_actual_qty or 0.0)
        if on_hand <= 0:
            return []
        excess_qty = problem.shortage_qty  # reused as "excess magnitude" by detector
        if excess_qty <= 0:
            return []
        return [
            ResolutionCandidate(
                family_key=str(family.get("key")),
                problem_ref=_problem_ref(problem),
                from_node=problem.node_id,
                to_node=problem.node_id,
                sku=problem.sku,
                qty=round(excess_qty, 2),
                feasible=True,
                lead_time_days=0.0,
                incremental_cost=None,
                evidence={
                    "suggested_uplift_pct": 0.20,
                    "target_weeks_of_cover": 8,
                    "current_excess_qty": round(excess_qty, 2),
                },
            )
        ]

    def _enum_transfer_out_to_sibling(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        # Inverse of transfer_excess: push excess to a sibling below ROP.
        if problem.problem_key != "excess_inventory_risk":
            return []
        siblings = self._sibling_nodes(problem.sku, problem.node_id)
        if not siblings:
            return []
        on_hand_map = self._on_hand_map(problem.sku, siblings)
        rop_map = self._reorder_point_map(problem.sku, siblings)
        results: list[ResolutionCandidate] = []
        for sib in siblings:
            sib_on_hand = on_hand_map.get(sib, 0.0)
            sib_rop = rop_map.get(sib, 0.0)
            gap = max(0.0, sib_rop - sib_on_hand)
            if gap <= 0:
                continue
            qty = min(problem.shortage_qty, gap)
            if qty <= 0:
                continue
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=problem.node_id,
                    to_node=sib,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=True,
                    lead_time_days=2.0,
                    incremental_cost=0.0,
                    evidence={
                        "sibling_on_hand": sib_on_hand,
                        "sibling_rop": sib_rop,
                        "sibling_gap": round(gap, 2),
                    },
                )
            )
        return results

    def _enum_pause_inbound(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key != "excess_inventory_risk":
            return []
        rows = (
            self.db.query(ReplenishmentOrder)
            .filter(
                ReplenishmentOrder.sku == problem.sku,
                ReplenishmentOrder.ship_to_node_id == problem.node_id,
                ReplenishmentOrder.status.in_(("open", "planned")),
            )
            .all()
        )
        results: list[ResolutionCandidate] = []
        for row in rows:
            qty = min(problem.shortage_qty, float(row.order_qty or 0.0))
            if qty <= 0:
                continue
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=row.ship_from_node_id,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=bool(row.update_possible),
                    lead_time_days=None,
                    incremental_cost=0.0,
                    evidence={
                        "order_id": row.order_id,
                        "order_status": row.status,
                        "suggested_action": "pause_or_cancel",
                    },
                )
            )
        return results

    def _enum_pre_build_inventory(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        # Only meaningful when the problem lives inside a promotion window —
        # promotion_supply_gap or projected_stockout whose breach falls inside
        # a bound promotion_plan row for this sku/node.
        breach_week = problem.breach_week or 1
        window_start = self.base_week
        window_end = self.base_week + timedelta(days=7 * max(breach_week, 1))
        promos = (
            self.db.query(PromotionPlanWeekly)
            .filter(
                PromotionPlanWeekly.sku == problem.sku,
                PromotionPlanWeekly.node_id == problem.node_id,
            )
            .all()
        )
        relevant: list[PromotionPlanWeekly] = []
        for p in promos:
            try:
                ws = date.fromisoformat(str(p.week_start))
            except (TypeError, ValueError):
                continue
            if window_start <= ws <= window_end and float(p.uplift_pct or 0.0) > 0:
                relevant.append(p)
        if not relevant:
            return []
        # Suggest pulling inventory in 1 week before the first relevant promo.
        first = min(relevant, key=lambda p: p.week_start)
        first_week = date.fromisoformat(str(first.week_start))
        arrive_by = (first_week - timedelta(days=7)).isoformat()
        return [
            ResolutionCandidate(
                family_key=str(family.get("key")),
                problem_ref=_problem_ref(problem),
                from_node=None,
                to_node=problem.node_id,
                sku=problem.sku,
                qty=round(problem.shortage_qty, 2) if problem.shortage_qty > 0 else 0.0,
                feasible=True,
                lead_time_days=7.0,
                incremental_cost=None,
                evidence={
                    "promo_first_week": first.week_start,
                    "suggested_arrival_by": arrive_by,
                    "promos_in_window": len(relevant),
                },
            )
        ]

    # ------------------------------------------------- perishable resolutions

    def _latest_batches(self, sku: str, node: str) -> list[InventoryBatchSnapshot]:
        rows = (
            self.db.query(InventoryBatchSnapshot)
            .filter(
                InventoryBatchSnapshot.sku == sku,
                InventoryBatchSnapshot.node_id == node,
            )
            .all()
        )
        if not rows:
            return []
        latest = max(str(r.as_of_date) for r in rows)
        return [r for r in rows if str(r.as_of_date) == latest]

    def _rsl_days(self, row: InventoryBatchSnapshot, as_of: date) -> int | None:
        try:
            exp = date.fromisoformat(row.expiry_date)
        except (TypeError, ValueError):
            return None
        return (exp - as_of).days

    def _enum_accelerated_markdown(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        """Propose a markdown for each batch with RSL ≤ 2 days so it sells before
        expiry. Only fires for perishable problem types."""
        if problem.problem_key not in ("expiring_batch_risk", "shelf_life_shortfall", "excess_inventory_risk"):
            return []
        rows = self._latest_batches(problem.sku, problem.node_id)
        if not rows:
            return []
        as_of = self.base_week
        results: list[ResolutionCandidate] = []
        for r in rows:
            rsl = self._rsl_days(r, as_of)
            qty = float(r.batch_qty or 0.0)
            if rsl is None or qty <= 0:
                continue
            if rsl > 2:
                continue
            uplift_pct = 0.40 if rsl <= 1 else 0.25
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=problem.node_id,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=True,
                    lead_time_days=0.0,
                    incremental_cost=None,
                    evidence={
                        "batch_id": r.batch_id,
                        "rsl_days": rsl,
                        "expiry_date": r.expiry_date,
                        "suggested_uplift_pct": uplift_pct,
                        "rationale": "RSL-driven markdown to clear stock before expiry.",
                    },
                )
            )
        return results

    def _enum_donate_or_scrap(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        """Terminal action for batches already expired or with RSL ≤ 0."""
        if problem.problem_key not in ("expiring_batch_risk", "shelf_life_shortfall"):
            return []
        rows = self._latest_batches(problem.sku, problem.node_id)
        if not rows:
            return []
        as_of = self.base_week
        results: list[ResolutionCandidate] = []
        for r in rows:
            rsl = self._rsl_days(r, as_of)
            qty = float(r.batch_qty or 0.0)
            if rsl is None or qty <= 0:
                continue
            if rsl > 0:
                continue
            action = "donate" if rsl == 0 else "scrap"
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=problem.node_id,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=True,
                    lead_time_days=0.0,
                    incremental_cost=None,
                    evidence={
                        "batch_id": r.batch_id,
                        "rsl_days": rsl,
                        "expiry_date": r.expiry_date,
                        "terminal_action": action,
                        "rationale": "No sellable window remains — route to donation or scrap per policy.",
                    },
                )
            )
        return results

    def _enum_expedite_fresh_batch(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        """Pull a fresh batch from an upstream/sibling node to cover the
        shelf-life shortfall. Prefers the batch with the longest RSL."""
        if problem.problem_key not in ("shelf_life_shortfall", "expiring_batch_risk", "projected_stockout"):
            return []
        candidates = self._sibling_nodes(problem.sku, problem.node_id)
        parent = self._parent_node(problem.sku, problem.node_id)
        if parent:
            candidates = candidates + [parent]
        candidates = list(dict.fromkeys(candidates))
        if not candidates:
            return []
        as_of = self.base_week
        results: list[ResolutionCandidate] = []
        for src in candidates:
            rows = self._latest_batches(problem.sku, src)
            if not rows:
                continue
            # Prefer freshest batch (largest RSL) with qty > 0.
            fresh: tuple[InventoryBatchSnapshot, int] | None = None
            for r in rows:
                rsl = self._rsl_days(r, as_of)
                if rsl is None or float(r.batch_qty or 0.0) <= 0:
                    continue
                if fresh is None or rsl > fresh[1]:
                    fresh = (r, rsl)
            if fresh is None:
                continue
            batch, rsl = fresh
            qty = min(problem.shortage_qty, float(batch.batch_qty or 0.0))
            if qty <= 0:
                continue
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=src,
                    to_node=problem.node_id,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=True,
                    lead_time_days=1.0,
                    incremental_cost=0.0,
                    evidence={
                        "source_batch_id": batch.batch_id,
                        "source_batch_rsl_days": rsl,
                        "source_expiry_date": batch.expiry_date,
                        "rationale": "Pull longest-RSL batch upstream to cover shortfall.",
                    },
                )
            )
        return results

    def _enum_redirect_to_high_velocity_store(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        """Push aged batches (RSL ≤ 3 days) from the problem node to the highest-
        velocity sibling store to convert them to sales before expiry."""
        if problem.problem_key not in ("expiring_batch_risk", "excess_inventory_risk"):
            return []
        rows = self._latest_batches(problem.sku, problem.node_id)
        if not rows:
            return []
        siblings = self._sibling_nodes(problem.sku, problem.node_id)
        if not siblings:
            return []
        as_of = self.base_week
        # Rank siblings by recent actual demand (last 6 rows) — proxy for velocity.
        velocity_map: dict[str, float] = {}
        for sib in siblings:
            actuals = (
                self.db.query(NetworkActualWeekly)
                .filter(
                    NetworkActualWeekly.sku == problem.sku,
                    NetworkActualWeekly.node_id == sib,
                )
                .order_by(NetworkActualWeekly.week_start.desc())
                .limit(6)
                .all()
            )
            velocity_map[sib] = sum(float(a.actual_qty or 0.0) for a in actuals)
        ranked = sorted(velocity_map.items(), key=lambda kv: kv[1], reverse=True)
        if not ranked or ranked[0][1] <= 0:
            return []
        target = ranked[0][0]
        target_velocity = ranked[0][1]
        results: list[ResolutionCandidate] = []
        for r in rows:
            rsl = self._rsl_days(r, as_of)
            qty = float(r.batch_qty or 0.0)
            if rsl is None or qty <= 0 or rsl > 3 or rsl <= 0:
                continue
            results.append(
                ResolutionCandidate(
                    family_key=str(family.get("key")),
                    problem_ref=_problem_ref(problem),
                    from_node=problem.node_id,
                    to_node=target,
                    sku=problem.sku,
                    qty=round(qty, 2),
                    feasible=True,
                    lead_time_days=0.5,
                    incremental_cost=0.0,
                    evidence={
                        "batch_id": r.batch_id,
                        "rsl_days": rsl,
                        "target_velocity_last_6_weeks": round(target_velocity, 2),
                        "rationale": f"Redirect to {target} — highest recent sell-through for this SKU.",
                    },
                )
            )
        return results

    # ------------------------------------------------------- helpers (new)

    def _reorder_point_map(self, sku: str, nodes: list[str]) -> dict[str, float]:
        if not nodes:
            return {}
        rows = (
            self.db.query(ParameterValue.location, ParameterValue.effective_value)
            .filter(
                ParameterValue.sku == sku,
                ParameterValue.location.in_(nodes),
                ParameterValue.parameter_code == "reorder_point_qty",
            )
            .all()
        )
        result: dict[str, float] = {}
        for loc, value in rows:
            try:
                result[loc] = float(value)
            except (TypeError, ValueError):
                continue
        return result

    # ------------------------------------------------------------------ helpers

    def _sibling_nodes(self, sku: str, target_node: str) -> list[str]:
        target_rule = (
            self.db.query(NetworkSourcingRule)
            .filter(
                NetworkSourcingRule.sku == sku,
                NetworkSourcingRule.dest_node_id == target_node,
            )
            .first()
        )
        if target_rule is None or not target_rule.parent_location_node_id:
            return []
        rows = (
            self.db.query(NetworkSourcingRule.dest_node_id)
            .filter(
                NetworkSourcingRule.sku == sku,
                NetworkSourcingRule.parent_location_node_id == target_rule.parent_location_node_id,
                NetworkSourcingRule.dest_node_id != target_node,
            )
            .all()
        )
        return sorted({r[0] for r in rows if r[0]})

    def _parent_node(self, sku: str, target_node: str) -> str | None:
        row = (
            self.db.query(NetworkSourcingRule)
            .filter(
                NetworkSourcingRule.sku == sku,
                NetworkSourcingRule.dest_node_id == target_node,
            )
            .first()
        )
        if row is None:
            return None
        return row.primary_source_node_id or row.parent_location_node_id

    def _on_hand_map(self, sku: str, nodes: list[str]) -> dict[str, float]:
        if not nodes:
            return {}
        rows = (
            self.db.query(NetworkInventorySnapshot)
            .filter(
                NetworkInventorySnapshot.sku == sku,
                NetworkInventorySnapshot.node_id.in_(nodes),
            )
            .all()
        )
        result: dict[str, float] = {}
        for row in rows:
            existing = result.get(row.node_id)
            if existing is None or float(row.on_hand_qty) > existing:
                result[row.node_id] = float(row.on_hand_qty)
        return result

    def _safety_stock_map(self, sku: str, nodes: list[str]) -> dict[str, float]:
        if not nodes:
            return {}
        rows = (
            self.db.query(ParameterValue.location, ParameterValue.effective_value)
            .filter(
                ParameterValue.sku == sku,
                ParameterValue.location.in_(nodes),
                ParameterValue.parameter_code == "safety_stock_qty",
            )
            .all()
        )
        result: dict[str, float] = {}
        for loc, value in rows:
            try:
                result[loc] = float(value)
            except (TypeError, ValueError):
                continue
        return result


def _problem_ref(problem: ProblemInstance) -> dict[str, Any]:
    return {
        "problem_key": problem.problem_key,
        "sku": problem.sku,
        "node_id": problem.node_id,
        "breach_week": problem.breach_week,
        "shortage_qty": problem.shortage_qty,
    }
