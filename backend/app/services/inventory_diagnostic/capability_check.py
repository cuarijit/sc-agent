"""Determine which agent capabilities are enabled for a given instance.

Inputs: instance_id + agent template behavior.
Outputs: AgentCapabilitySnapshot row describing
  - which slots are available / degraded / missing,
  - which problem / root-cause / resolution templates are disabled because
    their `requires_slots` cannot be satisfied,
  - any warnings (e.g. degraded slots, force-enable overrides).

The snapshot is cached for `CAPABILITY_CACHE_TTL_SECONDS` per instance so the
admin UI and chat runtime don't recompute on every request.
"""
from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from ...database import engine as default_engine
from ...models import (
    AgentCapabilitySnapshot,
    AgentInstanceDatasetBinding,
    AgentInstanceRecord,
    AgentTemplateRecord,
)
from .semantic_slot_registry import SemanticSlotRegistry

CAPABILITY_CACHE_TTL_SECONDS = 60

STATUS_AVAILABLE = "available"
STATUS_DEGRADED = "degraded"
STATUS_MISSING = "missing"


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


def _json_dump(value: Any, default: str = "{}") -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return default


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class SlotStatus:
    slot_key: str
    status: str  # available | degraded | missing
    reason: str | None = None
    missing_required_fields: list[str] = field(default_factory=list)
    missing_optional_fields: list[str] = field(default_factory=list)
    binding_kind: str | None = None
    source_ref: str | None = None


@dataclass
class CapabilitySnapshot:
    instance_id: str
    slots: dict[str, SlotStatus]
    disabled_problems: list[str]
    disabled_root_causes: list[str]
    disabled_resolutions: list[str]
    warnings: list[str]
    checked_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "instance_id": self.instance_id,
            "slots": {
                k: {
                    "status": s.status,
                    "reason": s.reason,
                    "missing_required_fields": s.missing_required_fields,
                    "missing_optional_fields": s.missing_optional_fields,
                    "binding_kind": s.binding_kind,
                    "source_ref": s.source_ref,
                }
                for k, s in self.slots.items()
            },
            "disabled_problems": self.disabled_problems,
            "disabled_root_causes": self.disabled_root_causes,
            "disabled_resolutions": self.disabled_resolutions,
            "warnings": self.warnings,
            "checked_at": self.checked_at,
        }


