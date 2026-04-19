"""Merge deterministic JSON + produce a narrative.

Phase 2: the narrative is a deterministic template string so the pipeline
works without an LLM. Phase 3 will add the `explanation` LLM call (call site
#3) that rewrites the narrative based on the structured output.

Only `intent_parser`, `followup_interpreter`, and this module are allowed to
import `app.services.llm_service`. A lint test enforces that rule.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import json

from .audit_logger import LlmCallEntry
from .capability_check import CapabilitySnapshot
from ._llm_client import call_llm, resolve_api_key


@dataclass
class ComposedResponse:
    structured: dict[str, Any] = field(default_factory=dict)
    narrative: str = ""
    follow_up_questions: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "structured": self.structured,
            "narrative": self.narrative,
            "follow_up_questions": self.follow_up_questions,
            "warnings": self.warnings,
        }


class ResponseComposer:
    def __init__(
        self,
        *,
        narrative_max_chars: int = 1800,
        llm_policy: dict[str, Any] | None = None,
        api_key: str | None = None,
    ):
        self.narrative_max_chars = narrative_max_chars
        self.llm_policy = llm_policy or {}
        self.api_key = api_key
        self.call_site_config: dict[str, Any] = {}

    # ----------------------------------------------------------------- public

    def compose(
        self,
        *,
        run_id: str,
        intent_mode: str,
        scope: dict[str, Any],
        problems: list[dict[str, Any]],
        root_causes: list[dict[str, Any]] | None = None,
        resolutions: list[dict[str, Any]] | None = None,
        action_plan: dict[str, Any] | None = None,
        capabilities: CapabilitySnapshot | None = None,
        warnings: list[str] | None = None,
        llm_call_log: list[LlmCallEntry] | None = None,
    ) -> ComposedResponse:
        root_causes = root_causes or []
        resolutions = resolutions or []
        warnings = list(warnings or [])

        capabilities_applied: dict[str, Any] = {}
        if capabilities is not None:
            capabilities_applied = {
                "slots_available": sorted(
                    [k for k, v in capabilities.slots.items() if v.status == "available"]
                ),
                "slots_degraded": sorted(
                    [k for k, v in capabilities.slots.items() if v.status == "degraded"]
                ),
                "slots_missing": sorted(
                    [k for k, v in capabilities.slots.items() if v.status == "missing"]
                ),
                "disabled_problems": capabilities.disabled_problems,
                "disabled_root_causes": capabilities.disabled_root_causes,
                "disabled_resolutions": capabilities.disabled_resolutions,
            }
            warnings.extend(capabilities.warnings)

        structured = {
            "run_id": run_id,
            "intent_mode": intent_mode,
            "scope": scope,
            "problems": problems,
            "root_causes": root_causes,
            "resolutions": resolutions,
            "action_plan": action_plan,
            "capabilities_applied": capabilities_applied,
            "warnings": warnings,
        }

        deterministic_narrative = self._deterministic_narrative(
            intent_mode=intent_mode,
            scope=scope,
            problems=problems,
            root_causes=root_causes,
            resolutions=resolutions,
            capabilities_applied=capabilities_applied,
        )
        narrative, llm_entry = self._compose_narrative(
            intent_mode=intent_mode,
            scope=scope,
            problems=problems,
            root_causes=root_causes,
            resolutions=resolutions,
            action_plan=action_plan,
            capabilities_applied=capabilities_applied,
            deterministic_narrative=deterministic_narrative,
        )
        if llm_call_log is not None and llm_entry is not None:
            llm_call_log.append(llm_entry)

        follow_ups = self._follow_up_questions(intent_mode, problems, capabilities_applied)

        return ComposedResponse(
            structured=structured,
            narrative=narrative[: self.narrative_max_chars],
            follow_up_questions=follow_ups,
            warnings=warnings,
        )

    # --------------------------------------------------------- LLM narrative

    def _compose_narrative(
        self,
        *,
        intent_mode: str,
        scope: dict[str, Any],
        problems: list[dict[str, Any]],
        root_causes: list[dict[str, Any]],
        resolutions: list[dict[str, Any]],
        action_plan: dict[str, Any] | None,
        capabilities_applied: dict[str, Any],
        deterministic_narrative: str,
    ) -> tuple[str, LlmCallEntry | None]:
        """Return (narrative, llm_call_entry).

        Falls back to the deterministic template when no api_key is available
        or the LLM call fails.
        """
        cfg = self.llm_policy.get("explanation") if isinstance(self.llm_policy.get("explanation"), dict) else {}
        merged_site = self.call_site_config or {}
        provider = (
            merged_site.get("provider_default")
            or merged_site.get("provider")
            or cfg.get("provider")
            or "openai"
        )
        effective_key = resolve_api_key(provider=provider, user_supplied=self.api_key)
        if not effective_key:
            return deterministic_narrative, LlmCallEntry(
                call_site="explanation",
                provider=None,
                model=None,
                latency_ms=0,
                error="no_api_key",
            )
        # Build a compact brief — truncate long arrays so we don't blow the context.
        brief = {
            "intent_mode": intent_mode,
            "scope": {
                "skus": (scope.get("skus") or [])[:20],
                "nodes": (scope.get("nodes") or [])[:20],
                "week_offsets": scope.get("week_offsets") or [],
                "focus": scope.get("focus"),
            },
            "capabilities_applied": capabilities_applied,
            "top_problems": [
                {
                    k: p.get(k)
                    for k in (
                        "rank",
                        "problem_key",
                        "sku",
                        "node_id",
                        "severity",
                        "breach_week",
                        "shortage_qty",
                        "projected_on_hand_actual_qty",
                        "safety_stock_qty",
                        "reorder_point_qty",
                    )
                }
                for p in problems[:5]
            ],
            "top_root_causes": [
                {k: rc.get(k) for k in ("rc_key", "weight", "score", "problem_ref", "evidence")}
                for rc in root_causes[:5]
            ],
            "top_resolutions": [
                {
                    k: r.get(k)
                    for k in (
                        "rank",
                        "family_key",
                        "sku",
                        "from_node",
                        "to_node",
                        "qty",
                        "lead_time_days",
                        "feasible",
                        "resolves_breach",
                        "simulation_score",
                    )
                }
                for r in resolutions[:5]
            ],
            "action_plan_status": (action_plan or {}).get("status") if action_plan else None,
            "action_plan_count": len(((action_plan or {}).get("plans") or [])),
        }

        system_prompt = (
            merged_site.get("system_prompt")
            or cfg.get("system_prompt")
            or _EXPLANATION_SYSTEM_PROMPT
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
            if temperature is None:
                temperature = 0.2
        max_tokens = merged_site.get("max_tokens") or cfg.get("max_tokens") or 900
        result = call_llm(
            provider=provider,
            model=model,
            api_key=effective_key,
            system_prompt=system_prompt,
            user_prompt=json.dumps(brief, default=str, indent=2),
            temperature=float(temperature),
            max_tokens=int(max_tokens),
        )
        entry = LlmCallEntry(
            call_site="explanation",
            provider=result.provider,
            model=result.model,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            latency_ms=result.latency_ms,
            error=result.error,
        )
        if result.error or not result.text:
            return deterministic_narrative, entry
        narrative = result.text.strip()[: self.narrative_max_chars]
        return narrative, entry

    # ---------------------------------------------------------------- helpers

    @staticmethod
    def _deterministic_narrative(
        *,
        intent_mode: str,
        scope: dict[str, Any],
        problems: list[dict[str, Any]],
        root_causes: list[dict[str, Any]] | None = None,
        resolutions: list[dict[str, Any]] | None = None,
        capabilities_applied: dict[str, Any],
    ) -> str:
        root_causes = root_causes or []
        resolutions = resolutions or []
        lines: list[str] = []
        week_range = scope.get("week_offsets") or []
        window = (
            f"weeks {week_range[0]}–{week_range[-1]}"
            if week_range
            else "the planning horizon"
        )

        if not problems:
            lines.append(
                f"No inventory issues detected across {window} for the current scope."
            )
        else:
            top = problems[0]
            lines.append(
                f"Detected {len(problems)} inventory issue(s) across {window}. "
                f"Top-ranked: {top.get('sku')} at {top.get('node_id')} "
                f"breaching at week {top.get('breach_week')} "
                f"(severity={top.get('severity')}, shortage={top.get('shortage_qty')})."
            )

        if root_causes:
            top_rc = root_causes[0]
            lines.append(
                f"Leading root cause: {top_rc.get('rc_key')} "
                f"(weight={top_rc.get('weight')}, score={top_rc.get('score')})."
            )

        if resolutions:
            # Pick the first candidate that resolves the top problem.
            top_resolution = next(
                (r for r in resolutions if r.get("resolves_breach")),
                resolutions[0] if resolutions else None,
            )
            if top_resolution is not None:
                lines.append(
                    f"Recommended action: {top_resolution.get('family_key')} "
                    f"{top_resolution.get('qty')} units of {top_resolution.get('sku')} "
                    f"from {top_resolution.get('from_node') or '—'} "
                    f"to {top_resolution.get('to_node')} "
                    f"(resolves breach: {top_resolution.get('resolves_breach')})."
                )

        disabled = capabilities_applied.get("disabled_problems") or []
        if disabled:
            lines.append(
                f"Some analyses skipped due to unavailable data: {', '.join(disabled)}."
            )
        missing_slots = capabilities_applied.get("slots_missing") or []
        if missing_slots:
            lines.append(f"Missing data bindings: {', '.join(missing_slots)}.")

        if intent_mode == "show":
            lines.append("Result is deterministic. Re-run the same prompt to reproduce.")
        elif intent_mode == "diagnose" and not resolutions:
            lines.append("Recommended resolutions will arrive when solve intent is invoked.")
        return "\n".join(lines)

    @staticmethod
    def _follow_up_questions(
        intent_mode: str,
        problems: list[dict[str, Any]],
        capabilities_applied: dict[str, Any],
    ) -> list[str]:
        suggestions: list[str] = []
        if problems:
            top = problems[0]
            suggestions.append(
                f"What are the root causes of the top breach at {top.get('sku')} / {top.get('node_id')}?"
            )
            suggestions.append(
                f"Which resolutions are feasible to prevent the week-{top.get('breach_week')} stockout?"
            )
        if capabilities_applied.get("slots_missing"):
            suggestions.append("Which slot bindings should I configure to unlock the disabled analyses?")
        if intent_mode == "show":
            suggestions.append("Would you like to diagnose root causes for these issues?")
        return suggestions[:3]


_EXPLANATION_SYSTEM_PROMPT = """\
You are a senior supply-chain analyst explaining the results of a deterministic
inventory diagnostic run to a planner.

You receive a compact JSON brief containing the top problems, root causes,
resolutions, and the action plan summary. Produce a clear, factual narrative
that:
- Opens with a 1-2 sentence headline: what did we detect, how severe, when?
- Names the top 1-3 SKU/node pairs with breach week and shortage.
- Explains the leading root cause in plain language (reference evidence).
- Recommends the top 1-2 resolutions with specifics (qty, source node, whether
  simulation confirms it clears the breach, lead time).
- Flags any disabled analyses or missing data bindings briefly.
- Closes with a concrete next step the planner can take today.

Rules:
- Never invent numbers; only use what's in the brief.
- Max ~250 words. No markdown headings, no bullet-only output — natural
  sentences. You may use one short bullet list for the resolutions if that
  reads more clearly.
- If the brief has zero problems, say so plainly and reassure the planner.
"""
