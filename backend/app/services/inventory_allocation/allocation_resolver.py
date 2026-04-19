"""Enumerate resolution candidates for allocation / distribution problems.

Each resolution family has an enumeration_rule string declared in the agent
template; this module dispatches those IDs to deterministic Python handlers.
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
    StoreVelocity,
)
from ..inventory_diagnostic.problem_detector import ProblemInstance
from ..inventory_diagnostic.resolution_generator import ResolutionCandidate, _problem_ref


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


class AllocationResolver:
    def __init__(
        self,
        db: Session,
        *,
        families: list[dict[str, Any]] | None = None,
        disabled_keys: set[str] | None = None,
        rsl_days_critical: int = 1,
    ):
        self.db = db
        self.families = families or []
        self.disabled_keys = disabled_keys or set()
        self.rsl_days_critical = int(rsl_days_critical)
        self.handlers: dict[str, Callable[[ProblemInstance, dict[str, Any]], list[ResolutionCandidate]]] = {
            "rebalance_by_velocity_and_rsl": self._rebalance_allocation,
            "swap_stop_order_or_vehicle_for_iftar_fit": self._reroute_delivery,
            "push_from_slow_store_to_fast_store": self._inter_store_transfer,
            "propose_markdown_for_batches_with_rsl_below_threshold": self._markdown_local,
            "terminal_action_for_batches_with_rsl_le_critical": self._scrap_donate,
            "push_aged_batches_to_fastest_selling_sibling": self._redirect_to_high_velocity,
            "swap_to_vehicle_with_remaining_capacity": self._swap_vehicle_capacity,
        }

    # ----------------------------------------------------------------- public

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

    # ---------------------------------------------------- rebalance_allocation

    def _rebalance_allocation(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in ("allocation_gap", "store_fair_share_deviation"):
            return []
        ev = problem.evidence or {}
        fair = float(ev.get("fair_share_qty") or 0.0)
        actual = float(ev.get("actual_on_hand_qty") or 0.0)
        deviation = float(ev.get("deviation_pct") or 0.0)
        siblings = list(ev.get("sibling_nodes") or [])
        if not siblings or fair <= 0:
            return []
        # Overallocated → push to siblings. Underallocated → pull from siblings.
        push_qty = actual - fair
        if abs(push_qty) < 1:
            return []
        direction = "outbound" if push_qty > 0 else "inbound"
        candidates: list[ResolutionCandidate] = []
        for sib in siblings[:3]:
            from_node = problem.node_id if direction == "outbound" else sib
            to_node = sib if direction == "outbound" else problem.node_id
            candidates.append(ResolutionCandidate(
                family_key=str(family.get("key")),
                problem_ref=_problem_ref(problem),
                from_node=from_node,
                to_node=to_node,
                sku=problem.sku,
                qty=round(abs(push_qty) / max(1, len(siblings[:3])), 2),
                feasible=True,
                lead_time_days=0.5,
                incremental_cost=0.0,
                evidence={
                    "fair_share_qty": fair,
                    "actual_on_hand_qty": actual,
                    "deviation_pct": round(deviation, 3),
                    "direction": direction,
                    "rationale": "Rebalance toward velocity-weighted fair share.",
                },
            ))
        return candidates

    # ----------------------------------------------------- reroute_delivery

    def _reroute_delivery(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in ("iftar_window_miss_risk", "route_delivery_risk"):
            return []
        ev = problem.evidence or {}
        route_id = ev.get("route_id")
        if not route_id:
            return []
        row = (
            self.db.query(DeliveryRoute)
            .filter(DeliveryRoute.route_id == route_id)
            .first()
        )
        if row is None:
            return []
        try:
            stops = json.loads(row.stops_json or "[]")
        except json.JSONDecodeError:
            stops = []
        # Simple reroute proposal: move the at-risk stop earlier in the sequence.
        target_stop_node = ev.get("stop_node_id") or problem.node_id
        reordered = [s for s in stops if isinstance(s, dict) and s.get("node_id") == target_stop_node]
        reordered += [s for s in stops if isinstance(s, dict) and s.get("node_id") != target_stop_node]
        return [ResolutionCandidate(
            family_key=str(family.get("key")),
            problem_ref=_problem_ref(problem),
            from_node=row.origin_node_id or route_id,
            to_node=target_stop_node,
            sku=problem.sku or "",
            qty=0.0,
            feasible=True,
            lead_time_days=0.0,
            incremental_cost=0.0,
            evidence={
                "route_id": route_id,
                "suggested_stop_order": [s.get("node_id") for s in reordered if isinstance(s, dict)],
                "current_eta_for_target": ev.get("planned_eta"),
                "iftar_local_time": ev.get("iftar_local_time"),
                "minutes_vs_iftar": ev.get("minutes_vs_iftar"),
                "rationale": "Promote at-risk stop to earlier in the sequence to regain Iftar buffer.",
            },
        )]

    # --------------------------------------------------- inter_store_transfer

    def _inter_store_transfer(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in ("allocation_gap", "store_fair_share_deviation", "expiry_risk_cluster"):
            return []
        ev = problem.evidence or {}
        siblings = list(ev.get("sibling_nodes") or [])
        if not siblings:
            # Fall back to StoreVelocity-based sibling discovery.
            rows = (
                self.db.query(StoreVelocity)
                .filter(StoreVelocity.sku == problem.sku)
                .all()
            )
            sibling_set = {r.node_id for r in rows if r.node_id != problem.node_id}
            siblings = sorted(sibling_set)
        if not siblings:
            return []
        # Rank siblings by velocity DESC; push to the fastest 1–2.
        vel_rows = (
            self.db.query(StoreVelocity)
            .filter(
                StoreVelocity.sku == problem.sku,
                StoreVelocity.node_id.in_(siblings),
            )
            .all()
        )
        vel_by_sib: dict[str, float] = {}
        for v in vel_rows:
            vel_by_sib[v.node_id] = max(vel_by_sib.get(v.node_id, 0.0), float(v.units_per_hour_avg or 0.0))
        ranked = sorted(siblings, key=lambda s: vel_by_sib.get(s, 0.0), reverse=True)[:2]
        qty_total = float(problem.shortage_qty or 0.0) or float(ev.get("batch_qty") or 0.0)
        if qty_total <= 0:
            return []
        out: list[ResolutionCandidate] = []
        per = round(qty_total / max(1, len(ranked)), 2)
        for sib in ranked:
            out.append(ResolutionCandidate(
                family_key=str(family.get("key")),
                problem_ref=_problem_ref(problem),
                from_node=problem.node_id,
                to_node=sib,
                sku=problem.sku,
                qty=per,
                feasible=True,
                lead_time_days=0.5,
                incremental_cost=0.0,
                evidence={
                    "target_velocity_units_per_hour": vel_by_sib.get(sib, 0.0),
                    "rationale": "Move stock to highest-velocity sibling to convert to sales before expiry.",
                },
            ))
        return out

    # -------------------------------------------------------- markdown_local

    def _markdown_local(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in ("expiry_risk_cluster",):
            return []
        ev = problem.evidence or {}
        rsl = ev.get("earliest_batch_rsl_days")
        qty = float(ev.get("batch_qty") or problem.shortage_qty or 0.0)
        if qty <= 0 or rsl is None:
            return []
        uplift_pct = 0.40 if int(rsl) <= 1 else 0.25
        return [ResolutionCandidate(
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
                "batch_id": ev.get("batch_id"),
                "rsl_days": rsl,
                "suggested_uplift_pct": uplift_pct,
                "rationale": "Local markdown to sell through before expiry.",
            },
        )]

    # ---------------------------------------------------------- scrap_donate

    def _scrap_donate(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in ("expiry_risk_cluster",):
            return []
        ev = problem.evidence or {}
        rsl = ev.get("earliest_batch_rsl_days")
        qty = float(ev.get("batch_qty") or problem.shortage_qty or 0.0)
        if qty <= 0 or rsl is None or int(rsl) > self.rsl_days_critical:
            return []
        action = "donate" if int(rsl) >= 0 else "scrap"
        return [ResolutionCandidate(
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
                "batch_id": ev.get("batch_id"),
                "rsl_days": rsl,
                "terminal_action": action,
                "rationale": "Below sellable window — route to donation/scrap per policy.",
            },
        )]

    # ------------------------------------------ redirect_to_high_velocity

    def _redirect_to_high_velocity(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in ("expiry_risk_cluster", "allocation_gap"):
            return []
        ev = problem.evidence or {}
        qty = float(ev.get("batch_qty") or problem.shortage_qty or 0.0)
        if qty <= 0:
            return []
        # Find highest-velocity sibling across the whole network for this SKU.
        rows = (
            self.db.query(StoreVelocity)
            .filter(
                StoreVelocity.sku == problem.sku,
                StoreVelocity.node_id != problem.node_id,
            )
            .all()
        )
        if not rows:
            return []
        best: tuple[str, float] | None = None
        for r in rows:
            v = float(r.units_per_hour_avg or 0.0)
            if best is None or v > best[1]:
                best = (r.node_id, v)
        if best is None or best[1] <= 0:
            return []
        return [ResolutionCandidate(
            family_key=str(family.get("key")),
            problem_ref=_problem_ref(problem),
            from_node=problem.node_id,
            to_node=best[0],
            sku=problem.sku,
            qty=round(qty, 2),
            feasible=True,
            lead_time_days=0.5,
            incremental_cost=0.0,
            evidence={
                "target_velocity_units_per_hour": best[1],
                "rationale": f"Redirect to {best[0]} — highest recorded velocity for this SKU.",
            },
        )]

    # ------------------------------------------------- swap_vehicle_capacity

    def _swap_vehicle_capacity(
        self, problem: ProblemInstance, family: dict[str, Any]
    ) -> list[ResolutionCandidate]:
        if problem.problem_key not in ("route_delivery_risk", "iftar_window_miss_risk"):
            return []
        ev = problem.evidence or {}
        route_id = ev.get("route_id")
        if not route_id:
            return []
        row = (
            self.db.query(DeliveryRoute)
            .filter(DeliveryRoute.route_id == route_id)
            .first()
        )
        if row is None:
            return []
        scheduled_date = row.scheduled_date
        # Find another route on the same day with headroom.
        peers = (
            self.db.query(DeliveryRoute)
            .filter(
                DeliveryRoute.scheduled_date == scheduled_date,
                DeliveryRoute.route_id != row.route_id,
            )
            .all()
        )
        results: list[ResolutionCandidate] = []
        for p in peers:
            try:
                stops_p = json.loads(p.stops_json or "[]")
            except json.JSONDecodeError:
                stops_p = []
            planned_p = 0.0
            for s in stops_p:
                planned_p += sum(float(v or 0.0) for v in (s.get("planned_qty_by_sku") or {}).values())
            headroom = float(p.capacity_units or 0.0) - planned_p
            if headroom <= 0:
                continue
            results.append(ResolutionCandidate(
                family_key=str(family.get("key")),
                problem_ref=_problem_ref(problem),
                from_node=p.route_id,
                to_node=row.route_id,
                sku="",
                qty=round(min(headroom, float(ev.get("overrun_units") or headroom)), 2),
                feasible=True,
                lead_time_days=0.0,
                incremental_cost=0.0,
                evidence={
                    "source_route_id": p.route_id,
                    "source_vehicle_id": p.vehicle_id,
                    "source_headroom_units": round(headroom, 2),
                    "target_route_id": row.route_id,
                    "rationale": "Swap in a peer vehicle with spare capacity to absorb the overrun.",
                },
            ))
        return results
