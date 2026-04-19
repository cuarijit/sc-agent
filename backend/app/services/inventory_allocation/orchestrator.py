"""End-to-end orchestrator for the Inventory Allocation & Distribution Agent.

Runs the deterministic pipeline for a single chat turn and writes one AgentRun
audit row. Reuses the diagnostic agent's IntentParser (regex + optional LLM) for
scope extraction; downstream detect/RCA/resolve/compose are allocation-specific.
"""
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
from ..inventory_diagnostic.problem_detector import ProblemInstance
from ..inventory_diagnostic.semantic_slot_registry import SemanticSlotRegistry
from ..inventory_diagnostic.step_recorder import StepRecorder

from .allocation_detector import AllocationDetector, AllocationScope
from .allocation_rca import AllocationRootCauseAnalyzer
from .allocation_resolver import AllocationResolver
from .response_composer import AllocationResponseComposer


_ALLOCATION_INTENT_MAP = {
    "show": "show",
    "diagnose": "analyse",  # diagnostic vocabulary → allocation vocabulary
    "analyse": "analyse",
    "solve": "solve",
    "simulate": "simulate",
    "execute": "execute",
    "clarify": "clarify",
    "out_of_scope": "out_of_scope",
}

_MODES_WITH_RC = {"analyse", "solve", "simulate", "execute"}
_MODES_WITH_RESOLUTIONS = {"solve", "simulate", "execute"}


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


@dataclass
class AllocationRunResult:
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


