"""End-to-end orchestrator for the Inventory Diagnostic Agent.

Runs the deterministic pipeline for a single chat turn and writes one
AgentRun audit row. This is the function `chatbot_service._build_response_node`
delegates to when `handler_hint == "inventory_diagnostic"`.

Phase 2 pipeline (of the 11-node plan):
  intent_parser → scope_resolver → capability_check → inventory_projection +
  problem_detector → prioritization → response_composer → audit_logger

Phase 3 adds root_cause_analyzer, resolution_generator, simulation_ranker,
action_mapper, and the explanation LLM call. Phase 4 adds follow-up. Phase 5
adds execute.
"""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models import AgentInstanceRecord, AgentTemplateRecord
from .action_mapper import ActionMapper, PlannedAction
from .audit_logger import AuditLogger, AuditRecord, LlmCallEntry
from .capability_check import CapabilityCheck
from .decision_graph import build_decision_graph, merge_per_template_overrides
from .followup_interpreter import FollowUpInterpreter, FollowUpRefinement
from .intent_parser import IntentParser, ParsedIntent
from .merged_runtime import MergedRuntime, build_merged_runtime
from .prioritization_engine import PrioritizationEngine
from .problem_detector import ProblemDetector
from .resolution_generator import ResolutionGenerator
from .response_composer import ResponseComposer
from .root_cause_analyzer import RootCauseAnalyzer
from .scope_resolver import ScopeResolver, ResolvedScope
from .semantic_slot_registry import SemanticSlotRegistry
from .simulation_ranker import SimulationRanker
from .step_recorder import StepRecorder


# Intent modes that trigger each downstream stage of the pipeline.
_MODES_WITH_RC = {"diagnose", "solve", "simulate", "execute"}
_MODES_WITH_RESOLUTIONS = {"solve", "simulate", "execute"}
_MODES_WITH_ACTION_PLAN = {"solve", "execute"}


