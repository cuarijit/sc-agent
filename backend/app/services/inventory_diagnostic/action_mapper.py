"""Map ranked resolution candidates to AgentActionPlan rows.

Policy:
- `solve` intent writes **draft** plans only.
- `execute` intent writes either **draft** (when `execute_mode.dispatch` is
  false, the default) or **queued** (when dispatch is enabled). The webhook
  dispatcher transitions queued → sent/failed.
- `show`, `diagnose`, `simulate` never produce action plans.
- The set of action templates available per intent is gated by
  `default_config.action_permissions_per_intent`.
- This module NEVER writes to ERP tables; plans are opaque payloads.
"""
from __future__ import annotations

import csv
import io
import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ...models import AgentActionPlan
from .resolution_generator import ResolutionCandidate


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_dump(value: Any, default: str = "{}") -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return default


@dataclass
class PlannedAction:
    plan_id: str
    run_id: str
    instance_id: str
    plan_status: str
    action_template_key: str
    target_system: str | None
    delivery_mode: str
    webhook_url: str | None
    payload: dict[str, Any]

    def to_payload(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "run_id": self.run_id,
            "instance_id": self.instance_id,
            "plan_status": self.plan_status,
            "action_template_key": self.action_template_key,
            "target_system": self.target_system,
            "delivery_mode": self.delivery_mode,
            "webhook_url": self.webhook_url,
            "payload": self.payload,
        }


