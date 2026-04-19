"""Auth router: /auth/login, /auth/logout, /auth/me, /auth/change-password, /auth/settings."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..database import SessionLocal
from ..services.auth_dependencies import COOKIE_NAME, require_auth
from ..services.auth_store import AuthStore, AuthUser

router = APIRouter()


def _cookie_secure() -> bool:
    return (os.getenv("SCP_AUTH_COOKIE_SECURE", "false") or "false").strip().lower() == "true"


def _cookie_samesite() -> str:
    raw = (os.getenv("SCP_AUTH_COOKIE_SAMESITE", "lax") or "lax").strip().lower()
    return raw if raw in ("strict", "lax", "none") else "lax"


def _ttl_seconds() -> int:
    try:
        return int(os.getenv("SCP_AUTH_SESSION_TTL_SECONDS", "28800"))
    except ValueError:
        return 28800


def _user_payload(user: AuthUser) -> dict:
    return {
        "authenticated": True,
        "user_id": user.user_id,
        "username": user.username,
        "name": user.name,
        "email": user.email,
        "roles": user.roles,
        "entitlements": user.entitlements,
        "data_access_groups": user.data_access_groups,
    }


@router.post("/auth/login")
def login(payload: dict, response: Response) -> dict:
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password are required.")
    db = SessionLocal()
    try:
        store = AuthStore(db)
        user = store.authenticate(username, password)
        if user is None:
            raise HTTPException(status_code=401, detail="Invalid username or password.")
        token = store.create_session(user.user_id, ttl_seconds=_ttl_seconds())
        response.set_cookie(
            key=COOKIE_NAME,
            value=token,
            max_age=_ttl_seconds(),
            httponly=True,
            secure=_cookie_secure(),
            samesite=_cookie_samesite(),
            path="/",
        )
        return _user_payload(user)
    finally:
        db.close()


@router.post("/auth/logout")
def logout(request: Request, response: Response) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        db = SessionLocal()
        try:
            AuthStore(db).revoke_session(token)
        finally:
            db.close()
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"authenticated": False}


@router.get("/auth/me")
def me(user: AuthUser = Depends(require_auth)) -> dict:
    return _user_payload(user)


@router.post("/auth/change-password")
def change_password(payload: dict, user: AuthUser = Depends(require_auth)) -> dict:
    current = str(payload.get("currentPassword") or payload.get("current_password") or "")
    new_pw = str(payload.get("newPassword") or payload.get("new_password") or "")
    if not current or not new_pw:
        raise HTTPException(status_code=400, detail="currentPassword and newPassword are required.")
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
    db = SessionLocal()
    try:
        store = AuthStore(db)
        ok = store.change_password(user.user_id, current, new_pw)
        if not ok:
            raise HTTPException(status_code=401, detail="Current password is incorrect.")
        return {"status": "ok", "detail": "Password changed."}
    finally:
        db.close()


@router.get("/auth/settings")
def get_settings(user: AuthUser = Depends(require_auth)) -> dict:
    db = SessionLocal()
    try:
        return {"settings": AuthStore(db).get_user_settings(user.user_id)}
    finally:
        db.close()


@router.put("/auth/settings")
def put_settings(payload: dict, user: AuthUser = Depends(require_auth)) -> dict:
    settings = payload.get("settings") if isinstance(payload, dict) else None
    if not isinstance(settings, dict):
        raise HTTPException(status_code=400, detail="Body must be {settings: {...}}")
    db = SessionLocal()
    try:
        AuthStore(db).save_user_settings(user.user_id, settings)
        return {"status": "ok", "settings": settings}
    finally:
        db.close()
