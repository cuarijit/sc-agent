"""Record one AgentRunStepArtifact per pipeline stage.

The runner wraps each major step with the context manager below; the recorder
collects input / output digests, row counts, sample rows (capped), warnings,
and any LLM call metadata. At the end of a run it flushes everything to the
`agent_run_step_artifacts` table so the UI Pipeline tab can drill into each
stage.
"""
from __future__ import annotations

import contextlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterator

from sqlalchemy.orm import Session

from ...models import AgentRunStepArtifact


MAX_SAMPLE_ROWS = 20


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_dump(value: Any, default: str = "{}") -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return default


def _sample(rows: Any) -> list[Any]:
    """Clip list-shaped payloads to MAX_SAMPLE_ROWS for UI preview."""
    if isinstance(rows, list):
        return rows[:MAX_SAMPLE_ROWS]
    return []


@dataclass
class StepArtifact:
    step_id: str
    status: str = "ok"
    duration_ms: int = 0
    row_count: int = 0
    inputs: dict[str, Any] = field(default_factory=dict)
    outputs: dict[str, Any] = field(default_factory=dict)
    sample_rows: list[Any] = field(default_factory=list)
    llm_call: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def skipped(self, reason: str = "not_enabled_for_intent") -> "StepArtifact":
        self.status = "skipped"
        self.warnings.append(reason)
        return self

    def failed(self, error: str) -> "StepArtifact":
        self.status = "error"
        self.warnings.append(error)
        return self


class StepRecorder:
    """Accumulates StepArtifacts during a run, then flushes them all at once
    keyed to a run_id. Safe to use before the run_id is committed — artifacts
    only hit the DB when `flush(run_id)` is called."""

    def __init__(self) -> None:
        self._artifacts: list[StepArtifact] = []

    def artifact(self, step_id: str) -> StepArtifact:
        art = StepArtifact(step_id=step_id)
        self._artifacts.append(art)
        return art

    @contextlib.contextmanager
    def record(
        self,
        step_id: str,
        *,
        inputs: dict[str, Any] | None = None,
    ) -> Iterator[StepArtifact]:
        """Context manager — times the block and optionally captures inputs."""
        art = StepArtifact(step_id=step_id, inputs=dict(inputs or {}))
        start = time.perf_counter()
        try:
            yield art
        except Exception as exc:  # pragma: no cover — defensive
            art.status = "error"
            art.warnings.append(str(exc))
            raise
        finally:
            art.duration_ms = int((time.perf_counter() - start) * 1000)
            self._artifacts.append(art)

    def flush(self, db: Session, run_id: str) -> None:
        now = _now_iso()
        for idx, art in enumerate(self._artifacts):
            row = AgentRunStepArtifact(
                run_id=run_id,
                step_id=art.step_id,
                sequence=idx,
                status=art.status,
                duration_ms=int(art.duration_ms),
                row_count=int(art.row_count),
                input_digest_json=_json_dump(art.inputs),
                output_digest_json=_json_dump(art.outputs),
                sample_rows_json=_json_dump(_sample(art.sample_rows), default="[]"),
                llm_call_json=_json_dump(art.llm_call),
                warnings_json=_json_dump(art.warnings, default="[]"),
                created_at=now,
            )
            db.add(row)
        db.commit()

    def list(self) -> list[StepArtifact]:
        return list(self._artifacts)


def load_step_artifacts(db: Session, run_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(AgentRunStepArtifact)
        .filter(AgentRunStepArtifact.run_id == run_id)
        .order_by(AgentRunStepArtifact.sequence.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "run_id": r.run_id,
            "step_id": r.step_id,
            "sequence": int(r.sequence or 0),
            "status": r.status,
            "duration_ms": int(r.duration_ms or 0),
            "row_count": int(r.row_count or 0),
            "inputs": _json_load(r.input_digest_json, {}),
            "outputs": _json_load(r.output_digest_json, {}),
            "sample_rows": _json_load(r.sample_rows_json, []),
            "llm_call": _json_load(r.llm_call_json, {}),
            "warnings": _json_load(r.warnings_json, []),
            "created_at": r.created_at,
        }
        for r in rows
    ]


def _json_load(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default
