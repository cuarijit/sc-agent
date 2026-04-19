"""Re-project each candidate resolution with `runtime_overrides` and rank.

Reuses `InventoryProjectionService.get_projection(runtime_overrides=...)` —
the same deterministic engine used in Phase 2 — so the simulation shares code
with the baseline projection.

Scoring (deterministic):
  base = 1.0 if candidate.resolves_breach else 0.2
  penalty = 0.02 * lead_time_days + 0.1 * incremental_cost / max(1, shortage)
  score = max(0.0, base - penalty)
"""
from __future__ import annotations

import math
from typing import Any

from sqlalchemy.orm import Session

from ..inventory_projection_service import InventoryProjectionService
from .problem_detector import ProblemInstance
from .resolution_generator import ResolutionCandidate


class SimulationRanker:
    def __init__(self, db: Session):
        self.db = db
        self.projection_service = InventoryProjectionService(db)

    # ----------------------------------------------------------------- public

    def simulate_and_rank(
        self,
        candidates: list[ResolutionCandidate],
        problems: list[ProblemInstance],
    ) -> list[ResolutionCandidate]:
        if not candidates:
            return []
        problem_lookup = {
            (p.problem_key, p.sku, p.node_id, p.breach_week): p for p in problems
        }
        for candidate in candidates:
            ref = candidate.problem_ref
            key = (
                ref.get("problem_key"),
                ref.get("sku"),
                ref.get("node_id"),
                ref.get("breach_week"),
            )
            problem = problem_lookup.get(key)
            if problem is None:
                candidate.resolves_breach = None
                candidate.simulation_score = 0.0
                continue
            self._simulate(candidate, problem)

        # Group candidates by problem and rank within group by score DESC.
        groups: dict[tuple[Any, ...], list[ResolutionCandidate]] = {}
        for candidate in candidates:
            ref = candidate.problem_ref
            key = (ref.get("sku"), ref.get("node_id"), ref.get("problem_key"))
            groups.setdefault(key, []).append(candidate)
        for group in groups.values():
            group.sort(
                key=lambda c: (
                    -(c.simulation_score or 0.0),
                    (c.lead_time_days if c.lead_time_days is not None else 1_000),
                    c.family_key,
                    c.from_node or "",
                )
            )
            for idx, candidate in enumerate(group, start=1):
                candidate.rank = idx
        return candidates

    # ---------------------------------------------------------------- helpers

    def _simulate(self, candidate: ResolutionCandidate, problem: ProblemInstance) -> None:
        if candidate.qty <= 0:
            candidate.resolves_breach = False
            candidate.simulation_score = 0.0
            return
        arrival_week = self._arrival_week(candidate, problem)
        try:
            projection = self.projection_service.get_projection(
                problem.sku,
                location=problem.node_id,
                runtime_overrides={arrival_week: (None, None)},  # touch to ensure engine runs
                include_demo_examples=False,
            )
        except (KeyError, ValueError):
            candidate.resolves_breach = None
            candidate.simulation_score = 0.0
            return

        # Identify the base order_qty at arrival_week to additively inject the candidate.
        base_orders_qty = 0.0
        for row in projection.get("weeks") or []:
            if row.get("week_offset") == arrival_week:
                base_orders_qty = float(row.get("orders_qty") or 0.0)
                break
        try:
            simulated = self.projection_service.get_projection(
                problem.sku,
                location=problem.node_id,
                runtime_overrides={arrival_week: (None, base_orders_qty + candidate.qty)},
                include_demo_examples=False,
            )
        except (KeyError, ValueError):
            candidate.resolves_breach = None
            candidate.simulation_score = 0.0
            return

        breach_week = problem.breach_week or 1
        post_breach_row = next(
            (w for w in simulated.get("weeks") or [] if w.get("week_offset") == breach_week),
            None,
        )
        if post_breach_row is None:
            candidate.resolves_breach = False
            candidate.simulated_ending_qty = None
            candidate.simulation_score = 0.0
            return
        ending = float(post_breach_row.get("projected_on_hand_actual_qty") or 0.0)
        reorder_point = float(post_breach_row.get("reorder_point_qty") or 0.0)
        safety_stock = float(post_breach_row.get("safety_stock_qty") or 0.0)
        candidate.simulated_ending_qty = round(ending, 2)

        resolves = ending >= max(reorder_point, safety_stock, 0.0)
        candidate.resolves_breach = bool(resolves)

        base = 1.0 if resolves else 0.2
        lead_time_days = float(candidate.lead_time_days or 0.0)
        shortage_denom = max(1.0, problem.shortage_qty)
        penalty = 0.02 * lead_time_days + 0.1 * (
            float(candidate.incremental_cost or 0.0) / shortage_denom
        )
        candidate.simulation_score = max(0.0, base - penalty)

    @staticmethod
    def _arrival_week(candidate: ResolutionCandidate, problem: ProblemInstance) -> int:
        """Translate lead_time_days into the first feasible arrival week offset."""
        breach_week = problem.breach_week or 1
        lead_time_days = float(candidate.lead_time_days or 0.0)
        if lead_time_days <= 0:
            return breach_week
        arrival_offset = max(1, int(math.ceil(lead_time_days / 7.0)))
        # Candidates with lead time ≥ weeks-to-breach can't fully resolve in-week;
        # we still inject at breach_week so simulation shows partial mitigation.
        return max(arrival_offset, 1)
