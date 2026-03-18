from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import and_, or_
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, selectinload

from ..models import AuditLog, LocationMaster, NetworkAlert, NetworkNode, NetworkSourcingRule, ParameterException, ParameterValue, PlanningRun, ProjectionPoint, ProductMaster, Recommendation, ReplenishmentOrder, ReplenishmentOrderAlertLink, ReplenishmentOrderDetail, SupplierMaster, SourcingOption
from .llm_service import resolve_llm_selection
from .rag_service import retrieve_policy_context


TODAY = date(2026, 3, 8)


def _iso_for_week(week_index: int) -> str:
    return (TODAY + timedelta(days=7 * week_index)).isoformat()


class PlanningService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self._ensure_order_alert_link_table()

    @staticmethod
    def _list_filter_values(value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        text = str(value).strip()
        return [text] if text else []

    def _apply_filter(self, query: Any, column: Any, value: Any):
        values = self._list_filter_values(value)
        if not values:
            return query
        if len(values) == 1:
            return query.filter(column == values[0])
        return query.filter(column.in_(values))

    def _ensure_order_alert_link_table(self) -> None:
        bind = self.db.get_bind()
        ReplenishmentOrderAlertLink.__table__.create(bind=bind, checkfirst=True)
        existing = {
            (str(item.order_id), str(item.alert_id))
            for item in self.db.query(ReplenishmentOrderAlertLink.order_id, ReplenishmentOrderAlertLink.alert_id).all()
        }
        created = False
        now_iso = datetime.utcnow().replace(microsecond=0).isoformat()
        for order_id, alert_id in self.db.query(ReplenishmentOrder.order_id, ReplenishmentOrder.alert_id).all():
            oid = str(order_id or "").strip()
            aid = str(alert_id or "").strip()
            if not oid or not aid or (oid, aid) in existing:
                continue
            self.db.add(
                ReplenishmentOrderAlertLink(
                    order_id=oid,
                    alert_id=aid,
                    link_status="active",
                    linked_scope="order",
                    created_at=now_iso,
                )
            )
            existing.add((oid, aid))
            created = True
        if created:
            self.db.flush()

    def _order_alert_links_by_order_id(self, order_ids: list[str]) -> dict[str, dict[str, list[str]]]:
        if not order_ids:
            return {}
        links = (
            self.db.query(ReplenishmentOrderAlertLink)
            .filter(ReplenishmentOrderAlertLink.order_id.in_(order_ids))
            .order_by(ReplenishmentOrderAlertLink.created_at.asc(), ReplenishmentOrderAlertLink.id.asc())
            .all()
        )
        result: dict[str, dict[str, list[str]]] = {order_id: {"active": [], "fixed": []} for order_id in order_ids}
        for item in links:
            status_key = "fixed" if str(item.link_status or "").strip().lower() == "fixed" else "active"
            bucket = result.setdefault(item.order_id, {"active": [], "fixed": []})
            if item.alert_id not in bucket[status_key]:
                bucket[status_key].append(item.alert_id)
        return result

    def _normalize_order_alert_links(self, order_id: str) -> None:
        rows = (
            self.db.query(ReplenishmentOrderAlertLink)
            .filter(ReplenishmentOrderAlertLink.order_id == order_id)
            .order_by(ReplenishmentOrderAlertLink.created_at.desc(), ReplenishmentOrderAlertLink.id.desc())
            .all()
        )
        if not rows:
            return
        keep_ids: set[int] = set()
        grouped: dict[str, list[ReplenishmentOrderAlertLink]] = {}
        for row in rows:
            key = str(row.alert_id or "").strip().lower()
            if not key:
                continue
            grouped.setdefault(key, []).append(row)
        for _, items in grouped.items():
            active = [item for item in items if str(item.link_status or "").strip().lower() == "active"]
            keep = active[0] if active else items[0]
            keep_ids.add(int(keep.id))
        for row in rows:
            if int(row.id) not in keep_ids:
                self.db.delete(row)

    def _sync_alert_archive_state(self, alert_id: str) -> None:
        target = str(alert_id or "").strip()
        if not target:
            return
        # Session autoflush is disabled; flush pending link-status updates so
        # archive decisions are based on the latest active/fixed state.
        self.db.flush()
        alert = self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == target).first()
        if not alert:
            return
        active_link_count = (
            self.db.query(ReplenishmentOrderAlertLink)
            .filter(
                ReplenishmentOrderAlertLink.alert_id == target,
                ReplenishmentOrderAlertLink.link_status == "active",
            )
            .count()
        )
        if active_link_count > 0:
            # Keep globally active while at least one order still references it.
            alert.effective_to = None
        else:
            if not alert.effective_to:
                alert.effective_to = datetime.utcnow().replace(microsecond=0).isoformat()

    def _apply_location_alias_filter(self, query: Any, columns: list[Any], value: Any):
        values = self._list_filter_values(value)
        if not values or not columns:
            return query
        clauses = []
        for column in columns:
            if len(values) == 1:
                clauses.append(column == values[0])
            else:
                clauses.append(column.in_(values))
        return query.filter(or_(*clauses))

    def _dashboard_query(self, filters: dict[str, Any]):
        query = self.db.query(Recommendation)
        run_values = self._list_filter_values(filters.get("run_id"))
        if run_values:
            query = self._apply_filter(query, Recommendation.run_id, run_values)
        else:
            query = query.filter(Recommendation.run_id == "RUN-BASELINE-001")
        query = self._apply_filter(query, Recommendation.region, filters.get("region"))
        query = self._apply_filter(query, Recommendation.location, filters.get("location"))
        query = self._apply_filter(query, Recommendation.sku, filters.get("sku"))
        query = self._apply_filter(query, Recommendation.category, filters.get("category"))
        query = self._apply_filter(query, Recommendation.supplier, filters.get("supplier"))
        query = self._apply_filter(query, Recommendation.status, filters.get("exception_status"))
        return query.order_by(Recommendation.region.asc(), Recommendation.sku.asc())

    def create_run(self) -> dict[str, object]:
        existing = self.db.query(PlanningRun).filter(PlanningRun.id == "RUN-BASELINE-001").first()
        return {
            "run_id": existing.id if existing else "RUN-BASELINE-001",
            "message": "SQLite-backed baseline planning snapshot is ready.",
            "summary": {
                "recommendation_count": self.db.query(Recommendation).filter(Recommendation.run_id == "RUN-BASELINE-001").count(),
                "open_parameter_exceptions": self.db.query(ParameterException).filter(ParameterException.status == "open").count(),
            },
        }

    def get_dashboard(self, filters: dict[str, Any]) -> dict[str, object]:
        run_values = self._list_filter_values(filters.get("run_id"))
        rows = self._dashboard_query(filters).all()
        return {
            "run_id": run_values[0] if run_values else "RUN-BASELINE-001",
            "generated_at": TODAY.isoformat(),
            "kpis": [
                {
                    "label": "At-Risk SKUs",
                    "value": str(sum(1 for row in rows if row.status == "at_risk")),
                    "detail": "Projected shortage inside 8 weeks",
                    "tone": "critical",
                },
                {
                    "label": "Excess Positions",
                    "value": str(sum(1 for row in rows if row.status == "excess")),
                    "detail": "Rebalance or suppress inbound",
                    "tone": "warning",
                },
                {
                    "label": "Open Parameter Exceptions",
                    "value": str(self.db.query(ParameterException).filter(ParameterException.status == "open").count()),
                    "detail": "Missing, stale, invalid, or misaligned",
                    "tone": "warning",
                },
                {
                    "label": "Indexed Policies",
                    "value": str(len(retrieve_policy_context(self.db, "policy"))),
                    "detail": "SQLite document chunk retrieval available",
                    "tone": "positive",
                },
            ],
            "recommendations": [self._recommendation_payload(row) for row in rows],
            "alerts": [
                "No-safe-action cases stay visible and require explicit planner escalation.",
                "Parameter recommendations persist with audit history after approval.",
            ],
        }

    def _recommendation_payload(self, row: Recommendation) -> dict[str, object]:
        return {
            "run_id": row.run_id,
            "sku": row.sku,
            "product_name": row.product_name,
            "category": row.category,
            "location": row.location,
            "region": row.region,
            "projected_stockout_week": row.projected_stockout_week,
            "shortage_qty": row.shortage_qty,
            "excess_qty": row.excess_qty,
            "action": row.action,
            "eta": row.eta,
            "incremental_cost": row.incremental_cost,
            "risk_score": row.risk_score,
            "confidence_score": row.confidence_score,
            "status": row.status,
            "rationale": row.rationale,
        }

    def get_sku_detail(self, sku: str, location: str, run_id: str | None) -> dict[str, object]:
        row = (
            self.db.query(Recommendation)
            .options(selectinload(Recommendation.options), selectinload(Recommendation.projections))
            .filter(
                and_(
                    Recommendation.sku == sku,
                    Recommendation.location == location,
                    Recommendation.run_id == (run_id or "RUN-BASELINE-001"),
                )
            )
            .first()
        )
        if row is None:
            raise KeyError(f"Unknown SKU/location combination: {sku} {location}")
        return {
            "run_id": row.run_id,
            "recommendation": self._recommendation_payload(row),
            "ranked_options": [
                {
                    "option_type": option.option_type,
                    "supplier": option.supplier,
                    "from_location": option.from_location,
                    "recommended_qty": option.recommended_qty,
                    "earliest_arrival_date": option.earliest_arrival_date,
                    "incremental_cost": option.incremental_cost,
                    "risk_score": option.risk_score,
                    "feasible_flag": option.feasible_flag,
                    "rationale": option.rationale,
                }
                for option in sorted(row.options, key=lambda item: item.risk_score)
            ],
            "projection": [
                {
                    "week_start": point.week_start,
                    "beginning_qty": point.beginning_qty,
                    "inbound_qty": point.inbound_qty,
                    "demand_qty": point.demand_qty,
                    "ending_qty": point.ending_qty,
                    "safety_stock_qty": point.safety_stock_qty,
                    "stockout_flag": point.stockout_flag,
                    "shortage_qty": point.shortage_qty,
                }
                for point in sorted(row.projections, key=lambda item: item.week_index)
            ],
            "policy_snippets": retrieve_policy_context(self.db, f"{sku} {location} {row.action}", limit=3),
        }

    def evaluate_scenario(self, payload: dict[str, object]) -> dict[str, object]:
        scenario_run_id = f"RUN-SCN-{self.db.query(PlanningRun).filter(PlanningRun.run_type == 'scenario').count() + 1:03d}"
        scope = payload.get("scope", {})
        changes = payload["changes"]
        self.db.add(
            PlanningRun(
                id=scenario_run_id,
                run_type="scenario",
                base_run_id="RUN-BASELINE-001",
                scenario_name=str(payload["scenario_name"]),
                created_at=TODAY.isoformat(),
                scope_json=json.dumps(scope),
                changes_json=json.dumps(changes),
            )
        )
        base_rows = self.db.query(Recommendation).options(selectinload(Recommendation.options), selectinload(Recommendation.projections)).filter(Recommendation.run_id == "RUN-BASELINE-001").all()
        deltas = []
        for base in base_rows:
            if scope and scope.get("region") and base.region != scope["region"]:
                continue
            new_row = Recommendation(
                run_id=scenario_run_id,
                sku=base.sku,
                product_name=base.product_name,
                category=base.category,
                location=base.location,
                region=base.region,
                supplier=base.supplier,
                status=base.status,
                action=base.action,
                eta=_iso_for_week(3) if changes["lead_time_delay_days"] else base.eta,
                incremental_cost=round(base.incremental_cost * (1 + (changes["forecast_multiplier"] - 1) * 0.25), 2),
                risk_score=min(0.99, round(base.risk_score + changes["supplier_reliability_delta"] + changes["lead_time_delay_days"] * 0.01, 2)),
                confidence_score=max(0.55, round(base.confidence_score - (changes["forecast_multiplier"] - 1) * 0.08, 2)),
                projected_stockout_week=base.projected_stockout_week,
                shortage_qty=int(round(base.shortage_qty * changes["forecast_multiplier"])),
                excess_qty=base.excess_qty,
                rationale=(
                    f"Scenario '{payload['scenario_name']}' recalculated shortage using deterministic multipliers "
                    f"for demand and lead time."
                ),
            )
            self.db.add(new_row)
            self.db.flush()
            for option in base.options:
                self.db.add(
                    SourcingOption(
                        recommendation_id=new_row.id,
                        option_type=option.option_type,
                        supplier=option.supplier,
                        from_location=option.from_location,
                        recommended_qty=int(round(option.recommended_qty * changes["forecast_multiplier"])),
                        earliest_arrival_date=new_row.eta if option.option_type == new_row.action else option.earliest_arrival_date,
                        incremental_cost=round(option.incremental_cost * (1 + (changes["forecast_multiplier"] - 1) * 0.2), 2),
                        risk_score=min(0.99, round(option.risk_score + changes["supplier_reliability_delta"], 2)),
                        feasible_flag=option.feasible_flag,
                        rationale=option.rationale,
                    )
                )
            for point in base.projections:
                demand_qty = int(round(point.demand_qty * changes["forecast_multiplier"]))
                ending_qty = point.beginning_qty + point.inbound_qty - demand_qty
                shortage_qty = max(0, point.safety_stock_qty - ending_qty)
                self.db.add(
                    ProjectionPoint(
                        recommendation_id=new_row.id,
                        week_index=point.week_index,
                        week_start=point.week_start,
                        beginning_qty=point.beginning_qty,
                        inbound_qty=point.inbound_qty,
                        demand_qty=demand_qty,
                        ending_qty=ending_qty,
                        safety_stock_qty=point.safety_stock_qty,
                        stockout_flag=ending_qty < 0,
                        shortage_qty=shortage_qty,
                    )
                )
            deltas.append(self._recommendation_payload(new_row))
        self.db.commit()
        return {
            "baseline_run_id": "RUN-BASELINE-001",
            "scenario_run_id": scenario_run_id,
            "deltas": deltas,
            "summary": f"Scenario {payload['scenario_name']} persisted {len(deltas)} scenario recommendations in SQLite.",
        }

    def explain(
        self,
        question: str,
        sku: str | None,
        location: str | None,
        llm_provider: str | None = None,
        llm_model: str | None = None,
    ) -> dict[str, object]:
        query = " ".join(part for part in [question, sku or "", location or ""] if part).strip()
        selected_provider, selected_model = resolve_llm_selection(llm_provider, llm_model)
        return {
            "answer": (
                "The selected action is grounded in the deterministic planning output stored in SQLite. "
                "The explanation layer summarizes timing, risk, and policy tradeoffs without inventing new facts."
            ),
            "citations": retrieve_policy_context(self.db, query, limit=3),
            "structured_output": {
                "task_type": "recommendation_explanation",
                "approval_required": False,
                "question": question,
            },
            "selected_llm_provider": selected_provider,
            "selected_llm_model": selected_model,
            "llm_invoked": False,
        }

    def get_parameter_exceptions(self, filters: dict[str, Any]) -> list[dict[str, object]]:
        query = self.db.query(ParameterException)
        query = self._apply_filter(query, ParameterException.sku, filters.get("sku"))
        query = self._apply_filter(query, ParameterException.location, filters.get("location"))
        query = self._apply_filter(query, ParameterException.status, filters.get("exception_status"))
        query = self._apply_filter(query, ParameterException.recommendation_id, filters.get("recommendation_id"))
        query = self._apply_filter(query, ParameterException.parameter_code, filters.get("parameter_code"))
        query = self._apply_filter(query, ParameterException.issue_type, filters.get("issue_type"))
        rows = query.order_by(ParameterException.sku.asc()).all()
        region_values = self._list_filter_values(filters.get("region"))
        if region_values:
            location_region_map = {row.code: row.region for row in self.db.query(LocationMaster).all()}
            node_region_map = {row.node_id: row.region for row in self.db.query(NetworkNode).all()}
            rows = [
                row for row in rows
                if (location_region_map.get(row.location) or node_region_map.get(row.location)) in region_values
            ]
        return [
            {
                "recommendation_id": row.recommendation_id,
                "sku": row.sku,
                "product_name": row.product_name,
                "location": row.location,
                "parameter_code": row.parameter_code,
                "issue_type": row.issue_type,
                "current_effective_value": row.current_effective_value,
                "recommended_value": row.recommended_value,
                "impact_summary": row.impact_summary,
                "confidence_score": row.confidence_score,
                "status": row.status,
            }
            for row in rows
        ]

    def get_effective_values(self, sku: str, location: str) -> list[dict[str, object]]:
        return [
            {
                "parameter_code": row.parameter_code,
                "parameter_name": row.parameter_name,
                "inherited_from": row.inherited_from,
                "effective_value": row.effective_value,
                "explicit_value": row.explicit_value,
                "source_type": row.source_type,
                "reason": row.reason,
            }
            for row in self.db.query(ParameterValue).filter(and_(ParameterValue.sku == sku, ParameterValue.location == location)).all()
        ]

    def _parameter_value_payload(self, row: ParameterValue) -> dict[str, object]:
        location = self.db.query(LocationMaster).filter(LocationMaster.code == row.location).first()
        network_node = self.db.query(NetworkNode).filter(NetworkNode.node_id == row.location).first()
        return {
            "id": row.id,
            "sku": row.sku,
            "location": row.location,
            "region": (location.region if location else None) or (network_node.region if network_node else None),
            "parameter_code": row.parameter_code,
            "parameter_name": row.parameter_name,
            "inherited_from": row.inherited_from,
            "effective_value": row.effective_value,
            "explicit_value": row.explicit_value,
            "source_type": row.source_type,
            "reason": row.reason,
        }

    def get_parameter_values(self, filters: dict[str, Any]) -> list[dict[str, object]]:
        query = self.db.query(ParameterValue)
        query = self._apply_filter(query, ParameterValue.sku, filters.get("sku"))
        query = self._apply_filter(query, ParameterValue.location, filters.get("location"))
        query = self._apply_filter(query, ParameterValue.parameter_code, filters.get("parameter_code"))
        rows = query.order_by(ParameterValue.sku.asc(), ParameterValue.location.asc(), ParameterValue.parameter_code.asc()).all()
        region_values = self._list_filter_values(filters.get("region"))
        if region_values:
            allowed_locations = {item.code for item in self.db.query(LocationMaster).filter(LocationMaster.region.in_(region_values)).all()}
            allowed_locations.update({item.node_id for item in self.db.query(NetworkNode).filter(NetworkNode.region.in_(region_values)).all()})
            rows = [row for row in rows if row.location in allowed_locations]
        return [self._parameter_value_payload(row) for row in rows]

    def update_parameter_value(self, row_id: int, payload: dict[str, object]) -> dict[str, object]:
        row = self.db.query(ParameterValue).filter(ParameterValue.id == row_id).first()
        if row is None:
            raise KeyError(str(row_id))
        row.effective_value = str(payload["effective_value"])
        row.explicit_value = payload.get("explicit_value") if payload.get("explicit_value") is not None else str(payload["effective_value"])
        row.source_type = str(payload.get("source_type") or "manual_override")
        row.reason = str(payload.get("reason") or "Inline parameter update from editable grid.")
        self.db.add(
            AuditLog(
                recommendation_id=f"INLINE-{row.id}",
                sku=row.sku,
                location=row.location,
                parameter_code=row.parameter_code,
                action_type="inline_update",
                notes=f"Updated effective value to {row.effective_value}.",
                changed_at=TODAY.isoformat(),
            )
        )
        self.db.commit()
        self.db.refresh(row)
        return self._parameter_value_payload(row)

    def bulk_apply_parameter_values(self, payload: dict[str, object]) -> dict[str, object]:
        ids = [int(item) for item in (payload.get("record_ids") or [])]
        if not ids:
            return {"updated_count": 0, "created_count": 0, "message": "No rows selected for bulk apply."}
        rows = self.db.query(ParameterValue).filter(ParameterValue.id.in_(ids)).all()
        for row in rows:
            row.effective_value = str(payload["effective_value"])
            row.explicit_value = str(payload["effective_value"])
            row.source_type = str(payload.get("source_type") or "bulk_override")
            row.reason = str(payload.get("reason") or "Bulk parameter update from parameter workbench.")
            self.db.add(
                AuditLog(
                    recommendation_id=f"BULK-{row.id}",
                    sku=row.sku,
                    location=row.location,
                    parameter_code=row.parameter_code,
                    action_type="bulk_update",
                    notes=f"Bulk updated effective value to {row.effective_value}.",
                    changed_at=TODAY.isoformat(),
                )
            )
        self.db.commit()
        return {
            "updated_count": len(rows),
            "created_count": 0,
            "message": f"Bulk update applied to {len(rows)} parameter rows.",
        }

    def paste_parameter_values(self, payload: dict[str, object]) -> dict[str, object]:
        updated_count = 0
        created_count = 0
        for item in payload.get("rows", []):
            sku = str(item["sku"]).strip()
            location = str(item["location"]).strip()
            parameter_code = str(item["parameter_code"]).strip()
            value = str(item["effective_value"]).strip()
            if not sku or not location or not parameter_code:
                continue
            current = (
                self.db.query(ParameterValue)
                .filter(
                    and_(
                        ParameterValue.sku == sku,
                        ParameterValue.location == location,
                        ParameterValue.parameter_code == parameter_code,
                    )
                )
                .first()
            )
            if current:
                current.effective_value = value
                current.explicit_value = item.get("explicit_value") or value
                current.source_type = str(item.get("source_type") or "paste_import")
                current.reason = str(item.get("reason") or "Value imported through paste dialog.")
                updated_count += 1
                target = current
            else:
                target = ParameterValue(
                    sku=sku,
                    location=location,
                    parameter_code=parameter_code,
                    parameter_name=parameter_code.replace("_", " ").title(),
                    inherited_from=f"GLOBAL > {location} > {sku}",
                    effective_value=value,
                    explicit_value=item.get("explicit_value") or value,
                    source_type=str(item.get("source_type") or "paste_import"),
                    reason=str(item.get("reason") or "Value imported through paste dialog."),
                )
                self.db.add(target)
                self.db.flush()
                created_count += 1
            self.db.add(
                AuditLog(
                    recommendation_id=f"PASTE-{target.id}",
                    sku=target.sku,
                    location=target.location,
                    parameter_code=target.parameter_code,
                    action_type="paste_upsert",
                    notes=f"Pasted effective value {target.effective_value}.",
                    changed_at=TODAY.isoformat(),
                )
            )
        self.db.commit()
        return {
            "updated_count": updated_count,
            "created_count": created_count,
            "message": f"Paste import completed: {updated_count} updated, {created_count} created.",
        }

    def run_parameter_recommendations(self, payload: dict[str, object]) -> dict[str, object]:
        codes = set(payload.get("parameter_codes") or [])
        query = self.db.query(ParameterException)
        if codes:
            query = query.filter(ParameterException.parameter_code.in_(codes))
        rows = query.order_by(ParameterException.recommendation_id.asc()).all()
        return {
            "count": len(rows),
            "recommendations": [
                {
                    "recommendation_id": row.recommendation_id,
                    "sku": row.sku,
                    "product_name": row.product_name,
                    "location": row.location,
                    "parameter_code": row.parameter_code,
                    "issue_type": row.issue_type,
                    "current_effective_value": row.current_effective_value,
                    "recommended_value": row.recommended_value,
                    "impact_summary": row.impact_summary,
                    "confidence_score": row.confidence_score,
                    "status": row.status,
                }
                for row in rows
            ],
            "message": "Parameter diagnostics executed against persisted SQLite records.",
        }

    def apply_parameter_recommendation(self, recommendation_id: str) -> dict[str, object]:
        target = self.db.query(ParameterException).filter(ParameterException.recommendation_id == recommendation_id).first()
        if target is None:
            raise KeyError(recommendation_id)
        target.status = "applied"
        current = (
            self.db.query(ParameterValue)
            .filter(
                and_(
                    ParameterValue.sku == target.sku,
                    ParameterValue.location == target.location,
                    ParameterValue.parameter_code == target.parameter_code,
                )
            )
            .first()
        )
        if current:
            current.effective_value = target.recommended_value
            current.explicit_value = target.recommended_value
            current.source_type = "manual_override"
            current.reason = f"Applied from recommendation {recommendation_id}."
        else:
            self.db.add(
                ParameterValue(
                    sku=target.sku,
                    location=target.location,
                    parameter_code=target.parameter_code,
                    parameter_name=target.parameter_code.replace("_", " ").title(),
                    inherited_from=f"GLOBAL > {target.location} > {target.sku}",
                    effective_value=target.recommended_value,
                    explicit_value=target.recommended_value,
                    source_type="manual_override",
                    reason=f"Applied from recommendation {recommendation_id}.",
                )
            )
        self.db.add(
            AuditLog(
                recommendation_id=recommendation_id,
                sku=target.sku,
                location=target.location,
                parameter_code=target.parameter_code,
                action_type="apply",
                notes=f"Applied override value {target.recommended_value}.",
                changed_at=TODAY.isoformat(),
            )
        )
        self.db.commit()
        return {
            "recommendation_id": recommendation_id,
            "status": "applied",
            "updated_effective_values": self.get_effective_values(target.sku, target.location),
            "audit_message": f"Recommendation {recommendation_id} applied and logged in the audit table.",
        }

    def parameter_chat(
        self,
        question: str,
        llm_provider: str | None = None,
        llm_model: str | None = None,
    ) -> dict[str, object]:
        selected_provider, selected_model = resolve_llm_selection(llm_provider, llm_model)
        return {
            "answer": (
                "Parameter diagnostics resolved inherited values first, then persisted exceptions that were "
                "missing, stale, invalid, or misaligned. Approved overrides are written back to SQLite with audit logs."
            ),
            "citations": retrieve_policy_context(self.db, question, limit=3),
            "structured_output": {
                "task_type": "parameter_explanation",
                "approval_required": True,
                "question": question,
            },
            "selected_llm_provider": selected_provider,
            "selected_llm_model": selected_model,
            "llm_invoked": False,
        }

    def get_master_data_options(self) -> dict[str, object]:
        products = self.db.query(ProductMaster).order_by(ProductMaster.sku.asc()).all()
        locations = self.db.query(LocationMaster).order_by(LocationMaster.code.asc()).all()
        network_nodes = self.db.query(NetworkNode).order_by(NetworkNode.node_id.asc()).all()
        order_headers = self.db.query(ReplenishmentOrder).all()
        order_details = self.db.query(ReplenishmentOrderDetail).all()
        suppliers = self.db.query(SupplierMaster).order_by(SupplierMaster.code.asc()).all()
        runs = self.db.query(PlanningRun).order_by(PlanningRun.id.asc()).all()
        sourcing_rows = self.db.query(NetworkSourcingRule).all()
        alert_rows = self.db.query(NetworkAlert).all()
        parameter_exception_rows = self.db.query(ParameterException).all()
        parameter_value_rows = self.db.query(ParameterValue).all()
        location_master_by_code = {row.code: row for row in locations}
        network_node_by_id = {row.node_id: row for row in network_nodes}

        location_codes = {
            row.code for row in locations
        }
        location_codes.update(row.node_id for row in network_nodes)
        location_codes.update(row.ship_to_node_id for row in order_headers if row.ship_to_node_id)
        location_codes.update(row.ship_from_node_id for row in order_headers if row.ship_from_node_id)
        location_codes.update(row.ship_to_node_id for row in order_details if row.ship_to_node_id)
        location_codes.update(row.ship_from_node_id for row in order_details if row.ship_from_node_id)

        normalized_locations = []
        for code in sorted(location_codes):
            lm = location_master_by_code.get(code)
            node = network_node_by_id.get(code)
            normalized_locations.append(
                {
                    "code": code,
                    "name": (lm.name if lm else None) or (node.name if node else code),
                    "region": (lm.region if lm else None) or (node.region if node else "UNKNOWN"),
                    "type": (lm.location_type if lm else None) or (node.node_type if node else "node"),
                    "city": (lm.city if lm else None) or "",
                    "state": (lm.state if lm else None) or "",
                    "description": (lm.description if lm else None) or "",
                }
            )

        def _distinct(values: list[str | None]) -> list[str]:
            return sorted({str(item).strip() for item in values if item is not None and str(item).strip()})

        global_filter_values = {
            "run_id": _distinct([row.id for row in runs]),
            "alert_id": _distinct([row.alert_id for row in order_headers] + [row.alert_id for row in alert_rows]),
            "alert_type": _distinct([row.alert_type for row in alert_rows]),
            "severity": _distinct([row.severity for row in alert_rows]),
            "order_id": _distinct([row.order_id for row in order_headers] + [row.order_id for row in order_details]),
            "order_type": _distinct([row.order_type for row in order_headers]),
            "status": _distinct([row.status for row in order_headers]),
            "exception_status": _distinct([row.status for row in parameter_exception_rows] + [row.status for row in order_headers]),
            "recommendation_id": _distinct([row.recommendation_id for row in parameter_exception_rows]),
            "exception_reason": _distinct([row.exception_reason for row in order_headers]),
            "ship_from_node_id": _distinct([row.ship_from_node_id for row in order_headers] + [row.ship_from_node_id for row in order_details]),
            "ship_to_node_id": _distinct([row.ship_to_node_id for row in order_headers] + [row.ship_to_node_id for row in order_details]),
            "parameter_code": _distinct([row.parameter_code for row in parameter_value_rows] + [row.parameter_code for row in parameter_exception_rows]),
            "issue_type": _distinct([row.issue_type for row in parameter_exception_rows]),
            "source_mode": _distinct([row.source_mode for row in sourcing_rows]),
            "node_type": _distinct([row.node_type for row in network_nodes]),
        }
        return {
            "products": [
                {
                    "sku": row.sku,
                    "name": row.name,
                    "category": row.category,
                    "brand": row.brand,
                    "description": row.description,
                }
                for row in products
            ],
            "locations": [
                row
                for row in normalized_locations
            ],
            "regions": sorted({row["region"] for row in normalized_locations}),
            "categories": sorted({row.category for row in products}),
            "suppliers": sorted({row.name for row in suppliers}),
            "supplier_records": [
                {
                    "code": row.code,
                    "name": row.name,
                    "region": row.region,
                    "incoterm": row.incoterm,
                    "reliability_score": row.reliability_score,
                    "lead_time_days": row.lead_time_days,
                    "description": row.description,
                }
                for row in suppliers
            ],
            "global_filter_values": global_filter_values,
        }

    def search_master_data(self, query: str) -> dict[str, object]:
        normalized = query.lower().strip()
        products = self.db.query(ProductMaster).all()
        locations = self.db.query(LocationMaster).all()
        network_nodes = self.db.query(NetworkNode).all()
        order_headers = self.db.query(ReplenishmentOrder).all()
        order_details = self.db.query(ReplenishmentOrderDetail).all()
        suppliers = self.db.query(SupplierMaster).all()
        location_master_by_code = {row.code: row for row in locations}
        network_node_by_id = {row.node_id: row for row in network_nodes}
        location_codes = {row.code for row in locations}
        location_codes.update(row.node_id for row in network_nodes)
        location_codes.update(row.ship_to_node_id for row in order_headers if row.ship_to_node_id)
        location_codes.update(row.ship_from_node_id for row in order_headers if row.ship_from_node_id)
        location_codes.update(row.ship_to_node_id for row in order_details if row.ship_to_node_id)
        location_codes.update(row.ship_from_node_id for row in order_details if row.ship_from_node_id)
        normalized_locations = []
        for code in sorted(location_codes):
            lm = location_master_by_code.get(code)
            node = network_node_by_id.get(code)
            normalized_locations.append(
                {
                    "code": code,
                    "name": (lm.name if lm else None) or (node.name if node else code),
                    "region": (lm.region if lm else None) or (node.region if node else "UNKNOWN"),
                    "type": (lm.location_type if lm else None) or (node.node_type if node else "node"),
                    "city": (lm.city if lm else None) or "",
                    "state": (lm.state if lm else None) or "",
                    "description": (lm.description if lm else None) or "",
                }
            )
        product_hits = [
            {
                "sku": row.sku,
                "name": row.name,
                "category": row.category,
                "brand": row.brand,
                "description": row.description,
            }
            for row in products
            if normalized in " ".join([row.sku, row.name, row.brand, row.category, row.description]).lower()
        ][:6]
        location_hits = [
            row
            for row in normalized_locations
            if normalized in " ".join([
                str(row.get("code") or ""),
                str(row.get("name") or ""),
                str(row.get("region") or ""),
                str(row.get("city") or ""),
                str(row.get("state") or ""),
                str(row.get("description") or ""),
            ]).lower()
        ][:6]
        supplier_hits = [
            {
                "code": row.code,
                "name": row.name,
                "region": row.region,
                "incoterm": row.incoterm,
                "lead_time_days": row.lead_time_days,
                "description": row.description,
            }
            for row in suppliers
            if normalized in " ".join([row.code, row.name, row.region, row.incoterm, row.description]).lower()
        ][:6]
        return {"products": product_hits, "locations": location_hits, "suppliers": supplier_hits}

    def _replenishment_payload(
        self,
        row: ReplenishmentOrder,
        detail_counts: dict[str, int],
        detail_qtys: dict[str, float],
        alert_links: dict[str, dict[str, list[str]]],
    ) -> dict[str, object]:
        product_count = int(detail_counts.get(row.order_id, row.product_count))
        order_qty = float(detail_qtys.get(row.order_id, row.order_qty))
        link_bucket = alert_links.get(row.order_id, {})
        active_alert_ids = list(link_bucket.get("active", []))
        fixed_alert_ids = list(link_bucket.get("fixed", []))
        # If we have link records and no active links, treat alert as removed from
        # the order even if legacy row.alert_id still contains a historical value.
        has_link_records = bool(active_alert_ids or fixed_alert_ids)
        primary_alert_id = active_alert_ids[0] if active_alert_ids else ("" if has_link_records else str(row.alert_id or ""))
        return {
            "order_id": row.order_id,
            "alert_id": primary_alert_id,
            "alert_ids": active_alert_ids,
            "fixed_alert_ids": fixed_alert_ids,
            "order_type": row.order_type,
            "status": row.status,
            "is_exception": row.is_exception,
            "exception_reason": row.exception_reason,
            "alert_action_taken": row.alert_action_taken,
            "order_created_by": row.order_created_by,
            "ship_to_node_id": row.ship_to_node_id,
            "ship_from_node_id": row.ship_from_node_id,
            "sku": None,
            "product_count": product_count,
            "order_qty": order_qty,
            "region": row.region,
            "order_cost": row.order_cost,
            "lead_time_days": row.lead_time_days,
            "delivery_delay_days": row.delivery_delay_days,
            "logistics_impact": row.logistics_impact,
            "production_impact": row.production_impact,
            "transit_impact": row.transit_impact,
            "update_possible": row.update_possible,
            "created_at": row.created_at,
            "eta": row.eta,
        }

    def _reconcile_order_details_for_order(self, order: ReplenishmentOrder) -> None:
        required_count = max(1, int(order.product_count or 1))
        target_qty = round(float(order.order_qty or 0.0), 2)
        current_rows = (
            self.db.query(ReplenishmentOrderDetail)
            .filter(ReplenishmentOrderDetail.order_id == order.order_id)
            .all()
        )
        current_qty = round(sum(float(item.order_qty or 0.0) for item in current_rows), 2)
        current_unique = len(
            {
                (
                    str(item.sku or "").strip(),
                    str(item.ship_to_node_id or "").strip(),
                    str(item.ship_from_node_id or "").strip(),
                )
                for item in current_rows
            }
        )
        if (
            len(current_rows) == required_count
            and abs(current_qty - target_qty) <= 0.01
            and current_unique == len(current_rows)
        ):
            return

        self.db.query(ReplenishmentOrderDetail).filter(
            ReplenishmentOrderDetail.order_id == order.order_id
        ).delete(synchronize_session=False)

        ship_to_skus = [
            row[0]
            for row in self.db.query(NetworkSourcingRule.sku)
            .filter(NetworkSourcingRule.dest_node_id == order.ship_to_node_id)
            .all()
            if row[0]
        ]
        all_skus = [row[0] for row in self.db.query(NetworkSourcingRule.sku).all() if row[0]]
        if not all_skus:
            all_skus = [row[0] for row in self.db.query(ProductMaster.sku).all() if row[0]]
        detail_candidates = sorted(set(ship_to_skus)) or sorted(set(all_skus)) or ([order.sku] if order.sku else ["SKU-UNKNOWN"])

        selected_skus: list[str] = []
        if order.sku and order.sku in detail_candidates:
            selected_skus.append(order.sku)
        for sku in detail_candidates:
            if sku not in selected_skus:
                selected_skus.append(sku)
            if len(selected_skus) >= required_count:
                break
        if len(selected_skus) < required_count:
            for sku in sorted(set(all_skus)):
                if sku not in selected_skus:
                    selected_skus.append(sku)
                if len(selected_skus) >= required_count:
                    break
        if len(selected_skus) < required_count:
            for idx in range(required_count - len(selected_skus)):
                selected_skus.append(f"SKU-AUTO-{idx+1:02d}")

        per_sku_qty = round(target_qty / required_count, 2) if required_count else 0.0
        qtys = [per_sku_qty] * required_count
        if required_count:
            qtys[-1] = round(target_qty - sum(qtys[:-1]), 2)
        for idx, sku in enumerate(selected_skus[:required_count]):
            self.db.add(
                ReplenishmentOrderDetail(
                    order_id=order.order_id,
                    sku=sku,
                    ship_to_node_id=order.ship_to_node_id,
                    ship_from_node_id=order.ship_from_node_id,
                    order_qty=qtys[idx],
                )
            )
        self.db.flush()

    def get_replenishment_orders(
        self,
        filters: dict[str, Any],
        exception_only: bool = False,
    ) -> dict[str, object]:
        empty_summary = {
            "total_orders": 0.0,
            "exception_orders": 0.0,
            "non_exception_orders": 0.0,
            "total_order_cost": 0.0,
            "avg_lead_time_days": 0.0,
            "avg_delivery_delay_days": 0.0,
        }
        query = self.db.query(ReplenishmentOrder)
        query = self._apply_filter(query, ReplenishmentOrder.region, filters.get("region"))
        query = self._apply_location_alias_filter(
            query,
            [ReplenishmentOrder.ship_to_node_id, ReplenishmentOrder.ship_from_node_id],
            filters.get("location"),
        )
        alert_filter_values = self._list_filter_values(filters.get("alert_id"))
        if alert_filter_values:
            matching_order_ids = {
                row.order_id
                for row in self.db.query(ReplenishmentOrderAlertLink)
                .filter(
                    ReplenishmentOrderAlertLink.link_status == "active",
                    ReplenishmentOrderAlertLink.alert_id.in_(alert_filter_values),
                )
                .all()
            }
            if not matching_order_ids:
                return {"rows": [], "summary": empty_summary}
            query = query.filter(ReplenishmentOrder.order_id.in_(matching_order_ids))
        query = self._apply_filter(query, ReplenishmentOrder.order_id, filters.get("order_id"))
        query = self._apply_filter(query, ReplenishmentOrder.order_type, filters.get("order_type"))
        query = self._apply_filter(query, ReplenishmentOrder.status, filters.get("status"))
        query = self._apply_filter(query, ReplenishmentOrder.exception_reason, filters.get("exception_reason"))
        query = self._apply_filter(query, ReplenishmentOrder.ship_from_node_id, filters.get("ship_from_node_id"))
        query = self._apply_filter(query, ReplenishmentOrder.ship_to_node_id, filters.get("ship_to_node_id"))
        sku_values = self._list_filter_values(filters.get("sku"))
        if sku_values:
            try:
                matching_order_ids = {
                    row[0]
                    for row in self.db.query(ReplenishmentOrderDetail.order_id)
                    .filter(ReplenishmentOrderDetail.sku.in_(sku_values))
                    .all()
                }
            except OperationalError:
                matching_order_ids = {
                    row[0]
                    for row in self.db.query(ReplenishmentOrder.order_id)
                    .filter(ReplenishmentOrder.sku.in_(sku_values))
                    .all()
                }
            if not matching_order_ids:
                return {"rows": [], "summary": empty_summary}
            query = query.filter(ReplenishmentOrder.order_id.in_(matching_order_ids))
        if exception_only:
            query = query.filter(ReplenishmentOrder.is_exception.is_(True))
        try:
            rows = query.order_by(ReplenishmentOrder.created_at.desc(), ReplenishmentOrder.order_id.asc()).all()
        except OperationalError:
            return {"rows": [], "summary": empty_summary}
        order_ids = [row.order_id for row in rows]
        try:
            detail_rows = (
                self.db.query(ReplenishmentOrderDetail.order_id, ReplenishmentOrderDetail.order_qty)
                .filter(ReplenishmentOrderDetail.order_id.in_(order_ids))
                .all()
                if order_ids
                else []
            )
        except OperationalError:
            detail_rows = []
        detail_counts: dict[str, int] = {}
        detail_qtys: dict[str, float] = {}
        for order_id_value, qty in detail_rows:
            detail_counts[order_id_value] = detail_counts.get(order_id_value, 0) + 1
            detail_qtys[order_id_value] = detail_qtys.get(order_id_value, 0.0) + float(qty or 0.0)
        total_count = len(rows)
        exception_count = sum(1 for row in rows if row.is_exception)
        total_order_cost = 0.0
        lead_time_sum = 0.0
        delay_sum = 0.0
        for row in rows:
            product_count = int(detail_counts.get(row.order_id, row.product_count))
            order_qty = float(detail_qtys.get(row.order_id, row.order_qty))
            unit_cost = (row.order_cost / row.order_qty) if row.order_qty else 0.0
            total_order_cost += unit_cost * order_qty
            lead_time_sum += row.lead_time_days
            delay_sum += row.delivery_delay_days
        summary = {
            "total_orders": float(total_count),
            "exception_orders": float(exception_count),
            "non_exception_orders": float(total_count - exception_count),
            "total_order_cost": round(total_order_cost, 2),
            "avg_lead_time_days": round((lead_time_sum / total_count), 3) if total_count else 0.0,
            "avg_delivery_delay_days": round((delay_sum / total_count), 3) if total_count else 0.0,
        }
        alert_links = self._order_alert_links_by_order_id(order_ids)
        return {
            "rows": [self._replenishment_payload(row, detail_counts, detail_qtys, alert_links) for row in rows],
            "summary": summary,
        }

    def get_replenishment_order_details(
        self,
        filters: dict[str, Any],
        exception_only: bool = False,
        order_id: str | list[str] | None = None,
    ) -> dict[str, object]:
        payload_rows: list[dict[str, object]] = []
        order_id_values = self._list_filter_values(order_id if order_id is not None else filters.get("order_id"))
        primary_order_id = order_id_values[0] if order_id_values else None
        alert_filter_values = self._list_filter_values(filters.get("alert_id"))
        alert_filtered_order_ids: set[str] | None = None
        if alert_filter_values:
            alert_filtered_order_ids = {
                item.order_id
                for item in self.db.query(ReplenishmentOrderAlertLink)
                .filter(
                    ReplenishmentOrderAlertLink.link_status == "active",
                    ReplenishmentOrderAlertLink.alert_id.in_(alert_filter_values),
                )
                .all()
            }
            if not alert_filtered_order_ids:
                return {"rows": [], "summary": {"total_rows": 0.0, "total_order_qty": 0.0, "total_orders": 0.0}}
        try:
            if primary_order_id:
                target = self.db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id == primary_order_id).first()
                if target:
                    self._reconcile_order_details_for_order(target)
            query = self.db.query(ReplenishmentOrderDetail, ReplenishmentOrder).join(
                ReplenishmentOrder,
                ReplenishmentOrder.order_id == ReplenishmentOrderDetail.order_id,
            )
            query = self._apply_filter(query, ReplenishmentOrder.region, filters.get("region"))
            if alert_filtered_order_ids is not None:
                query = query.filter(ReplenishmentOrder.order_id.in_(alert_filtered_order_ids))
            query = self._apply_filter(query, ReplenishmentOrderDetail.order_id, order_id_values)
            query = self._apply_filter(query, ReplenishmentOrder.order_type, filters.get("order_type"))
            query = self._apply_filter(query, ReplenishmentOrder.status, filters.get("status"))
            query = self._apply_filter(query, ReplenishmentOrder.exception_reason, filters.get("exception_reason"))
            query = self._apply_location_alias_filter(
                query,
                [
                    ReplenishmentOrderDetail.ship_to_node_id,
                    ReplenishmentOrderDetail.ship_from_node_id,
                    ReplenishmentOrder.ship_to_node_id,
                    ReplenishmentOrder.ship_from_node_id,
                ],
                filters.get("location"),
            )
            query = self._apply_filter(query, ReplenishmentOrderDetail.sku, filters.get("sku"))
            query = self._apply_filter(query, ReplenishmentOrderDetail.ship_from_node_id, filters.get("ship_from_node_id"))
            query = self._apply_filter(query, ReplenishmentOrderDetail.ship_to_node_id, filters.get("ship_to_node_id"))
            if exception_only:
                query = query.filter(ReplenishmentOrder.is_exception.is_(True))
            rows = query.order_by(ReplenishmentOrder.created_at.desc(), ReplenishmentOrderDetail.order_id.asc(), ReplenishmentOrderDetail.sku.asc()).all()
            alert_links = self._order_alert_links_by_order_id([detail.order_id for detail, _ in rows])
            payload_rows = [
                {
                    "id": detail.id,
                    "order_id": detail.order_id,
                    "sku": detail.sku,
                    "ship_to_node_id": detail.ship_to_node_id,
                    "ship_from_node_id": detail.ship_from_node_id,
                    "order_qty": float(detail.order_qty),
                    "alert_id": (
                        alert_links.get(header.order_id, {}).get("active", [])[0]
                        if alert_links.get(header.order_id, {}).get("active", [])
                        else ("" if alert_links.get(header.order_id, {}).get("fixed", []) else str(header.alert_id or ""))
                    ),
                    "order_type": header.order_type,
                    "status": header.status,
                    "is_exception": header.is_exception,
                    "exception_reason": header.exception_reason,
                    "created_at": header.created_at,
                    "eta": header.eta,
                }
                for detail, header in rows
            ]
        except OperationalError:
            query = self.db.query(ReplenishmentOrder)
            query = self._apply_filter(query, ReplenishmentOrder.region, filters.get("region"))
            if alert_filtered_order_ids is not None:
                query = query.filter(ReplenishmentOrder.order_id.in_(alert_filtered_order_ids))
            query = self._apply_filter(query, ReplenishmentOrder.order_id, order_id_values)
            query = self._apply_filter(query, ReplenishmentOrder.order_type, filters.get("order_type"))
            query = self._apply_filter(query, ReplenishmentOrder.status, filters.get("status"))
            query = self._apply_filter(query, ReplenishmentOrder.exception_reason, filters.get("exception_reason"))
            query = self._apply_location_alias_filter(
                query,
                [ReplenishmentOrder.ship_to_node_id, ReplenishmentOrder.ship_from_node_id],
                filters.get("location"),
            )
            query = self._apply_filter(query, ReplenishmentOrder.sku, filters.get("sku"))
            query = self._apply_filter(query, ReplenishmentOrder.ship_from_node_id, filters.get("ship_from_node_id"))
            query = self._apply_filter(query, ReplenishmentOrder.ship_to_node_id, filters.get("ship_to_node_id"))
            if exception_only:
                query = query.filter(ReplenishmentOrder.is_exception.is_(True))
            headers = query.order_by(ReplenishmentOrder.created_at.desc(), ReplenishmentOrder.order_id.asc()).all()
            alert_links = self._order_alert_links_by_order_id([header.order_id for header in headers])
            payload_rows = [
                {
                    "id": index + 1,
                    "order_id": header.order_id,
                    "sku": header.sku or "SKU-UNKNOWN",
                    "ship_to_node_id": header.ship_to_node_id,
                    "ship_from_node_id": header.ship_from_node_id,
                    "order_qty": float(header.order_qty),
                    "alert_id": (
                        alert_links.get(header.order_id, {}).get("active", [])[0]
                        if alert_links.get(header.order_id, {}).get("active", [])
                        else ("" if alert_links.get(header.order_id, {}).get("fixed", []) else str(header.alert_id or ""))
                    ),
                    "order_type": header.order_type,
                    "status": header.status,
                    "is_exception": header.is_exception,
                    "exception_reason": header.exception_reason,
                    "created_at": header.created_at,
                    "eta": header.eta,
                }
                for index, header in enumerate(headers)
            ]
        summary = {
            "total_rows": float(len(payload_rows)),
            "total_order_qty": round(sum(item["order_qty"] for item in payload_rows), 2),
            "total_orders": float(len({item["order_id"] for item in payload_rows})),
        }
        return {"rows": payload_rows, "summary": summary}

    def create_replenishment_order(self, payload: dict[str, object]) -> dict[str, object]:
        details = list(payload.get("details") or [])
        if not details:
            raise ValueError("At least one order detail row is required.")

        ship_to = str(payload.get("ship_to_node_id") or "").strip()
        if not ship_to:
            raise ValueError("ship_to_node_id is required.")
        ship_from = (str(payload.get("ship_from_node_id") or "").strip() or None)
        eta = str(payload.get("eta") or "").strip()
        if not eta:
            raise ValueError("eta is required.")

        order_id = str(payload.get("order_id") or "").strip()
        if not order_id:
            max_num = 0
            for row in self.db.query(ReplenishmentOrder.order_id).all():
                token = str(row[0] or "")
                if token.startswith("RO-"):
                    suffix = token.replace("RO-", "", 1)
                    if suffix.isdigit():
                        max_num = max(max_num, int(suffix))
            order_id = f"RO-{max_num + 1:05d}"
        if self.db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id == order_id).first():
            raise ValueError(f"Order already exists: {order_id}")

        aggregated: dict[tuple[str, str, str | None], float] = {}
        for row in details:
            sku = str(row.get("sku") or "").strip()
            if not sku:
                continue
            qty = float(row.get("order_qty") or 0.0)
            d_ship_to = str(row.get("ship_to_node_id") or ship_to).strip() or ship_to
            d_ship_from = (str(row.get("ship_from_node_id") or ship_from or "").strip() or ship_from)
            key = (sku, d_ship_to, d_ship_from)
            aggregated[key] = aggregated.get(key, 0.0) + qty
        if not aggregated:
            raise ValueError("Valid detail rows with sku and order_qty are required.")
        if any(value < 0 for value in aggregated.values()):
            raise ValueError("order_qty cannot be negative.")

        order_qty = round(sum(aggregated.values()), 2)
        product_count = len(aggregated)
        primary_sku = sorted({key[0] for key in aggregated})[0]
        created_at = str(payload.get("created_at") or datetime.utcnow().replace(microsecond=0).isoformat())
        alert_id = str(payload.get("alert_id") or f"ALERT-MANUAL-{order_id}")
        region = payload.get("region")
        if not region:
            node = self.db.query(NetworkNode).filter(NetworkNode.node_id == ship_to).first()
            region = node.region if node else None

        order_cost = payload.get("order_cost")
        if order_cost is None:
            order_cost = round(order_qty * 3.5, 2)

        order = ReplenishmentOrder(
            order_id=order_id,
            alert_id=alert_id,
            order_type=str(payload.get("order_type") or "Stock Transfer"),
            status=str(payload.get("status") or "created"),
            is_exception=bool(payload.get("is_exception") or False),
            exception_reason=(str(payload.get("exception_reason")) if payload.get("exception_reason") else None),
            alert_action_taken=str(payload.get("alert_action_taken") or "execute_planned_replenishment"),
            order_created_by=str(payload.get("order_created_by") or "manual"),
            ship_to_node_id=ship_to,
            ship_from_node_id=ship_from,
            sku=primary_sku,
            product_count=product_count,
            order_qty=order_qty,
            region=(str(region) if region else None),
            order_cost=float(order_cost),
            lead_time_days=float(payload.get("lead_time_days") or 0.0),
            delivery_delay_days=float(payload.get("delivery_delay_days") or 0.0),
            logistics_impact=(str(payload.get("logistics_impact")) if payload.get("logistics_impact") else None),
            production_impact=(str(payload.get("production_impact")) if payload.get("production_impact") else None),
            transit_impact=(str(payload.get("transit_impact")) if payload.get("transit_impact") else None),
            update_possible=bool(payload.get("update_possible") if payload.get("update_possible") is not None else True),
            created_at=created_at,
            eta=eta,
        )
        self.db.add(order)
        self.db.flush()
        self.db.add(
            ReplenishmentOrderAlertLink(
                order_id=order_id,
                alert_id=alert_id,
                link_status="active",
                linked_scope="order",
                source_node_id=ship_to,
                created_at=datetime.utcnow().replace(microsecond=0).isoformat(),
            )
        )
        # If this alert was previously archived but now has an active order link,
        # restore it to active state so active/archive sections stay consistent.
        self._sync_alert_archive_state(alert_id)
        for (sku, d_ship_to, d_ship_from), qty in aggregated.items():
            self.db.add(
                ReplenishmentOrderDetail(
                    order_id=order_id,
                    sku=sku,
                    ship_to_node_id=d_ship_to,
                    ship_from_node_id=d_ship_from,
                    order_qty=round(qty, 2),
                )
            )
        self.db.commit()
        return {
            "order_id": order_id,
            "message": "Order created",
            "product_count": product_count,
            "order_qty": order_qty,
            "eta": eta,
            "detail_rows": product_count,
        }

    def update_replenishment_order(self, order_id: str, payload: dict[str, object]) -> dict[str, object]:
        order = self.db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id == order_id).first()
        if not order:
            raise KeyError(f"Order not found: {order_id}")
        normalized_status = str(order.status or "").strip().lower().replace(" ", "_")
        if normalized_status in {"delivered", "in_progress"}:
            raise ValueError(f"Order {order_id} cannot be modified when status is '{order.status}'.")
        self._normalize_order_alert_links(order_id)

        now_iso = datetime.utcnow().replace(microsecond=0).isoformat()
        mark_alert_fixed = bool(payload.get("mark_alert_fixed")) if payload.get("mark_alert_fixed") is not None else False
        fixed_alert_id = str(payload.get("fixed_alert_id") or "").strip()
        link_alert_id = str(payload.get("alert_id") or "").strip()
        create_new_alert = bool(payload.get("create_new_alert")) if payload.get("create_new_alert") is not None else False
        new_alert_id_input = str(payload.get("new_alert_id") or "").strip()
        new_alert_type = str(payload.get("new_alert_type") or "manual").strip() or "manual"
        new_alert_severity = str(payload.get("new_alert_severity") or "warning").strip().lower() or "warning"
        new_alert_title = str(payload.get("new_alert_title") or "").strip()
        new_alert_description = str(payload.get("new_alert_description") or "").strip()
        new_alert_impacted_node_id = str(payload.get("new_alert_impacted_node_id") or "").strip()
        new_alert_issue_type = str(payload.get("new_alert_issue_type") or "").strip()
        create_new_alert = create_new_alert or bool(new_alert_title) or bool(new_alert_description)
        if create_new_alert and link_alert_id:
            raise ValueError("Choose either an existing alert ID or create a new alert, not both.")

        active_links = (
            self.db.query(ReplenishmentOrderAlertLink)
            .filter(
                ReplenishmentOrderAlertLink.order_id == order_id,
                ReplenishmentOrderAlertLink.link_status == "active",
            )
            .order_by(ReplenishmentOrderAlertLink.created_at.asc(), ReplenishmentOrderAlertLink.id.asc())
            .all()
        )
        active_alert_ids = [str(item.alert_id or "").strip() for item in active_links if str(item.alert_id or "").strip()]
        current_alert_id = str(order.alert_id or "").strip() or (active_alert_ids[0] if active_alert_ids else "")
        alert_to_fix = fixed_alert_id or current_alert_id
        if mark_alert_fixed and alert_to_fix:
            target_link = None
            target_norm = alert_to_fix.strip().lower()
            for link in active_links:
                if str(link.alert_id or "").strip().lower() == target_norm:
                    target_link = link
                    break
            if target_link is None and not fixed_alert_id and active_links:
                # Fallback to first active alert when UI did not send a specific id.
                target_link = active_links[0]
            if target_link:
                alert_to_fix = str(target_link.alert_id or "").strip() or alert_to_fix
                fix_norm = alert_to_fix.strip().lower()
                for link in active_links:
                    if str(link.alert_id or "").strip().lower() == fix_norm:
                        link.link_status = "fixed"
                        link.fixed_at = now_iso
                        link.fixed_by = "manual"
            if fixed_alert_id and target_link is None:
                raise ValueError(f"Active alert link not found on order: {fixed_alert_id}")
            self._sync_alert_archive_state(alert_to_fix)
            order.alert_action_taken = "marked_alert_fixed"

        if create_new_alert:
            alert_id = new_alert_id_input
            if alert_id and self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == alert_id).first():
                raise ValueError(f"Alert already exists: {alert_id}")
            if not alert_id:
                base = f"ALERT-MANUAL-{order_id}".upper()
                alert_id = base
                suffix = 1
                while self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == alert_id).first():
                    alert_id = f"{base}-{suffix:02d}"
                    suffix += 1
            created_alert = NetworkAlert(
                alert_id=alert_id,
                alert_type=new_alert_type,
                severity=new_alert_severity,
                title=new_alert_title or f"Manual alert for order {order_id}",
                description=new_alert_description or f"Alert created from replenishment order {order_id}.",
                impacted_node_id=new_alert_impacted_node_id or order.ship_to_node_id,
                impacted_sku=order.sku,
                impacted_lane_id=None,
                effective_from=now_iso,
                effective_to=None,
                recommended_action_json=json.dumps(
                    {
                        "source": "replenishment_edit_modal",
                        "order_id": order_id,
                        "issue_type": new_alert_issue_type or "manual",
                    }
                ),
            )
            self.db.add(created_alert)
            existing_link = (
                self.db.query(ReplenishmentOrderAlertLink)
                .filter(
                    ReplenishmentOrderAlertLink.order_id == order_id,
                    ReplenishmentOrderAlertLink.alert_id == alert_id,
                )
                .first()
            )
            if existing_link:
                existing_link.link_status = "active"
                existing_link.fixed_at = None
                existing_link.fixed_by = None
                existing_link.linked_scope = "supply_node" if new_alert_issue_type.lower() == "parameter_issue" else "order"
                existing_link.source_node_id = new_alert_impacted_node_id or order.ship_to_node_id
                existing_link.issue_type = new_alert_issue_type or None
                existing_link.notes = new_alert_description or None
            else:
                self.db.add(
                    ReplenishmentOrderAlertLink(
                        order_id=order_id,
                        alert_id=alert_id,
                        link_status="active",
                        linked_scope="supply_node" if new_alert_issue_type.lower() == "parameter_issue" else "order",
                        source_node_id=new_alert_impacted_node_id or order.ship_to_node_id,
                        issue_type=new_alert_issue_type or None,
                        notes=new_alert_description or None,
                        created_at=now_iso,
                    )
                )
            order.alert_action_taken = "manual_alert_created"
            self._sync_alert_archive_state(alert_id)
        elif link_alert_id:
            existing_alert = self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == link_alert_id).first()
            if not existing_alert:
                raise ValueError(f"Alert not found: {link_alert_id}")
            existing_link = (
                self.db.query(ReplenishmentOrderAlertLink)
                .filter(
                    ReplenishmentOrderAlertLink.order_id == order_id,
                    ReplenishmentOrderAlertLink.alert_id == link_alert_id,
                )
                .first()
            )
            if existing_link:
                existing_link.link_status = "active"
                existing_link.fixed_at = None
                existing_link.fixed_by = None
            else:
                self.db.add(
                    ReplenishmentOrderAlertLink(
                        order_id=order_id,
                        alert_id=link_alert_id,
                        link_status="active",
                        linked_scope="order",
                        source_node_id=order.ship_to_node_id,
                        created_at=now_iso,
                    )
                )
            self._sync_alert_archive_state(link_alert_id)

        refreshed_active_links = (
            self.db.query(ReplenishmentOrderAlertLink)
            .filter(
                ReplenishmentOrderAlertLink.order_id == order_id,
                ReplenishmentOrderAlertLink.link_status == "active",
            )
            .order_by(ReplenishmentOrderAlertLink.created_at.asc(), ReplenishmentOrderAlertLink.id.asc())
            .all()
        )
        order.alert_id = (refreshed_active_links[0].alert_id if refreshed_active_links else "")

        detail_inputs = payload.get("details")
        detail_count_override: int | None = None
        details_replaced = False
        if detail_inputs is not None:
            aggregated: dict[tuple[str, str, str | None], float] = {}
            for row in list(detail_inputs):
                sku = str(row.get("sku") or "").strip()
                if not sku:
                    continue
                qty = float(row.get("order_qty") or 0.0)
                if qty < 0:
                    raise ValueError("order_qty cannot be negative.")
                d_ship_to = str(row.get("ship_to_node_id") or order.ship_to_node_id).strip() or order.ship_to_node_id
                d_ship_from = (str(row.get("ship_from_node_id") or order.ship_from_node_id or "").strip() or order.ship_from_node_id)
                key = (sku, d_ship_to, d_ship_from)
                aggregated[key] = aggregated.get(key, 0.0) + qty
            if not aggregated:
                raise ValueError("details must include at least one valid row.")

            old_qty = float(order.order_qty or 0.0)
            new_qty_value = round(sum(aggregated.values()), 2)
            order.order_qty = new_qty_value
            order.product_count = len(aggregated)
            order.sku = sorted({item[0] for item in aggregated})[0]
            first_line = next(iter(aggregated.keys()))
            order.ship_to_node_id = first_line[1]
            order.ship_from_node_id = first_line[2]
            unit_cost = (float(order.order_cost or 0.0) / old_qty) if old_qty else 3.5
            order.order_cost = round(unit_cost * new_qty_value, 2)

            self.db.query(ReplenishmentOrderDetail).filter(
                ReplenishmentOrderDetail.order_id == order_id
            ).delete(synchronize_session=False)
            # Flush delete before re-insert to avoid duplicate rows
            # from mixed pending insert/delete states in the same session.
            self.db.flush()
            for (sku, d_ship_to, d_ship_from), qty in aggregated.items():
                self.db.add(
                    ReplenishmentOrderDetail(
                        order_id=order_id,
                        sku=sku,
                        ship_to_node_id=d_ship_to,
                        ship_from_node_id=d_ship_from,
                        order_qty=round(qty, 2),
                    )
                )
            detail_count_override = len(aggregated)
            details_replaced = True

        new_qty = payload.get("order_qty")
        if detail_inputs is None and new_qty is not None:
            new_qty_value = round(float(new_qty), 2)
            if new_qty_value < 0:
                raise ValueError("order_qty cannot be negative.")
            old_qty = float(order.order_qty or 0.0)
            detail_rows = (
                self.db.query(ReplenishmentOrderDetail)
                .filter(ReplenishmentOrderDetail.order_id == order_id)
                .order_by(ReplenishmentOrderDetail.id.asc())
                .all()
            )
            if detail_rows:
                if old_qty > 0:
                    running = 0.0
                    for idx, row in enumerate(detail_rows):
                        if idx == len(detail_rows) - 1:
                            row.order_qty = round(new_qty_value - running, 2)
                        else:
                            scaled = round((float(row.order_qty or 0.0) / old_qty) * new_qty_value, 2)
                            row.order_qty = scaled
                            running += scaled
                else:
                    per = round(new_qty_value / len(detail_rows), 2)
                    for idx, row in enumerate(detail_rows):
                        row.order_qty = per
                    detail_rows[-1].order_qty = round(new_qty_value - sum(float(r.order_qty or 0.0) for r in detail_rows[:-1]), 2)
            order.order_qty = new_qty_value
            unit_cost = (float(order.order_cost or 0.0) / old_qty) if old_qty else 3.5
            order.order_cost = round(unit_cost * new_qty_value, 2)

        if payload.get("eta"):
            order.eta = str(payload.get("eta"))

        if not details_replaced:
            self._reconcile_order_details_for_order(order)
        self.db.commit()
        detail_count = detail_count_override if detail_count_override is not None else self.db.query(ReplenishmentOrderDetail).filter(ReplenishmentOrderDetail.order_id == order_id).count()
        return {
            "order_id": order_id,
            "message": "Order updated",
            "product_count": int(order.product_count),
            "order_qty": float(order.order_qty),
            "eta": order.eta,
            "detail_rows": int(detail_count),
        }
