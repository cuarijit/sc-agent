"""Deterministic problem detection over a resolved scope.

Reuses `InventoryProjectionService.get_projection()` — the canonical deterministic
sku_location_week engine — and applies each enabled `problem_template` from the
agent template's behavior.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from ..inventory_projection_service import InventoryProjectionService
from .scope_resolver import ResolvedScope


@dataclass
class ProblemInstance:
    problem_key: str
    sku: str
    node_id: str
    breach_week: int | None
    breach_week_date: str | None
    severity: str
    shortage_qty: float
    projected_on_hand_actual_qty: float
    safety_stock_qty: float
    reorder_point_qty: float
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_payload(self) -> dict[str, Any]:
        return {
            "problem_key": self.problem_key,
            "sku": self.sku,
            "node_id": self.node_id,
            "breach_week": self.breach_week,
            "breach_week_date": self.breach_week_date,
            "severity": self.severity,
            "shortage_qty": self.shortage_qty,
            "projected_on_hand_actual_qty": self.projected_on_hand_actual_qty,
            "safety_stock_qty": self.safety_stock_qty,
            "reorder_point_qty": self.reorder_point_qty,
            "evidence": self.evidence,
        }


class ProblemDetector:
    def __init__(
        self,
        db: Session,
        *,
        problem_templates: list[dict[str, Any]] | None = None,
        disabled_keys: set[str] | None = None,
    ):
        self.db = db
        self.projection_service = InventoryProjectionService(db)
        self.problem_templates = problem_templates or []
        self.disabled_keys = disabled_keys or set()

    # ----------------------------------------------------------------- public

    def detect(self, scope: ResolvedScope) -> list[ProblemInstance]:
        enabled_templates = [
            t for t in self.problem_templates
            if isinstance(t, dict) and t.get("key") and t.get("key") not in self.disabled_keys
        ]
        if not enabled_templates or not scope.sku_node_pairs:
            return []

        problems: list[ProblemInstance] = []
        for sku, node in scope.sku_node_pairs:
            projection = self._safe_projection(sku, node)
            if projection is None:
                continue
            weeks = [
                w for w in projection.get("weeks") or []
                if w.get("week_offset") in scope.week_offsets
            ]
            if not weeks:
                continue
            for template in enabled_templates:
                instance = self._evaluate_template(template, sku, node, weeks)
                if instance is not None:
                    problems.append(instance)
        return problems

    # ---------------------------------------------------------- evaluation

    def _safe_projection(self, sku: str, node: str | None) -> dict[str, Any] | None:
        try:
            return self.projection_service.get_projection(sku, location=node, include_demo_examples=False)
        except (KeyError, ValueError):
            # Unknown SKU or missing product config — skip silently.
            return None

    def _evaluate_template(
        self,
        template: dict[str, Any],
        sku: str,
        node: str,
        weeks: list[dict[str, Any]],
    ) -> ProblemInstance | None:
        rule = template.get("rule") if isinstance(template.get("rule"), dict) else {}
        rule_type = rule.get("type")

        if rule_type == "threshold_on_projection_field":
            return self._evaluate_threshold(template, rule, sku, node, weeks)
        if rule_type == "threshold_on_projection_field_during_window":
            # Promotion window — Phase 4 wires the promotion_plan source; for
            # Phase 2 we treat it identically to the whole horizon.
            return self._evaluate_threshold(template, rule, sku, node, weeks)
        if rule_type == "sustained_excess_over_cover_ceiling":
            return self._evaluate_excess(template, rule, sku, node, weeks)
        if rule_type == "batch_expiry_within_window":
            return self._evaluate_expiring_batch(template, rule, sku, node, weeks)
        if rule_type == "sellable_below_horizon_demand":
            return self._evaluate_shelf_life_shortfall(template, rule, sku, node, weeks)
        # Unknown rule → never fires.
        return None

    def _evaluate_expiring_batch(
        self,
        template: dict[str, Any],
        rule: dict[str, Any],
        sku: str,
        node: str,
        weeks: list[dict[str, Any]],
    ) -> ProblemInstance | None:
        """Fire when a batch on-hand today has remaining shelf life within the
        configured threshold. Uses `base_earliest_rsl_days` (snapshot-time RSL)
        so a stale batch that gets consumed in week 1 still surfaces as a risk
        the planner can act on before it turns into waste.
        """
        first = weeks[0] if weeks else None
        if not first or not first.get("batch_mode"):
            return None
        rsl_threshold = int(rule.get("rsl_days_threshold") or 2)
        min_batch_qty = float(rule.get("min_batch_qty") or 1)
        rsl_days = first.get("base_earliest_rsl_days")
        if rsl_days is None:
            rsl_days = first.get("earliest_batch_rsl_days")
        if rsl_days is None:
            return None
        expired_week_1 = float(first.get("expired_qty_week") or 0.0)
        if int(rsl_days) > rsl_threshold and expired_week_1 < min_batch_qty:
            return None
        severity_cfg = template.get("severity") if isinstance(template.get("severity"), dict) else {}
        critical_cut = severity_cfg.get("critical_if_rsl_days_le")
        warning_cut = severity_cfg.get("warning_if_rsl_days_le")
        severity = str(severity_cfg.get("default") or "warning")
        try:
            if critical_cut is not None and int(rsl_days) <= int(critical_cut):
                severity = "critical"
            elif warning_cut is not None and int(rsl_days) <= int(warning_cut):
                severity = "warning"
        except (TypeError, ValueError):
            pass
        at_risk_qty = sum(float(w.get("expired_qty_week") or 0.0) for w in weeks)
        evidence = {
            "earliest_batch_rsl_days": rsl_days,
            "earliest_batch_expiry_date": first.get("base_earliest_expiry_date") or first.get("earliest_batch_expiry_date"),
            "expired_qty_week_1": expired_week_1,
            "total_expired_qty_in_horizon": round(at_risk_qty, 2),
            "rsl_days_threshold": rsl_threshold,
        }
        return ProblemInstance(
            problem_key=str(template.get("key")),
            sku=sku,
            node_id=node,
            breach_week=first.get("week_offset"),
            breach_week_date=first.get("week_start_date"),
            severity=severity,
            shortage_qty=round(at_risk_qty, 2),
            projected_on_hand_actual_qty=float(first.get("projected_on_hand_actual_qty") or 0.0),
            safety_stock_qty=float(first.get("safety_stock_qty") or 0.0),
            reorder_point_qty=float(first.get("reorder_point_qty") or 0.0),
            evidence=evidence,
        )

    def _evaluate_shelf_life_shortfall(
        self,
        template: dict[str, Any],
        rule: dict[str, Any],
        sku: str,
        node: str,
        weeks: list[dict[str, Any]],
    ) -> ProblemInstance | None:
        """Fire at the first week in the horizon where sellable_on_hand < forecast.

        Meaningfully different from projected_stockout: sellable_on_hand tracks the
        batch-aware quantity, so a SKU can look "healthy" by on-hand but still be
        short on SELLABLE stock because a large fraction is expiring.
        """
        horizon_weeks = int(rule.get("horizon_weeks") or 2)
        breach: dict[str, Any] | None = None
        for w in weeks[:horizon_weeks]:
            if not w.get("batch_mode"):
                return None
            sellable = float(w.get("sellable_on_hand_qty") or 0.0)
            forecast = float(w.get("forecast_qty") or 0.0)
            if sellable < forecast:
                breach = w
                break
        if breach is None:
            return None
        shortfall = max(0.0, float(breach.get("forecast_qty") or 0.0) - float(breach.get("sellable_on_hand_qty") or 0.0))
        severity_cfg = template.get("severity") if isinstance(template.get("severity"), dict) else {}
        severity = self._resolve_severity(severity_cfg, breach.get("week_offset"))
        evidence = {
            "sellable_on_hand_qty": breach.get("sellable_on_hand_qty"),
            "forecast_qty": breach.get("forecast_qty"),
            "shortfall_qty": round(shortfall, 2),
            "expired_qty_week": breach.get("expired_qty_week"),
            "earliest_batch_rsl_days": breach.get("earliest_batch_rsl_days"),
        }
        return ProblemInstance(
            problem_key=str(template.get("key")),
            sku=sku,
            node_id=node,
            breach_week=breach.get("week_offset"),
            breach_week_date=breach.get("week_start_date"),
            severity=severity,
            shortage_qty=round(shortfall, 2),
            projected_on_hand_actual_qty=float(breach.get("projected_on_hand_actual_qty") or 0.0),
            safety_stock_qty=float(breach.get("safety_stock_qty") or 0.0),
            reorder_point_qty=float(breach.get("reorder_point_qty") or 0.0),
            evidence=evidence,
        )

    def _evaluate_excess(
        self,
        template: dict[str, Any],
        rule: dict[str, Any],
        sku: str,
        node: str,
        weeks: list[dict[str, Any]],
    ) -> ProblemInstance | None:
        """Fire when projected_on_hand stays above `cover_weeks_threshold * forecast`
        for `consecutive_weeks` in a row."""
        cover_weeks = float(rule.get("cover_weeks_threshold") or 12.0)
        consecutive = int(rule.get("consecutive_weeks") or 4)
        run_length = 0
        first_breach: dict[str, Any] | None = None
        max_excess = 0.0
        for w in weeks:
            forecast = float(w.get("forecast_qty") or 0.0)
            ending = float(w.get("projected_on_hand_actual_qty") or 0.0)
            ceiling = forecast * cover_weeks
            if forecast > 0 and ending > ceiling:
                run_length += 1
                excess = ending - ceiling
                if excess > max_excess:
                    max_excess = excess
                if run_length >= consecutive and first_breach is None:
                    first_breach = w
            else:
                run_length = 0
        if first_breach is None:
            return None
        severity_cfg = template.get("severity") if isinstance(template.get("severity"), dict) else {}
        severity = str(severity_cfg.get("default") or "warning")
        evidence = {
            "week_offset": first_breach.get("week_offset"),
            "projected_on_hand_actual_qty": first_breach.get("projected_on_hand_actual_qty"),
            "forecast_qty": first_breach.get("forecast_qty"),
            "cover_weeks_threshold": cover_weeks,
            "consecutive_weeks_required": consecutive,
            "max_excess_qty": round(max_excess, 2),
        }
        return ProblemInstance(
            problem_key=str(template.get("key")),
            sku=sku,
            node_id=node,
            breach_week=first_breach.get("week_offset"),
            breach_week_date=first_breach.get("week_start_date"),
            severity=severity,
            # "shortage_qty" reused as magnitude of excess for downstream ranking.
            shortage_qty=round(max_excess, 2),
            projected_on_hand_actual_qty=float(first_breach.get("projected_on_hand_actual_qty") or 0.0),
            safety_stock_qty=float(first_breach.get("safety_stock_qty") or 0.0),
            reorder_point_qty=float(first_breach.get("reorder_point_qty") or 0.0),
            evidence=evidence,
        )

    def _evaluate_threshold(
        self,
        template: dict[str, Any],
        rule: dict[str, Any],
        sku: str,
        node: str,
        weeks: list[dict[str, Any]],
    ) -> ProblemInstance | None:
        field_name = rule.get("field") or "projected_on_hand_actual_qty"
        op = rule.get("op") or "<"
        value_ref = rule.get("value_ref")

        breach: dict[str, Any] | None = None
        for week_row in weeks:
            lhs = float(week_row.get(field_name) or 0.0)
            rhs = self._resolve_rhs(rule, value_ref, week_row)
            if self._compare(lhs, op, rhs):
                breach = week_row
                break

        if breach is None:
            return None

        severity_cfg = template.get("severity") if isinstance(template.get("severity"), dict) else {}
        severity = self._resolve_severity(severity_cfg, breach.get("week_offset"))

        shortage_qty = max(0.0, -float(breach.get(field_name) or 0.0))
        if value_ref == "projection.safety_stock_qty":
            safety_stock = float(breach.get("safety_stock_qty") or 0.0)
            shortage_qty = max(shortage_qty, safety_stock - float(breach.get(field_name) or 0.0))
        elif value_ref == "projection.reorder_point_qty":
            reorder = float(breach.get("reorder_point_qty") or 0.0)
            shortage_qty = max(shortage_qty, reorder - float(breach.get(field_name) or 0.0))

        evidence = {
            "week_offset": breach.get("week_offset"),
            "projected_on_hand_actual_qty": breach.get("projected_on_hand_actual_qty"),
            "forecast_qty": breach.get("forecast_qty"),
            "orders_qty": breach.get("orders_qty"),
            "below_rop": breach.get("below_rop"),
            "below_safety_stock": breach.get("below_safety_stock"),
            "stockout": breach.get("stockout"),
        }

        return ProblemInstance(
            problem_key=str(template.get("key")),
            sku=sku,
            node_id=node,
            breach_week=breach.get("week_offset"),
            breach_week_date=breach.get("week_start_date"),
            severity=severity,
            shortage_qty=round(shortage_qty, 2),
            projected_on_hand_actual_qty=float(breach.get("projected_on_hand_actual_qty") or 0.0),
            safety_stock_qty=float(breach.get("safety_stock_qty") or 0.0),
            reorder_point_qty=float(breach.get("reorder_point_qty") or 0.0),
            evidence=evidence,
        )

    @staticmethod
    def _resolve_rhs(rule: dict[str, Any], value_ref: str | None, week_row: dict[str, Any]) -> float:
        if value_ref == "projection.safety_stock_qty":
            return float(week_row.get("safety_stock_qty") or 0.0)
        if value_ref == "projection.reorder_point_qty":
            return float(week_row.get("reorder_point_qty") or 0.0)
        try:
            return float(rule.get("value") or 0.0)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _compare(lhs: float, op: str, rhs: float) -> bool:
        if op == "<":
            return lhs < rhs
        if op == "<=":
            return lhs <= rhs
        if op == ">":
            return lhs > rhs
        if op == ">=":
            return lhs >= rhs
        if op == "==":
            return lhs == rhs
        if op == "!=":
            return lhs != rhs
        return False

    @staticmethod
    def _resolve_severity(severity_cfg: dict[str, Any], breach_week: int | None) -> str:
        if breach_week is None:
            return str(severity_cfg.get("default") or "warning")
        critical_cut = severity_cfg.get("critical_if_weeks_until_breach")
        warning_cut = severity_cfg.get("warning_if_weeks_until_breach")
        try:
            if critical_cut is not None and breach_week <= int(critical_cut):
                return "critical"
            if warning_cut is not None and breach_week <= int(warning_cut):
                return "warning"
        except (TypeError, ValueError):
            pass
        return str(severity_cfg.get("default") or "warning")