class CapabilityCheck:
    def __init__(self, db: Session, engine=None):
        self.db = db
        self.engine = engine or default_engine
        self.registry = SemanticSlotRegistry(db, self.engine)

    # ------------------------------------------------------------------ public

    def evaluate_instance(self, instance_id: str, *, force: bool = False) -> CapabilitySnapshot:
        """Compute a capability snapshot for an instance, hitting the 60s cache unless `force`."""
        cached = self._load_cached(instance_id)
        if cached is not None and not force and not self._is_stale(cached):
            return cached
        snapshot = self._compute(instance_id)
        self._persist(snapshot)
        return snapshot

    def get_cached(self, instance_id: str) -> CapabilitySnapshot | None:
        return self._load_cached(instance_id)

    # ------------------------------------------------------------- computation

    def _compute(self, instance_id: str) -> CapabilitySnapshot:
        instance = (
            self.db.query(AgentInstanceRecord)
            .filter(AgentInstanceRecord.instance_id == instance_id)
            .first()
        )
        if instance is None:
            raise ValueError(f"Agent instance '{instance_id}' not found.")

        template = (
            self.db.query(AgentTemplateRecord)
            .filter(AgentTemplateRecord.type_key == instance.agent_type)
            .first()
        )
        behavior = _json_load_dict(template.behavior_json) if template else {}
        instance_config = _json_load_dict(instance.type_specific_config_json)
        capability_overrides = (
            instance_config.get("capability_overrides")
            if isinstance(instance_config.get("capability_overrides"), dict)
            else {}
        )
        force_disable: set[str] = set(capability_overrides.get("force_disable") or [])
        force_enable: set[str] = set(capability_overrides.get("force_enable") or [])

        slot_defs = self.registry.list_definitions()
        bindings = {b.slot_key: b for b in self.registry.list_bindings(instance_id)}

        warnings: list[str] = []
        slots: dict[str, SlotStatus] = {}

        for d in slot_defs:
            status = self._evaluate_slot(d, bindings.get(d.slot_key), warnings)
            slots[d.slot_key] = status

        # Persist availability_status back onto each binding for the admin UI.
        self._write_binding_statuses(instance_id, slots, bindings)

        # Legacy top-level catalogs (behavior.problem_templates etc.) take
        # precedence when present, falling through to the v6 library.
        library = behavior.get("library") if isinstance(behavior.get("library"), dict) else {}
        problem_catalog = (
            behavior.get("problem_templates")
            if isinstance(behavior.get("problem_templates"), list)
            else library.get("problem_templates")
        )
        rc_catalog = (
            behavior.get("root_cause_templates")
            if isinstance(behavior.get("root_cause_templates"), list)
            else library.get("root_cause_templates")
        )
        resolution_catalog = (
            behavior.get("resolution_families")
            if isinstance(behavior.get("resolution_families"), list)
            else library.get("resolution_families")
        )

        disabled_problems = self._filter_catalog(
            problem_catalog, slots, force_disable, force_enable, warnings, "problem"
        )
        disabled_root_causes = self._filter_catalog(
            rc_catalog, slots, force_disable, force_enable, warnings, "root_cause"
        )
        disabled_resolutions = self._filter_catalog(
            resolution_catalog, slots, force_disable, force_enable, warnings, "resolution"
        )

        return CapabilitySnapshot(
            instance_id=instance_id,
            slots=slots,
            disabled_problems=disabled_problems,
            disabled_root_causes=disabled_root_causes,
            disabled_resolutions=disabled_resolutions,
            warnings=warnings,
            checked_at=_now_iso(),
        )

    def _evaluate_slot(self, d, binding, warnings: list[str]) -> SlotStatus:
        if binding is None:
            return SlotStatus(
                slot_key=d.slot_key,
                status=STATUS_MISSING,
                reason="No binding configured.",
                binding_kind=None,
                source_ref=None,
            )

        if binding.binding_kind == "none" or not binding.source_ref:
            return SlotStatus(
                slot_key=d.slot_key,
                status=STATUS_MISSING,
                reason="Binding has no source reference.",
                binding_kind=binding.binding_kind,
                source_ref=binding.source_ref,
            )

        if binding.binding_kind == "config_declared":
            # Derived slots (e.g. ISO-calendar fallback) are always available.
            return SlotStatus(
                slot_key=d.slot_key,
                status=STATUS_AVAILABLE,
                binding_kind=binding.binding_kind,
                source_ref=binding.source_ref,
            )

        # sql_table or view — inspect the engine.
        columns = self.registry.inspect_table_columns(binding.source_ref)
        if columns is None:
            return SlotStatus(
                slot_key=d.slot_key,
                status=STATUS_MISSING,
                reason=f"Source '{binding.source_ref}' not found in database schema.",
                binding_kind=binding.binding_kind,
                source_ref=binding.source_ref,
            )

        column_set = {c.lower() for c in columns}

        missing_required: list[str] = []
        for field_name in d.required_fields:
            mapped = binding.field_map.get(field_name) or field_name
            if str(mapped).lower() not in column_set:
                missing_required.append(field_name)

        missing_optional: list[str] = []
        for field_name in d.optional_fields:
            # Only treat optional fields as "missing" when the admin explicitly mapped them.
            mapped = binding.field_map.get(field_name)
            if mapped and str(mapped).lower() not in column_set:
                missing_optional.append(field_name)

        if missing_required:
            return SlotStatus(
                slot_key=d.slot_key,
                status=STATUS_MISSING,
                reason=f"Missing required fields: {', '.join(missing_required)}.",
                missing_required_fields=missing_required,
                missing_optional_fields=missing_optional,
                binding_kind=binding.binding_kind,
                source_ref=binding.source_ref,
            )

        if missing_optional:
            warnings.append(
                f"Slot '{d.slot_key}' degraded: optional fields {missing_optional} not present in '{binding.source_ref}'."
            )
            return SlotStatus(
                slot_key=d.slot_key,
                status=STATUS_DEGRADED,
                reason=f"Optional fields absent: {', '.join(missing_optional)}.",
                missing_optional_fields=missing_optional,
                binding_kind=binding.binding_kind,
                source_ref=binding.source_ref,
            )

        return SlotStatus(
            slot_key=d.slot_key,
            status=STATUS_AVAILABLE,
            binding_kind=binding.binding_kind,
            source_ref=binding.source_ref,
        )

    def _filter_catalog(
        self,
        catalog: Any,
        slots: dict[str, SlotStatus],
        force_disable: set[str],
        force_enable: set[str],
        warnings: list[str],
        kind: str,
    ) -> list[str]:
        """Return sorted list of catalog keys that should be disabled for this instance."""
        if not isinstance(catalog, list):
            return []
        disabled: list[str] = []
        for entry in catalog:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get("key") or "").strip()
            if not key:
                continue
            if key in force_disable:
                disabled.append(key)
                continue
            required_slots = entry.get("requires_slots") or []
            missing = [
                s for s in required_slots
                if slots.get(s) is None or slots[s].status == STATUS_MISSING
            ]
            if missing and key not in force_enable:
                disabled.append(key)
            elif missing and key in force_enable:
                warnings.append(
                    f"{kind} template '{key}' force-enabled despite missing slots: {missing}."
                )
        return sorted(set(disabled))

    # ------------------------------------------------------------- persistence

    def _load_cached(self, instance_id: str) -> CapabilitySnapshot | None:
        row = (
            self.db.query(AgentCapabilitySnapshot)
            .filter(AgentCapabilitySnapshot.instance_id == instance_id)
            .first()
        )
        if row is None:
            return None
        slots_raw = _json_load_dict(row.slots_available_json)
        slots: dict[str, SlotStatus] = {}
        for slot_key, data in slots_raw.items():
            if not isinstance(data, dict):
                continue
            slots[slot_key] = SlotStatus(
                slot_key=slot_key,
                status=str(data.get("status") or STATUS_MISSING),
                reason=data.get("reason"),
                missing_required_fields=list(data.get("missing_required_fields") or []),
                missing_optional_fields=list(data.get("missing_optional_fields") or []),
                binding_kind=data.get("binding_kind"),
                source_ref=data.get("source_ref"),
            )
        return CapabilitySnapshot(
            instance_id=row.instance_id,
            slots=slots,
            disabled_problems=_json_load_list(row.disabled_problems_json),
            disabled_root_causes=_json_load_list(row.disabled_root_causes_json),
            disabled_resolutions=_json_load_list(row.disabled_resolutions_json),
            warnings=_json_load_list(row.warnings_json),
            checked_at=row.checked_at,
        )

    def _persist(self, snapshot: CapabilitySnapshot) -> None:
        row = (
            self.db.query(AgentCapabilitySnapshot)
            .filter(AgentCapabilitySnapshot.instance_id == snapshot.instance_id)
            .first()
        )
        if row is None:
            row = AgentCapabilitySnapshot(instance_id=snapshot.instance_id, checked_at=snapshot.checked_at)
            self.db.add(row)
        row.slots_available_json = _json_dump({k: v for k, v in snapshot.to_dict()["slots"].items()})
        row.disabled_problems_json = _json_dump(snapshot.disabled_problems, default="[]")
        row.disabled_root_causes_json = _json_dump(snapshot.disabled_root_causes, default="[]")
        row.disabled_resolutions_json = _json_dump(snapshot.disabled_resolutions, default="[]")
        row.warnings_json = _json_dump(snapshot.warnings, default="[]")
        row.checked_at = snapshot.checked_at
        self.db.commit()

    def _write_binding_statuses(
        self,
        instance_id: str,
        slots: dict[str, SlotStatus],
        bindings_by_slot: dict[str, Any],
    ) -> None:
        now = _now_iso()
        for slot_key, status in slots.items():
            binding = bindings_by_slot.get(slot_key)
            if binding is None:
                continue
            row = (
                self.db.query(AgentInstanceDatasetBinding)
                .filter(
                    AgentInstanceDatasetBinding.instance_id == instance_id,
                    AgentInstanceDatasetBinding.slot_key == slot_key,
                )
                .first()
            )
            if row is None:
                continue
            row.availability_status = status.status
            row.status_reason = status.reason
            row.last_checked_at = now
        self.db.commit()

    @staticmethod
    def _is_stale(snapshot: CapabilitySnapshot) -> bool:
        try:
            checked = datetime.fromisoformat(snapshot.checked_at.replace("Z", "+00:00"))
        except ValueError:
            return True
        age = (datetime.now(timezone.utc) - checked).total_seconds()
        return age > CAPABILITY_CACHE_TTL_SECONDS