class InventoryAllocationRunner:
    def __init__(self, db: Session):
        self.db = db
        self.capability = CapabilityCheck(db)
        self.registry = SemanticSlotRegistry(db, self.capability.engine)
        self.audit = AuditLogger(db)

    # ----------------------------------------------------------------- public

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
    ) -> AllocationRunResult:
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
        if instance.agent_type != "inventory_allocation_agent":
            raise ValueError(
                f"Instance '{instance_id}' is bound to '{instance.agent_type}', not inventory_allocation_agent."
            )

        behavior = _json_load_dict(template.behavior_json)
        default_config = _json_load_dict(template.default_config_json)
        instance_config = _json_load_dict(instance.type_specific_config_json)
        merged_instance_config = _merge_defaults(default_config, instance_config)
        runtime = build_merged_runtime(behavior=behavior, instance_config=merged_instance_config)

        enabled_intents = set(
            instance_config.get("enabled_intents")
            or default_config.get("enabled_intents")
            or ["show", "analyse", "solve", "simulate", "execute"]
        )
        planning_horizon = 1  # allocation uses hour-grain, not weeks — but IntentParser needs a stub.
        llm_call_log: list[LlmCallEntry] = []
        recorder = StepRecorder()

        # ---------- 1) Intent parse (reuse diagnostic's parser).
        ip_log_start = len(llm_call_log)
        intent_parser = IntentParser(
            llm_policy=instance_config.get("llm_policy") or default_config.get("llm_policy") or {},
            api_key=api_key,
            default_planning_horizon_weeks=planning_horizon,
        )
        intent_parser.call_site_config = runtime.llm_call_site("intent_parse")
        intent = intent_parser.parse(message, llm_call_log=llm_call_log)
        raw_mode = intent.intent_mode
        intent_mode = _ALLOCATION_INTENT_MAP.get(raw_mode, raw_mode)
        if intent_mode not in enabled_intents and intent_mode not in ("clarify", "out_of_scope"):
            # Fall back to a supported intent — prefer show for read-only, solve for "how do I" language.
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

        # Build scope from parsed intent.
        parsed_scope = intent.scope or {}
        scope = AllocationScope(
            skus=[s for s in (parsed_scope.get("skus") or []) if isinstance(s, str)],
            nodes=[n for n in (parsed_scope.get("nodes") or []) if isinstance(n, str)],
            route_ids=[r for r in (parsed_scope.get("route_ids") or []) if isinstance(r, str)],
            delivery_date=str(parsed_scope.get("delivery_date") or "") or None,
            window=str(parsed_scope.get("window") or "") or None,
        )
        sc_art = recorder.artifact("scope")
        sc_art.outputs = {
            "skus": scope.skus, "nodes": scope.nodes, "route_ids": scope.route_ids,
            "delivery_date": scope.delivery_date, "window": scope.window,
        }

        # ---------- 2) Capability check (informational — doesn't short-circuit).
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

        # ---------- 3) Detect.
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

        iftar_buffer = int(merged_instance_config.get("iftar_buffer_minutes") or 15)
        rsl_critical = int(merged_instance_config.get("rsl_days_critical") or 1)
        rsl_warning = int(merged_instance_config.get("rsl_days_warning") or 2)

        detector = AllocationDetector(
            self.db,
            problem_templates=problem_templates,
            disabled_keys=disabled_problem_keys,
            iftar_buffer_minutes=iftar_buffer,
            rsl_days_threshold=rsl_warning,
        )
        problems = detector.detect(scope)
        pd_art = recorder.artifact("detect_problems")
        pd_art.inputs = {
            "problem_template_keys": [str(p.get("key") or "") for p in problem_templates],
            "iftar_buffer_minutes": iftar_buffer,
            "rsl_days_threshold": rsl_warning,
        }
        pd_art.outputs = {"problem_count": len(problems)}
        pd_art.sample_rows = [p.to_payload() for p in problems[:20]]
        pd_art.row_count = len(problems)

        # ---------- 4) Prioritize (reuse the diagnostic ranker — same ProblemInstance shape).
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

        # ---------- 5) RCA (analyse / solve / simulate / execute).
        root_causes_payload: list[dict[str, Any]] = []
        if intent_mode in _MODES_WITH_RC and ranked:
            top_problems = [r.problem for r in ranked[:10]]
            rca = AllocationRootCauseAnalyzer(
                self.db,
                templates=rc_templates,
                disabled_keys=disabled_rc_keys,
                iftar_buffer_minutes=iftar_buffer,
            )
            rcs = rca.analyze(top_problems)
            root_causes_payload = [rc.to_payload() for rc in rcs]
            rca_art = recorder.artifact("analyze_root_cause")
            rca_art.inputs = {"rca_template_keys": [str(t.get("key") or "") for t in rc_templates]}
            rca_art.outputs = {"root_cause_count": len(root_causes_payload)}
            rca_art.sample_rows = root_causes_payload[:10]
            rca_art.row_count = len(root_causes_payload)
        else:
            recorder.artifact("analyze_root_cause").skipped(f"intent={intent_mode} doesn't run RCA")

        # ---------- 6) Resolve (solve / simulate / execute).
        resolutions_payload: list[dict[str, Any]] = []
        if intent_mode in _MODES_WITH_RESOLUTIONS and ranked:
            top_problems_full = [r.problem for r in ranked[:10]]
            resolver = AllocationResolver(
                self.db,
                families=res_templates,
                disabled_keys=disabled_res_keys,
                rsl_days_critical=rsl_critical,
            )
            candidates = resolver.enumerate(top_problems_full)
            resolutions_payload = [c.to_payload() for c in candidates]
            res_art = recorder.artifact("enumerate_resolutions")
            res_art.inputs = {"resolver_family_keys": [str(f.get("key") or "") for f in res_templates]}
            res_art.outputs = {"candidate_count": len(resolutions_payload)}
            res_art.sample_rows = resolutions_payload[:15]
            res_art.row_count = len(resolutions_payload)
        else:
            recorder.artifact("enumerate_resolutions").skipped(f"intent={intent_mode} doesn't run resolver")

        # ---------- 7) Compose (deterministic + optional LLM explanation).
        compose_log_start = len(llm_call_log)
        composer = AllocationResponseComposer(
            call_site_config=runtime.llm_call_site("explanation") or {},
            api_key=api_key,
        )
        composed = composer.compose(
            run_id=str(uuid.uuid4()),
            intent_mode=intent_mode,
            scope={
                "skus": scope.skus,
                "nodes": scope.nodes,
                "route_ids": scope.route_ids,
                "delivery_date": scope.delivery_date or date.today().isoformat(),
                "window": scope.window,
            },
            problems=ranked_payload,
            root_causes=root_causes_payload,
            resolutions=resolutions_payload,
            capabilities_applied={
                "slots_available": sorted(k for k, v in capability.slots.items() if v.status == "available"),
                "slots_missing": sorted(k for k, v in capability.slots.items() if v.status == "missing"),
                "disabled_problems": sorted(disabled_problem_keys),
            },
            llm_call_log=llm_call_log,
        )

        # ---------- 8) Audit.
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
        # Record compose step + flush all artifacts keyed to this run_id.
        cp_art = recorder.artifact("compose_response")
        cp_art.outputs = {
            "narrative_chars": len(composed.narrative or ""),
            "follow_ups": len(composed.follow_up_questions or []),
        }
        cp_art.llm_call = (
            llm_call_log[compose_log_start].__dict__
            if len(llm_call_log) > compose_log_start else {}
        )
        recorder.flush(self.db, run_id)

        # Detect the LLM-active state (any successful non-intent-parse call).
        llm_active = any(c.error is None for c in llm_call_log if c.call_site == "explanation")
        llm_provider = None
        llm_model = None
        for c in llm_call_log:
            if c.call_site == "explanation" and c.error is None:
                llm_provider = c.provider
                llm_model = c.model
                break

        return AllocationRunResult(
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


def _enabled_keys(instance_config: dict[str, Any], catalog: str) -> set[str]:
    enabled = (instance_config.get("enabled_library") or {}).get(catalog)
    if not isinstance(enabled, list):
        return set()
    return {str(k) for k in enabled if isinstance(k, str)}
