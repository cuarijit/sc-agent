"""Branding admin routes — all gated by Depends(require_admin).

Public GET /api/branding stays in branding_routes.py and reads from the
same storage so the LoginPage / TopHeader can fetch logos without auth.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..services.auth_dependencies import require_admin
from ..services.auth_store import AuthUser
from ..services.branding_storage import (
    BrandingSettings,
    LocalFsBrandingStorage,
    get_branding_storage,
)

router = APIRouter()


@router.get("/admin/branding")
def get_branding(_: AuthUser = Depends(require_admin)) -> dict:
    s = get_branding_storage().read()
    return {
        "company_logo": s.company_logo,
        "customer_logo": s.customer_logo,
    }


@router.put("/admin/branding")
def put_branding(payload: dict, _: AuthUser = Depends(require_admin)) -> dict:
    settings = BrandingSettings(
        company_logo=payload.get("company_logo"),
        customer_logo=payload.get("customer_logo"),
    )
    saved = get_branding_storage().write(settings)
    return {
        "company_logo": saved.company_logo,
        "customer_logo": saved.customer_logo,
    }


@router.get("/admin/branding/assets")
def list_assets(_: AuthUser = Depends(require_admin)) -> dict:
    storage = get_branding_storage()
    if isinstance(storage, LocalFsBrandingStorage):
        assets = storage.list_library()
        return {
            "library": [
                {"name": a.name, "path": a.path, "size_bytes": a.size_bytes}
                for a in assets
            ],
        }
    return {"library": []}


@router.post("/admin/branding/upload")
async def upload_asset(
    file: UploadFile = File(...),
    _: AuthUser = Depends(require_admin),
) -> dict:
    storage = get_branding_storage()
    if not isinstance(storage, LocalFsBrandingStorage):
        raise HTTPException(status_code=400, detail="Upload not supported on configured storage.")
    data = await file.read()
    try:
        token = storage.save_upload(filename=file.filename or "upload.png", data=data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"path": token, "size_bytes": len(data)}
