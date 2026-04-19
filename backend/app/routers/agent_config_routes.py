from __future__ import annotations

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


# NOTE: /admin/roles moved to admin_user_routes.py (returns wrapped {roles: [...]}).
# The hardcoded stub here was overwriting the real RBAC roles. Removed.


# NOTE: /admin/modules moved to module_config_routes.py (real CRUD + 4 seeded modules).
# Hardcoded stub here was overwriting the real DB-backed modules. Removed.


@router.get("/admin/agent-types")
def list_agent_types(service: AgentConfigService = Depends(get_agent_config_service)) -> list[dict[str, object]]:
    return service.list_agent_types()


@router.get("/admin/agent-templates")
def list_agent_templates(service: AgentConfigService = Depends(get_agent_config_service)) -> list[dict[str, object]]:
    return service.list_agent_types()


@router.get("/admin/agent-templates/{type_key}")
def get_agent_template(type_key: str, service: AgentConfigService = Depends(get_agent_config_service)) -> dict[str, object]:
    payload = service.get_agent_template(type_key)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Agent template '{type_key}' not found.")
    return payload


@router.put("/admin/agent-templates/{type_key}", dependencies=[Depends(require_entitlement("action.agent.template.update"))])
def update_agent_template(
    type_key: str,
    payload: dict[str, object],
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    cleaned = {k: v for k, v in payload.items() if v is not None}
    updated = service.update_agent_template(type_key, cleaned)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Agent template '{type_key}' not found.")
    return updated


@router.post("/admin/agent-templates/{type_key}/sync")
def sync_agent_template_instances(
    type_key: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    result = service.sync_template_instances(type_key)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Agent template '{type_key}' not found.")
    return result


@router.post("/admin/agent-templates/reload")
def reload_agent_templates(service: AgentConfigService = Depends(get_agent_config_service)) -> dict[str, str]:
    count = service.reload_templates()
    return {"status": "ok", "detail": f"Reloaded {count} template(s)."}


@router.post("/admin/agent-templates/{type_key}/publish", dependencies=[Depends(require_entitlement("action.agent.template.publish"))])
def publish_agent_template(
    type_key: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    payload = service.publish_agent_template(type_key)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Agent template '{type_key}' not found.")
    return payload


@router.get("/admin/semantic-slots")
def list_semantic_slots(service: AgentConfigService = Depends(get_agent_config_service)) -> list[dict[str, object]]:
    return service.list_semantic_slots()


@router.get("/admin/agent-instances")
def list_agent_instances(service: AgentConfigService = Depends(get_agent_config_service)) -> list[dict[str, object]]:
    return service.list_agent_instances()


@router.get("/admin/agent-instances/{instance_id}")
def get_agent_instance(instance_id: str, service: AgentConfigService = Depends(get_agent_config_service)) -> dict[str, object]:
    payload = service.get_agent_instance(instance_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Agent instance not found.")
    return payload


@router.post("/admin/agent-instances", dependencies=[Depends(require_entitlement("action.agent.instance.create"))])
def create_agent_instance(
    payload: dict[str, object],
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    try:
        result = service.create_agent_instance(dict(payload))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return result


@router.patch("/admin/agent-instances/{instance_id}", dependencies=[Depends(require_entitlement("action.agent.instance.update"))])
def update_agent_instance(
    instance_id: str,
    payload: dict[str, object],
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    cleaned = {k: v for k, v in payload.items() if v is not None}
    result = service.update_agent_instance(instance_id, cleaned)
    if result is None:
        raise HTTPException(status_code=404, detail="Agent instance not found.")
    return result


@router.delete("/admin/agent-instances/{instance_id}", dependencies=[Depends(require_entitlement("action.agent.instance.delete"))])
def delete_agent_instance(instance_id: str, service: AgentConfigService = Depends(get_agent_config_service)) -> dict[str, str]:
    deleted = service.delete_agent_instance(instance_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Agent instance not found.")
    return {"status": "ok", "detail": "Agent instance deleted."}


@router.get("/admin/agent-instances/{instance_id}/bindings")
def list_instance_bindings(
    instance_id: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> list[dict[str, object]]:
    result = service.list_instance_bindings(instance_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Agent instance '{instance_id}' not found.")
    return result


@router.post("/admin/agent-instances/{instance_id}/bindings")
def upsert_instance_binding(
    instance_id: str,
    payload: dict[str, object],
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    try:
        result = service.upsert_instance_binding(instance_id, dict(payload))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail=f"Agent instance '{instance_id}' not found.")
    return result


@router.delete("/admin/agent-instances/{instance_id}/bindings/{slot_key}")
def delete_instance_binding(
    instance_id: str,
    slot_key: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, str]:
    ok = service.delete_instance_binding(instance_id, slot_key)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail=f"Binding for instance '{instance_id}' slot '{slot_key}' not found.",
        )
    return {"status": "deleted"}


@router.get("/admin/agent-instances/{instance_id}/capability")
def get_instance_capability(
    instance_id: str,
    force: bool = False,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    from ..services.inventory_diagnostic.capability_check import CapabilityCheck

    try:
        snapshot = CapabilityCheck(service.db).evaluate_instance(instance_id, force=force)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return snapshot.to_dict()


@router.get("/api/agent-instances/{instance_id}/resolved")
def get_resolved_agent_instance(
    instance_id: str,
    service: AgentConfigService = Depends(get_agent_config_service),
) -> dict[str, object]:
    payload = service.resolve_instance(instance_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Agent instance '{instance_id}' not found.")
    if not payload.get("is_active"):
        raise HTTPException(status_code=404, detail=f"Agent instance '{instance_id}' is inactive.")
    return payload
