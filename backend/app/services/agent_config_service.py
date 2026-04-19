from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..database import Base, engine, apply_additive_column_migrations
from ..models import (
    AgentInstanceDatasetBinding,
    AgentInstanceRecord,
    AgentTemplateRecord,
    SemanticSlotDefinition,
)

INSTANCE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_load_dict(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _json_load_list(raw: str | None) -> list[Any]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _json_dump(value: Any, *, default: str = "{}") -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return default


def _deep_merge(base: dict[str, Any] | None, override: dict[str, Any] | None) -> dict[str, Any]:
    """Return a new dict where ``override`` is deep-merged over ``base``.

    Dict values recurse; every other value (list, scalar, None) is replaced wholesale
    by the override so instances can cleanly replace list-valued template sections.
    """
    merged: dict[str, Any] = copy.deepcopy(base) if isinstance(base, dict) else {}
    if not isinstance(override, dict):
        return merged
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


class AgentConfigService:
    def __init__(self, db: Session):
        self.db = db
        self.repo_root = Path(__file__).resolve().parents[3]
        self.templates_dir = self.repo_root / "config" / "agent" / "templates"
        self.instances_dir = self.repo_root / "config" / "agent" / "instances"
        self.semantic_slots_dir = self.repo_root / "config" / "agent" / "semantic_slots"
        Base.metadata.create_all(bind=engine)
        # Apply any additive column migrations on long-lived SQLite volumes
        # before we touch the tables via ORM queries.
        apply_additive_column_migrations()
        self._ensure_seed_data()
        self._load_semantic_slots_from_filesystem()

    def _ensure_seed_data(self) -> None:
        templates_count = self.db.query(AgentTemplateRecord).count()
        instances_count = self.db.query(AgentInstanceRecord).count()

        # Filesystem JSON is the bootstrap source on first boot, and a fresh
        # deployment that bumps `template_version` in a shipped JSON will still
        # upgrade the DB row on boot. Otherwise the DB stays authoritative so
        # admin UI edits (PATCH/PUT) persist across requests. An explicit
        # `POST /admin/agent-templates/reload` force-refreshes everything.
        if templates_count == 0:
            template_loaded = self._load_templates_from_filesystem(force=True)
            if template_loaded == 0:
                self._seed_builtin_templates()
        else:
            self._load_templates_from_filesystem(force=False)

        if instances_count == 0:
            instance_loaded = self._load_instances_from_filesystem()
            if instance_loaded == 0:
                self._seed_builtin_instances()
        else:
            # Pick up newly-shipped instance JSONs (e.g. reference
            # `stockout-resolver`, `excess-optimizer`, `promo-readiness`)
            # without clobbering admin edits to existing rows.
            self._load_instances_from_filesystem(only_new=True)

        # Keep existing DBs aligned with renamed MEIO identifiers/content.
        self._migrate_legacy_360_to_meio()
        self._purge_retired_agents()

    def _migrate_legacy_360_to_meio(self) -> None:
        changed = False
        now = _now_iso()

        legacy = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == "360-data-assistant").first()
        meio = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == "meio-data-assistant").first()
        if legacy is not None:
            if meio is None:
                legacy.instance_id = "meio-data-assistant"
                legacy.display_name = "MEIO Data Assistant"
                if legacy.description:
                    legacy.description = legacy.description.replace("360", "MEIO")
                legacy.updated_at = now
                changed = True
            else:
                self.db.delete(legacy)
                changed = True

        for row in self.db.query(AgentInstanceRecord).all():
            row_changed = False
            if row.display_name and "360" in row.display_name:
                row.display_name = row.display_name.replace("360", "MEIO")
                row_changed = True
            if row.description and "360" in row.description:
                row.description = row.description.replace("360", "MEIO")
                row_changed = True
            if row_changed:
                row.updated_at = now
                changed = True

        for tpl in self.db.query(AgentTemplateRecord).all():
            tpl_changed = False
            if tpl.behavior_json and "\"360\"" in tpl.behavior_json:
                tpl.behavior_json = tpl.behavior_json.replace("\"360\"", "\"meio\"")
                tpl_changed = True
            if tpl.description and "360" in tpl.description:
                tpl.description = tpl.description.replace("360", "MEIO")
                tpl_changed = True
            if tpl_changed:
                tpl.updated_at = now
                changed = True

        if changed:
            self.db.commit()

    def _purge_retired_agents(self) -> None:
        retired_instance_ids = {"adoption-management", "scp-data-assistant"}
        retired_type_keys = {"adoption_management"}
        changed = False

        instances = (
            self.db.query(AgentInstanceRecord)
            .filter(
                (AgentInstanceRecord.instance_id.in_(retired_instance_ids))
                | (AgentInstanceRecord.agent_type.in_(retired_type_keys))
            )
            .all()
        )
        for row in instances:
            self.db.delete(row)
            changed = True

        templates = (
            self.db.query(AgentTemplateRecord)
            .filter(AgentTemplateRecord.type_key.in_(retired_type_keys))
            .all()
        )
        for row in templates:
            self.db.delete(row)
            changed = True

        if changed:
            self.db.commit()

    def _normalize_instance_id(self, raw: Any) -> str:
        text = str(raw or "").strip().lower()
        text = re.sub(r"[\s_]+", "-", text)
        text = re.sub(r"[^a-z0-9-]", "", text)
        text = re.sub(r"-{2,}", "-", text).strip("-")
        if not text:
            return ""
        if not INSTANCE_ID_RE.match(text):
            return ""
        return text

    def _seed_builtin_templates(self) -> None:
        now = _now_iso()
        defaults: list[dict[str, Any]] = [
            {
                "type_key": "data_search_agent",
                "display_name": "Data Search Assistant",
                "description": "Queries data sources via natural language and applies page-level filters.",
                "status": "active",
                "available_actions": ["query", "set_page_filter", "export_results", "explain"],
                "handler_hint": "rag_chat",
                "assistant_mode": "search-data-assistant",
                "template_version": 1,
                "config_schema": {"type": "object", "properties": {}},
                "default_config": {},
                "default_instance": {
                    "icon": "AutoAwesomeOutlined",
                    "button_text": "Data Search",
                    "button_style": "icon_and_text",
                    "tooltip_text": "SCP Data Search Assistant",
                    "config_ref": "analytics.json",
                },
                "ui_hints": {"sections": []},
                "behavior": {},
            },
        ]

        for entry in defaults:
            self.db.add(
                AgentTemplateRecord(
                    type_key=entry["type_key"],
                    display_name=entry["display_name"],
                    description=entry["description"],
                    status=entry["status"],
                    available_actions_json=_json_dump(entry["available_actions"], default="[]"),
                    handler_hint=entry["handler_hint"],
                    assistant_mode=entry["assistant_mode"],
                    template_version=int(entry["template_version"]),
                    config_schema_json=_json_dump(entry["config_schema"]),
                    default_config_json=_json_dump(entry["default_config"]),
                    default_instance_json=_json_dump(entry["default_instance"]),
                    ui_hints_json=_json_dump(entry["ui_hints"]),
                    behavior_json=_json_dump(entry["behavior"]),
                    updated_at=now,
                )
            )

        self.db.commit()

    def _load_templates_from_filesystem(self, *, force: bool = True) -> int:
        """Upsert templates from the filesystem into the DB.

        When ``force`` is True (the default, matching POST /admin/agent-templates/reload)
        every filesystem JSON overwrites its DB row. When False, a filesystem JSON is
        only applied if its ``template_version`` is greater than the DB row's version —
        this lets shipped updates propagate on boot without stomping admin UI edits.
        """
        if not self.templates_dir.is_dir():
            return 0

        loaded = 0
        for path in sorted(self.templates_dir.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(payload, dict):
                continue

            type_key = str(payload.get("type_key") or "").strip()
            if not type_key:
                continue

            row = self.db.query(AgentTemplateRecord).filter(AgentTemplateRecord.type_key == type_key).first()
            file_version = int(payload.get("template_version") or 1)
            if not force and row is not None and int(row.template_version or 0) >= file_version:
                continue
            now = _now_iso()

            display_name = str(payload.get("display_name") or type_key)
            description = str(payload.get("description") or "")
            status = str(payload.get("status") or "active")
            available_actions = payload.get("available_actions") if isinstance(payload.get("available_actions"), list) else []
            handler_hint = str(payload.get("handler_hint") or "chat_only")
            assistant_mode = str(payload.get("assistant_mode") or "search-data-assistant")
            template_version = int(payload.get("template_version") or 1)
            config_schema = payload.get("config_schema") if isinstance(payload.get("config_schema"), dict) else {}
            default_config = payload.get("default_config") if isinstance(payload.get("default_config"), dict) else {}
            default_instance = payload.get("default_instance") if isinstance(payload.get("default_instance"), dict) else {}
            ui_hints = payload.get("ui_hints") if isinstance(payload.get("ui_hints"), dict) else {}
            behavior = payload.get("behavior") if isinstance(payload.get("behavior"), dict) else {}

            if row is None:
                row = AgentTemplateRecord(type_key=type_key, display_name=display_name, updated_at=now)
                self.db.add(row)

            row.display_name = display_name
            row.description = description
            row.status = status
            row.available_actions_json = _json_dump(available_actions, default="[]")
            row.handler_hint = handler_hint
            row.assistant_mode = assistant_mode
            row.template_version = template_version
            row.config_schema_json = _json_dump(config_schema)
            row.default_config_json = _json_dump(default_config)
            row.default_instance_json = _json_dump(default_instance)
            row.ui_hints_json = _json_dump(ui_hints)
            row.behavior_json = _json_dump(behavior)
            row.updated_at = now
            loaded += 1

        if loaded:
            self.db.commit()
        return loaded

    def _load_instances_from_filesystem(self, *, only_new: bool = False) -> int:
        if not self.instances_dir.is_dir():
            return 0

        loaded = 0
        for path in sorted(self.instances_dir.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(payload, dict):
                continue

            instance_id = str(payload.get("instance_id") or "").strip()
            agent_type = str(payload.get("agent_type") or "").strip()
            display_name = str(payload.get("display_name") or "").strip()
            if not instance_id or not agent_type or not display_name:
                continue

            now = _now_iso()
            row = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == instance_id).first()
            if row is None:
                row = AgentInstanceRecord(
                    instance_id=instance_id,
                    agent_type=agent_type,
                    display_name=display_name,
                    created_at=str(payload.get("created_at") or now),
                    updated_at=str(payload.get("updated_at") or now),
                )
                self.db.add(row)
            elif only_new:
                # Additive-only mode: a shipped instance JSON never overwrites
                # an existing DB row, so admin UI edits persist across boots.
                continue

            row.agent_type = agent_type
            row.display_name = display_name
            row.icon = payload.get("icon") if isinstance(payload.get("icon"), str) else None
            row.button_text = payload.get("button_text") if isinstance(payload.get("button_text"), str) else None
            row.button_style = str(payload.get("button_style") or "icon_and_text")
            row.tooltip_text = payload.get("tooltip_text") if isinstance(payload.get("tooltip_text"), str) else None
            row.description = payload.get("description") if isinstance(payload.get("description"), str) else None
            row.source_directory = payload.get("source_directory") if isinstance(payload.get("source_directory"), str) else None
            row.config_ref = payload.get("config_ref") if isinstance(payload.get("config_ref"), str) else None
            row.module_slug = payload.get("module_slug") if isinstance(payload.get("module_slug"), str) else None
            row.type_specific_config_json = _json_dump(payload.get("type_specific_config") if isinstance(payload.get("type_specific_config"), dict) else {})
            row.is_active = bool(payload.get("is_active", True))
            if not row.created_at:
                row.created_at = now
            row.updated_at = str(payload.get("updated_at") or now)
            loaded += 1

        if loaded:
            self.db.commit()
        return loaded

    def _seed_builtin_instances(self) -> None:
        now = _now_iso()
        templates = {t.type_key: t for t in self.db.query(AgentTemplateRecord).all()}
        seeds = [
            {
                "instance_id": "scp-data-assistant",
                "agent_type": "data_search_agent",
                "display_name": "SCP Data Assistant",
                "module_slug": "meio-replenishment",
            },
        ]
        for seed in seeds:
            template = templates.get(seed["agent_type"])
            default_instance = _json_load_dict(template.default_instance_json) if template else {}
            default_config = _json_load_dict(template.default_config_json) if template else {}
            self.db.add(
                AgentInstanceRecord(
                    instance_id=seed["instance_id"],
                    agent_type=seed["agent_type"],
                    display_name=seed["display_name"],
                    icon=str(default_instance.get("icon") or "SmartToyOutlined"),
                    button_text=str(default_instance.get("button_text") or "Ask Agent"),
                    button_style=str(default_instance.get("button_style") or "icon_and_text"),
                    tooltip_text=str(default_instance.get("tooltip_text") or ""),
                    description=seed["display_name"],
                    module_slug=seed["module_slug"],
                    config_ref=(str(default_instance.get("config_ref")) if default_instance.get("config_ref") else None),
                    type_specific_config_json=_json_dump(default_config),
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                )
            )
        self.db.commit()

    def reload_templates(self) -> int:
        return self._load_templates_from_filesystem()

    def list_roles(self) -> list[dict[str, Any]]:
        return [
            {"id": 1, "name": "admin", "is_system": True, "entitlement_keys": ["*"]},
            {"id": 2, "name": "planner", "is_system": True, "entitlement_keys": []},
            {"id": 3, "name": "analyst", "is_system": True, "entitlement_keys": []},
        ]

    def list_modules(self) -> list[dict[str, Any]]:
        return [
            {
                "module_slug": "demand-analysis",
                "label": "Demand Analysis",
                "description": "Demand analysis planning module",
                "documentation": None,
                "config_root": None,
                "is_active": True,
                "icon": "AnalyticsOutlined",
                "sort_order": 10,
                "landing_page_slug": "forecast-alerts",
            },
            {
                "module_slug": "meio-replenishment",
                "label": "MEIO and Replenishment",
                "description": "MEIO and replenishment planning module",
                "documentation": None,
                "config_root": None,
                "is_active": True,
                "icon": "HubOutlined",
                "sort_order": 20,
                "landing_page_slug": "dashboard",
            },
            {
                "module_slug": "agentic-ai",
                "label": "Agentic AI",
                "description": "Agentic AI module",
                "documentation": None,
                "config_root": None,
                "is_active": True,
                "icon": "SmartToyOutlined",
                "sort_order": 30,
                "landing_page_slug": "global-filter-compliance",
            },
        ]

    def _template_to_payload(self, row: AgentTemplateRecord) -> dict[str, Any]:
        return {
            "type_key": row.type_key,
            "display_name": row.display_name,
            "description": row.description,
            "status": row.status,
            "available_actions": _json_load_list(row.available_actions_json),
            "handler_hint": row.handler_hint,
            "assistant_mode": row.assistant_mode,
            "template_version": row.template_version,
            "config_schema": _json_load_dict(row.config_schema_json),
            "default_config": _json_load_dict(row.default_config_json),
            "default_instance": _json_load_dict(row.default_instance_json),
            "ui_hints": _json_load_dict(row.ui_hints_json),
            "behavior": _json_load_dict(row.behavior_json),
        }

    def list_agent_types(self) -> list[dict[str, Any]]:
        rows = self.db.query(AgentTemplateRecord).order_by(AgentTemplateRecord.type_key.asc()).all()
        return [self._template_to_payload(row) for row in rows]

    def get_agent_template(self, type_key: str) -> dict[str, Any] | None:
        row = self.db.query(AgentTemplateRecord).filter(AgentTemplateRecord.type_key == type_key).first()
        if row is None:
            return None
        return self._template_to_payload(row)

    def update_agent_template(self, type_key: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        row = self.db.query(AgentTemplateRecord).filter(AgentTemplateRecord.type_key == type_key).first()
        if row is None:
            return None

        changed = False
        if isinstance(updates.get("display_name"), str):
            row.display_name = updates["display_name"].strip() or row.display_name
            changed = True
        if isinstance(updates.get("description"), str):
            row.description = updates["description"]
            changed = True

        for field, attr, default_json in (
            ("default_config", "default_config_json", "{}"),
            ("default_instance", "default_instance_json", "{}"),
            ("ui_hints", "ui_hints_json", "{}"),
            ("behavior", "behavior_json", "{}"),
        ):
            if field in updates and isinstance(updates.get(field), dict):
                setattr(row, attr, _json_dump(updates[field], default=default_json))
                changed = True

        if changed:
            row.updated_at = _now_iso()
            self.db.commit()
            self.db.refresh(row)

        return self._template_to_payload(row)

    def publish_agent_template(self, type_key: str) -> dict[str, Any] | None:
        row = self.db.query(AgentTemplateRecord).filter(AgentTemplateRecord.type_key == type_key).first()
        if row is None:
            return None
        row.template_version = int(row.template_version or 0) + 1
        row.status = "active"
        row.updated_at = _now_iso()
        self.db.commit()
        self.db.refresh(row)
        return self._template_to_payload(row)

    def sync_template_instances(self, type_key: str) -> dict[str, Any] | None:
        template = self.db.query(AgentTemplateRecord).filter(AgentTemplateRecord.type_key == type_key).first()
        if template is None:
            return None

        defaults = _json_load_dict(template.default_config_json)
        fields_added: set[str] = set()
        synced_count = 0
        now = _now_iso()

        rows = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.agent_type == type_key).all()
        for row in rows:
            current = _json_load_dict(row.type_specific_config_json)
            changed = False
            for key, value in defaults.items():
                if key not in current:
                    current[key] = copy.deepcopy(value)
                    fields_added.add(key)
                    changed = True
            if changed:
                row.type_specific_config_json = _json_dump(current)
                row.updated_at = now
                synced_count += 1

        if synced_count > 0:
            self.db.commit()

        return {
            "status": "ok",
            "synced_count": synced_count,
            "fields_added": sorted(fields_added),
            "warnings": [],
        }

    def _instance_to_payload(self, row: AgentInstanceRecord, template_map: dict[str, AgentTemplateRecord]) -> dict[str, Any]:
        role_ids = [int(v) for v in _json_load_list(row.role_ids_json) if isinstance(v, (int, float, str)) and str(v).isdigit()]
        action_permissions_raw = _json_load_dict(row.action_permissions_json)
        action_permissions: dict[str, list[int]] = {}
        for action, values in action_permissions_raw.items():
            if not isinstance(values, list):
                continue
            parsed = [int(v) for v in values if isinstance(v, (int, float, str)) and str(v).isdigit()]
            action_permissions[str(action)] = parsed

        type_specific_config = _json_load_dict(row.type_specific_config_json)
        template = template_map.get(row.agent_type)

        template_version: int | None = None
        template_sync_status = "unknown"
        behavior: dict[str, Any] = {}

        if template is not None:
            template_version = int(template.template_version)
            defaults = _json_load_dict(template.default_config_json)
            missing = [key for key in defaults.keys() if key not in type_specific_config]
            template_sync_status = "synced" if not missing else "outdated"
            behavior = _json_load_dict(template.behavior_json)

        return {
            "id": row.id,
            "instance_id": row.instance_id,
            "agent_type": row.agent_type,
            "display_name": row.display_name,
            "icon": row.icon,
            "button_text": row.button_text,
            "button_style": row.button_style,
            "tooltip_text": row.tooltip_text,
            "description": row.description,
            "source_directory": row.source_directory,
            "config_ref": row.config_ref,
            "module_slug": row.module_slug,
            "role_ids": role_ids,
            "action_permissions": action_permissions,
            "type_specific_config": type_specific_config,
            "is_active": bool(row.is_active),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "template_version": template_version,
            "template_sync_status": template_sync_status,
            "behavior": behavior,
        }

    def list_agent_instances(self) -> list[dict[str, Any]]:
        template_rows = self.db.query(AgentTemplateRecord).all()
        template_map = {row.type_key: row for row in template_rows}
        rows = self.db.query(AgentInstanceRecord).order_by(AgentInstanceRecord.instance_id.asc()).all()
        return [self._instance_to_payload(row, template_map) for row in rows]

    def get_agent_instance(self, instance_id: str) -> dict[str, Any] | None:
        row = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == instance_id).first()
        if row is None:
            return None
        template_rows = self.db.query(AgentTemplateRecord).all()
        template_map = {t.type_key: t for t in template_rows}
        return self._instance_to_payload(row, template_map)

    def create_agent_instance(self, payload: dict[str, Any]) -> dict[str, Any]:
        instance_id = self._normalize_instance_id(payload.get("instance_id"))
        if not instance_id:
            raise ValueError("instance_id must contain letters/numbers and may include hyphens.")

        if self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == instance_id).first() is not None:
            raise ValueError(f"Agent instance '{instance_id}' already exists.")

        agent_type = str(payload.get("agent_type") or "").strip()
        if not agent_type:
            raise ValueError("agent_type is required.")

        template = self.db.query(AgentTemplateRecord).filter(AgentTemplateRecord.type_key == agent_type).first()
        if template is None:
            raise ValueError(f"Unknown agent_type '{agent_type}'.")
        if template.status != "active":
            raise ValueError(f"Agent type '{agent_type}' has status '{template.status}' and cannot be instantiated.")

        default_instance = _json_load_dict(template.default_instance_json)
        default_config = _json_load_dict(template.default_config_json)

        override_type_config = payload.get("type_specific_config") if isinstance(payload.get("type_specific_config"), dict) else {}
        type_specific_config = copy.deepcopy(default_config)
        type_specific_config.update(override_type_config)

        now = _now_iso()
        row = AgentInstanceRecord(
            instance_id=instance_id,
            agent_type=agent_type,
            display_name=str(payload.get("display_name") or instance_id),
            icon=str(payload.get("icon") or default_instance.get("icon") or "SmartToyOutlined"),
            button_text=str(payload.get("button_text") or default_instance.get("button_text") or "Ask Agent"),
            button_style=str(payload.get("button_style") or default_instance.get("button_style") or "icon_and_text"),
            tooltip_text=(
                str(payload.get("tooltip_text")) if payload.get("tooltip_text") is not None else str(default_instance.get("tooltip_text") or "")
            ),
            description=(str(payload.get("description")) if payload.get("description") is not None else None),
            source_directory=(str(payload.get("source_directory")) if payload.get("source_directory") is not None else None),
            config_ref=(
                str(payload.get("config_ref")) if payload.get("config_ref") is not None else (str(default_instance.get("config_ref")) if default_instance.get("config_ref") else None)
            ),
            module_slug=(str(payload.get("module_slug")) if payload.get("module_slug") is not None else None),
            role_ids_json=_json_dump(payload.get("role_ids") if isinstance(payload.get("role_ids"), list) else [], default="[]"),
            action_permissions_json=_json_dump(payload.get("action_permissions") if isinstance(payload.get("action_permissions"), dict) else {}, default="{}"),
            type_specific_config_json=_json_dump(type_specific_config),
            is_active=bool(payload.get("is_active", True)),
            created_at=now,
            updated_at=now,
        )

        self.db.add(row)
        self.db.commit()
        return self.get_agent_instance(instance_id) or {}

    def update_agent_instance(self, instance_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        row = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == instance_id).first()
        if row is None:
            return None

        mutable_scalar_fields: dict[str, str] = {
            "display_name": "display_name",
            "icon": "icon",
            "button_text": "button_text",
            "button_style": "button_style",
            "tooltip_text": "tooltip_text",
            "description": "description",
            "source_directory": "source_directory",
            "config_ref": "config_ref",
            "module_slug": "module_slug",
        }

        changed = False
        for request_key, attr in mutable_scalar_fields.items():
            if request_key in updates:
                value = updates.get(request_key)
                setattr(row, attr, str(value) if value is not None else None)
                changed = True

        if "role_ids" in updates and isinstance(updates.get("role_ids"), list):
            row.role_ids_json = _json_dump(updates.get("role_ids"), default="[]")
            changed = True

        if "action_permissions" in updates and isinstance(updates.get("action_permissions"), dict):
            row.action_permissions_json = _json_dump(updates.get("action_permissions"), default="{}")
            changed = True

        if "type_specific_config" in updates and isinstance(updates.get("type_specific_config"), dict):
            row.type_specific_config_json = _json_dump(updates.get("type_specific_config"), default="{}")
            changed = True

        if "is_active" in updates:
            row.is_active = bool(updates.get("is_active"))
            changed = True

        if changed:
            row.updated_at = _now_iso()
            self.db.commit()

        return self.get_agent_instance(instance_id)

    def delete_agent_instance(self, instance_id: str) -> bool:
        row = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == instance_id).first()
        if row is None:
            return False
        self.db.delete(row)
        self.db.commit()
        return True

    def resolve_instance(self, instance_id: str) -> dict[str, Any] | None:
        row = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == instance_id).first()
        if row is None:
            return None

        template = self.db.query(AgentTemplateRecord).filter(AgentTemplateRecord.type_key == row.agent_type).first()
        template_behavior = _json_load_dict(template.behavior_json) if template is not None else {}
        type_specific_config = _json_load_dict(row.type_specific_config_json)

        instance_overrides = type_specific_config.get("behavior_overrides")
        behavior = _deep_merge(template_behavior, instance_overrides if isinstance(instance_overrides, dict) else {})

        # UI = merged behavior.ui_behavior (template defaults + behavior_overrides) then instance-level `ui` block wins.
        merged_ui_behavior = behavior.get("ui_behavior") if isinstance(behavior.get("ui_behavior"), dict) else {}
        instance_ui = type_specific_config.get("ui") if isinstance(type_specific_config.get("ui"), dict) else {}
        ui = _deep_merge(merged_ui_behavior, instance_ui)

        template_payload: dict[str, Any] = {}
        if template is not None:
            template_payload = {
                "type_key": template.type_key,
                "display_name": template.display_name,
                "template_version": int(template.template_version or 0),
                "available_actions": _json_load_list(template.available_actions_json),
                "handler_hint": template.handler_hint,
                "assistant_mode": template.assistant_mode,
            }

        return {
            "instance_id": row.instance_id,
            "agent_type": row.agent_type,
            "display_name": row.display_name,
            "icon": row.icon,
            "button_text": row.button_text,
            "button_style": row.button_style,
            "tooltip_text": row.tooltip_text,
            "description": row.description,
            "module_slug": row.module_slug,
            "is_active": bool(row.is_active),
            "ui": ui,
            "behavior": behavior,
            "template": template_payload,
        }

    def _load_semantic_slots_from_filesystem(self) -> int:
        """Upsert semantic slot definitions from /config/agent/semantic_slots/*.json."""
        if not self.semantic_slots_dir.is_dir():
            return 0

        loaded = 0
        now = _now_iso()
        for path in sorted(self.semantic_slots_dir.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(payload, dict):
                continue
            slot_key = str(payload.get("slot_key") or "").strip()
            if not slot_key:
                continue

            row = self.db.query(SemanticSlotDefinition).filter(SemanticSlotDefinition.slot_key == slot_key).first()
            if row is None:
                row = SemanticSlotDefinition(slot_key=slot_key, display_name=slot_key, created_at=now, updated_at=now)
                self.db.add(row)

            row.display_name = str(payload.get("display_name") or slot_key)
            row.description = str(payload.get("description") or "")
            row.is_required = bool(payload.get("is_required", False))
            row.required_fields_json = _json_dump(
                payload.get("required_fields") if isinstance(payload.get("required_fields"), list) else [],
                default="[]",
            )
            row.optional_fields_json = _json_dump(
                payload.get("optional_fields") if isinstance(payload.get("optional_fields"), list) else [],
                default="[]",
            )
            row.grain_hint = str(payload.get("grain_hint") or "sku_location_week")
            row.derivation_hint_json = _json_dump(
                payload.get("derivation_hint") if isinstance(payload.get("derivation_hint"), dict) else {}
            )
            row.updated_at = now
            loaded += 1

        if loaded:
            self.db.commit()
        return loaded

    # ------------------------------------------------------------- bindings

    def list_instance_bindings(self, instance_id: str) -> list[dict[str, Any]] | None:
        instance = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == instance_id).first()
        if instance is None:
            return None
        rows = (
            self.db.query(AgentInstanceDatasetBinding)
            .filter(AgentInstanceDatasetBinding.instance_id == instance_id)
            .order_by(AgentInstanceDatasetBinding.slot_key.asc())
            .all()
        )
        return [self._binding_to_payload(r) for r in rows]

    def upsert_instance_binding(self, instance_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        instance = self.db.query(AgentInstanceRecord).filter(AgentInstanceRecord.instance_id == instance_id).first()
        if instance is None:
            return None

        slot_key = str(payload.get("slot_key") or "").strip()
        if not slot_key:
            raise ValueError("slot_key is required.")

        slot_def = (
            self.db.query(SemanticSlotDefinition)
            .filter(SemanticSlotDefinition.slot_key == slot_key)
            .first()
        )
        if slot_def is None:
            raise ValueError(f"Unknown semantic slot '{slot_key}'.")

        now = _now_iso()
        row = (
            self.db.query(AgentInstanceDatasetBinding)
            .filter(
                AgentInstanceDatasetBinding.instance_id == instance_id,
                AgentInstanceDatasetBinding.slot_key == slot_key,
            )
            .first()
        )
        if row is None:
            row = AgentInstanceDatasetBinding(
                instance_id=instance_id,
                slot_key=slot_key,
                created_at=now,
                updated_at=now,
            )
            self.db.add(row)

        row.binding_kind = str(payload.get("binding_kind") or "sql_table")
        row.source_ref = payload.get("source_ref") if isinstance(payload.get("source_ref"), str) else None
        field_map = payload.get("field_map") if isinstance(payload.get("field_map"), dict) else {}
        # Coerce keys/values to strings and reject obvious shell injection attempts.
        clean_field_map: dict[str, str] = {}
        for k, v in field_map.items():
            key = str(k)
            value = str(v) if v is not None else ""
            if any(ch in value for ch in (";", "--", "/*", "*/")):
                raise ValueError(f"Invalid column mapping for '{key}': {value!r}.")
            clean_field_map[key] = value
        row.field_map_json = _json_dump(clean_field_map)
        filter_predicate = payload.get("filter_predicate") if isinstance(payload.get("filter_predicate"), dict) else {}
        row.filter_predicate_json = _json_dump(filter_predicate)
        row.updated_at = now
        # Availability is re-evaluated by capability_check on the next check.
        row.availability_status = row.availability_status or "missing"

        self.db.commit()
        self.db.refresh(row)
        return self._binding_to_payload(row)

    def delete_instance_binding(self, instance_id: str, slot_key: str) -> bool:
        row = (
            self.db.query(AgentInstanceDatasetBinding)
            .filter(
                AgentInstanceDatasetBinding.instance_id == instance_id,
                AgentInstanceDatasetBinding.slot_key == slot_key,
            )
            .first()
        )
        if row is None:
            return False
        self.db.delete(row)
        self.db.commit()
        return True

    @staticmethod
    def _binding_to_payload(row: AgentInstanceDatasetBinding) -> dict[str, Any]:
        return {
            "id": row.id,
            "instance_id": row.instance_id,
            "slot_key": row.slot_key,
            "binding_kind": row.binding_kind,
            "source_ref": row.source_ref,
            "field_map": _json_load_dict(row.field_map_json),
            "filter_predicate": _json_load_dict(row.filter_predicate_json),
            "availability_status": row.availability_status,
            "status_reason": row.status_reason,
            "last_checked_at": row.last_checked_at,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    # --------------------------------------------------------- semantic slots

    def list_semantic_slots(self) -> list[dict[str, Any]]:
        rows = (
            self.db.query(SemanticSlotDefinition)
            .order_by(
                SemanticSlotDefinition.is_required.desc(),
                SemanticSlotDefinition.slot_key.asc(),
            )
            .all()
        )
        return [
            {
                "slot_key": row.slot_key,
                "display_name": row.display_name,
                "description": row.description,
                "is_required": bool(row.is_required),
                "required_fields": _json_load_list(row.required_fields_json),
                "optional_fields": _json_load_list(row.optional_fields_json),
                "grain_hint": row.grain_hint,
                "derivation_hint": _json_load_dict(row.derivation_hint_json),
            }
            for row in rows
        ]
