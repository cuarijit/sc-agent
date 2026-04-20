"""HelpService — filesystem-backed help/user-guide manager.

Mirrors the scp-main implementation:
  - manifest at  backend/data/help/help_manifest.json
  - one markdown file per entry at backend/data/help/content/{entry_id}.md

The same files are also served by the public read endpoint
GET /api/help/{slug} (slug = entry_id), so the existing PageHelpDrawer
keeps working and admin edits become live without a hard refresh.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class HelpServiceError(Exception):
    pass


class HelpEntryNotFound(HelpServiceError):
    pass


class HelpService:
    def __init__(self, root: Path | None = None) -> None:
        if root is None:
            # backend/app/services/help_service.py → parents[2] == backend/
            root = Path(__file__).resolve().parents[2] / "data" / "help"
        self.root = root
        self.content_dir = self.root / "content"
        self.manifest_path = self.root / "help_manifest.json"
        self.root.mkdir(parents=True, exist_ok=True)
        self.content_dir.mkdir(parents=True, exist_ok=True)
        if not self.manifest_path.exists():
            self._write_manifest({"version": 1, "entries": []})

    # ── manifest ───────────────────────────────────────────────────────
    def get_manifest(self) -> dict[str, Any]:
        raw = self.manifest_path.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict) or "entries" not in data:
            return {"version": 1, "entries": []}
        return data

    def update_manifest(self, manifest: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(manifest, dict) or "entries" not in manifest:
            raise HelpServiceError("manifest must include an 'entries' array")
        entries = manifest.get("entries")
        if not isinstance(entries, list):
            raise HelpServiceError("'entries' must be a list")
        payload = {"version": int(manifest.get("version", 1)), "entries": entries}
        self._write_manifest(payload)
        return payload

    # ── content ────────────────────────────────────────────────────────
    def get_content(self, entry_id: str) -> str:
        path = self._content_path_for(entry_id)
        if not path.exists():
            raise HelpEntryNotFound(f"content for entry '{entry_id}' not found")
        return path.read_text(encoding="utf-8")

    def update_content(self, entry_id: str, content: str) -> None:
        self._require_entry(entry_id)
        path = self._content_path_for(entry_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    # ── entries ────────────────────────────────────────────────────────
    def add_entry(self, entry: dict[str, Any]) -> dict[str, Any]:
        entry_id = str(entry.get("id", "")).strip()
        if not entry_id:
            raise HelpServiceError("entry.id is required")
        manifest = self.get_manifest()
        for existing in manifest["entries"]:
            if existing.get("id") == entry_id:
                raise HelpServiceError(f"entry '{entry_id}' already exists")
        content_file = entry.get("content_file") or f"content/{entry_id}.md"
        normalized = {
            "id": entry_id,
            "type": entry.get("type") or "page",
            "title": entry.get("title") or entry_id,
            "description": entry.get("description") or "",
            "icon": entry.get("icon"),
            "content_file": content_file,
            "route_path": entry.get("route_path") or "",
            "parent_id": entry.get("parent_id"),
            "order": int(entry.get("order") or 0),
        }
        manifest["entries"].append(normalized)
        self._write_manifest(manifest)
        content_path = self.root / content_file
        if not content_path.exists():
            content_path.parent.mkdir(parents=True, exist_ok=True)
            seed = entry.get("content") or f"# {normalized['title']}\n\n_Documentation pending._\n"
            content_path.write_text(seed, encoding="utf-8")
        return normalized

    def delete_entry(self, entry_id: str) -> None:
        manifest = self.get_manifest()
        remaining = [e for e in manifest["entries"] if e.get("id") != entry_id]
        if len(remaining) == len(manifest["entries"]):
            raise HelpEntryNotFound(f"entry '{entry_id}' not found")
        removed = next(e for e in manifest["entries"] if e.get("id") == entry_id)
        manifest["entries"] = remaining
        self._write_manifest(manifest)
        content_file = removed.get("content_file") or f"content/{entry_id}.md"
        path = self.root / content_file
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass

    # ── internals ──────────────────────────────────────────────────────
    def _require_entry(self, entry_id: str) -> dict[str, Any]:
        manifest = self.get_manifest()
        for entry in manifest["entries"]:
            if entry.get("id") == entry_id:
                return entry
        raise HelpEntryNotFound(f"entry '{entry_id}' not found")

    def _content_path_for(self, entry_id: str) -> Path:
        entry = self._require_entry(entry_id)
        return self.root / (entry.get("content_file") or f"content/{entry_id}.md")

    def _write_manifest(self, manifest: dict[str, Any]) -> None:
        self.manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )


_HELP_SERVICE: HelpService | None = None


def get_help_service() -> HelpService:
    global _HELP_SERVICE
    if _HELP_SERVICE is None:
        _HELP_SERVICE = HelpService()
    return _HELP_SERVICE
