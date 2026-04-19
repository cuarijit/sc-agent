"""Resolve the legal decision graph for an instance.

The template declares:
  behavior.decision_graph = [
    {from_problem, compatible_root_causes[], compatible_resolutions[], default_rank[]},
    ...
  ]

Each instance may additionally restrict the graph via:
  instance.type_specific_config.decision_graph_overrides = {
    "disabled_edges": [
      {"from_problem": "projected_stockout", "root_cause": "blocked_inventory"},
      {"from_problem": "projected_stockout", "resolution": "reroute_intransit"},
    ]
  }

And may restrict which library entries are enabled at all:
  instance.type_specific_config.enabled_library = {
    "problem_templates": [...], "root_cause_templates": [...],
    "resolution_families": [...], "action_templates": [...]
  }

This module is the authority on "given a problem, which RCs / resolutions are
legal?" — the RCA and resolution generator both call into it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable


@dataclass
class EnabledLibrary:
    problem_templates: set[str] = field(default_factory=set)
    root_cause_templates: set[str] = field(default_factory=set)
    resolution_families: set[str] = field(default_factory=set)
    action_templates: set[str] = field(default_factory=set)


@dataclass
class DecisionGraph:
    """Immutable view of template + instance-restricted edges."""
    edges: list[dict[str, Any]]
    enabled: EnabledLibrary
    disabled_edges: list[dict[str, Any]]
    resolution_to_actions: dict[str, list[str]]

    # ----------------------------------------------------------------- queries

    def is_problem_enabled(self, key: str) -> bool:
        return (not self.enabled.problem_templates) or key in self.enabled.problem_templates

    def is_root_cause_enabled(self, key: str) -> bool:
        return (not self.enabled.root_cause_templates) or key in self.enabled.root_cause_templates

    def is_resolution_enabled(self, key: str) -> bool:
        return (not self.enabled.resolution_families) or key in self.enabled.resolution_families

    def is_action_enabled(self, key: str) -> bool:
        return (not self.enabled.action_templates) or key in self.enabled.action_templates

    def compatible_root_causes(self, problem_key: str) -> list[str]:
        if not self.is_problem_enabled(problem_key):
            return []
        edge = self._edge_for(problem_key)
        if edge is None:
            return []
        rcs = [
            rc for rc in (edge.get("compatible_root_causes") or [])
            if self.is_root_cause_enabled(rc)
            and not self._edge_disabled(problem_key, root_cause=rc)
        ]
        return rcs

    def compatible_resolutions(self, problem_key: str) -> list[str]:
        if not self.is_problem_enabled(problem_key):
            return []
        edge = self._edge_for(problem_key)
        if edge is None:
            return []
        resolutions = [
            r for r in (edge.get("compatible_resolutions") or [])
            if self.is_resolution_enabled(r)
            and not self._edge_disabled(problem_key, resolution=r)
        ]
        return resolutions

    def compatible_actions(self, resolution_key: str) -> list[str]:
        """Which action templates are legal for this resolution family."""
        candidates = self.resolution_to_actions.get(resolution_key)
        if candidates is None:
            # Resolution not wired to a specific action list — allow all enabled actions.
            return [a for a in self.enabled.action_templates] if self.enabled.action_templates else []
        return [a for a in candidates if self.is_action_enabled(a)]

    def default_rank(self, problem_key: str) -> list[str]:
        edge = self._edge_for(problem_key)
        if edge is None:
            return []
        return [r for r in (edge.get("default_rank") or []) if self.is_resolution_enabled(r)]

    # ----------------------------------------------------------------- helpers

    def _edge_for(self, problem_key: str) -> dict[str, Any] | None:
        for edge in self.edges:
            if str(edge.get("from_problem")) == problem_key:
                return edge
        return None

    def _edge_disabled(
        self,
        problem_key: str,
        *,
        root_cause: str | None = None,
        resolution: str | None = None,
    ) -> bool:
        for entry in self.disabled_edges:
            if str(entry.get("from_problem")) != problem_key:
                continue
            if root_cause is not None and str(entry.get("root_cause")) == root_cause:
                return True
            if resolution is not None and str(entry.get("resolution")) == resolution:
                return True
        return False


def build_decision_graph(
    *,
    template_behavior: dict[str, Any],
    instance_config: dict[str, Any],
) -> DecisionGraph:
    """Merge the template decision graph with instance-level restrictions."""
    edges = template_behavior.get("decision_graph") or []
    if not isinstance(edges, list):
        edges = []
    resolution_to_actions = template_behavior.get("resolution_to_actions") or {}
    if not isinstance(resolution_to_actions, dict):
        resolution_to_actions = {}

    raw_enabled = instance_config.get("enabled_library") or {}
    enabled = EnabledLibrary(
        problem_templates=_as_set(raw_enabled.get("problem_templates")),
        root_cause_templates=_as_set(raw_enabled.get("root_cause_templates")),
        resolution_families=_as_set(raw_enabled.get("resolution_families")),
        action_templates=_as_set(raw_enabled.get("action_templates")),
    )

    overrides = instance_config.get("decision_graph_overrides") or {}
    disabled_raw = overrides.get("disabled_edges") if isinstance(overrides, dict) else None
    disabled_edges = list(disabled_raw) if isinstance(disabled_raw, list) else []

    return DecisionGraph(
        edges=edges,
        enabled=enabled,
        disabled_edges=disabled_edges,
        resolution_to_actions={k: list(v) for k, v in resolution_to_actions.items() if isinstance(v, list)},
    )


def _as_set(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {str(x).strip() for x in value if str(x).strip()}


def merge_per_template_overrides(
    library_entries: Iterable[dict[str, Any]],
    overrides: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Return a new list of library entries with per-instance deltas merged.

    Overrides look like `{"projected_stockout": {"severity": {...}}, ...}`.
    Dicts merge one level deep; lists / scalars replace wholesale. Handlers on
    the template side (e.g. `rule`, `requires_slots`) are untouched.
    """
    overrides = overrides or {}
    merged: list[dict[str, Any]] = []
    for entry in library_entries:
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("key") or "")
        instance_delta = overrides.get(key)
        if not isinstance(instance_delta, dict):
            merged.append(dict(entry))
            continue
        new_entry: dict[str, Any] = dict(entry)
        for k, v in instance_delta.items():
            existing = new_entry.get(k)
            if isinstance(existing, dict) and isinstance(v, dict):
                combined = dict(existing)
                combined.update(v)
                new_entry[k] = combined
            else:
                new_entry[k] = v
        merged.append(new_entry)
    return merged
