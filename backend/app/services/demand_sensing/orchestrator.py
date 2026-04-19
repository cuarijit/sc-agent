"""End-to-end orchestrator for the Demand Sensing Agent."""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from ...models import AgentInstanceRecord, AgentTemplateRecord
from ..inventory_diagnostic.audit_logger import AuditLogger, AuditRecord, LlmCallEntry
from ..inventory_diagnostic.capability_check import CapabilityCheck
from ..inventory_diagnostic.intent_parser import IntentParser
from ..inventory_diagnostic.merged_runtime import build_merged_runtime
from ..inventory_diagnostic.prioritization_engine import PrioritizationEngine
from ..inventory_diagnostic.semantic_slot_registry import SemanticSlotRegistry
from ..inventory_diagnostic.step_recorder import StepRecorder

from .signal_detector import DemandSensingDetector, DemandSensingScope
from .rca import DemandSensingRootCauseAnalyzer
from .resolver import DemandSensingResolver
from .response_composer import DemandSensingResponseComposer


_INTENT_MAP = {
    "show": "show",
    "diagnose": "diagnose",
    "analyse": "analyse",
    "solve": "solve",
    "simulate": "simulate",
    "execute": "solve",  # demand sensing has no execute mode; alias
    "clarify": "clarify",
    "out_of_scope": "out_of_scope",
}
_MODES_WITH_RC = {"analyse", "diagnose", "solve", "simulate"}
_MODES_WITH_RESOLUTIONS = {"solve", "simulate"}


