"""Resolve semantic slot definitions and their instance-specific bindings.

This module is the single source of truth for:
- What slots exist (from `SemanticSlotDefinition`).
- How an instance's bindings map slot fields to concrete DB columns.
- Inspecting the database schema to confirm a binding's source + fields are real.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from ...models import AgentInstanceDatasetBinding, SemanticSlotDefinition


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


@dataclass
class SlotDefinition:
    slot_key: str
    display_name: str
    description: str
    is_required: bool
    required_fields: list[str]
    optional_fields: list[str]
    grain_hint: str
    derivation_hint: dict[str, Any] = field(default_factory=dict)


@dataclass
class BindingRow:
    slot_key: str
    binding_kind: str
    source_ref: str | None
    field_map: dict[str, str]
    filter_predicate: dict[str, Any]
    availability_status: str
    status_reason: str | None
    last_checked_at: str | None


class SemanticSlotRegistry:
    """Read-only adapter over SemanticSlotDefinition + AgentInstanceDatasetBinding."""

    def __init__(self, db: Session, engine: Engine | None = None):
        self.db = db
        # Engine is optional — only needed for availability evaluation.
        self.engine = engine

    def list_definitions(self) -> list[SlotDefinition]:
        rows = (
            self.db.query(SemanticSlotDefinition)
            .order_by(SemanticSlotDefinition.is_required.desc(), SemanticSlotDefinition.slot_key.asc())
            .all()
        )
        return [
            SlotDefinition(
                slot_key=row.slot_key,
                display_name=row.display_name,
                description=row.description or "",
                is_required=bool(row.is_required),
                required_fields=_json_load_list(row.required_fields_json),
                optional_fields=_json_load_list(row.optional_fields_json),
                grain_hint=row.grain_hint or "sku_location_week",
                derivation_hint=_json_load_dict(row.derivation_hint_json),
            )
            for row in rows
        ]

    def get_definition(self, slot_key: str) -> SlotDefinition | None:
        return next((d for d in self.list_definitions() if d.slot_key == slot_key), None)

    def list_bindings(self, instance_id: str) -> list[BindingRow]:
        rows = (
            self.db.query(AgentInstanceDatasetBinding)
            .filter(AgentInstanceDatasetBinding.instance_id == instance_id)
            .order_by(AgentInstanceDatasetBinding.slot_key.asc())
            .all()
        )
        return [self._row_to_binding(r) for r in rows]

    def get_binding(self, instance_id: str, slot_key: str) -> BindingRow | None:
        row = (
            self.db.query(AgentInstanceDatasetBinding)
            .filter(
                AgentInstanceDatasetBinding.instance_id == instance_id,
                AgentInstanceDatasetBinding.slot_key == slot_key,
            )
            .first()
        )
        return self._row_to_binding(row) if row is not None else None

    @staticmethod
    def _row_to_binding(row: AgentInstanceDatasetBinding) -> BindingRow:
        return BindingRow(
            slot_key=row.slot_key,
            binding_kind=row.binding_kind or "sql_table",
            source_ref=row.source_ref,
            field_map=_json_load_dict(row.field_map_json),
            filter_predicate=_json_load_dict(row.filter_predicate_json),
            availability_status=row.availability_status or "missing",
            status_reason=row.status_reason,
            last_checked_at=row.last_checked_at,
        )

    def inspect_table_columns(self, source_ref: str) -> list[str] | None:
        """Return column names for a real DB table, or None if the table is absent."""
        if self.engine is None or not source_ref:
            return None
        inspector = inspect(self.engine)
        try:
            if not inspector.has_table(source_ref):
                return None
            return [c["name"] for c in inspector.get_columns(source_ref)]
        except Exception:
            return None
