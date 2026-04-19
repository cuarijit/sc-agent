from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..database import SessionLocal
from ..services.agent_config_service import AgentConfigService

router = APIRouter()


def get_agent_config_service() -> AgentConfigService:
    db = SessionLocal()
    try:
        yield AgentConfigService(db)
    finally:
        db.close()


@router.get("/api/demand-sensing/runs/{run_id}/steps")
def list_demand_sensing_run_steps(
    run_id: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> list[dict[str, object]]:
    from ..services.inventory_diagnostic.step_recorder import load_step_artifacts

    return load_step_artifacts(service.db, run_id)


@router.post("/api/demand-sensing/query")
def demand_sensing_query(
    payload: dict[str, object],
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    from ..services.demand_sensing import DemandSensingRunner

    instance_id = str(payload.get("instance_id") or "").strip()
    message = str(payload.get("message") or "").strip()
    if not instance_id:
        raise HTTPException(status_code=400, detail="instance_id is required.")
    if not message:
        raise HTTPException(status_code=400, detail="message is required.")
    try:
        result = DemandSensingRunner(service.db).run(
            message=message,
            instance_id=instance_id,
            conversation_id=(str(payload.get("conversation_id")) if payload.get("conversation_id") else None),
            turn_index=int(payload.get("turn_index") or 0),
            api_key=(str(payload.get("openai_api_key")) if payload.get("openai_api_key") else None),
            llm_provider=(str(payload.get("llm_provider")) if payload.get("llm_provider") else None),
            llm_model=(str(payload.get("llm_model")) if payload.get("llm_model") else None),
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