def _json_load_dict(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _merge_defaults(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    out = dict(a or {})
    for k, v in (b or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge_defaults(out[k], v)
        else:
            out[k] = v
    return out


def _enabled_keys(instance_config: dict[str, Any], catalog: str) -> set[str]:
    enabled = (instance_config.get("enabled_library") or {}).get(catalog)
    if not isinstance(enabled, list):
        return set()
    return {str(k) for k in enabled if isinstance(k, str)}


@dataclass
class DemandSensingRunResult:
    run_id: str
    structured: dict[str, Any]
    narrative: str
    follow_up_questions: list[str]
    warnings: list[str]
    llm_calls: list[dict[str, Any]]
    agent_type: str
    agent_type_version: int
    instance_id: str
    intent_mode: str
    conversation_id: str | None
    llm_active: bool = False
    llm_provider: str | None = None
    llm_model: str | None = None


class DemandSensingRunner:
    def __init__(self, db: Session):
        self.db = db
        self.capability = CapabilityCheck(db)
        self.registry = SemanticSlotRegistry(db, self.capability.engine)
        self.audit = AuditLogger(db)

    def run(
        self,
        *,
        message: str,
        instance_id: str,
        conversation_id: str | None = None,
        turn_index: int = 0,
        api_key: str | None = None,
        llm_provider: str | None = None,
        llm_model: str | None = None,
    ) -> DemandSensingRunResult:
        start = time.perf_counter()
        instance = (
            self.db.query(AgentInstanceRecord)
            .filter(AgentInstanceRecord.instance_id == instance_id)
            .first()
        )
        if instance is None:
            raise ValueError(f"Agent instance '{instance_id}' not found.")
        template = (
            self.db.query(AgentTemplateRecord)
            .filter(AgentTemplateRecord.type_key == instance.agent_type)
            .first()
        )
        if template is None:
            raise ValueError(f"Agent template '{instance.agent_type}' not found.")
        if instance.agent_type != "demand_sensing_agent":
            raise ValueError(
                f"Instance '{instance_id}' is bound to '{instance.agent_type}', not demand_sensing_agent."
            )

        behavior = _json_load_dict(template.behavior_json)
        default_config = _json_load_dict(template.default_config_json)
        instance_config = _json_load_dict(instance.type_specific_config_json)
        merged_instance_config = _merge_defaults(default_config, instance_config)
        runtime = build_merged_runtime(behavior=behavior, instance_config=merged_instance_config)

        enabled_intents = set(
            instance_config.get("enabled_intents")
            or default_config.get("enabled_intents")
            or ["show", "analyse", "diagnose", "solve", "simulate"]
        )
        llm_call_log: list[LlmCallEntry] = []
        recorder = StepRecorder()

        # Intent parse.
        ip_log_start = len(llm_call_log)
        intent_parser = IntentParser(
            llm_policy=instance_config.get("llm_policy") or default_config.get("llm_policy") or {},
            api_key=api_key,
            default_planning_horizon_weeks=1,
        )
        intent_parser.call_site_config = runtime.llm_call_site("intent_parse")
        intent = intent_parser.parse(message, llm_call_log=llm_call_log)
        raw_mode = intent.intent_mode
        intent_mode = _INTENT_MAP.get(raw_mode, raw_mode)
        if intent_mode not in enabled_intents and intent_mode not in ("clarify", "out_of_scope"):
            intent_mode = "show" if "show" in enabled_intents else next(iter(enabled_intents), "show")
        ip_art = recorder.artifact("intent_parse")
        ip_art.inputs = {"prompt": message[:200]}
        ip_art.outputs = {
            "intent_mode_raw": raw_mode,
            "intent_mode_effective": intent_mode,
            **intent.to_payload(),
        }
        ip_art.llm_call = (
            llm_call_log[ip_log_start].__dict__ if len(llm_call_log) > ip_log_start else {}
        )

        parsed_scope = intent.scope or {}
        scope = DemandSensingScope(
            skus=[s for s in (parsed_scope.get("skus") or []) if isinstance(s, str)],
            nodes=[n for n in (parsed_scope.get("nodes") or []) if isinstance(n, str)],
            ramadan_day_filter=(
                int(parsed_scope["ramadan_day_filter"])
                if isinstance(parsed_scope.get("ramadan_day_filter"), (int, str)) and str(parsed_scope.get("ramadan_day_filter")).isdigit()
                else None
            ),
            simulation_delta=dict(parsed_scope.get("simulation_delta") or {}),
        )
        sc_art = recorder.artifact("scope")
        sc_art.outputs = {
            "skus": scope.skus, "nodes": scope.nodes,
            "ramadan_day_filter": scope.ramadan_day_filter,
            "simulation_delta": scope.simulation_delta,
        }

        # Capability (advisory only — detector will fall back if slots missing).
        capability = self.capability.evaluate_instance(instance_id, force=False)
        disabled_problem_keys = set(capability.disabled_problems)
        disabled_rc_keys = set(capability.disabled_root_causes)
        disabled_res_keys = set(capability.disabled_resolutions)
        cap_art = recorder.artifact("capability")
        cap_art.outputs = {
            "slots_available": sorted(k for k, v in capability.slots.items() if v.status == "available"),
            "slots_missing": sorted(k for k, v in capability.slots.items() if v.status == "missing"),
            "disabled_problems": sorted(disabled_problem_keys),
            "disabled_root_causes": sorted(disabled_rc_keys),
            "disabled_resolutions": sorted(disabled_res_keys),
        }

        library = behavior.get("library") if isinstance(behavior.get("library"), dict) else {}
        problem_templates = [
            p for p in (library.get("problem_templates") or [])
            if isinstance(p, dict) and p.get("key") in _enabled_keys(merged_instance_config, "problem_templates")
        ]
        rc_templates = [
            rc for rc in (library.get("root_cause_templates") or [])
            if isinstance(rc, dict) and rc.get("key") in _enabled_keys(merged_instance_config, "root_cause_templates")
        ]
        res_templates = [
            f for f in (library.get("resolution_families") or [])
            if isinstance(f, dict) and f.get("key") in _enabled_keys(merged_instance_config, "resolution_families")
        ]

        sensing_horizon = int(merged_instance_config.get("sensing_horizon_hours") or 6)
        divergence_threshold = float(merged_instance_config.get("divergence_threshold_pct") or 20.0)
        event_lookahead = int(merged_instance_config.get("ramadan_event_lookahead_days") or 14)

        detector = DemandSensingDetector(
            self.db,
            problem_templates=problem_templates,
            disabled_keys=disabled_problem_keys,
            sensing_horizon_hours=sensing_horizon,
            divergence_threshold_pct=divergence_threshold,
            ramadan_event_lookahead_days=event_lookahead,
        )
        problems = detector.detect(scope)
        pd_art = recorder.artifact("detect_signals")
        pd_art.inputs = {
            "problem_template_keys": [str(p.get("key") or "") for p in problem_templates],
            "sensing_horizon_hours": sensing_horizon,
            "divergence_threshold_pct": divergence_threshold,
            "ramadan_event_lookahead_days": event_lookahead,
        }
        pd_art.outputs = {"signal_count": len(problems)}
        pd_art.sample_rows = [p.to_payload() for p in problems[:20]]
        pd_art.row_count = len(problems)

        weights = (
            merged_instance_config.get("prioritization_weights")
            or default_config.get("prioritization_weights")
            or {}
        )
        ranker = PrioritizationEngine(
            self.db,
            weights=weights,
            abc_weight_map={"A": 1.0, "B": 0.6, "C": 0.3},
            horizon_weeks=1,
        )
        ranked = ranker.rank(problems)
        ranked_payload = [r.to_payload() for r in ranked]
        pr_art = recorder.artifact("prioritize")
        pr_art.inputs = {"weights": weights}
        pr_art.outputs = {"ranked_count": len(ranked)}
        pr_art.sample_rows = [
            {k: v for k, v in r.items() if k in {"rank", "sku", "node_id", "severity", "shortage_qty", "score", "problem_key"}}
            for r in ranked_payload[:20]
        ]
        pr_art.row_count = len(ranked_payload)

        root_causes_payload: list[dict[str, Any]] = []
        if intent_mode in _MODES_WITH_RC and ranked:
            top = [r.problem for r in ranked[:10]]
            rca = DemandSensingRootCauseAnalyzer(
                self.db,
                templates=rc_templates,
                disabled_keys=disabled_rc_keys,
            )
            rcs = rca.analyze(top)
            root_causes_payload = [rc.to_payload() for rc in rcs]
            rca_art = recorder.artifact("analyze_root_cause")
            rca_art.inputs = {"rca_template_keys": [str(t.get("key") or "") for t in rc_templates]}
            rca_art.outputs = {"root_cause_count": len(root_causes_payload)}
            rca_art.sample_rows = root_causes_payload[:10]
            rca_art.row_count = len(root_causes_payload)
        else:
            recorder.artifact("analyze_root_cause").skipped(f"intent={intent_mode} doesn't run RCA")

        resolutions_payload: list[dict[str, Any]] = []
        if intent_mode in _MODES_WITH_RESOLUTIONS and ranked:
            top = [r.problem for r in ranked[:10]]
            resolver = DemandSensingResolver(
                self.db,
                families=res_templates,
                disabled_keys=disabled_res_keys,
            )
            cands = resolver.enumerate(top)
            resolutions_payload = [c.to_payload() for c in cands]
            res_art = recorder.artifact("enumerate_resolutions")
            res_art.inputs = {"resolver_family_keys": [str(f.get("key") or "") for f in res_templates]}
            res_art.outputs = {"candidate_count": len(resolutions_payload)}
            res_art.sample_rows = resolutions_payload[:15]
            res_art.row_count = len(resolutions_payload)
        else:
            recorder.artifact("enumerate_resolutions").skipped(f"intent={intent_mode} doesn't run resolver")

        compose_log_start = len(llm_call_log)
        composer = DemandSensingResponseComposer(
            call_site_config=runtime.llm_call_site("explanation") or {},
            api_key=api_key,
        )
        composed = composer.compose(
            run_id=str(uuid.uuid4()),
            intent_mode=intent_mode,
            scope={
                "skus": scope.skus,
                "nodes": scope.nodes,
                "ramadan_day_filter": scope.ramadan_day_filter,
                "simulation_delta": scope.simulation_delta,
                "as_of_date": date.today().isoformat(),
            },
            problems=ranked_payload,
            root_causes=root_causes_payload,
            resolutions=resolutions_payload,
            capabilities_applied={
                "slots_available": sorted(k for k, v in capability.slots.items() if v.status == "available"),
                "slots_missing": sorted(k for k, v in capability.slots.items() if v.status == "missing"),
            },
            llm_call_log=llm_call_log,
        )

        run_id = composed.structured.get("run_id") or str(uuid.uuid4())
        record = AuditRecord(
            run_id=run_id,
            instance_id=instance_id,
            agent_type=instance.agent_type,
            agent_type_version=int(template.template_version or 0),
            conversation_id=conversation_id,
            turn_index=int(turn_index or 0),
            intent_mode=intent_mode,
            user_prompt=message,
            parsed_intent=intent.to_payload(),
            scope=composed.structured.get("scope") or {},
            structured_output=composed.structured,
            narrative_text=composed.narrative,
            llm_calls=list(llm_call_log),
            warnings=composed.warnings,
            status="ok",
            duration_ms=int((time.perf_counter() - start) * 1000),
        )
        self.audit.write(record)

        llm_active = any(c.error is None for c in llm_call_log if c.call_site == "explanation")
        llm_provider = None
        llm_model = None
        for c in llm_call_log:
            if c.call_site == "explanation" and c.error is None:
                llm_provider = c.provider
                llm_model = c.model
                break

        return DemandSensingRunResult(
            run_id=run_id,
            structured=composed.structured,
            narrative=composed.narrative,
            follow_up_questions=composed.follow_up_questions,
            warnings=composed.warnings,
            llm_calls=[c.__dict__ for c in llm_call_log],
            agent_type=instance.agent_type,
            agent_type_version=int(template.template_version or 0),
            instance_id=instance_id,
            intent_mode=intent_mode,
            conversation_id=conversation_id,
            llm_active=llm_active,
            llm_provider=llm_provider,
            llm_model=llm_model,
        )
