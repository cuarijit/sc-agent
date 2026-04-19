"""Admin router: /admin/users, /admin/roles, /admin/entitlements, /admin/data-access-groups.

All endpoints require admin role.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..database import SessionLocal
from ..services.auth_dependencies import require_admin
from ..services.auth_store import AuthStore, AuthUser

router = APIRouter()


def _store():
    db = SessionLocal()
    try:
        yield AuthStore(db)
    finally:
        db.close()


# ---------- USERS ----------

@router.get("/admin/users")
def list_users(_: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> list[dict]:
    return store.list_users()


@router.get("/admin/users/{user_id}")
def get_user(user_id: int, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    user = store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


@router.post("/admin/users", status_code=201)
def create_user(payload: dict, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    name = str(payload.get("name") or "")
    email = str(payload.get("email") or "")
    roles = payload.get("roles") if isinstance(payload.get("roles"), list) else None
    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password are required.")
    try:
        result = store.create_user(username=username, password=password, name=name, email=email, roles=roles)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "id": result.user_id, "username": result.username, "name": result.name,
        "email": result.email, "is_active": result.is_active, "roles": result.roles,
    }


@router.post("/admin/users/{user_id}/profile")
def update_profile(user_id: int, payload: dict, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    name = payload.get("name")
    email = payload.get("email")
    user = store.update_user_profile(user_id, name=name, email=email)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return store.get_user(user_id) or {}


@router.post("/admin/users/{user_id}/role")
def set_role(user_id: int, payload: dict, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    role = payload.get("role")
    roles = payload.get("roles")
    if isinstance(role, str):
        roles_list = [role]
    elif isinstance(roles, list):
        roles_list = [str(r) for r in roles]
    else:
        raise HTTPException(status_code=400, detail="Provide 'role' (str) or 'roles' (list).")
    if not store.get_user(user_id):
        raise HTTPException(status_code=404, detail="User not found.")
    store.set_user_roles(user_id, roles_list)
    return store.get_user(user_id) or {}


@router.post("/admin/users/{user_id}/reset-password")
def reset_password(user_id: int, payload: dict, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    new_password = str(payload.get("new_password") or payload.get("newPassword") or "")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if not store.reset_user_password(user_id, new_password):
        raise HTTPException(status_code=404, detail="User not found.")
    return {"status": "ok", "detail": "Password reset."}


@router.delete("/admin/users/{user_id}")
def delete_user(user_id: int, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    if not store.delete_user(user_id):
        raise HTTPException(status_code=404, detail="User not found.")
    return {"status": "ok", "detail": "User deleted."}


@router.post("/admin/users/{user_id}/data-access-groups")
def set_user_dags(user_id: int, payload: dict, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    groups = payload.get("groups")
    if not isinstance(groups, list):
        raise HTTPException(status_code=400, detail="Body must be {groups: [...]}")
    if not store.set_user_data_access_groups(user_id, [str(g) for g in groups]):
        raise HTTPException(status_code=404, detail="User not found.")
    return store.get_user(user_id) or {}


# ---------- ROLES ----------

@router.get("/admin/roles")
def list_roles(_: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    """Wrapped shape `{roles: [...]}` matches the puls8 frontend client
    (`fetchRoles` in agentConfigApi.ts unwraps `response.roles`)."""
    return {"roles": store.list_roles()}


@router.post("/admin/roles", status_code=201)
def create_role(payload: dict, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    name = str(payload.get("name") or "").strip()
    entitlements = payload.get("entitlements") if isinstance(payload.get("entitlements"), list) else None
    try:
        return store.create_role(name, entitlements)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/admin/roles/{role_id}")
def update_role(role_id: int, payload: dict, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    name = payload.get("name")
    entitlements = payload.get("entitlements") if isinstance(payload.get("entitlements"), list) else None
    result = store.update_role(role_id, name=name, entitlements=entitlements)
    if result is None:
        raise HTTPException(status_code=404, detail="Role not found.")
    return result


@router.delete("/admin/roles/{role_id}")
def delete_role(role_id: int, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    try:
        ok = store.delete_role(role_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not ok:
        raise HTTPException(status_code=404, detail="Role not found.")
    return {"status": "ok", "detail": "Role deleted."}


# ---------- ENTITLEMENTS ----------

@router.get("/admin/entitlements")
def list_entitlements(_: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> list[dict]:
    return store.list_entitlements()


# ---------- DATA ACCESS GROUPS ----------

@router.get("/admin/data-access-groups")
def list_data_access_groups(_: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> list[dict]:
    return store.list_data_access_groups()


@router.post("/admin/data-access-groups", status_code=201)
def create_data_access_group(payload: dict, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    name = str(payload.get("name") or "").strip()
    description = str(payload.get("description") or "")
    try:
        return store.create_data_access_group(name, description)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/admin/data-access-groups/{group_id}")
def update_data_access_group(group_id: int, payload: dict, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    result = store.update_data_access_group(
        group_id, name=payload.get("name"), description=payload.get("description"),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Group not found.")
    return result


@router.delete("/admin/data-access-groups/{group_id}")
def delete_data_access_group(group_id: int, _: AuthUser = Depends(require_admin), store: AuthStore = Depends(_store)) -> dict:
    if not store.delete_data_access_group(group_id):
        raise HTTPException(status_code=404, detail="Group not found.")
    return {"status": "ok", "detail": "Group deleted."}
