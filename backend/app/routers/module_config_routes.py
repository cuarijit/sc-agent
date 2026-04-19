"""Module + Page admin routes — all gated by Depends(require_admin)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..database import SessionLocal
from ..services.auth_dependencies import require_admin
from ..services.auth_store import AuthUser
from ..services.module_config_service import ModuleConfigService

router = APIRouter()


def _store():
    db = SessionLocal()
    try:
        yield ModuleConfigService(db)
    finally:
        db.close()


@router.get("/admin/modules")
def list_modules(_: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> list[dict]:
    return s.list_modules()


@router.get("/api/nav/modules")
def list_modules_for_nav(s: ModuleConfigService = Depends(_store)) -> list[dict]:
    """Public-ish nav tree: modules + their pages in one call. Used by the
    LeftNav to render the live navigation (admin edits flow through).
    Auth-gated by the global middleware (any logged-in user can read)."""
    result = []
    for m in s.list_modules():
        m["pages"] = s.list_pages(m["module_slug"])
        result.append(m)
    return result


@router.get("/admin/modules/{slug}")
def get_module(slug: str, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    m = s.get_module(slug)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Module '{slug}' not found.")
    return m


@router.post("/admin/modules", status_code=201)
def create_module(payload: dict, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    try:
        return s.create_module(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.patch("/admin/modules/{slug}")
def update_module(slug: str, payload: dict, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    m = s.update_module(slug, payload)
    if m is None:
        raise HTTPException(status_code=404, detail=f"Module '{slug}' not found.")
    return m


@router.delete("/admin/modules/{slug}")
def delete_module(slug: str, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    if not s.delete_module(slug):
        raise HTTPException(status_code=404, detail=f"Module '{slug}' not found.")
    return {"status": "ok", "detail": f"Module '{slug}' deleted."}


@router.get("/admin/modules/{slug}/pages")
def list_pages(slug: str, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> list[dict]:
    if not s.get_module(slug):
        raise HTTPException(status_code=404, detail=f"Module '{slug}' not found.")
    return s.list_pages(slug)


@router.post("/admin/modules/{slug}/pages", status_code=201)
def create_page(slug: str, payload: dict, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    try:
        result = s.create_page(slug, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if result is None:
        raise HTTPException(status_code=404, detail=f"Module '{slug}' not found.")
    return result


@router.patch("/admin/modules/{slug}/pages/{page_slug}")
def update_page(slug: str, page_slug: str, payload: dict, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    result = s.update_page(slug, page_slug, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="Module or page not found.")
    return result


@router.delete("/admin/modules/{slug}/pages/{page_slug}")
def delete_page(slug: str, page_slug: str, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    if not s.delete_page(slug, page_slug):
        raise HTTPException(status_code=404, detail="Module or page not found.")
    return {"status": "ok", "detail": f"Page '{page_slug}' deleted."}


@router.put("/admin/modules/{slug}/roles")
def set_module_roles(slug: str, payload: dict, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    role_ids = payload.get("role_ids")
    if not isinstance(role_ids, list):
        raise HTTPException(status_code=400, detail="Body must be {role_ids: [...]}")
    if not s.set_module_roles(slug, [int(r) for r in role_ids]):
        raise HTTPException(status_code=404, detail=f"Module '{slug}' not found.")
    return s.get_module(slug) or {}


@router.put("/admin/modules/{slug}/pages/{page_slug}/roles")
def set_page_roles(slug: str, page_slug: str, payload: dict, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    role_ids = payload.get("role_ids")
    if not isinstance(role_ids, list):
        raise HTTPException(status_code=400, detail="Body must be {role_ids: [...]}")
    if not s.set_page_roles(slug, page_slug, [int(r) for r in role_ids]):
        raise HTTPException(status_code=404, detail="Module or page not found.")
    return next((p for p in s.list_pages(slug) if p["page_slug"] == page_slug), {})


@router.put("/admin/modules/{slug}/pages/{page_slug}/agents")
def set_page_agents(slug: str, page_slug: str, payload: dict, _: AuthUser = Depends(require_admin), s: ModuleConfigService = Depends(_store)) -> dict:
    aids = payload.get("agent_instance_ids")
    if not isinstance(aids, list):
        raise HTTPException(status_code=400, detail="Body must be {agent_instance_ids: [...]}")
    if not s.set_page_agents(slug, page_slug, [int(a) for a in aids]):
        raise HTTPException(status_code=404, detail="Module or page not found.")
    return next((p for p in s.list_pages(slug) if p["page_slug"] == page_slug), {})
