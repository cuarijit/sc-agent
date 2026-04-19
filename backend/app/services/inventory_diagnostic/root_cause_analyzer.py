"""Deterministic root-cause analysis for detected problems.

Each root-cause template declares `requires_slots` + an `evidence_query`
identifier. This module maps the identifier to a Python handler that probes
the database (through canonical MEIO tables for MVP; later via
SemanticSlotRegistry). The output is a ranked list of
`RootCauseInstance` records, each tied to a single problem.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Callable

from sqlalchemy.orm import Session

from ...models import (
    InventoryBatchSnapshot,
    LocationMaster,
    NetworkActualWeekly,
    NetworkForecastWeekly,
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
class RootCauseInstance:
    rc_key: str
    problem_ref: dict[str, Any]
    fired: bool
    weight: float
    score: float
    evidence: dict[str, Any] = field(default_factory=dict)

    def to_payload(self) -> dict[str, Any]:
        return {
            "rc_key": self.rc_key,
            "problem_ref": self.problem_ref,
            "fired": self.fired,
            "weight": self.weight,
            "score": round(self.score, 4),
            "evidence": self.evidence,
        }


class RootCauseAnalyzer:
    def __init__(
        self,
        db: Session,
        *,
        templates: list[dict[str, Any]] | None = None,
        disabled_keys: set[str] | None = None,
        horizon_weeks: int = 12,
    ):
        self.db = db
        self.templates = templates or []
        self.disabled_keys = disabled_keys or set()
        self.base_week = DEFAULT_BASE_WEEK
        self.horizon_weeks = max(1, int(horizon_weeks or 12))
        self.handlers: dict[str, Callable[[ProblemInstance, dict[str, Any]], tuple[bool, dict[str, Any]]]] = {
            "orders_with_delivery_delay_days_gt_0_or_eta_after_breach_week": self._evidence_late_supply,
            "sibling_node_excess_while_target_below_rop": self._evidence_network_imbalance,
            "promotion_plan_uplift_in_breach_window": self._evidence_promo_uplift,
            "opening_inventory_quality_hold_or_near_expiry": self._evidence_blocked_inventory,
            "safety_stock_or_reorder_point_below_minimum_advisable": self._evidence_policy_issue,
            "actual_to_forecast_ratio_sustained_below_threshold": self._evidence_forecast_overstated,
            "sibling_sku_in_category_spiking_while_this_drops": self._evidence_substitution,
            "batches_with_rsl_days_le_threshold": self._evidence_rsl_below_threshold,
            "batches_flagged_quality_hold_or_cold_chain_event": self._evidence_cold_chain_break,
            "batches_with_receipt_to_expiry_span_below_product_shelf_life": self._evidence_aged_receipt,
        }

    def analyze(self, problems: list[ProblemInstance]) -> list[RootCauseInstance]:
        if not self.templates or not problems:
            return []
        enabled = [
            t for t in self.templates
            if isinstance(t, dict) and t.get("key") and t.get("key") not in self.disabled_keys
        ]
        output: list[RootCauseInstance] = []
        for problem in problems:
            for template in enabled:
                key = str(template.get("key"))
                handler = self.handlers.get(str(template.get("evidence_query")))
                if handler is None:
                    continue
                fired, evidence = handler(problem, template)
                weight = float(template.get("weight") or 0.0)
                score = weight if fired else 0.0
                if fired:
                    output.append(
                        RootCauseInstance(
                            rc_key=key,
                            problem_ref={
                                "problem_key": problem.problem_key,
                                "sku": problem.sku,
                                "node_id": problem.node_id,
                                "breach_week": problem.breach_week,
                            },
                            fired=True,
                            weight=weight,
                            score=score,
                            evidence=evidence,
                        )
                    )
        # Rank by score DESC then by problem severity, breach week, then rc_key.
        output.sort(
            key=lambda rc: (
                -rc.score,
                rc.problem_ref.get("breach_week") or 10_000,
                rc.rc_key,
            )
        )
        return output

    # ------------------------------------------------------- evidence handlers

    def _evidence_late_supply(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        breach_week = problem.breach_week or 1
        breach_date = self.base_week + timedelta(days=7 * (breach_week - 1))
        rows = (
            self.db.query(ReplenishmentOrder)
            .filter(
                ReplenishmentOrder.sku == problem.sku,
                ReplenishmentOrder.ship_to_node_id == problem.node_id,
            )
            .all()
        )
        delayed: list[dict[str, Any]] = []
        for row in rows:
            eta_raw = (row.eta or "").split("T")[0]
            try:
                eta_date = date.fromisoformat(eta_raw)
            except ValueError:
                continue
            eta_after_breach = eta_date >= breach_date
            delay_flag = float(row.delivery_delay_days or 0.0) > 0
            if delay_flag or eta_after_breach:
                delayed.append(
                    {
                        "order_id": row.order_id,
                        "eta": eta_raw,
                        "eta_after_breach": eta_after_breach,
                        "delivery_delay_days": float(row.delivery_delay_days or 0.0),
                        "qty": float(row.order_qty or 0.0),
                    }
                )
        fired = bool(delayed)
        return fired, {"orders": delayed, "breach_week_date": breach_date.isoformat()}

    def _evidence_network_imbalance(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        siblings = self._sibling_nodes(problem.sku, problem.node_id)
        if not siblings:
            return False, {}
        safety_map = self._safety_stock_map(problem.sku, siblings + [problem.node_id])
        as_of_rows = (
            self.db.query(NetworkInventorySnapshot)
            .filter(
                NetworkInventorySnapshot.sku == problem.sku,
                NetworkInventorySnapshot.node_id.in_(siblings + [problem.node_id]),
            )
            .all()
        )
        as_of_map: dict[str, float] = {}
        for row in as_of_rows:
            # Use the most recent snapshot per node.
            existing = as_of_map.get(row.node_id)
            if existing is None or float(row.on_hand_qty) > existing:
                as_of_map[row.node_id] = float(row.on_hand_qty)

        target_ok = as_of_map.get(problem.node_id, 0.0) < problem.reorder_point_qty
        excess_siblings: list[dict[str, Any]] = []
        for sibling in siblings:
            on_hand = as_of_map.get(sibling, 0.0)
            sibling_safety = safety_map.get(sibling, 0.0)
            if on_hand > sibling_safety and on_hand > problem.shortage_qty:
                excess_siblings.append(
                    {
                        "node_id": sibling,
                        "on_hand_qty": on_hand,
                        "sibling_safety_stock": sibling_safety,
                    }
                )
        fired = bool(excess_siblings and target_ok)
        return fired, {
            "target_node_below_rop": target_ok,
            "sibling_excess": excess_siblings,
        }

    def _evidence_promo_uplift(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        # Promotion uplift is a contributing driver for the WHOLE planning horizon,
        # not just the week of breach. Use the configured horizon.
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
        matching: list[dict[str, Any]] = []
        for row in rows:
            try:
                ws = date.fromisoformat(str(row.week_start))
            except (TypeError, ValueError):
                continue
            if window_start <= ws <= window_end and float(row.uplift_pct or 0.0) > 0:
                matching.append(
                    {
                        "week_start": ws.isoformat(),
                        "uplift_pct": float(row.uplift_pct or 0.0),
                        "promo_type": row.promo_type,
                    }
                )
        fired = bool(matching)
        return fired, {
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
            "promotions": matching,
        }

    def _evidence_blocked_inventory(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        rows = (
            self.db.query(NetworkInventorySnapshot)
            .filter(
                NetworkInventorySnapshot.sku == problem.sku,
                NetworkInventorySnapshot.node_id == problem.node_id,
                NetworkInventorySnapshot.quality_hold_flag.is_(True),
            )
            .all()
        )
        if not rows:
            return False, {"reason": "No quality-hold stock at this sku/node."}
        blocked_qty = sum(float(r.on_hand_qty or 0.0) for r in rows)
        return True, {
            "blocked_qty": round(blocked_qty, 2),
            "rows": [{"as_of": r.as_of_date, "qty": float(r.on_hand_qty)} for r in rows[:5]],
        }

    def _evidence_forecast_overstated(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        """Fire when actual_qty / forecast_qty is consistently below 0.7 over the
        last 4 observed weeks. Requires `NetworkActualWeekly` rows.

        Forecast overstatement is a SKU-level property (the forecasting model
        is biased high for this product). The problem may fire at one node
        while historical actuals live at another — so we aggregate actuals +
        forecasts across all nodes for the SKU, then compute the ratio.
        """
        actual_rows = (
            self.db.query(NetworkActualWeekly)
            .filter(NetworkActualWeekly.sku == problem.sku)
            .all()
        )
        if not actual_rows:
            return False, {"reason": "No actual_demand rows for this SKU."}
        forecast_rows = (
            self.db.query(NetworkForecastWeekly)
            .filter(NetworkForecastWeekly.sku == problem.sku)
            .all()
        )
        # Aggregate per week across nodes so small ENERGY-110 side-rows don't
        # drown the signal on a SKU shared across stores.
        actuals_by_week: dict[str, float] = {}
        for a in actual_rows:
            actuals_by_week[a.week_start] = actuals_by_week.get(a.week_start, 0.0) + float(a.actual_qty or 0.0)
        forecast_by_week: dict[str, float] = {}
        for f in forecast_rows:
            forecast_by_week[f.week_start] = forecast_by_week.get(f.week_start, 0.0) + float(f.forecast_qty or 0.0)
        ratios: list[tuple[str, float]] = []
        for week, actual in sorted(actuals_by_week.items()):
            fcst = forecast_by_week.get(week, 0.0)
            if fcst <= 0:
                continue
            ratios.append((week, round(actual / fcst, 3)))
        if len(ratios) < 4:
            return False, {"reason": "Not enough observed weeks."}
        recent = ratios[-4:]
        below = [r for r in recent if r[1] < 0.7]
        fired = len(below) >= 3
        return fired, {
            "recent_ratios": recent,
            "threshold": 0.7,
            "consecutive_below_required": 3,
            "scope": "sku_all_nodes_aggregated",
        }

    def _evidence_substitution(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        """Fire when a sibling SKU in the same category is trending up while this
        one is trending down across the last 4 actual-demand weeks."""
        self_product = (
            self.db.query(ProductMaster)
            .filter(ProductMaster.sku == problem.sku)
            .first()
        )
        if self_product is None or not self_product.category:
            return False, {"reason": "No category on product."}
        siblings = [
            p.sku for p in
            self.db.query(ProductMaster)
            .filter(
                ProductMaster.category == self_product.category,
                ProductMaster.sku != problem.sku,
            )
            .all()
        ]
        if not siblings:
            return False, {"reason": "No sibling SKUs in category."}

        def _trend(sku: str, node: str) -> float:
            rows = (
                self.db.query(NetworkActualWeekly)
                .filter(
                    NetworkActualWeekly.sku == sku,
                    NetworkActualWeekly.node_id == node,
                )
                .order_by(NetworkActualWeekly.week_start.asc())
                .all()
            )
            recent = rows[-4:] if len(rows) >= 4 else rows
            if len(recent) < 2:
                return 0.0
            first = float(recent[0].actual_qty or 0.0)
            last = float(recent[-1].actual_qty or 0.0)
            return last - first

        self_trend = _trend(problem.sku, problem.node_id)
        spikers: list[dict[str, Any]] = []
        for sib in siblings:
            t = _trend(sib, problem.node_id)
            if t > 0 and (self_trend < 0 or self_trend < t * 0.25):
                spikers.append({"sku": sib, "trend_delta": round(t, 2)})
        fired = self_trend < 0 and bool(spikers)
        return fired, {
            "self_trend_delta": round(self_trend, 2),
            "spiking_siblings": spikers[:3],
            "category": self_product.category,
        }

    def _evidence_policy_issue(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        # Heuristic: flag when reorder_point < expected lead-time-demand.
        forecast_rows = (
            self.db.query(ReplenishmentOrderDetail)
            .filter(
                ReplenishmentOrderDetail.sku == problem.sku,
                ReplenishmentOrderDetail.ship_to_node_id == problem.node_id,
            )
            .all()
        )
        # Use the problem's observed forecast quantity (per-week) as an estimate.
        forecast_qty = float(problem.evidence.get("forecast_qty") or 0.0)
        lead_time_weeks = max(1.0, (2.0))  # default 2 weeks; config later
        advisable_rop = forecast_qty * lead_time_weeks
        policy_rop = problem.reorder_point_qty
        safety_stock = problem.safety_stock_qty
        # Fire if actual policy is materially below advisable.
        margin = 0.9
        fired = bool(policy_rop < advisable_rop * margin) or bool(safety_stock == 0)
        evidence = {
            "policy_reorder_point": policy_rop,
            "advisable_reorder_point_estimate": round(advisable_rop, 2),
            "policy_safety_stock": safety_stock,
            "forecast_qty_per_week": forecast_qty,
            "lead_time_weeks_used": lead_time_weeks,
        }
        return fired, evidence

    # --------------------------------------------------- perishable handlers

    def _evidence_rsl_below_threshold(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        """Fire when one or more batches for the problem sku/node have remaining
        shelf life <= 2 days. Reads from InventoryBatchSnapshot."""
        threshold_days = 2
        rows = (
            self.db.query(InventoryBatchSnapshot)
            .filter(
                InventoryBatchSnapshot.sku == problem.sku,
                InventoryBatchSnapshot.node_id == problem.node_id,
            )
            .all()
        )
        if not rows:
            return False, {"reason": "No batch-grain inventory found."}
        # Use the most-recent as_of_date for this sku/node.
        latest_as_of = max(str(r.as_of_date) for r in rows)
        try:
            as_of_date_obj = date.fromisoformat(latest_as_of)
        except (TypeError, ValueError):
            as_of_date_obj = self.base_week
        flagged: list[dict[str, Any]] = []
        for r in rows:
            if str(r.as_of_date) != latest_as_of:
                continue
            try:
                exp = date.fromisoformat(r.expiry_date)
            except (TypeError, ValueError):
                continue
            rsl = (exp - as_of_date_obj).days
            if rsl <= threshold_days and float(r.batch_qty or 0.0) > 0:
                flagged.append({
                    "batch_id": r.batch_id,
                    "qty": float(r.batch_qty or 0.0),
                    "expiry_date": exp.isoformat(),
                    "rsl_days": rsl,
                })
        fired = bool(flagged)
        return fired, {
            "as_of_date": latest_as_of,
            "threshold_days": threshold_days,
            "flagged_batches": flagged[:5],
            "total_at_risk_qty": round(sum(b["qty"] for b in flagged), 2),
        }

    def _evidence_cold_chain_break(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        """Fire when any batch for this sku/node is on quality hold (proxy for a
        cold-chain break or a lab-hold event that pulls stock from sellable)."""
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
            return False, {"reason": "No quality-hold batches."}
        blocked_qty = sum(float(r.batch_qty or 0.0) for r in rows)
        return True, {
            "blocked_qty": round(blocked_qty, 2),
            "batches": [{"batch_id": r.batch_id, "qty": float(r.batch_qty)} for r in rows[:5]],
            "note": "Quality-hold proxy for cold-chain / QA event — confirm with receiving.",
        }

    def _evidence_aged_receipt(
        self, problem: ProblemInstance, template: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        """Fire when received_date → expiry_date span is materially below the
        product's ``shelf_life_days`` — implying the SKU was shipped too close
        to expiry by the supplier (aged receipt)."""
        product = (
            self.db.query(ProductMaster)
            .filter(ProductMaster.sku == problem.sku)
            .first()
        )
        if product is None or not getattr(product, "shelf_life_days", None):
            return False, {"reason": "No shelf_life_days configured on product."}
        product_sl = int(product.shelf_life_days or 0)
        if product_sl <= 0:
            return False, {"reason": "Non-perishable SKU."}
        rows = (
            self.db.query(InventoryBatchSnapshot)
            .filter(
                InventoryBatchSnapshot.sku == problem.sku,
                InventoryBatchSnapshot.node_id == problem.node_id,
            )
            .all()
        )
        aged: list[dict[str, Any]] = []
        for r in rows:
            try:
                exp = date.fromisoformat(r.expiry_date)
                rec = date.fromisoformat(r.received_date) if r.received_date else None
            except (TypeError, ValueError):
                continue
            if rec is None:
                continue
            span_days = (exp - rec).days
            # "Aged" = shipped with ≥ 50% of total shelf life already consumed.
            if span_days < product_sl * 0.5:
                aged.append({
                    "batch_id": r.batch_id,
                    "span_days": span_days,
                    "product_shelf_life_days": product_sl,
                    "received_date": rec.isoformat(),
                    "expiry_date": exp.isoformat(),
                })
        fired = bool(aged)
        return fired, {
            "product_shelf_life_days": product_sl,
            "aged_threshold_pct": 0.5,
            "aged_batches": aged[:5],
        }

    # ----------------------------------------------------------------- helpers

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
        sibling_rows = (
            self.db.query(NetworkSourcingRule.dest_node_id)
            .filter(
                NetworkSourcingRule.sku == sku,
                NetworkSourcingRule.parent_location_node_id == target_rule.parent_location_node_id,
                NetworkSourcingRule.dest_node_id != target_node,
            )
            .all()
        )
        return sorted({r[0] for r in sibling_rows if r[0]})

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