class ActionMapper:
    """Build action plan rows from top-K ranked resolutions."""

    def __init__(
        self,
        db: Session,
        *,
        action_templates: dict[str, dict[str, Any]] | None = None,
        permissions_per_intent: dict[str, list[str]] | None = None,
        execute_mode: dict[str, Any] | None = None,
        max_plans_per_run: int = 10,
    ):
        self.db = db
        self.templates = action_templates or {}
        self.permissions = permissions_per_intent or {}
        self.execute_mode = execute_mode or {}
        self.max_plans_per_run = max_plans_per_run

    # ----------------------------------------------------------------- public

    def build_plans(
        self,
        *,
        run_id: str,
        instance_id: str,
        intent_mode: str,
        resolutions: list[ResolutionCandidate],
        requested_action_keys: list[str] | None = None,
    ) -> list[PlannedAction]:
        if intent_mode not in ("solve", "execute"):
            return []
        allowed = set(self.permissions.get(intent_mode) or [])
        if not allowed:
            return []

        # Default selection: every allowed action template emits a row per top resolution.
        action_keys = [
            k for k in (requested_action_keys or list(allowed))
            if k in allowed and k in self.templates
        ]
        if not action_keys:
            raise PermissionError(
                f"No action templates permitted for intent '{intent_mode}'."
            )

        dispatch_enabled = bool(self.execute_mode.get("dispatch"))
        webhook_url = self.execute_mode.get("webhook_url")
        csv_path = self.execute_mode.get("csv_path") or "/tmp/inventory_diagnostic_actions"

        # Only the top-K by simulation score survive.
        top_resolutions = sorted(
            [r for r in resolutions if r.feasible],
            key=lambda r: (-(r.simulation_score or 0.0), (r.lead_time_days or 0.0), r.family_key),
        )[: self.max_plans_per_run]

        plans: list[PlannedAction] = []
        for resolution in top_resolutions:
            for action_key in action_keys:
                template_cfg = self.templates.get(action_key) or {}
                delivery_mode = str(template_cfg.get("delivery_mode") or "recommendation_record")
                target_system = template_cfg.get("target_system")
                payload = self._payload_for(resolution, action_key, template_cfg, run_id, csv_path)

                plan_status = "draft"
                if intent_mode == "execute" and dispatch_enabled and delivery_mode == "webhook":
                    plan_status = "queued"
                plans.append(
                    PlannedAction(
                        plan_id=str(uuid.uuid4()),
                        run_id=run_id,
                        instance_id=instance_id,
                        plan_status=plan_status,
                        action_template_key=action_key,
                        target_system=target_system,
                        delivery_mode=delivery_mode,
                        webhook_url=webhook_url if delivery_mode == "webhook" else None,
                        payload=payload,
                    )
                )

        # Persist plans and run any non-dispatch side effects (CSV export).
        for plan in plans:
            self._persist(plan)
            if plan.delivery_mode == "csv":
                self._write_csv(plan, csv_path)

        return plans

    # ----------------------------------------------------------------- helpers

    @staticmethod
    def _payload_for(
        resolution: ResolutionCandidate,
        action_key: str,
        template_cfg: dict[str, Any],
        run_id: str,
        csv_path: str,
    ) -> dict[str, Any]:
        base = {
            "run_id": run_id,
            "sku": resolution.sku,
            "from_node": resolution.from_node,
            "to_node": resolution.to_node,
            "family_key": resolution.family_key,
            "qty": resolution.qty,
            "breach_week": (resolution.problem_ref or {}).get("breach_week"),
            "resolves_breach": resolution.resolves_breach,
            "simulation_score": resolution.simulation_score,
            "evidence": resolution.evidence,
        }
        if action_key == "create_task":
            return {
                **base,
                "task_title": f"{resolution.family_key} {resolution.qty} units {resolution.sku}",
                "task_description": (
                    f"Transfer/adjust {resolution.qty} units of {resolution.sku} "
                    f"from {resolution.from_node or '—'} to {resolution.to_node}."
                ),
                "task_priority": "high" if resolution.resolves_breach else "medium",
            }
        if action_key == "create_recommendation_record":
            return {
                **base,
                "recommendation_category": "inventory_diagnostic",
                "explanation": (
                    f"{resolution.family_key} recommended for {resolution.sku} at {resolution.to_node}."
                ),
            }
        if action_key == "create_webhook_payload":
            return {
                "schema_ref": template_cfg.get("schema_ref"),
                **base,
            }
        if action_key == "export_action_csv":
            return {
                **base,
                "csv_row_path": str(Path(csv_path) / f"{run_id}.csv"),
                "columns": template_cfg.get("columns") or list(base.keys()),
            }
        return base

    def _persist(self, plan: PlannedAction) -> None:
        row = AgentActionPlan(
            plan_id=plan.plan_id,
            run_id=plan.run_id,
            instance_id=plan.instance_id,
            plan_status=plan.plan_status,
            action_template_key=plan.action_template_key,
            target_system=plan.target_system,
            delivery_mode=plan.delivery_mode,
            webhook_url=plan.webhook_url,
            payload_json=_json_dump(plan.payload),
            dispatch_attempts=0,
            last_dispatch_at=None,
            last_error=None,
            created_at=_now_iso(),
        )
        self.db.add(row)
        self.db.commit()

    @staticmethod
    def _write_csv(plan: PlannedAction, csv_path_base: str) -> None:
        try:
            folder = Path(csv_path_base)
            folder.mkdir(parents=True, exist_ok=True)
            target = folder / f"{plan.run_id}.csv"
            columns = list(plan.payload.get("columns") or plan.payload.keys())
            row = {k: plan.payload.get(k) for k in columns}
            header_needed = not target.exists()
            with target.open("a", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
                if header_needed:
                    writer.writeheader()
                writer.writerow(row)
        except OSError:
            # CSV is a best-effort side effect; errors don't invalidate the plan row.
            pass


class ActionPlanRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_for_run(self, run_id: str) -> list[dict[str, Any]]:
        rows = (
            self.db.query(AgentActionPlan)
            .filter(AgentActionPlan.run_id == run_id)
            .order_by(AgentActionPlan.created_at.asc())
            .all()
        )
        return [self._to_payload(r) for r in rows]

    def get(self, plan_id: str) -> dict[str, Any] | None:
        row = self.db.query(AgentActionPlan).filter(AgentActionPlan.plan_id == plan_id).first()
        if row is None:
            return None
        return self._to_payload(row)

    @staticmethod
    def _to_payload(row: AgentActionPlan) -> dict[str, Any]:
        return {
            "plan_id": row.plan_id,
            "run_id": row.run_id,
            "instance_id": row.instance_id,
            "plan_status": row.plan_status,
            "action_template_key": row.action_template_key,
            "target_system": row.target_system,
            "delivery_mode": row.delivery_mode,
            "webhook_url": row.webhook_url,
            "payload": _json_load_dict(row.payload_json),
            "dispatch_attempts": int(row.dispatch_attempts or 0),
            "last_dispatch_at": row.last_dispatch_at,
            "last_error": row.last_error,
            "created_at": row.created_at,
        }


def _json_load_dict(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
