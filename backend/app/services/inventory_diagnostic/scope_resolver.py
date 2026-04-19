"""Resolve a parsed intent's scope against master data.

Input: ParsedIntent with raw SKU/node/week hints.
Output: ResolvedScope with concrete sku_location pairs + week offsets to drive
the projection + problem-detection pipeline.

All logic is deterministic. Falls back gracefully when master-data slot
bindings are missing (relies on canonical tables for Phase 2).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ...models import LocationMaster, NetworkSourcingRule, ProductMaster
from ..inventory_projection_service import DEFAULT_BASE_WEEK
from .intent_parser import ParsedIntent


@dataclass
class ResolvedScope:
    skus: list[str]
    nodes: list[str]
    sku_node_pairs: list[tuple[str, str]]
    week_offsets: list[int]
    week_dates: list[str]
    base_week: str
    focus: str | None
    sort_by: str | None = None
    needs_clarification: bool = False
    clarification_reason: str | None = None
    warnings: list[str] = field(default_factory=list)
    follow_up: dict[str, Any] | None = None
    simulation_delta: dict[str, Any] | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "skus": self.skus,
            "nodes": self.nodes,
            "sku_node_pairs": [list(p) for p in self.sku_node_pairs],
            "week_offsets": self.week_offsets,
            "week_dates": self.week_dates,
            "base_week": self.base_week,
            "focus": self.focus,
            "sort_by": self.sort_by,
            "needs_clarification": self.needs_clarification,
            "clarification_reason": self.clarification_reason,
            "warnings": self.warnings,
        }
        if self.follow_up is not None:
            payload["follow_up"] = self.follow_up
        if self.simulation_delta is not None:
            payload["simulation_delta"] = self.simulation_delta
        return payload


class ScopeResolver:
    def __init__(self, db: Session, *, base_week: date | None = None):
        self.db = db
        self.base_week = base_week or DEFAULT_BASE_WEEK

    # ----------------------------------------------------------------- public

    def resolve(self, intent: ParsedIntent) -> ResolvedScope:
        warnings: list[str] = []

        # SKUs: restrict to those known in ProductMaster. If none requested,
        # enumerate the whole catalog.
        requested_skus = list(intent.scope.get("skus") or [])
        known_skus = self._known_skus(requested_skus)
        if requested_skus:
            missing = sorted(set(requested_skus) - set(known_skus))
            if missing:
                warnings.append(f"Unknown SKUs filtered out: {missing}.")
        if not known_skus:
            # No explicit or known SKUs — use the full catalog for "show"/"diagnose".
            known_skus = self._all_skus()

        # Nodes: same treatment.
        requested_nodes = list(intent.scope.get("nodes") or [])
        known_nodes = self._known_nodes(requested_nodes)
        if requested_nodes:
            missing = sorted(set(requested_nodes) - set(known_nodes))
            if missing:
                warnings.append(f"Unknown nodes filtered out: {missing}.")
        if not known_nodes:
            known_nodes = self._all_nodes()

        # SKU-node pairs: use sourcing rules to enumerate the valid grain.
        pairs = self._enumerate_sku_node_pairs(known_skus, known_nodes)
        if not pairs:
            # Fall back to Cartesian product — useful when sourcing_network is thin.
            pairs = [(s, n) for s in known_skus for n in known_nodes]

        week_offsets = self._week_offsets(intent.scope.get("week_range"))
        week_dates = [
            (self.base_week + timedelta(days=7 * (off - 1))).isoformat() for off in week_offsets
        ]

        needs_clarification = False
        clarification_reason: str | None = None
        if not pairs:
            needs_clarification = True
            clarification_reason = "No SKU-node pairs in scope."

        return ResolvedScope(
            skus=sorted({s for s, _ in pairs}) or known_skus,
            nodes=sorted({n for _, n in pairs}) or known_nodes,
            sku_node_pairs=pairs,
            week_offsets=week_offsets,
            week_dates=week_dates,
            base_week=self.base_week.isoformat(),
            focus=intent.focus,
            sort_by=intent.scope.get("sort_by"),
            needs_clarification=needs_clarification,
            clarification_reason=clarification_reason,
            warnings=warnings,
            follow_up=intent.scope.get("follow_up"),
            simulation_delta=intent.scope.get("simulation_delta"),
        )

    # ---------------------------------------------------------- master lookups

    def _known_skus(self, skus: list[str]) -> list[str]:
        if not skus:
            return []
        rows = (
            self.db.query(ProductMaster.sku)
            .filter(ProductMaster.sku.in_(skus))
            .all()
        )
        return sorted({r[0] for r in rows})

    def _all_skus(self) -> list[str]:
        rows = self.db.query(ProductMaster.sku).order_by(ProductMaster.sku.asc()).all()
        return [r[0] for r in rows]

    def _known_nodes(self, nodes: list[str]) -> list[str]:
        if not nodes:
            return []
        rows = (
            self.db.query(LocationMaster.code)
            .filter(LocationMaster.code.in_(nodes))
            .all()
        )
        return sorted({r[0] for r in rows})

    def _all_nodes(self) -> list[str]:
        rows = self.db.query(LocationMaster.code).order_by(LocationMaster.code.asc()).all()
        return [r[0] for r in rows]

    def _enumerate_sku_node_pairs(self, skus: list[str], nodes: list[str]) -> list[tuple[str, str]]:
        if not skus or not nodes:
            return []
        rows = (
            self.db.query(NetworkSourcingRule.sku, NetworkSourcingRule.dest_node_id)
            .filter(
                NetworkSourcingRule.sku.in_(skus),
                NetworkSourcingRule.dest_node_id.in_(nodes),
            )
            .all()
        )
        pairs = sorted({(r[0], r[1]) for r in rows})
        return pairs

    # --------------------------------------------------------- week offsets

    @staticmethod
    def _week_offsets(week_range: Any) -> list[int]:
        if not isinstance(week_range, dict):
            return list(range(1, 13))
        try:
            start = max(1, int(week_range.get("start") or 1))
            end = max(start, int(week_range.get("end") or start))
        except (TypeError, ValueError):
            return list(range(1, 13))
        end = min(end, 52)
        return list(range(start, end + 1))
