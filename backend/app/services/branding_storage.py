"""Branding asset persistence.

v1 stores everything on the local filesystem under ``config/branding/`` so
uploads ride the same Docker bind-mount that already persists per-module
configs (see ``docker-compose.ui-api-rag.yml``). The whole module is kept
behind the ``BrandingStorage`` protocol so swapping in S3/GCS later is a
one-file change.
"""

from __future__ import annotations

import json
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Protocol

# Path tokens stored in the database / branding.json. The frontend resolves
# them to URLs under the ``/static/branding`` mount.
LIBRARY_PREFIX = "library:"
UPLOAD_PREFIX = "upload:"

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg", ".webp"}
MAX_UPLOAD_BYTES = 2 * 1024 * 1024  # 2 MB


@dataclass(frozen=True, slots=True)
class LibraryAsset:
    name: str            # filename (e.g. "Puls8-360-ads.png")
    path: str            # token form (e.g. "library:Puls8-360-ads.png")
    size_bytes: int


@dataclass(frozen=True, slots=True)
class BrandingSettings:
    company_logo: str | None = None
    customer_logo: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return {"company_logo": self.company_logo, "customer_logo": self.customer_logo}


class BrandingStorage(Protocol):
    def read(self) -> BrandingSettings: ...
    def write(self, settings: BrandingSettings) -> BrandingSettings: ...
    def list_library(self) -> list[LibraryAsset]: ...
    def save_upload(self, *, filename: str, data: bytes) -> str: ...


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


class LocalFsBrandingStorage:
    """Filesystem-backed implementation rooted at ``<repo>/config/branding``."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or (_repo_root() / "config" / "branding")
        self.library_dir = self.root / "library"
        self.uploads_dir = self.root / "uploads"
        self.settings_path = self.root / "branding.json"

    # ── settings ────────────────────────────────────────────────────────
    def read(self) -> BrandingSettings:
        self._ensure_dirs()
        if not self.settings_path.is_file():
            return BrandingSettings()
        try:
            payload = json.loads(self.settings_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return BrandingSettings()
        return BrandingSettings(
            company_logo=_normalise(payload.get("company_logo")),
            customer_logo=_normalise(payload.get("customer_logo")),
        )

    def write(self, settings: BrandingSettings) -> BrandingSettings:
        self._ensure_dirs()
        # Atomic replace so a half-written file never wins on crash.
        tmp = self.settings_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(settings.to_dict(), indent=2), encoding="utf-8")
        tmp.replace(self.settings_path)
        return settings

    # ── library ────────────────────────────────────────────────────────
    def list_library(self) -> list[LibraryAsset]:
        self._ensure_dirs()
        assets: list[LibraryAsset] = []
        for entry in sorted(self.library_dir.iterdir(), key=lambda p: p.name.lower()):
            if not entry.is_file() or entry.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue
            assets.append(LibraryAsset(
                name=entry.name,
                path=f"{LIBRARY_PREFIX}{entry.name}",
                size_bytes=entry.stat().st_size,
            ))
        return assets

    def seed_library(self, sources: Iterable[Path]) -> int:
        """Copy seed PNG/SVG files into the library on first run.

        Skips any file that already exists. Returns the number copied.
        """
        self._ensure_dirs()
        copied = 0
        for src in sources:
            if not src.is_file() or src.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue
            dest = self.library_dir / src.name
            if dest.exists():
                continue
            try:
                shutil.copy2(src, dest)
                copied += 1
            except OSError:
                continue
        return copied

    # ── uploads ────────────────────────────────────────────────────────
    def save_upload(self, *, filename: str, data: bytes) -> str:
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise ValueError(
                f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}"
            )
        if len(data) > MAX_UPLOAD_BYTES:
            raise ValueError(
                f"File too large ({len(data)} bytes). Max is {MAX_UPLOAD_BYTES}."
            )
        if len(data) == 0:
            raise ValueError("Empty file.")
        self._ensure_dirs()
        token = f"{uuid.uuid4().hex}{ext}"
        dest = self.uploads_dir / token
        dest.write_bytes(data)
        return f"{UPLOAD_PREFIX}{token}"

    # ── helpers ────────────────────────────────────────────────────────
    def _ensure_dirs(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.library_dir.mkdir(exist_ok=True)
        self.uploads_dir.mkdir(exist_ok=True)


def _normalise(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        return v or None
    return None


_storage_singleton: BrandingStorage | None = None


def get_branding_storage() -> BrandingStorage:
    global _storage_singleton
    if _storage_singleton is None:
        _storage_singleton = LocalFsBrandingStorage()
    return _storage_singleton
