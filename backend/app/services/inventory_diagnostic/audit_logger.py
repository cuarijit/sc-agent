"""Write one AgentRun row per chat turn.

All agent activity must produce a traceable audit record containing:
- agent_type + agent_type_version at the moment of the run,
- the instance's data bindings snapshot,
- the scoring profile actually applied,
- every LLM call made (up to 3),
- the structured output JSON and narrative.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ...models import AgentRun


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_dump(value: Any, default: str = "{}") -> str:
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return default


@dataclass
class LlmCallEntry:
    call_site: str
    provider: str | None
    model: str | None
    tokens_in: int | None = None
    tokens_out: int | None = None
    latency_ms: int | None = None
    error: str | None = None


@dataclass
class AuditRecord:
    run_id: str
    instance_id: str
    agent_type: str
    agent_type_version: int
    conversation_id: str | None
    turn_index: int
    intent_mode: str
    user_prompt: str
    parsed_intent: dict[str, Any] = field(default_factory=dict)
    scope: dict[str, Any] = field(default_factory=dict)
    bindings_snapshot: list[dict[str, Any]] = field(default_factory=list)
    disabled_capabilities: dict[str, list[str]] = field(default_factory=dict)
    scoring_profile_used: dict[str, Any] = field(default_factory=dict)
    inputs_digest: dict[str, Any] = field(default_factory=dict)
    structured_output: dict[str, Any] = field(default_factory=dict)
    narrative_text: str = ""
    llm_calls: list[LlmCallEntry] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    status: str = "ok"
    created_at: str = field(default_factory=_now_iso)
    duration_ms: int = 0

    def new_run_id(self) -> str:
        self.run_id = str(uuid.uuid4())
        return self.run_id

    def log_llm_call(self, entry: LlmCallEntry) -> None:
        self.llm_calls.append(entry)

    def to_orm(self) -> AgentRun:
        return AgentRun(
            run_id=self.run_id,
            instance_id=self.instance_id,
            agent_type=self.agent_type,
            agent_type_version=int(self.agent_type_version or 0),
            conversation_id=self.conversation_id,
            turn_index=int(self.turn_index or 0),
            intent_mode=self.intent_mode,
            user_prompt=self.user_prompt,
            parsed_intent_json=_json_dump(self.parsed_intent),
            scope_json=_json_dump(self.scope),
            bindings_snapshot_json=_json_dump(self.bindings_snapshot, default="[]"),
            disabled_capabilities_json=_json_dump(self.disabled_capabilities),
            scoring_profile_used_json=_json_dump(self.scoring_profile_used),
            inputs_digest_json=_json_dump(self.inputs_digest),
            structured_output_json=_json_dump(self.structured_output),
            narrative_text=self.narrative_text,
            llm_calls_json=_json_dump([asdict(c) for c in self.llm_calls], default="[]"),
            warnings_json=_json_dump(self.warnings, default="[]"),
            status=self.status,
            created_at=self.created_at,
            duration_ms=int(self.duration_ms or 0),
        )


class AuditLogger:
    def __init__(self, db: Session):
        self.db = db

    def write(self, record: AuditRecord) -> str:
        if not record.run_id:
            record.new_run_id()
        row = record.to_orm()
        self.db.add(row)
        self.db.commit()
        return record.run_id

    def get(self, run_id: str) -> dict[str, Any] | None:
        row = self.db.query(AgentRun).filter(AgentRun.run_id == run_id).first()
        if row is None:
            return None
        return self._to_payload(row)

    @staticmethod
    def _to_payload(row: AgentRun) -> dict[str, Any]:
        def load(raw: str | None, default):
            if not raw:
                return default
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return default

        return {
            "run_id": row.run_id,
            "instance_id": row.instance_id,
            "agent_type": row.agent_type,
            "agent_type_version": int(row.agent_type_version or 0),
            "conversation_id": row.conversation_id,
            "turn_index": int(row.turn_index or 0),
            "intent_mode": row.intent_mode,
            "user_prompt": row.user_prompt,
            "parsed_intent": load(row.parsed_intent_json, {}),
            "scope": load(row.scope_json, {}),
            "bindings_snapshot": load(row.bindings_snapshot_json, []),
            "disabled_capabilities": load(row.disabled_capabilities_json, {}),
            "scoring_profile_used": load(row.scoring_profile_used_json, {}),
            "inputs_digest": load(row.inputs_digest_json, {}),
            "structured_output": load(row.structured_output_json, {}),
            "narrative_text": row.narrative_text,
            "llm_calls": load(row.llm_calls_json, []),
            "warnings": load(row.warnings_json, []),
            "status": row.status,
            "created_at": row.created_at,
            "duration_ms": int(row.duration_ms or 0),
        }
