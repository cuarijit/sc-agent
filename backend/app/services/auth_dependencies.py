"""FastAPI dependency factories for authentication and authorization.

Honours SCP_AUTH_ENABLED env var:
- "true" (default): real auth — cookie -> session -> AuthUser
- "false": synthetic admin user, all endpoints open (for demo/CI)
"""
from __future__ import annotations

import os
from typing import Callable

from fastapi import Cookie, Depends, HTTPException, Request

from ..database import SessionLocal
from .auth_store import AuthStore, AuthUser


COOKIE_NAME = os.getenv("SCP_AUTH_COOKIE_NAME", "scp_session")


def _auth_enabled() -> bool:
    return (os.getenv("SCP_AUTH_ENABLED", "true") or "true").strip().lower() != "false"


def _synthetic_admin() -> AuthUser:
    return AuthUser(
        user_id=0,
        username="planner",
        name="Synthetic Admin (auth disabled)",
        email="planner@local",
        is_active=True,
        roles=["admin"],
        entitlements=["*"],
        data_access_groups=[],
    )


def _resolve_user(request: Request) -> AuthUser | None:
    if not _auth_enabled():
        return _synthetic_admin()
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    db = SessionLocal()
    try:
        store = AuthStore(db)
        return store.validate_session(token)
    finally:
        db.close()


def require_auth(request: Request) -> AuthUser:
    user = _resolve_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user


def require_admin(request: Request) -> AuthUser:
    user = require_auth(request)
    if "admin" in user.roles or "*" in user.entitlements:
        return user
    raise HTTPException(status_code=403, detail="Administrator access required.")


def require_entitlement(entitlement_key: str) -> Callable[[Request], AuthUser]:
    def _checker(request: Request) -> AuthUser:
        user = require_auth(request)
        if "admin" in user.roles or "*" in user.entitlements:
            return user
        if entitlement_key in user.entitlements:
            return user
        raise HTTPException(status_code=403, detail=f"Missing entitlement: {entitlement_key}")
    return _checker


def optional_auth(request: Request) -> AuthUser | None:
    """Like require_auth but returns None instead of raising — for endpoints
    that work both authed and unauthed (e.g. /api/health, /api/branding)."""
    return _resolve_user(request)
