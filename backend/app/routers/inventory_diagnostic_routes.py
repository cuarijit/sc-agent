from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException

from ..database import SessionLocal
from ..services.agent_config_service import AgentConfigService
from ..services.auth_dependencies import require_entitlement

router = APIRouter()


def get_agent_config_service() -> AgentConfigService:
    db = SessionLocal()
    try:
        yield AgentConfigService(db)
    finally:
        db.close()


@router.post("/admin/inventory-diagnostic/seed-demo")
def seed_inventory_diagnostic_demo_route(
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    from ..services.inventory_diagnostic.demo_seed import seed_inventory_diagnostic_demo

    summary = seed_inventory_diagnostic_demo(service.db)
    return {"status": "ok", "summary": summary}


@router.post("/admin/inventory-diagnostic/llm-health")
def inventory_diagnostic_llm_health(
    payload: dict[str, object] | None = None,
) -> dict[str, object]:
    from ..services.inventory_diagnostic._llm_client import ping_provider

    payload = payload or {}
    user_openai = payload.get("openai_api_key") if isinstance(payload.get("openai_api_key"), str) else None
    user_anthropic = payload.get("anthropic_api_key") if isinstance(payload.get("anthropic_api_key"), str) else None
    return {
        "env_keys_present": {
            "OPENAI": bool(os.getenv("OPENAI_API_KEY")),
            "ANTHROPIC": bool(os.getenv("ANTHROPIC_API_KEY")),
        },
        "providers": {
            "openai": ping_provider("openai", user_openai),
            "anthropic": ping_provider("anthropic", user_anthropic),
        },
    }


@router.post("/api/inventory-diagnostic/query")
def inventory_diagnostic_query(
    payload: dict[str, object],
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    from ..services.inventory_diagnostic.inventory_diagnostic_runner import InventoryDiagnosticRunner

    instance_id = str(payload.get("instance_id") or "").strip()
    message = str(payload.get("message") or "").strip()
    if not instance_id:
        raise HTTPException(status_code=400, detail="instance_id is required.")
    if not message:
        raise HTTPException(status_code=400, detail="message is required.")
    try:
        result = InventoryDiagnosticRunner(service.db).run(
            message=message,
            instance_id=instance_id,
            conversation_id=(str(payload.get("conversation_id"))
                             if payload.get("conversation_id") else None),
            turn_index=int(payload.get("turn_index") or 0),
            api_key=(str(payload.get("openai_api_key"))
                     if payload.get("openai_api_key") else None),
            llm_provider=(str(payload.get("llm_provider"))
                          if payload.get("llm_provider") else None),
            llm_model=(str(payload.get("llm_model"))
                       if payload.get("llm_model") else None),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "run_id": result.run_id,
        "intent_mode": result.intent_mode,
        "agent_type": result.agent_type,
        "agent_type_version": result.agent_type_version,
        "instance_id": result.instance_id,
        "conversation_id": result.conversation_id,
        "structured": result.structured,
        "narrative": result.narrative,
        "follow_up_questions": result.follow_up_questions,
        "warnings": result.warnings,
        "llm_calls": result.llm_calls,
        "llm_active": result.llm_active,
        "llm_provider": result.llm_provider,
        "llm_model": result.llm_model,
    }


@router.get("/api/inventory-diagnostic/runs/{run_id}")
def inventory_diagnostic_run(
    run_id: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    from ..services.inventory_diagnostic.audit_logger import AuditLogger

    record = AuditLogger(service.db).get(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Agent run '{run_id}' not found.")
    return record


@router.get("/api/inventory-diagnostic/runs/{run_id}/steps")
def list_run_steps(
    run_id: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> list[dict[str, object]]:
    from ..services.inventory_diagnostic.step_recorder import load_step_artifacts

    return load_step_artifacts(service.db, run_id)


@router.get("/api/inventory-diagnostic/runs/{run_id}/action-plans")
def list_action_plans_for_run(
    run_id: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> list[dict[str, object]]:
    from ..services.inventory_diagnostic.action_mapper import ActionPlanRepository

    return ActionPlanRepository(service.db).list_for_run(run_id)


@router.post("/api/inventory-diagnostic/action-plans/{plan_id}/dispatch", dependencies=[Depends(require_entitlement("action.inventory_diagnostic.dispatch_action_plan"))])
def dispatch_action_plan(
    plan_id: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    from ..services.inventory_diagnostic.webhook_dispatcher import WebhookDispatcher

    try:
        result = WebhookDispatcher(service.db).dispatch(plan_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "plan_id": result.plan_id,
        "status": result.status,
        "status_code": result.status_code,
        "error": result.error,
        "attempts": result.attempts,
    }
