"""Admin routes for the Help / Documentation Management feature.

All endpoints require the `admin` role. Public read of help content stays
on `GET /api/help/{slug}` (in branding_routes.py) so the in-app help drawer
keeps working without auth.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..services.auth_dependencies import require_admin
from ..services.auth_store import AuthUser
from ..services.help_service import (
    HelpEntryNotFound,
    HelpService,
    HelpServiceError,
    get_help_service,
)

router = APIRouter()

MAX_MD_BYTES = 512 * 1024  # 512 KB ceiling per upload


@router.get("/admin/help/manifest")
def read_manifest(
    _: AuthUser = Depends(require_admin),
    service: HelpService = Depends(get_help_service),
) -> dict[str, object]:
    return service.get_manifest()


@router.put("/admin/help/manifest")
def write_manifest(
    payload: dict[str, object],
    _: AuthUser = Depends(require_admin),
    service: HelpService = Depends(get_help_service),
) -> dict[str, object]:
    try:
        return service.update_manifest(payload)
    except HelpServiceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/admin/help/content/{entry_id}")
def read_content(
    entry_id: str,
    _: AuthUser = Depends(require_admin),
    service: HelpService = Depends(get_help_service),
) -> dict[str, str]:
    try:
        content = service.get_content(entry_id)
    except HelpEntryNotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"entry_id": entry_id, "content": content}


@router.put("/admin/help/content/{entry_id}")
def write_content(
    entry_id: str,
    payload: dict[str, str],
    _: AuthUser = Depends(require_admin),
    service: HelpService = Depends(get_help_service),
) -> dict[str, str]:
    content = payload.get("content")
    if content is None:
        raise HTTPException(status_code=400, detail="'content' is required")
    try:
        service.update_content(entry_id, content)
    except HelpEntryNotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"entry_id": entry_id, "content": content}


@router.post("/admin/help/entry")
def create_entry(
    payload: dict[str, object],
    _: AuthUser = Depends(require_admin),
    service: HelpService = Depends(get_help_service),
) -> dict[str, object]:
    try:
        return service.add_entry(payload)
    except HelpServiceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/admin/help/entry/{entry_id}")
def delete_entry(
    entry_id: str,
    _: AuthUser = Depends(require_admin),
    service: HelpService = Depends(get_help_service),
) -> dict[str, str]:
    try:
        service.delete_entry(entry_id)
    except HelpEntryNotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"status": "deleted", "entry_id": entry_id}


@router.post("/admin/help/upload/{entry_id}")
async def upload_markdown(
    entry_id: str,
    file: UploadFile = File(...),
    _: AuthUser = Depends(require_admin),
    service: HelpService = Depends(get_help_service),
) -> dict[str, object]:
    """Replace an existing entry's content from an uploaded .md file."""
    name = (file.filename or "").lower()
    if not (name.endswith(".md") or name.endswith(".markdown") or name.endswith(".txt")):
        raise HTTPException(status_code=400, detail="Only .md / .markdown / .txt files accepted.")
    raw = await file.read()
    if len(raw) > MAX_MD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (>{MAX_MD_BYTES} bytes).")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=400, detail="File is not valid UTF-8.") from e
    try:
        service.update_content(entry_id, text)
    except HelpEntryNotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"entry_id": entry_id, "size_bytes": len(raw)}
