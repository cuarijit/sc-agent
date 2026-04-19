"""Global auth middleware. Auth-gates every request except a public allow-list.

This is the safety net: per-route Depends(require_entitlement) provides
finer-grained control on top, but this middleware guarantees that nothing
slips through without authentication.
"""
from __future__ import annotations

import os
import re
from typing import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from ..database import SessionLocal
from .auth_store import AuthStore


COOKIE_NAME = os.getenv("SCP_AUTH_COOKIE_NAME", "scp_session")

# Public paths — no auth required. Patterns are anchored prefix matches.
PUBLIC_PATHS: tuple[str, ...] = (
    "/api/health",
    "/auth/login",
    "/api/branding",
    "/api/help/",
    "/static/branding/",  # logos served via StaticFiles mount; LoginPage needs them pre-auth
    "/docs",
    "/openapi.json",
    "/redoc",
)


def _auth_enabled() -> bool:
    return (os.getenv("SCP_AUTH_ENABLED", "true") or "true").strip().lower() != "false"


def _is_public(path: str, public_paths: Iterable[str]) -> bool:
    for p in public_paths:
        if path == p or path.startswith(p):
            return True
    return False


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if not _auth_enabled():
            return await call_next(request)

        path = request.url.path
        method = request.method.upper()

        # Always allow CORS preflights.
        if method == "OPTIONS":
            return await call_next(request)

        if _is_public(path, PUBLIC_PATHS):
            return await call_next(request)

        token = request.cookies.get(COOKIE_NAME)
        if not token:
            return JSONResponse({"detail": "Authentication required."}, status_code=401)

        # Validate session against the DB.
        db = SessionLocal()
        try:
            user = AuthStore(db).validate_session(token)
        finally:
            db.close()

        if user is None:
            return JSONResponse({"detail": "Invalid or expired session."}, status_code=401)

        # Stash on request.state so downstream Depends() factories can reuse.
        request.state.auth_user = user
        return await call_next(request)
