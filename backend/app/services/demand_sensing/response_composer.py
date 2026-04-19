"""Compose structured+narrative output for the demand sensing agent."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from ..inventory_diagnostic._llm_client import call_llm, resolve_api_key
from ..inventory_diagnostic.audit_logger import LlmCallEntry


@dataclass
class ComposedDemandResponse:
    structured: dict[str, Any] = field(default_factory=dict)
    narrative: str = ""
    follow_up_questions: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class DemandSensingResponseComposer:
    def __init__(
        self,
        *,
        call_site_config: dict[str, Any] | None = None,
        api_key: str | None = None,
    ):
        self.call_site_config = call_site_config or {}
        self.api_key = api_key

    def compose(
        self,
        *,
        run_id: str,
        intent_mode: str,
        scope: dict[str, Any],
        problems: list[dict[str, Any]],
        root_causes: list[dict[str, Any]] | None = None,
        resolutions: list[dict[str, Any]] | None = None,
        capabilities_applied: dict[str, Any] | None = None,
        warnings: list[str] | None = None,
        llm_call_log: list[LlmCallEntry] | None = None,
    ) -> ComposedDemandResponse:
        root_causes = root_causes or []
        resolutions = resolutions or []
        warnings = list(warnings or [])

        structured: dict[str, Any] = {
            "run_id": run_id,
            "intent_mode": intent_mode,
            "scope": scope,
            "problems": problems,
            "root_causes": root_causes,
            "resolutions": resolutions,
            "capabilities_applied": capabilities_applied or {},
            "warnings": warnings,
        }
        narrative_det = self._deterministic(intent_mode, problems, root_causes, resolutions)
        narrative, entry = self._try_llm(
            intent_mode=intent_mode, scope=scope, problems=problems,
            root_causes=root_causes, resolutions=resolutions,
            deterministic=narrative_det,
        )
        if llm_call_log is not None and entry is not None:
            llm_call_log.append(entry)
        return ComposedDemandResponse(
            structured=structured,
            narrative=narrative or narrative_det,
            follow_up_questions=self._follow_ups(intent_mode, problems),
            warnings=warnings,
        )

    def _deterministic(
        self,
        intent_mode: str,
        problems: list[dict[str, Any]],
        root_causes: list[dict[str, Any]],
        resolutions: list[dict[str, Any]],
    ) -> str:
        if not problems:
            return "No real-time demand signals in scope. Current POS tracks forecast."
        parts: list[str] = []
        top = problems[0]
        pk = top.get("problem_key", "signal")
        sku = top.get("sku") or "—"
        node = top.get("node_id") or "—"
        sev = top.get("severity") or "warning"
        ev = top.get("evidence") or {}
        detail = ""
        if pk == "real_time_shortage_at_current_pos":
            detail = (
                f" (on-hand {ev.get('on_hand_start')} vs velocity "
                f"{ev.get('baseline_units_per_hour')} u/h → shortage at "
                f"hour +{ev.get('shortage_hour_offset')})"
            )
        elif pk == "pos_signal_divergence":
            detail = (
                f" (last {ev.get('window_hours')}h: POS {ev.get('recent_pos_units')} vs forecast "
                f"{ev.get('forecast_pro_rata_units')}, Δ={ev.get('deviation_pct')}%)"
            )
        elif pk == "short_term_demand_spike":
            detail = (
                f" (last 24h: {ev.get('last_24h_units')} vs trailing mean "
                f"{ev.get('trailing_mean_24h_units')}, surge {ev.get('spike_pct')}%)"
            )
        elif pk == "event_pattern_shift":
            detail = (
                f" (Ramadan in {ev.get('days_until_event')} days, first day "
                f"{ev.get('first_event_date')}, Iftar {ev.get('iftar_local_time')})"
            )
        elif pk == "cold_chain_prepos_gap":
            detail = (
                f" (on-hand {ev.get('on_hand_qty')} vs expected uplifted weekly "
                f"{ev.get('expected_uplifted_weekly_qty')}, prepos shortfall "
                f"{ev.get('prepos_shortfall_qty')})"
            )
        parts.append(f"Detected {len(problems)} demand sensing signal(s). Top: {pk} for {sku} at {node} ({sev}){detail}.")
        if root_causes:
            rc = root_causes[0]
            parts.append(f"Leading root cause: {rc.get('rc_key')} (weight={rc.get('weight')}).")
        if resolutions:
            r = resolutions[0]
            qty = r.get("qty")
            src = r.get("from_node")
            dst = r.get("to_node")
            parts.append(
                f"Recommended action: {r.get('family_key')} {qty} {r.get('sku') or ''} "
                f"from {src} to {dst}."
            )
        if intent_mode in ("show", "analyse", "diagnose"):
            parts.append("Ask 'how do I fix this' to generate ranked resolutions.")
        return " ".join(parts).strip()

    def _try_llm(
        self,
        *,
        intent_mode: str,
        scope: dict[str, Any],
        problems: list[dict[str, Any]],
        root_causes: list[dict[str, Any]],
        resolutions: list[dict[str, Any]],
        deterministic: str,
    ) -> tuple[str | None, LlmCallEntry | None]:
        cfg = self.call_site_config or {}
        provider = cfg.get("provider_default") or cfg.get("provider") or "openai"
        model = cfg.get("model_default") or cfg.get("model") or "gpt-4.1-mini"
        system_prompt = cfg.get("system_prompt") or (
            "You are a demand planner. Explain the real-time demand sensing result "
            "in 1-2 sentences with precise POS vs forecast deltas and hours-until-shortage. "
            "Recommend the top resolution. Never invent numbers."
        )
        temperature = float(cfg.get("temperature") or 0.2)
        max_tokens = int(cfg.get("max_tokens") or 700)
        api_key = resolve_api_key(provider=provider, user_supplied=self.api_key)
        if not api_key:
            return None, LlmCallEntry(
                call_site="explanation",
                provider=provider,
                model=model,
                latency_ms=0,
                tokens_in=None,
                tokens_out=None,
                error="no_api_key",
            )
        brief = {
            "intent_mode": intent_mode,
            "scope": scope,
            "problems": problems[:5],
            "root_causes": root_causes[:3],
            "resolutions": resolutions[:3],
        }
        user_prompt = (
            "Here is the deterministic output. Write the explanation.\n\n"
            + json.dumps(brief, indent=2, default=str)
        )
        result = call_llm(
            provider=provider, model=model, api_key=api_key,
            system_prompt=system_prompt, user_prompt=user_prompt,
            temperature=temperature, max_tokens=max_tokens,
        )
        entry = LlmCallEntry(
            call_site="explanation",
            provider=result.provider or provider,
            model=result.model or model,
            latency_ms=result.latency_ms,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            error=result.error,
        )
        return (result.text if result.text else None), entry

    def _follow_ups(
        self, intent_mode: str, problems: list[dict[str, Any]]
    ) -> list[str]:
        if not problems:
            return []
        kinds = {p.get("problem_key") for p in problems}
        out: list[str] = []
        if "real_time_shortage_at_current_pos" in kinds and intent_mode != "solve":
            out.append("How do I cover the shortage before next delivery?")
        if "event_pattern_shift" in kinds and intent_mode != "solve":
            out.append("How should I pre-position for this event?")
        if "pos_signal_divergence" in kinds and intent_mode != "solve":
            out.append("Should I re-forecast the short horizon now?")
        return out[:3]