def _json_load_dict(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


@dataclass
class RunResult:
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


def _apply_llm_overrides(
    *,
    runtime: MergedRuntime,
    default_config: dict[str, Any],
    instance_config: dict[str, Any],
    provider_override: str | None,
    model_override: str | None,
) -> None:
    """Apply UI-selected provider/model to every LLM call site.

    Without this, templates pin a specific model (e.g. gpt-4.1-mini) and the
    UI's model picker has no effect on the agent pipeline. We patch both the
    merged `runtime.llm_call_sites` (where call sites read provider_default /
    model_default) and the shared `llm_policy` dict (the downstream `cfg`
    fallback) so a UI override wins over the template/instance defaults.
    """
    provider = (provider_override or "").strip() or None
    model = (model_override or "").strip() or None
    if not provider and not model:
        return

    for site_cfg in runtime.llm_call_sites.values():
        if not isinstance(site_cfg, dict):
            continue
        if provider:
            site_cfg["provider_default"] = provider
            site_cfg["provider"] = provider
        if model:
            site_cfg["model_default"] = model
            site_cfg["model"] = model

    for cfg_source in (instance_config, default_config):
        policy = cfg_source.get("llm_policy") if isinstance(cfg_source, dict) else None
        if not isinstance(policy, dict):
            continue
        if provider:
            policy["provider"] = provider
            policy["provider_default"] = provider
        if model:
            policy["model"] = model
            policy["model_default"] = model
        for site_cfg in policy.values():
            if not isinstance(site_cfg, dict):
                continue
            if provider:
                site_cfg["provider"] = provider
            if model:
                site_cfg["model"] = model


class InventoryDiagnosticRunner:
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
    ) -> RunResult:
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

        behavior = _json_load_dict(template.behavior_json)
        default_config = _json_load_dict(template.default_config_json)
        instance_config = _json_load_dict(instance.type_specific_config_json)

        # Build the effective runtime by deep-merging template behaviour with
        # the instance's type_specific_config. This is the ONLY place that
        # reads the raw template / instance JSON — every downstream module
        # consumes the merged view via `runtime`.
        merged_instance_config = _merge_defaults(default_config, instance_config)
        runtime: MergedRuntime = build_merged_runtime(
            behavior=behavior, instance_config=merged_instance_config,
        )
        _apply_llm_overrides(
            runtime=runtime,
            default_config=default_config,
            instance_config=instance_config,
            provider_override=llm_provider,
            model_override=llm_model,
        )
        template_actions = runtime.action_templates

        decision_graph_view = build_decision_graph(
            template_behavior=behavior, instance_config=merged_instance_config,
        )

        # Filter merged library catalogs through enabled_library + decision graph.
        active_problems = [
            p for p in runtime.problem_templates
            if decision_graph_view.is_problem_enabled(str(p.get("key") or ""))
        ]
        active_rcs = [
            rc for rc in runtime.root_cause_templates
            if decision_graph_view.is_root_cause_enabled(str(rc.get("key") or ""))
        ]
        active_resolutions = [
            r for r in runtime.resolution_families
            if decision_graph_view.is_resolution_enabled(str(r.get("key") or ""))
        ]

        # Intents enabled on this instance (defaults to all).
        enabled_intents = set(
            (instance_config.get("enabled_intents") or default_config.get("enabled_intents") or [])
        )

        planning_horizon = int(
            instance_config.get("planning_horizon_weeks")
            or default_config.get("planning_horizon_weeks")
            or 12
        )
        # Prioritization: weights from instance_config (flat) + abc_weight_map
        # / tiebreaker / normalization from runtime.prioritization (which
        # already merged the template's prioritization with instance overrides).
        weights = (
            runtime.prioritization.get("weights")
            or instance_config.get("prioritization_weights")
            or default_config.get("prioritization_weights")
            or {}
        )
        abc_weight_map = runtime.prioritization.get("abc_weight_map") or DEFAULT_ABC_WEIGHT_MAP
        tiebreaker = runtime.prioritization.get("tiebreaker") or ["earlier_breach_week", "lower_sku"]
        normalization = runtime.prioritization.get("normalization") or "min_max_per_batch"

        llm_call_log: list[LlmCallEntry] = []
        warnings: list[str] = []
        recorder = StepRecorder()

        # 0) Follow-up context (LLM call #2) — only when there's a prior run in
        # this conversation.
        _fu_call_log_start = len(llm_call_log)
        _followup_interpreter = FollowUpInterpreter(
            self.db,
            llm_policy=instance_config.get("llm_policy") or default_config.get("llm_policy") or {},
            api_key=api_key,
        )
        _followup_interpreter.call_site_config = runtime.llm_call_site("followup_interpret")
        follow_up = _followup_interpreter.interpret(
            message=message,
            conversation_id=conversation_id,
            llm_call_log=llm_call_log,
        )
        fu_art = recorder.artifact("followup_interpret")
        fu_art.status = "ok" if follow_up is not None else "skipped"
        fu_art.inputs = {"conversation_id": conversation_id, "message": message[:200]}
        fu_art.outputs = follow_up.to_payload() if follow_up is not None else {}
        fu_art.llm_call = (
            llm_call_log[_fu_call_log_start].__dict__
            if len(llm_call_log) > _fu_call_log_start else {}
        )
        if follow_up is None:
            fu_art.warnings.append("No prior conversation — skipped.")

        # 1) Intent parse (LLM call #1)
        _ip_call_log_start = len(llm_call_log)
        intent_parser = IntentParser(
            llm_policy=instance_config.get("llm_policy") or default_config.get("llm_policy") or {},
            api_key=api_key,
            default_planning_horizon_weeks=planning_horizon,
        )
        intent_parser.call_site_config = runtime.llm_call_site("intent_parse")
        intent = intent_parser.parse(message, llm_call_log=llm_call_log)
        ip_art = recorder.artifact("intent_parse")
        ip_art.inputs = {"prompt": message[:200], "default_horizon": planning_horizon}
        ip_art.outputs = intent.to_payload()
        ip_art.llm_call = (
            llm_call_log[_ip_call_log_start].__dict__
            if len(llm_call_log) > _ip_call_log_start else {}
        )

        if follow_up is not None:
            _merge_follow_up(intent, follow_up)

        # 2) Scope resolve
        scope = ScopeResolver(self.db).resolve(intent)
        sr_art = recorder.artifact("scope_resolve")
        sr_art.inputs = {"intent_scope": intent.scope}
        sr_art.outputs = {
            "skus_count": len(scope.skus),
            "nodes_count": len(scope.nodes),
            "sku_node_pairs_count": len(scope.sku_node_pairs),
            "week_offsets": scope.week_offsets,
            "base_week": scope.base_week,
        }
        sr_art.sample_rows = [list(p) for p in scope.sku_node_pairs[:20]]
        sr_art.row_count = len(scope.sku_node_pairs)

        # 3) Capability check
        capabilities = self.capability.evaluate_instance(instance_id, force=False)
        disabled_keys = set(capabilities.disabled_problems)
        cap_art = recorder.artifact("capability_check")
        # Rich per-slot detail for the Pipeline tab — status, reason, missing
        # field list, binding kind, and the declarative catalog entry
        # (required/optional fields + library keys this slot unlocks).
        catalog_by_key = {
            str(entry.get("slot_key") or ""): entry
            for entry in (runtime.slot_catalog or [])
            if isinstance(entry, dict)
        }
        slot_details: list[dict[str, Any]] = []
        for slot_key, status in sorted(capabilities.slots.items()):
            catalog_entry = catalog_by_key.get(slot_key, {})
            slot_details.append({
                "slot_key": slot_key,
                "status": status.status,
                "reason": status.reason,
                "missing_required_fields": list(status.missing_required_fields or []),
                "missing_optional_fields": list(status.missing_optional_fields or []),
                "binding_kind": status.binding_kind,
                "source_ref": status.source_ref,
                "required_fields": list(catalog_entry.get("required_fields") or []),
                "optional_fields": list(catalog_entry.get("optional_fields") or []),
                "unlocks": list(catalog_entry.get("unlocks") or []),
            })
        cap_art.outputs = {
            "available": sorted([k for k, v in capabilities.slots.items() if v.status == "available"]),
            "degraded": sorted([k for k, v in capabilities.slots.items() if v.status == "degraded"]),
            "missing": sorted([k for k, v in capabilities.slots.items() if v.status == "missing"]),
            "disabled_problems": capabilities.disabled_problems,
            "disabled_root_causes": capabilities.disabled_root_causes,
            "disabled_resolutions": capabilities.disabled_resolutions,
            "slot_details": slot_details,
        }
        cap_art.warnings = capabilities.warnings

        # 4) Problem detection — use the instance-filtered catalog.
        detector = ProblemDetector(
            self.db,
            problem_templates=active_problems,
            disabled_keys=disabled_keys,
        )
        problems = detector.detect(scope)
        pd_art = recorder.artifact("detect_problems")
        pd_art.inputs = {
            "active_problem_keys": [str(p.get("key") or "") for p in active_problems],
            "disabled_keys": sorted(disabled_keys),
        }
        pd_art.outputs = {"problem_count": len(problems)}
        pd_art.sample_rows = [p.to_payload() for p in problems[:20]]
        pd_art.row_count = len(problems)

        # 5) Prioritisation
        ranker = PrioritizationEngine(
            self.db,
            weights=weights,
            abc_weight_map=abc_weight_map,
            horizon_weeks=planning_horizon,
            tiebreaker=tiebreaker,
            normalization=normalization,
        )
        ranked = ranker.rank(problems)
        ranked_payload = [r.to_payload() for r in ranked]
        pr_art = recorder.artifact("prioritize")
        pr_art.inputs = {"weights": weights, "abc_weight_map": abc_weight_map}
        pr_art.outputs = {"ranked_count": len(ranked)}
        pr_art.sample_rows = [
            {k: v for k, v in r.items() if k in {"rank", "sku", "node_id", "severity", "breach_week", "shortage_qty", "score"}}
            for r in ranked_payload[:20]
        ]
        pr_art.row_count = len(ranked_payload)

        # 6) Root-cause analysis (diagnose/solve/simulate/execute)
        root_causes_payload: list[dict[str, Any]] = []
        if intent.intent_mode in _MODES_WITH_RC:
            # Filter RCs to only those the decision_graph says are compatible
            # with at least one of the active problem keys.
            top_n_problems = [r.problem for r in ranked[:10]]
            problem_keys_in_scope = {p.problem_key for p in top_n_problems}
            legal_rc_keys: set[str] = set()
            for pk in problem_keys_in_scope:
                legal_rc_keys.update(decision_graph_view.compatible_root_causes(pk))
            rca_templates = [rc for rc in active_rcs if str(rc.get("key") or "") in legal_rc_keys] if legal_rc_keys else list(active_rcs)
            rca = RootCauseAnalyzer(
                self.db,
                templates=rca_templates,
                disabled_keys=set(capabilities.disabled_root_causes),
                horizon_weeks=planning_horizon,
            )
            root_causes = rca.analyze(top_n_problems)
            root_causes_payload = [rc.to_payload() for rc in root_causes]
            rca_art = recorder.artifact("analyze_root_cause")
            rca_art.inputs = {
                "rca_template_keys": [str(t.get("key") or "") for t in rca_templates],
                "top_problem_count": len(top_n_problems),
            }
            rca_art.outputs = {"root_cause_count": len(root_causes_payload)}
            rca_art.sample_rows = root_causes_payload[:10]
            rca_art.row_count = len(root_causes_payload)
        else:
            recorder.artifact("analyze_root_cause").skipped(
                f"intent={intent.intent_mode} doesn't run RCA"
            )

        # 7) Resolution generation + simulation (solve/simulate/execute)
        resolutions_payload: list[dict[str, Any]] = []
        candidates = []
        if intent.intent_mode in _MODES_WITH_RESOLUTIONS:
            top_n_problems_full = [r.problem for r in ranked[:10]]
            problem_keys_in_scope = {p.problem_key for p in top_n_problems_full}
            legal_resolution_keys: set[str] = set()
            for pk in problem_keys_in_scope:
                legal_resolution_keys.update(decision_graph_view.compatible_resolutions(pk))
            resolver_families = [
                r for r in active_resolutions if str(r.get("key") or "") in legal_resolution_keys
            ] if legal_resolution_keys else list(active_resolutions)
            resolver = ResolutionGenerator(
                self.db,
                families=resolver_families,
                disabled_keys=set(capabilities.disabled_resolutions),
                horizon_weeks=planning_horizon,
            )
            candidates = resolver.enumerate(top_n_problems_full)
            resolve_art = recorder.artifact("enumerate_resolutions")
            resolve_art.inputs = {
                "resolver_family_keys": [str(f.get("key") or "") for f in resolver_families],
            }
            resolve_art.outputs = {"candidate_count_pre_simulation": len(candidates)}
            resolve_art.sample_rows = [c.to_payload() for c in candidates[:15]]
            resolve_art.row_count = len(candidates)
            candidates = SimulationRanker(self.db).simulate_and_rank(
                candidates, top_n_problems_full
            )
            resolutions_payload = [c.to_payload() for c in candidates]
            sim_art = recorder.artifact("simulate_rank")
            sim_art.outputs = {
                "resolves_breach_count": sum(1 for c in candidates if c.resolves_breach is True),
                "total_count": len(candidates),
            }
            sim_art.sample_rows = resolutions_payload[:15]
            sim_art.row_count = len(resolutions_payload)
        else:
            recorder.artifact("enumerate_resolutions").skipped(
                f"intent={intent.intent_mode} doesn't run resolution generator"
            )
            recorder.artifact("simulate_rank").skipped(
                f"intent={intent.intent_mode} doesn't run simulation"
            )

        # 7.5) Action mapping + dispatch (solve draft, execute queued when dispatch=true)
        action_plan_payload: dict[str, Any] | None = None
        planned_actions: list[PlannedAction] = []
        # Reserve the run_id early so action plans can back-reference it and
        # the eventual AgentRun row shares the same id.
        reserved_run_id = str(uuid.uuid4())

        if intent.intent_mode in _MODES_WITH_ACTION_PLAN and candidates:
            run_id_reserved = reserved_run_id
            # Prefer the v6 library path.
            action_templates = template_actions or {}
            permissions_per_intent = (
                instance_config.get("action_permissions_per_intent")
                or default_config.get("action_permissions_per_intent")
                or {}
            )
            execute_mode = (
                instance_config.get("execute_mode")
                or default_config.get("execute_mode")
                or {}
            )
            try:
                planned_actions = ActionMapper(
                    self.db,
                    action_templates=action_templates,
                    permissions_per_intent=permissions_per_intent,
                    execute_mode=execute_mode,
                ).build_plans(
                    run_id=run_id_reserved,
                    instance_id=instance_id,
                    intent_mode=intent.intent_mode,
                    resolutions=candidates,
                )
            except PermissionError as exc:
                warnings.append(str(exc))
                planned_actions = []

            action_plan_payload = {
                "run_id": run_id_reserved,
                "status": "queued" if any(p.plan_status == "queued" for p in planned_actions)
                    else "draft" if planned_actions else "empty",
                "plans": [p.to_payload() for p in planned_actions],
                "intent_mode": intent.intent_mode,
                "dispatch_enabled": bool(
                    (execute_mode or {}).get("dispatch") if intent.intent_mode == "execute" else False
                ),
            }
            am_art = recorder.artifact("map_actions")
            am_art.inputs = {
                "intent_mode": intent.intent_mode,
                "permitted_actions": list((permissions_per_intent or {}).get(intent.intent_mode) or []),
                "dispatch_enabled": action_plan_payload["dispatch_enabled"],
            }
            am_art.outputs = {
                "plan_status": action_plan_payload["status"],
                "plan_count": len(planned_actions),
            }
            am_art.sample_rows = [p.to_payload() for p in planned_actions[:10]]
            am_art.row_count = len(planned_actions)
            am_art.warnings = list(warnings)
        else:
            recorder.artifact("map_actions").skipped(
                f"intent={intent.intent_mode} with candidates={len(candidates)}"
            )

        # 8) Response compose (LLM call #3 if api_key present)
        _rc_call_log_start = len(llm_call_log)
        composer = ResponseComposer(
            llm_policy=instance_config.get("llm_policy") or default_config.get("llm_policy") or {},
            api_key=api_key,
        )
        composer.call_site_config = runtime.llm_call_site("explanation")
        composed = composer.compose(
            run_id="pending",
            intent_mode=intent.intent_mode,
            scope=scope.to_payload(),
            problems=ranked_payload,
            root_causes=root_causes_payload,
            resolutions=resolutions_payload,
            action_plan=action_plan_payload,
            capabilities=capabilities,
            warnings=warnings,
            llm_call_log=llm_call_log,
        )
        compose_art = recorder.artifact("compose_response")
        compose_art.inputs = {"narrative_max_chars": composer.narrative_max_chars}
        compose_art.outputs = {
            "narrative_length": len(composed.narrative),
            "narrative_preview": composed.narrative[:360],
            "follow_up_questions": composed.follow_up_questions,
            "warnings_count": len(composed.warnings),
        }
        compose_art.llm_call = (
            llm_call_log[_rc_call_log_start].__dict__
            if len(llm_call_log) > _rc_call_log_start else {}
        )

        # 7) Audit
        bindings_snapshot = [b.__dict__ for b in self.registry.list_bindings(instance_id)]
        disabled_capabilities = {
            "problems": capabilities.disabled_problems,
            "root_causes": capabilities.disabled_root_causes,
            "resolutions": capabilities.disabled_resolutions,
        }
        inputs_digest = {
            "sku_node_pair_count": len(scope.sku_node_pairs),
            "week_count": len(scope.week_offsets),
            "problem_candidate_count": len(problems),
            "digest": hashlib.sha1(
                json.dumps(
                    {
                        "skus": scope.skus,
                        "nodes": scope.nodes,
                        "weeks": scope.week_offsets,
                    },
                    sort_keys=True,
                ).encode("utf-8"),
            ).hexdigest(),
        }

        record = AuditRecord(
            run_id=reserved_run_id,
            instance_id=instance_id,
            agent_type=instance.agent_type,
            agent_type_version=int(template.template_version or 0),
            conversation_id=conversation_id,
            turn_index=turn_index,
            intent_mode=intent.intent_mode,
            user_prompt=message,
            parsed_intent=intent.to_payload(),
            scope=scope.to_payload(),
            bindings_snapshot=bindings_snapshot,
            disabled_capabilities=disabled_capabilities,
            scoring_profile_used={
                "weights": weights,
                "abc_weight_map": abc_weight_map,
                "tiebreaker": tiebreaker,
                "normalization": normalization,
                "horizon_weeks": planning_horizon,
                "calculation_profile": runtime.calculation_profile,
            },
            inputs_digest=inputs_digest,
            structured_output=composed.structured,
            narrative_text=composed.narrative,
            llm_calls=llm_call_log,
            warnings=composed.warnings,
            status="ok",
            duration_ms=int((time.perf_counter() - start) * 1000),
        )
        run_id = self.audit.write(record)
        composed.structured["run_id"] = run_id

        # Emit a final audit artifact and flush all recorded step artifacts.
        audit_art = recorder.artifact("audit")
        audit_art.outputs = {
            "run_id": run_id,
            "agent_type_version": int(template.template_version or 0),
            "llm_calls_count": len(llm_call_log),
        }
        try:
            recorder.flush(self.db, run_id)
        except Exception:
            # Recording is best-effort; never let it break the run.
            pass

        # Did the LLM actually fire on any call site?
        successful_calls = [c for c in llm_call_log if c.provider and not c.error]
        llm_active = bool(successful_calls)
        primary_call = successful_calls[-1] if successful_calls else None
        return RunResult(
            run_id=run_id,
            structured=composed.structured,
            narrative=composed.narrative,
            follow_up_questions=composed.follow_up_questions,
            warnings=composed.warnings,
            llm_calls=[c.__dict__ for c in llm_call_log],
            agent_type=instance.agent_type,
            agent_type_version=int(template.template_version or 0),
            instance_id=instance_id,
            intent_mode=intent.intent_mode,
            conversation_id=conversation_id,
            llm_active=llm_active,
            llm_provider=primary_call.provider if primary_call else None,
            llm_model=primary_call.model if primary_call else None,
        )


