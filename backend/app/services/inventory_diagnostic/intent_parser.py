"""Intent parsing — LLM call #1 with a deterministic keyword fallback.

The LLM is asked to emit strict JSON of the form:
    {"intent_mode": "show|diagnose|solve|simulate|execute|clarify|out_of_scope",
     "scope": {"skus": [...], "nodes": [...], "regions": [...], "weeks": [...],
               "week_range": {"start": 1, "end": 6}, "focus": "..."},
     "confidence": 0.0..1.0}

When no api_key is available (or the LLM call fails), we fall back to a
deterministic keyword/regex table. That keeps the agent usable without an LLM
and gives us a reproducible baseline for testing.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

from ..llm_service import resolve_llm_selection
from .audit_logger import LlmCallEntry
from ._llm_client import call_llm, extract_json_object, resolve_api_key


INTENT_MODES = {"show", "diagnose", "solve", "simulate", "execute", "clarify", "out_of_scope"}

# Keyword tables for the deterministic fallback. Later keywords win, so order
# matters: "what if" (simulate) should win over "show" even if both appear.
_KEYWORD_PRIORITY: list[tuple[str, list[re.Pattern[str]]]] = [
    ("out_of_scope", [re.compile(r"\b(joke|poem|story|weather|movie|song)\b", re.I)]),
    ("show", [re.compile(r"\b(show|list|display|give me|summar(?:ise|ize))\b", re.I)]),
    ("diagnose", [re.compile(r"\b(diagnose|why|root cause|explain)\b", re.I)]),
    ("execute", [re.compile(r"\b(execute|dispatch|send to|push to)\b", re.I)]),
    ("simulate", [re.compile(r"\b(what if|simulate|scenario|if we)\b", re.I)]),
    ("solve", [
        re.compile(r"\b(what (?:can|should|do) (?:i|we)|how (?:can|do) (?:i|we)|where can i get|resolve|fix|recover)\b", re.I),
        re.compile(r"\b(stock[- ]?out|shortage)\b.*\bwhat\b", re.I),
    ]),
]

_WEEK_RANGE_PATTERNS = [
    re.compile(r"next\s+(\d+)\s+weeks?", re.I),
    re.compile(r"in\s+(\d+)\s+weeks?", re.I),
    re.compile(r"over\s+the\s+next\s+(\d+)\s+weeks?", re.I),
    re.compile(r"(\d+)[- ]week(?:\s+horizon)?", re.I),
]
_NEXT_WEEK_PATTERN = re.compile(r"\bnext\s+week\b", re.I)
_THIS_WEEK_PATTERN = re.compile(r"\bthis\s+week\b", re.I)

_SKU_PATTERN = re.compile(r"\b([A-Z]{2,}-[A-Z0-9]{2,})\b")
_NODE_PATTERN = re.compile(r"\b([A-Z]{2,}-\d{2,}|[A-Z]{2,}\d{2,})\b")


@dataclass
class ParsedIntent:
    intent_mode: str
    scope: dict[str, Any] = field(default_factory=dict)
    focus: str | None = None
    confidence: float = 0.5
    llm_invoked: bool = False
    fallback_reason: str | None = None
    warnings: list[str] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "intent_mode": self.intent_mode,
            "scope": self.scope,
            "focus": self.focus,
            "confidence": self.confidence,
            "llm_invoked": self.llm_invoked,
            "fallback_reason": self.fallback_reason,
            "warnings": self.warnings,
        }


class IntentParser:
    """Parse a user prompt into a structured intent.

    `api_key` + `llm_policy` enable the LLM path; otherwise deterministic only.
    """

    def __init__(
        self,
        *,
        llm_policy: dict[str, Any] | None = None,
        api_key: str | None = None,
        default_planning_horizon_weeks: int = 12,
    ):
        self.llm_policy = llm_policy or {}
        self.api_key = api_key
        self.default_horizon = int(default_planning_horizon_weeks or 12)
        # When the runner passes a merged call-site config (with system_prompt,
        # provider_default, model_default, temperature, max_tokens), we use
        # those values. They take precedence over llm_policy + module
        # constants so admins can retune via the template editor.
        self.call_site_config: dict[str, Any] = {}

    # ----------------------------------------------------------------- public

    def parse(self, prompt: str, llm_call_log: list[LlmCallEntry] | None = None) -> ParsedIntent:
        text = (prompt or "").strip()
        if not text:
            if llm_call_log is not None:
                llm_call_log.append(
                    LlmCallEntry(call_site="intent_parse", provider=None, model=None)
                )
            return ParsedIntent(
                intent_mode="clarify",
                focus="empty_prompt",
                confidence=0.0,
                warnings=["Prompt was empty."],
            )

        baseline = self._deterministic_parse(text)

        # Resolve the effective api_key: caller-supplied first, then env-var
        # fallback (OPENAI_API_KEY / ANTHROPIC_API_KEY) so an admin can enable
        # LLM globally via docker env without forcing every planner to paste
        # a key.
        cfg = self.llm_policy.get("intent_parse") if isinstance(self.llm_policy.get("intent_parse"), dict) else {}
        # Merged runtime config wins when provided; falls back to llm_policy.
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
                        call_site="intent_parse",
                        provider=None,
                        model=None,
                        latency_ms=0,
                        error="no_api_key",
                    )
                )
            return baseline

        # Try the LLM. On any failure, keep the deterministic baseline.
        system_prompt = (
            merged_site.get("system_prompt")
            or cfg.get("system_prompt")
            or _INTENT_SYSTEM_PROMPT
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
        max_tokens = merged_site.get("max_tokens") or cfg.get("max_tokens") or 400
        result = call_llm(
            provider=provider,
            model=model,
            api_key=effective_key,
            system_prompt=system_prompt,
            user_prompt=_build_intent_user_prompt(text, self.default_horizon),
            temperature=float(temperature or 0.0),
            max_tokens=int(max_tokens),
        )
        if llm_call_log is not None:
            llm_call_log.append(
                LlmCallEntry(
                    call_site="intent_parse",
                    provider=result.provider,
                    model=result.model,
                    tokens_in=result.tokens_in,
                    tokens_out=result.tokens_out,
                    latency_ms=result.latency_ms,
                    error=result.error,
                )
            )
        if result.error or not result.text:
            return baseline

        llm_parsed = extract_json_object(result.text)
        if not llm_parsed:
            return baseline

        merged = _merge_intents(baseline, llm_parsed)
        merged.llm_invoked = True
        merged.fallback_reason = None
        return merged

    # --------------------------------------------------------- deterministic

    def _deterministic_parse(self, text: str) -> ParsedIntent:
        warnings: list[str] = []
        intent_mode = self._classify_intent(text)

        scope: dict[str, Any] = {}
        week_range = self._extract_week_range(text)
        if week_range is not None:
            scope["week_range"] = week_range
        skus = sorted(set(_SKU_PATTERN.findall(text)))
        if skus:
            scope["skus"] = skus
        nodes = sorted(set(_NODE_PATTERN.findall(text)))
        # Filter out SKUs that also match NODE pattern
        nodes = [n for n in nodes if n not in skus]
        if nodes:
            scope["nodes"] = nodes

        focus = self._extract_focus(text)

        if intent_mode == "show" and not scope.get("week_range") and _NEXT_WEEK_PATTERN.search(text):
            scope["week_range"] = {"start": 1, "end": 1}
        if intent_mode == "show" and not scope.get("week_range") and _THIS_WEEK_PATTERN.search(text):
            scope["week_range"] = {"start": 0, "end": 0}
        if not scope.get("week_range"):
            # Default horizon for any intent that needs a window.
            scope["week_range"] = {"start": 1, "end": self.default_horizon}

        # Simple "order by" heuristic for prompt 2.
        if re.search(r"order\s+by\s+top\s+contributor", text, re.I):
            scope["sort_by"] = "top_contributor"

        # Simulation-delta hints for "what if" prompts.
        if intent_mode == "simulate":
            simulation_delta = self._extract_simulation_delta(text)
            if simulation_delta:
                scope["simulation_delta"] = simulation_delta

        return ParsedIntent(
            intent_mode=intent_mode,
            scope=scope,
            focus=focus,
            confidence=0.6,
            llm_invoked=False,
            fallback_reason="no_llm_configured",
            warnings=warnings,
        )

    @staticmethod
    def _extract_simulation_delta(text: str) -> dict[str, Any] | None:
        delta: dict[str, Any] = {}
        delay_match = re.search(r"delay (?:the )?(promo|promotion)(?: by (\d+) weeks?)?", text, re.I)
        if delay_match:
            delta["kind"] = "delay_promotion"
            delta["weeks"] = int(delay_match.group(2)) if delay_match.group(2) else 1
        transfer_match = re.search(r"transfer\s+(\d+)\s+units?(?: from ([A-Z0-9\-]+))?", text, re.I)
        if transfer_match:
            delta["kind"] = "transfer_units"
            delta["qty"] = int(transfer_match.group(1))
            if transfer_match.group(2):
                delta["from_node"] = transfer_match.group(2)
        pull_match = re.search(r"pull(?: forward)?\s+(\d+)\s+units?", text, re.I)
        if pull_match:
            delta["kind"] = "pull_forward"
            delta["qty"] = int(pull_match.group(1))
        return delta or None

    @staticmethod
    def _classify_intent(text: str) -> str:
        # Iterate in priority order; last match wins so the more specific
        # patterns (e.g. simulate, execute) override the broad "show".
        matched: str | None = None
        for mode, patterns in _KEYWORD_PRIORITY:
            if any(p.search(text) for p in patterns):
                matched = mode
        if matched is not None:
            return matched
        return "diagnose"

    @staticmethod
    def _extract_week_range(text: str) -> dict[str, int] | None:
        for pattern in _WEEK_RANGE_PATTERNS:
            m = pattern.search(text)
            if m:
                try:
                    end = int(m.group(1))
                    if end >= 1:
                        return {"start": 1, "end": end}
                except (TypeError, ValueError):
                    pass
        return None

    @staticmethod
    def _extract_focus(text: str) -> str | None:
        lowered = text.lower()
        if "promo" in lowered or "promotion" in lowered:
            return "promotion_supply_gap"
        if "stock out" in lowered or "stock-out" in lowered or "stockout" in lowered:
            return "stockout"
        if "risk" in lowered:
            return "inventory_risk"
        if "excess" in lowered:
            return "excess_inventory"
        return None


_INTENT_SYSTEM_PROMPT = (
    "You are the intent parser for an inventory diagnostic agent. "
    "Given a planner's natural-language question, return STRICT JSON with the keys:\n"
    "  intent_mode: one of 'show','diagnose','solve','simulate','execute','clarify','out_of_scope'\n"
    "  scope: object with optional keys:\n"
    "    skus: array of uppercase SKU strings mentioned explicitly (e.g. 'BAR-002')\n"
    "    nodes: array of node ids mentioned explicitly (e.g. 'STORE-001')\n"
    "    regions: array of region names\n"
    "    week_range: {start:int, end:int} (weeks relative to today; 1 = next week)\n"
    "    sort_by: optional 'top_contributor' if user asked to order by contributor\n"
    "    simulation_delta: when intent_mode is 'simulate', describe {kind, qty?, weeks?, from_node?}\n"
    "  focus: optional short string such as 'stockout','inventory_risk','promotion_supply_gap'\n"
    "  confidence: number in [0,1]\n"
    "Respond with ONLY a JSON object — no prose, no markdown fences."
)


def _build_intent_user_prompt(prompt: str, default_horizon: int) -> str:
    return (
        f"Planner question: {prompt}\n\n"
        f"If no explicit week window is mentioned and the prompt implies the planning horizon, "
        f"default to weeks 1..{default_horizon}. 'next week' means week_range=[1,1]; "
        "'this week' means [0,0]; 'next N weeks' means [1,N]."
    )


def _merge_intents(baseline: ParsedIntent, llm: dict[str, Any]) -> ParsedIntent:
    """Take the LLM JSON, override baseline fields where the LLM is confident."""
    intent_mode = str(llm.get("intent_mode") or baseline.intent_mode).strip()
    if intent_mode not in INTENT_MODES:
        intent_mode = baseline.intent_mode
    focus = llm.get("focus") if isinstance(llm.get("focus"), str) and llm.get("focus") else baseline.focus
    try:
        confidence = float(llm.get("confidence"))
        if not 0.0 <= confidence <= 1.0:
            confidence = baseline.confidence
    except (TypeError, ValueError):
        confidence = baseline.confidence

    scope = dict(baseline.scope)  # start from deterministic, let LLM refine
    llm_scope = llm.get("scope") if isinstance(llm.get("scope"), dict) else {}
    if isinstance(llm_scope.get("skus"), list):
        skus = [str(s).strip() for s in llm_scope["skus"] if str(s).strip()]
        if skus:
            scope["skus"] = sorted(set(skus))
    if isinstance(llm_scope.get("nodes"), list):
        nodes = [str(n).strip() for n in llm_scope["nodes"] if str(n).strip()]
        if nodes:
            scope["nodes"] = sorted(set(nodes))
    if isinstance(llm_scope.get("regions"), list):
        regions = [str(r).strip() for r in llm_scope["regions"] if str(r).strip()]
        if regions:
            scope["regions"] = sorted(set(regions))
    if isinstance(llm_scope.get("week_range"), dict):
        try:
            start = int(llm_scope["week_range"].get("start"))
            end = int(llm_scope["week_range"].get("end"))
            if end >= start >= 0:
                scope["week_range"] = {"start": max(1, start), "end": min(52, end)}
        except (TypeError, ValueError):
            pass
    if isinstance(llm_scope.get("sort_by"), str) and llm_scope["sort_by"]:
        scope["sort_by"] = llm_scope["sort_by"]
    if isinstance(llm_scope.get("simulation_delta"), dict) and intent_mode == "simulate":
        scope["simulation_delta"] = llm_scope["simulation_delta"]

    return ParsedIntent(
        intent_mode=intent_mode,
        scope=scope,
        focus=focus,
        confidence=confidence,
        llm_invoked=True,
        fallback_reason=None,
        warnings=list(baseline.warnings),
    )
