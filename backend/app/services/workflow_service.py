from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..models import (
    NetworkAgentResult,
    NetworkAlert,
    NetworkForecastWeekly,
    NetworkSourcingRule,
    ReplenishmentOrder,
    ReplenishmentOrderDetail,
)
from .inventory_projection_service import InventoryProjectionService


def _utc_now() -> str:
    return datetime.utcnow().isoformat()


def _safe_alert_suffix(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", value.strip())
    return cleaned.strip("-").upper()[:64] or "NA"


class WorkflowService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.projection = InventoryProjectionService(db)

    @staticmethod
    def _parse_action_json(raw: str | None) -> dict[str, object]:
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    def _alert_status(self, row: NetworkAlert) -> str:
        meta = self._parse_action_json(row.recommended_action_json)
        workflow = meta.get("workflow")
        if isinstance(workflow, dict):
            status = str(workflow.get("status") or "").strip().lower()
            if status in {"active", "archived"}:
                return status
        return "active"

    def _set_alert_workflow(
        self,
        row: NetworkAlert,
        *,
        status: str,
        resolution_action: str | None = None,
        note: str | None = None,
        resolved_by: str = "planner",
    ) -> None:
        meta = self._parse_action_json(row.recommended_action_json)
        workflow = meta.get("workflow")
        if not isinstance(workflow, dict):
            workflow = {}
        workflow["status"] = status
        if status == "archived":
            workflow["resolved_at"] = _utc_now()
            workflow["resolved_by"] = resolved_by
            if resolution_action:
                workflow["resolution_action"] = resolution_action
            if note:
                workflow["resolution_note"] = note
        else:
            workflow.pop("resolved_at", None)
            workflow.pop("resolved_by", None)
            workflow.pop("resolution_action", None)
            workflow.pop("resolution_note", None)
        meta["workflow"] = workflow
        row.recommended_action_json = json.dumps(meta)

    def _projected_stockout_week(self, sku: str, node: str) -> int | None:
        payload = self.projection.get_projection(sku=sku, location=node, include_demo_examples=False)
        weeks = payload.get("weeks") or []
        for week in weeks:
            if float(week.get("projected_on_hand_actual_qty", 0.0)) < 0:
                return int(week.get("week_offset", 0))
        return None

    def recompute_service_alerts(self) -> dict[str, int]:
        sourcing_pairs = sorted({(row.sku, row.dest_node_id) for row in self.db.query(NetworkSourcingRule).all()})
        created = 0
        updated = 0
        archived = 0
        for sku, node in sourcing_pairs:
            first_stockout_week = self._projected_stockout_week(sku, node)
            alert_id = f"ALERT-SVC-{_safe_alert_suffix(sku)}-{_safe_alert_suffix(node)}"
            existing = self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == alert_id).first()
            if first_stockout_week is None:
                if existing and self._alert_status(existing) == "active":
                    self._set_alert_workflow(existing, status="archived", resolution_action="auto_no_stockout")
                    archived += 1
                continue

            severity = "critical" if first_stockout_week <= 2 else "warning" if first_stockout_week <= 4 else "info"
            title = f"Projected stockout risk - {sku} @ {node}"
            description = (
                f"Projected on-hand inventory for {sku} at {node} is expected to go below zero in week "
                f"{first_stockout_week}. Severity follows Network Alert Rules (1-2 weeks critical, 2-4 weeks warning)."
            )
            action = {
                "association": "sku_node",
                "action": "projected_inventory_mitigation",
                "projected_stockout_week": first_stockout_week,
                "workflow": {"status": "active"},
            }
            if existing is None:
                self.db.add(
                    NetworkAlert(
                        alert_id=alert_id,
                        alert_type="service_issue_stockout",
                        severity=severity,
                        title=title,
                        description=description,
                        impacted_node_id=node,
                        impacted_sku=sku,
                        impacted_lane_id=None,
                        effective_from=datetime.utcnow().date().isoformat(),
                        effective_to=(datetime.utcnow().date() + timedelta(days=30)).isoformat(),
                        recommended_action_json=json.dumps(action),
                    )
                )
                created += 1
                continue

            existing.alert_type = "service_issue_stockout"
            existing.severity = severity
            existing.title = title
            existing.description = description
            existing.impacted_node_id = node
            existing.impacted_sku = sku
            existing.effective_from = datetime.utcnow().date().isoformat()
            existing.effective_to = (datetime.utcnow().date() + timedelta(days=30)).isoformat()
            self._set_alert_workflow(existing, status="active")
            meta = self._parse_action_json(existing.recommended_action_json)
            meta["projected_stockout_week"] = first_stockout_week
            existing.recommended_action_json = json.dumps(meta)
            updated += 1

        self.db.commit()
        return {"created": created, "updated": updated, "archived": archived}

    def list_alerts(self, status: str = "active") -> list[dict[str, object]]:
        status = status.lower().strip() or "active"
        rows = self.db.query(NetworkAlert).order_by(NetworkAlert.severity.desc(), NetworkAlert.alert_id.asc()).all()
        output: list[dict[str, object]] = []
        for row in rows:
            row_status = self._alert_status(row)
            if status != "all" and row_status != status:
                continue
            meta = self._parse_action_json(row.recommended_action_json)
            workflow = meta.get("workflow") if isinstance(meta.get("workflow"), dict) else {}
            output.append(
                {
                    "alert_id": row.alert_id,
                    "alert_type": row.alert_type,
                    "severity": row.severity,
                    "title": row.title,
                    "description": row.description,
                    "impacted_node_id": row.impacted_node_id,
                    "impacted_sku": row.impacted_sku,
                    "effective_from": row.effective_from,
                    "effective_to": row.effective_to,
                    "status": row_status,
                    "projected_stockout_week": meta.get("projected_stockout_week"),
                    "resolved_at": workflow.get("resolved_at") if isinstance(workflow, dict) else None,
                    "resolved_by": workflow.get("resolved_by") if isinstance(workflow, dict) else None,
                    "resolution_action": workflow.get("resolution_action") if isinstance(workflow, dict) else None,
                }
            )
        return output

    def resolve_alert(self, alert_id: str, action: str = "manual_resolution", note: str | None = None) -> dict[str, object]:
        row = self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == alert_id).first()
        if row is None:
            raise KeyError(alert_id)
        self._set_alert_workflow(row, status="archived", resolution_action=action, note=note)
        self.db.commit()
        return {"alert_id": alert_id, "status": "archived"}

    def resolve_alert_from_order(self, order_id: str, alert_id: str, note: str | None = None) -> dict[str, object]:
        order = self.db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id == order_id).first()
        if order is None:
            raise KeyError(order_id)
        order.status = "resolved"
        self.resolve_alert(alert_id, action="order_edit_resolution", note=note)
        self.db.commit()
        return {"order_id": order_id, "alert_id": alert_id, "status": "resolved"}

    def analyze_inventory_alerts(self, alert_ids: list[str] | None = None) -> dict[str, object]:
        alerts = self.list_alerts(status="active")
        critical = [item for item in alerts if str(item["severity"]).lower() == "critical"]
        selected = [item for item in critical if not alert_ids or item["alert_id"] in alert_ids]
        selected_ids = [str(item["alert_id"]) for item in selected]
        order_rows = (
            self.db.query(ReplenishmentOrder)
            .filter(ReplenishmentOrder.alert_id.in_(selected_ids))
            .order_by(ReplenishmentOrder.delivery_delay_days.desc(), ReplenishmentOrder.order_cost.desc())
            .all()
            if selected_ids
            else []
        )
        impacted_orders = [
            {
                "order_id": row.order_id,
                "alert_id": row.alert_id,
                "sku": row.sku,
                "ship_to_node_id": row.ship_to_node_id,
                "lead_time_days": row.lead_time_days,
                "order_qty": row.order_qty,
                "order_cost": row.order_cost,
                "delivery_delay_days": row.delivery_delay_days,
            }
            for row in order_rows[:40]
        ]
        total_cost = sum(float(item["order_cost"]) for item in impacted_orders)
        options = [
            {"id": "move_order", "label": "Move delivery date by 1 week"},
            {"id": "change_demand", "label": "Adjust demand for impacted weeks"},
            {"id": "change_order_qty", "label": "Increase impacted order quantity"},
        ]
        return {
            "alerts": selected,
            "impacted_orders": impacted_orders,
            "current_lead_time_days": round(sum(item["lead_time_days"] for item in impacted_orders) / max(1, len(impacted_orders)), 2) if impacted_orders else 0.0,
            "total_impacted_cost": round(total_cost, 2),
            "options": options,
        }

    def apply_inventory_action(
        self,
        *,
        alert_ids: list[str],
        option_id: str,
        use_neighbor: bool,
        neighbor_node_id: str | None = None,
        order_updates: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        updates = order_updates or []
        if option_id == "change_order_qty":
            for item in updates:
                order_id = str(item.get("order_id") or "").strip()
                if not order_id:
                    continue
                row = self.db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id == order_id).first()
                if row is None:
                    continue
                if item.get("order_qty") is not None:
                    row.order_qty = float(item["order_qty"])
                if item.get("eta"):
                    row.eta = str(item["eta"])
                details = self.db.query(ReplenishmentOrderDetail).filter(ReplenishmentOrderDetail.order_id == order_id).all()
                if details and item.get("order_qty") is not None:
                    split = float(item["order_qty"]) / max(1, len(details))
                    for d in details:
                        d.order_qty = split
        elif option_id == "move_order":
            for item in updates:
                order_id = str(item.get("order_id") or "").strip()
                if not order_id:
                    continue
                row = self.db.query(ReplenishmentOrder).filter(ReplenishmentOrder.order_id == order_id).first()
                if row is None:
                    continue
                eta = row.eta.split("T")[0]
                try:
                    row.eta = (datetime.fromisoformat(eta) + timedelta(days=7)).date().isoformat()
                except ValueError:
                    continue
        elif option_id == "change_demand":
            for alert_id in alert_ids:
                alert = self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == alert_id).first()
                if not alert or not alert.impacted_sku or not alert.impacted_node_id:
                    continue
                rows = (
                    self.db.query(NetworkForecastWeekly)
                    .filter(
                        NetworkForecastWeekly.sku == alert.impacted_sku,
                        NetworkForecastWeekly.node_id == alert.impacted_node_id,
                    )
                    .all()
                )
                for idx, row in enumerate(rows):
                    if idx < 4:
                        row.forecast_qty = max(0.0, round(float(row.forecast_qty) * 0.9, 2))

        created_transfer_order = None
        if use_neighbor:
            first_alert = self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == alert_ids[0]).first() if alert_ids else None
            if first_alert and first_alert.impacted_sku and first_alert.impacted_node_id:
                new_id = f"RO-AUTO-{self.db.query(ReplenishmentOrder).count() + 1:05d}"
                created_transfer_order = new_id
                self.db.add(
                    ReplenishmentOrder(
                        order_id=new_id,
                        alert_id=first_alert.alert_id,
                        order_type="Stock Transfer",
                        status="created",
                        is_exception=False,
                        exception_reason=None,
                        alert_action_taken="autonomous_neighbor_transfer",
                        order_created_by="agent",
                        ship_to_node_id=first_alert.impacted_node_id,
                        ship_from_node_id=neighbor_node_id or "RDC-001",
                        sku=first_alert.impacted_sku,
                        product_count=1,
                        order_qty=120.0,
                        region=None,
                        order_cost=540.0,
                        lead_time_days=2.0,
                        delivery_delay_days=0.0,
                        logistics_impact="low",
                        production_impact="low",
                        transit_impact="low",
                        update_possible=True,
                        created_at=_utc_now(),
                        eta=(datetime.utcnow().date() + timedelta(days=3)).isoformat(),
                    )
                )
                self.db.add(
                    ReplenishmentOrderDetail(
                        order_id=new_id,
                        sku=first_alert.impacted_sku,
                        ship_to_node_id=first_alert.impacted_node_id,
                        ship_from_node_id=neighbor_node_id or "RDC-001",
                        order_qty=120.0,
                    )
                )

        for alert_id in alert_ids:
            row = self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == alert_id).first()
            if row:
                self._set_alert_workflow(row, status="archived", resolution_action=option_id)
        self.db.commit()
        message = (
            f"Applied {option_id} to {len(alert_ids)} alert(s). "
            + (f"Created transfer order {created_transfer_order} and archived impacted alerts." if created_transfer_order else "Archived impacted alerts.")
        )
        return {"status": "ok", "message": message, "created_transfer_order": created_transfer_order}

    def trigger_autonomous(self) -> dict[str, object]:
        active_critical = [item for item in self.list_alerts(status="active") if str(item["severity"]).lower() == "critical"][:3]
        run_id = f"AUTO-RUN-{self.db.query(NetworkAgentResult).count() + 1:05d}"
        steps = [
            {"step": "identify_critical_alerts", "status": "success"},
            {"step": "compute_impacted_orders", "status": "success"},
            {"step": "generate_resolution_options", "status": "executing"},
            {"step": "apply_resolution", "status": "pending"},
        ]
        status = "executing" if active_critical else "needs_more_info"
        payload = {
            "run_id": run_id,
            "status": status,
            "title": f"Autonomous mitigation run for {len(active_critical)} critical alerts",
            "alerts": active_critical,
            "steps": steps,
            "created_at": _utc_now(),
        }
        self.db.add(
            NetworkAgentResult(
                agent_run_id=run_id,
                scenario_id=None,
                question="autonomous_inventory_diagnostic_trigger",
                response_json=json.dumps(payload),
                staged_changes_json=None,
                recommended_option=None,
                requires_approval=status == "needs_more_info",
            )
        )
        self.db.commit()
        return payload

    def list_autonomous_actions(self) -> list[dict[str, object]]:
        rows = (
            self.db.query(NetworkAgentResult)
            .filter(NetworkAgentResult.question == "autonomous_inventory_diagnostic_trigger")
            .order_by(NetworkAgentResult.agent_run_id.desc())
            .all()
        )
        output: list[dict[str, object]] = []
        for row in rows:
            try:
                payload = json.loads(row.response_json or "{}")
            except Exception:
                payload = {}
            output.append(
                {
                    "run_id": row.agent_run_id,
                    "title": payload.get("title") or "Autonomous action",
                    "status": payload.get("status") or "unknown",
                    "created_at": payload.get("created_at"),
                    "steps": payload.get("steps") or [],
                }
            )
        return output

    def get_autonomous_action(self, run_id: str) -> dict[str, object]:
        row = self.db.query(NetworkAgentResult).filter(NetworkAgentResult.agent_run_id == run_id).first()
        if row is None:
            raise KeyError(run_id)
        try:
            payload = json.loads(row.response_json or "{}")
        except Exception:
            payload = {}
        return payload
