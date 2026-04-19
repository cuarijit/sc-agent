"""Deterministic weighted-sum ranking of detected problems.

Features computed per problem:
  - revenue_at_risk  → shortage_qty * unit_price (falls back to shortage_qty
    when no ProductMaster unit_price is modelled)
  - stockout_severity → critical=1.0, warning=0.6, else 0.3
  - customer_facing_flag → 1.0 if node is customer-facing in
    NetworkSourcingRule, else 0.0
  - abc_class → behavior.prioritization.abc_weight_map
  - lead_time_weeks → (horizon - breach_week) / horizon; earlier breaches
    score higher

Feature vectors are min-max normalised within the batch, multiplied by
per-feature weights (from instance default_config.prioritization_weights),
summed, and sorted. Ties are broken by earlier breach_week then lower SKU.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from sqlalchemy.orm import Session

from ...models import LocationMaster, NetworkSourcingRule, ProductMaster
from .problem_detector import ProblemInstance


SEVERITY_SCORE = {"critical": 1.0, "warning": 0.6, "info": 0.3}
DEFAULT_ABC_WEIGHT_MAP = {"A": 1.0, "B": 0.6, "C": 0.3}


def _invert_string(s: str) -> tuple[int, ...]:
    # For `higher_sku` tiebreaker: negate char codes so reverse order naturally.
    return tuple(-ord(c) for c in s)


@dataclass
class RankedProblem:
    problem: ProblemInstance
    score: float
    rank: int
    feature_values: dict[str, float]
    feature_contribution: dict[str, float]

    def to_payload(self) -> dict[str, Any]:
        payload = self.problem.to_payload()
        payload.update(
            {
                "rank": self.rank,
                "score": round(self.score, 4),
                "feature_values": {k: round(v, 4) for k, v in self.feature_values.items()},
                "feature_contribution": {
                    k: round(v, 4) for k, v in self.feature_contribution.items()
                },
            }
        )
        return payload


class PrioritizationEngine:
    def __init__(
        self,
        db: Session,
        *,
        weights: dict[str, float] | None = None,
        abc_weight_map: dict[str, float] | None = None,
        horizon_weeks: int = 12,
        tiebreaker: list[str] | None = None,
        normalization: str = "min_max_per_batch",
    ):
        self.db = db
        self.weights = weights or {}
        self.abc_weight_map = abc_weight_map or DEFAULT_ABC_WEIGHT_MAP
        self.horizon = max(1, int(horizon_weeks or 12))
        # Both default values match behaviour prior to Phase 8. Instance-level
        # overrides are threaded through runtime.prioritization.
        self.tiebreaker = list(tiebreaker or ["earlier_breach_week", "lower_sku"])
        self.normalization = normalization or "min_max_per_batch"

    # ----------------------------------------------------------------- public

    def rank(self, problems: Iterable[ProblemInstance]) -> list[RankedProblem]:
        problem_list = list(problems)
        if not problem_list:
            return []

        unit_price_map = self._unit_price_map({p.sku for p in problem_list})
        abc_map = self._abc_map({p.sku for p in problem_list})
        customer_facing_nodes = self._customer_facing_node_set(
            skus={p.sku for p in problem_list},
            nodes={p.node_id for p in problem_list},
        )

        raw_features: list[dict[str, float]] = []
        for p in problem_list:
            raw_features.append(
                {
                    "revenue_at_risk": p.shortage_qty * unit_price_map.get(p.sku, 1.0),
                    "stockout_severity": SEVERITY_SCORE.get(p.severity, 0.3),
                    "customer_facing_flag": 1.0 if p.node_id in customer_facing_nodes else 0.0,
                    "abc_class": self.abc_weight_map.get(abc_map.get(p.sku, "C"), 0.3),
                    "lead_time_weeks": self._lead_time_feature(p.breach_week),
                }
            )

        normalized = self._min_max_normalize(raw_features)
        weighted_sums: list[tuple[ProblemInstance, dict[str, float], dict[str, float], float]] = []
        for p, raw, norm in zip(problem_list, raw_features, normalized):
            contribution = {k: norm.get(k, 0.0) * float(self.weights.get(k, 0.0)) for k in norm}
            total = sum(contribution.values())
            weighted_sums.append((p, raw, contribution, total))

        # Sort: score DESC, then breach_week ASC, then sku ASC.
        weighted_sums.sort(key=self._sort_key)

        ranked: list[RankedProblem] = []
        for idx, (problem, raw, contribution, score) in enumerate(weighted_sums, start=1):
            ranked.append(
                RankedProblem(
                    problem=problem,
                    score=score,
                    rank=idx,
                    feature_values=raw,
                    feature_contribution=contribution,
                )
            )
        return ranked

    # ---------------------------------------------------------------- helpers

    def _sort_key(self, entry: tuple[Any, ...]) -> tuple[Any, ...]:
        """Compose a sort key honouring the configured tiebreaker list."""
        problem: ProblemInstance = entry[0]
        raw: dict[str, float] = entry[1]
        score: float = entry[3]
        parts: list[Any] = [-score]
        for rule in self.tiebreaker:
            if rule == "earlier_breach_week":
                parts.append(problem.breach_week if problem.breach_week is not None else 1_000_000)
            elif rule == "later_breach_week":
                parts.append(-(problem.breach_week if problem.breach_week is not None else 0))
            elif rule == "lower_sku":
                parts.append(problem.sku)
            elif rule == "higher_sku":
                parts.append(_invert_string(problem.sku))
            elif rule == "higher_shortage":
                parts.append(-problem.shortage_qty)
            elif rule == "lower_shortage":
                parts.append(problem.shortage_qty)
            elif rule == "higher_revenue_at_risk":
                parts.append(-raw.get("revenue_at_risk", 0.0))
            else:
                parts.append(problem.sku)  # unknown rule → deterministic fallback
        parts.append(problem.node_id)
        return tuple(parts)

    def _lead_time_feature(self, breach_week: int | None) -> float:
        if breach_week is None:
            return 0.0
        weeks_to_breach = max(1, int(breach_week))
        # Earlier breach → higher feature. Normalised to the configured horizon.
        urgency = max(0.0, (self.horizon - weeks_to_breach + 1) / self.horizon)
        return min(1.0, urgency)

    def _unit_price_map(self, skus: set[str]) -> dict[str, float]:
        # ProductMaster in this repo does not carry unit_price; default to 1.0
        # so revenue_at_risk degrades to shortage_qty. A future slot
        # `item_economics` will override this when bound.
        if not skus:
            return {}
        rows = (
            self.db.query(ProductMaster.sku)
            .filter(ProductMaster.sku.in_(skus))
            .all()
        )
        return {r[0]: 1.0 for r in rows}

    def _abc_map(self, skus: set[str]) -> dict[str, str]:
        if not skus:
            return {}
        rows = (
            self.db.query(ProductMaster.sku, ProductMaster.abc_class)
            .filter(ProductMaster.sku.in_(skus))
            .all()
        )
        return {r[0]: (r[1] or "C") for r in rows}

    def _customer_facing_node_set(self, skus: set[str], nodes: set[str]) -> set[str]:
        if not skus or not nodes:
            return set()
        result: set[str] = set()

        # Prefer the NetworkSourcingRule flag when present.
        sourcing_rows = (
            self.db.query(NetworkSourcingRule.dest_node_id, NetworkSourcingRule.is_customer_facing_node)
            .filter(
                NetworkSourcingRule.sku.in_(skus),
                NetworkSourcingRule.dest_node_id.in_(nodes),
            )
            .all()
        )
        for node_id, flag in sourcing_rows:
            if flag:
                result.add(node_id)

        # Fallback: treat any LocationMaster row with location_type containing
        # 'store' or 'rdc' as customer-facing.
        location_rows = (
            self.db.query(LocationMaster.code, LocationMaster.location_type)
            .filter(LocationMaster.code.in_(nodes))
            .all()
        )
        for code, location_type in location_rows:
            if location_type and any(tag in location_type.lower() for tag in ("store", "rdc", "retail")):
                result.add(code)

        return result

    @staticmethod
    def _min_max_normalize(feature_rows: list[dict[str, float]]) -> list[dict[str, float]]:
        if not feature_rows:
            return []
        keys = list(feature_rows[0].keys())
        mins = {k: min(r[k] for r in feature_rows) for k in keys}
        maxs = {k: max(r[k] for r in feature_rows) for k in keys}
        normalized: list[dict[str, float]] = []
        for row in feature_rows:
            normed: dict[str, float] = {}
            for k in keys:
                span = maxs[k] - mins[k]
                if span <= 0:
                    # All values equal → constant. Choose 1.0 so the feature still
                    # contributes its full weight, rather than vanishing.
                    normed[k] = 1.0 if mins[k] > 0 else 0.0
                else:
                    normed[k] = (row[k] - mins[k]) / span
            normalized.append(normed)
        return normalized