# Module-level default so the runner can survive a template without an
# explicit abc_weight_map.
DEFAULT_ABC_WEIGHT_MAP = {"A": 1.0, "B": 0.6, "C": 0.3}


def _merge_defaults(
    defaults: dict[str, Any], overrides: dict[str, Any]
) -> dict[str, Any]:
    """Shallow merge — instance_config keys override template default_config."""
    merged: dict[str, Any] = {}
    if isinstance(defaults, dict):
        merged.update(defaults)
    if isinstance(overrides, dict):
        merged.update(overrides)
    return merged


def _merge_follow_up(intent: ParsedIntent, follow_up: FollowUpRefinement) -> None:
    """Apply deterministic scope refinements from a prior-turn context."""
    delta = follow_up.scope_delta or {}
    scope = intent.scope
    if delta.get("skus"):
        scope["skus"] = list(dict.fromkeys(list(delta["skus"]) + list(scope.get("skus") or [])))
    if delta.get("nodes"):
        scope["nodes"] = list(dict.fromkeys(list(delta["nodes"]) + list(scope.get("nodes") or [])))
    if delta.get("inherit_week_range") and not scope.get("week_range"):
        prior_weeks = delta.get("week_offsets_prior") or []
        if prior_weeks:
            scope["week_range"] = {"start": prior_weeks[0], "end": prior_weeks[-1]}
    scope["follow_up"] = {
        "prior_run_id": follow_up.prior_run_id,
        "prior_turn_index": follow_up.prior_turn_index,
        "applied_delta": delta,
    }
