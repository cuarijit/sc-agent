"""Follow-up interpretation — LLM call #2 (with deterministic fallback).

When the current turn has a `conversation_id` and a prior `AgentRun` row
exists for that conversation, this module refines the current prompt's scope
by merging it with the prior run's scope. The LLM path is reserved for richer
context interpretation; the deterministic fallback handles simple "what about
X" / "only at Y" / "narrow to Z" patterns.

Only this module, intent_parser.py, and response_composer.py may import
llm_service (a lint test enforces this).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from ...models import AgentRun
from ..llm_service import resolve_llm_selection
from .audit_logger import LlmCallEntry
from ._llm_client import call_llm, extract_json_object, resolve_api_key


_SKU_PATTERN = re.compile(r"\b([A-Z]{2,}-[A-Z0-9]{2,})\b")
_NODE_PATTERN = re.compile(r"\b([A-Z]{2,}-\d{2,}|[A-Z]{2,}\d{2,})\b")
_NARROW_PATTERNS = (
    re.compile(r"\bwhat about\s+([A-Z0-9\-]+)\b", re.I),
    re.compile(r"\bonly at\s+([A-Z0-9\-]+)\b", re.I),
    re.compile(r"\bnarrow to\s+([A-Z0-9\-]+)\b", re.I),
    re.compile(r"\bjust\s+([A-Z0-9\-]+)\b", re.I),
)


@dataclass
class FollowUpRefinement:
    scope_delta: dict[str, Any] = field(default_factory=dict)
    prior_run_id: str | None = None
    prior_turn_index: int | None = None
    invoked_llm: bool = False
    fallback_reason: str | None = None
    warnings: list[str] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "scope_delta": self.scope_delta,
            "prior_run_id": self.prior_run_id,
            "prior_turn_index": self.prior_turn_index,
            "invoked_llm": self.invoked_llm,
            "fallback_reason": self.fallback_reason,
            "warnings": self.warnings,
        }


class FollowUpInterpreter:
    def __init__(
        self,
        db: Session,
        *,
        llm_policy: dict[str, Any] | None = None,
        api_key: str | None = None,
    ):
        self.db = db
        self.llm_policy = llm_policy or {}
        self.api_key = api_key
        self.call_site_config: dict[str, Any] = {}

    # ----------------------------------------------------------------- public

    def interpret(
        self,
        *,
        message: str,
        conversation_id: str | None,
        llm_call_log: list[LlmCallEntry] | None = None,
    ) -> FollowUpRefinement | None:
        if not conversation_id:
            return None
        prior = (
            self.db.query(AgentRun)
            .filter(AgentRun.conversation_id == conversation_id)
            .order_by(AgentRun.turn_index.desc(), AgentRun.created_at.desc())
            .first()
        )
        if prior is None:
            return None

        # Deterministic baseline first — this is always safe.
        refinement = self._deterministic_refine(message, prior)
        refinement.prior_run_id = prior.run_id
        refinement.prior_turn_index = int(prior.turn_index or 0)

        cfg = self.llm_policy.get("followup_interpret") if isinstance(self.llm_policy.get("followup_interpret"), dict) else {}
        merged_site = self.call_site_config or {}
        provider = (
            merged_site.get("provider_default")
            or merged_site.get("provider")
            or cfg.get("provider")
            or "openai"
        )
        effective_key = resolve_api_key(provider=provider, user_supplied=self.api_key)

        if not effective_key:
            if llm_call_log is not None:
                llm_call_log.append(
                    LlmCallEntry(
                        call_site="followup_interpret",
                        provider=None,
                        model=None,
                        latency_ms=0,
                        error="no_api_key",
                    )
                )
            return refinement

        prior_scope = self._load_scope(prior)
        system_prompt = (
            merged_site.get("system_prompt")
            or cfg.get("system_prompt")
            or _FOLLOWUP_SYSTEM_PROMPT
        )
        model = (
            merged_site.get("model_default")
            or merged_site.get("model")
            or cfg.get("model")
            or "gpt-4.1-mini"
        )
        temperature = merged_site.get("temperature")
        if temperature is None:
            temperature = cfg.get("temperature")
        max_tokens = merged_site.get("max_tokens") or cfg.get("max_tokens") or 250
        result = call_llm(
            provider=provider,
            model=model,
            api_key=effective_key,
            system_prompt=system_prompt,
            user_prompt=json.dumps(
                {
                    "prior_scope": prior_scope,
                    "prior_intent_mode": prior.intent_mode,
                    "new_message": message,
                },
                default=str,
            ),
            temperature=float(temperature or 0.0),
            max_tokens=int(max_tokens),
        )
        if llm_call_log is not None:
            llm_call_log.append(
                LlmCallEntry(
                    call_site="followup_interpret",
                    provider=result.provider,
                    model=result.model,
                    tokens_in=result.tokens_in,
                    tokens_out=result.tokens_out,
                    latency_ms=result.latency_ms,
                    error=result.error,
                )
            )
        if result.error or not result.text:
            return refinement

        llm_delta = extract_json_object(result.text)
        if isinstance(llm_delta, dict):
            _merge_llm_delta_into(refinement, llm_delta)
            refinement.invoked_llm = True
            refinement.fallback_reason = None
        return refinement

    # -------------------------------------------------------- deterministic

    def _deterministic_refine(
        self,
        message: str,
        prior: AgentRun,
    ) -> FollowUpRefinement:
        warnings: list[str] = []
        prior_scope = self._load_scope(prior)

        delta: dict[str, Any] = {}

        # Narrow-to patterns: "What about CDC-001 only?" / "narrow to BAR-002"
        narrowed: list[str] = []
        for pattern in _NARROW_PATTERNS:
            for match in pattern.finditer(message):
                token = match.group(1)
                if token:
                    narrowed.append(token)
        if narrowed:
            # Split into SKUs (ALPHA-ALNUM pairs) vs nodes (ALPHA-NUM).
            skus = sorted(set(_SKU_PATTERN.findall(" ".join(narrowed))))
            nodes = sorted(set(_NODE_PATTERN.findall(" ".join(narrowed))))
            nodes = [n for n in nodes if n not in skus]
            if skus:
                delta["skus"] = skus
            if nodes:
                delta["nodes"] = nodes
        else:
            # Broad SKU / node mentions in the follow-up override the prior scope.
            skus = sorted(set(_SKU_PATTERN.findall(message)))
            nodes = sorted(set(_NODE_PATTERN.findall(message)))
            nodes = [n for n in nodes if n not in skus]
            if skus:
                delta["skus"] = skus
            if nodes:
                delta["nodes"] = nodes

        # Carry prior week range forward unless the current message says otherwise.
        prior_weeks = prior_scope.get("week_offsets")
        if prior_weeks and not any(k in message.lower() for k in ("week", "horizon")):
            delta.setdefault("inherit_week_range", True)
            delta.setdefault("week_offsets_prior", prior_weeks)

        return FollowUpRefinement(
            scope_delta=delta,
            warnings=warnings,
            fallback_reason="no_llm_configured",
        )

    # ----------------------------------------------------------------- helpers

    @staticmethod
    def _load_scope(prior: AgentRun) -> dict[str, Any]:
        raw = prior.scope_json or "{}"
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}


_FOLLOWUP_SYSTEM_PROMPT = (
    "You refine a prior chat turn's scope based on a new user message. "
    "Return STRICT JSON with keys:\n"
    "  skus: array of uppercase SKUs mentioned in the new message\n"
    "  nodes: array of node ids mentioned in the new message\n"
    "  inherit_week_range: boolean — true if the new message doesn't mention weeks\n"
    "  week_offsets_prior: optional array of int (copy from prior_scope when inheriting)\n"
    "Respond with ONLY a JSON object."
)


def _merge_llm_delta_into(refinement: "FollowUpRefinement", delta: dict[str, Any]) -> None:
    existing = refinement.scope_delta
    if isinstance(delta.get("skus"), list):
        skus = [str(s).strip() for s in delta["skus"] if str(s).strip()]
        if skus:
            existing["skus"] = sorted(set(skus))
    if isinstance(delta.get("nodes"), list):
        nodes = [str(n).strip() for n in delta["nodes"] if str(n).strip()]
        if nodes:
            existing["nodes"] = sorted(set(nodes))
    if delta.get("inherit_week_range") is not None:
        existing["inherit_week_range"] = bool(delta.get("inherit_week_range"))
    if isinstance(delta.get("week_offsets_prior"), list):
        existing["week_offsets_prior"] = [int(x) for x in delta["week_offsets_prior"] if str(x).isdigit()]
