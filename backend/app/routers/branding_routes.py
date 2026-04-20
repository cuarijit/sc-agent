"""Branding + help routers.

GET /api/branding -> branding.json
GET /api/help/{slug} -> markdown content for a help topic
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()

REPO_ROOT = Path(__file__).resolve().parents[3]
BRANDING_PATH = REPO_ROOT / "config" / "branding" / "branding.json"
HELP_DIR = REPO_ROOT / "data" / "help" / "content"

_SLUG_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


@router.get("/api/branding")
def get_branding() -> dict:
    """Public endpoint — LoginPage and TopHeader call this without auth.

    Merges static metadata from branding.json (app_name, version, etc.) with
    the dynamic logo tokens managed by the BrandingStorage admin endpoints.
    """
    base: dict = {}
    if BRANDING_PATH.exists():
        try:
            base = json.loads(BRANDING_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            base = {}
    # Overlay dynamic logo tokens from BrandingStorage so admin edits show up
    # without needing to re-write branding.json by hand.
    try:
        from ..services.branding_storage import get_branding_storage
        live = get_branding_storage().read()
        if live.company_logo is not None:
            base["company_logo"] = live.company_logo
        if live.customer_logo is not None:
            base["customer_logo"] = live.customer_logo
        if live.tenant_logo is not None:
            base["tenant_logo"] = live.tenant_logo
    except Exception:
        pass
    base.setdefault("app_name", "Supply Chain Planning")
    return base


@router.get("/api/help/{slug}")
def get_help(slug: str) -> dict:
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug.")
    # Primary path: delegate to HelpService so admin edits / uploads
    # become live without touching disk. Legacy file fallback below for
    # docs that pre-date the manifest.
    try:
        from ..services.help_service import HelpEntryNotFound, get_help_service

        content = get_help_service().get_content(slug)
        return {"slug": slug, "content": content}
    except HelpEntryNotFound:
        pass
    except Exception:  # noqa: BLE001
        pass
    candidate = HELP_DIR / f"{slug}.md"
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"No help available for '{slug}'.")
    try:
        candidate.resolve().relative_to(HELP_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path.")
    return {"slug": slug, "content": candidate.read_text(encoding="utf-8")}
