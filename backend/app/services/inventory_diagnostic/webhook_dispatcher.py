"""HTTP webhook dispatcher for queued action plans.

Policy:
- Only dispatches plans with `delivery_mode="webhook"` and `plan_status="queued"`.
- Validates the webhook URL shape before attempting a request.
- Never imports ERP-specific libraries. The body is opaque.
- A test-friendly `send_fn` hook lets pytest inject a stub instead of making
  real HTTP calls.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from ...models import AgentActionPlan


_ALLOWED_SCHEMES = ("http", "https")


@dataclass
class DispatchResult:
    plan_id: str
    status: str  # sent | failed | skipped
    status_code: int | None
    error: str | None
    attempts: int


class WebhookDispatcher:
    def __init__(self, db: Session, *, send_fn: Callable[[str, dict[str, Any]], tuple[int, str]] | None = None):
        self.db = db
        self.send_fn = send_fn or _default_send_fn

    # ----------------------------------------------------------------- public

    def dispatch(self, plan_id: str) -> DispatchResult:
        row = self.db.query(AgentActionPlan).filter(AgentActionPlan.plan_id == plan_id).first()
        if row is None:
            raise ValueError(f"Action plan '{plan_id}' not found.")
        if row.delivery_mode != "webhook":
            return DispatchResult(
                plan_id=plan_id,
                status="skipped",
                status_code=None,
                error=f"delivery_mode '{row.delivery_mode}' does not require a webhook dispatch.",
                attempts=int(row.dispatch_attempts or 0),
            )
        if row.plan_status not in ("queued", "failed"):
            return DispatchResult(
                plan_id=plan_id,
                status="skipped",
                status_code=None,
                error=f"plan_status '{row.plan_status}' not eligible for dispatch.",
                attempts=int(row.dispatch_attempts or 0),
            )
        webhook_url = row.webhook_url
        if not webhook_url or not self._is_valid_url(webhook_url):
            return self._mark_failed(row, status_code=None, error="Invalid webhook URL.")

        try:
            payload = json.loads(row.payload_json or "{}") or {}
        except json.JSONDecodeError:
            payload = {}

        try:
            status_code, error = self.send_fn(webhook_url, payload)
        except Exception as exc:
            return self._mark_failed(row, status_code=None, error=str(exc))

        if 200 <= (status_code or 0) < 300:
            row.plan_status = "sent"
            row.dispatch_attempts = int(row.dispatch_attempts or 0) + 1
            row.last_dispatch_at = _now_iso()
            row.last_error = None
            self.db.commit()
            return DispatchResult(
                plan_id=plan_id,
                status="sent",
                status_code=status_code,
                error=None,
                attempts=int(row.dispatch_attempts),
            )
        return self._mark_failed(row, status_code=status_code, error=error or f"HTTP {status_code}")

    # ----------------------------------------------------------------- helpers

    def _mark_failed(
        self, row: AgentActionPlan, *, status_code: int | None, error: str
    ) -> DispatchResult:
        row.plan_status = "failed"
        row.dispatch_attempts = int(row.dispatch_attempts or 0) + 1
        row.last_dispatch_at = _now_iso()
        row.last_error = error
        self.db.commit()
        return DispatchResult(
            plan_id=row.plan_id,
            status="failed",
            status_code=status_code,
            error=error,
            attempts=int(row.dispatch_attempts),
        )

    @staticmethod
    def _is_valid_url(url: str) -> bool:
        if not isinstance(url, str):
            return False
        lowered = url.strip().lower()
        return any(lowered.startswith(f"{s}://") for s in _ALLOWED_SCHEMES)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _default_send_fn(url: str, payload: dict[str, Any]) -> tuple[int, str]:
    """Deferred import + opaque POST. In tests, inject a stub via `send_fn`."""
    try:
        import httpx
    except ImportError:  # pragma: no cover - dev environments without httpx
        return 0, "httpx not installed"
    try:
        response = httpx.post(url, json=payload, timeout=10.0)
        return response.status_code, response.text
    except Exception as exc:
        return 0, str(exc)
