"""Compute the effective runtime for a given template + instance.

Everything the runner needs to execute a turn is a deep merge of:
  - the template's `behavior` (authoritative library + defaults)
  - the instance's `type_specific_config` (selective overrides)

This module is the single source of truth for the merge. Every consumer
(problem_detector, root_cause_analyzer, resolution_generator, action_mapper,
prioritization_engine, intent_parser, response_composer) reads from a
`MergedRuntime` — NEVER directly from the template dict. That way "override
this at the instance level" is a config-only change, and the runner
guarantees the override actually takes effect.

Merge rules:
  - Dicts merge recursively; scalars / lists at the same key overwrite.
  - Library entries (problem_templates, root_cause_templates,
    resolution_families) are keyed by `key`. `instance.per_template_overrides`
    maps `key → partial entry dict` and is deep-merged per entry.
  - Action templates (a dict of key → cfg) are merged the same way via
    `instance.action_template_overrides`.
  - `instance.per_call_site_prompts` overrides `behavior.llm_call_sites[site]`
    field-by-field. Lets admins retune the LLM prompts per instance without
    publishing a new template version.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Iterable


@dataclass
class MergedRuntime:
    calculation_profile: dict[str, Any] = field(default_factory=dict)
    problem_templates: list[dict[str, Any]] = field(default_factory=list)
    root_cause_templates: list[dict[str, Any]] = field(default_factory=list)
    resolution_families: list[dict[str, Any]] = field(default_factory=list)
    action_templates: dict[str, Any] = field(default_factory=dict)
    prioritization: dict[str, Any] = field(default_factory=dict)
    llm_call_sites: dict[str, Any] = field(default_factory=dict)
    decision_graph: list[dict[str, Any]] = field(default_factory=list)
    resolution_to_actions: dict[str, list[str]] = field(default_factory=dict)
    slot_catalog: list[dict[str, Any]] = field(default_factory=list)
    intents: list[dict[str, Any]] = field(default_factory=list)

    def problem_template(self, key: str) -> dict[str, Any] | None:
        return _find_by_key(self.problem_templates, key)

    def root_cause_template(self, key: str) -> dict[str, Any] | None:
        return _find_by_key(self.root_cause_templates, key)

    def resolution_family(self, key: str) -> dict[str, Any] | None:
        return _find_by_key(self.resolution_families, key)

    def llm_call_site(self, site: str) -> dict[str, Any]:
        return dict(self.llm_call_sites.get(site) or {})

    def action_template(self, key: str) -> dict[str, Any]:
        return dict(self.action_templates.get(key) or {})


def build_merged_runtime(
    *,
    behavior: dict[str, Any] | None,
    instance_config: dict[str, Any] | None,
) -> MergedRuntime:
    behavior = behavior or {}
    instance_config = instance_config or {}

    library = behavior.get("library") if isinstance(behavior.get("library"), dict) else {}

    # Top-level catalog lookups honour the legacy shape as a fallback so
    # older templates and a handful of targeted test fixtures keep working.
    raw_problems = _prefer(behavior.get("problem_templates"), library.get("problem_templates"), [])
    raw_rcs = _prefer(behavior.get("root_cause_templates"), library.get("root_cause_templates"), [])
    raw_resolutions = _prefer(behavior.get("resolution_families"), library.get("resolution_families"), [])
    raw_actions = _prefer(behavior.get("action_templates"), library.get("action_templates"), {})
    if not isinstance(raw_actions, dict):
        raw_actions = {}

    per_template_overrides = instance_config.get("per_template_overrides") or {}
    if not isinstance(per_template_overrides, dict):
        per_template_overrides = {}

    merged_problems = _merge_library_list(raw_problems, per_template_overrides)
    merged_rcs = _merge_library_list(raw_rcs, per_template_overrides)
    merged_resolutions = _merge_library_list(raw_resolutions, per_template_overrides)

    # Action templates: dict-keyed in behavior. Allow instance-level
    # overrides via action_template_overrides (same shape: key -> partial cfg).
    action_overrides = instance_config.get("action_template_overrides") or {}
    if not isinstance(action_overrides, dict):
        action_overrides = {}
    merged_actions: dict[str, Any] = {}
    for key, cfg in raw_actions.items():
        merged_actions[key] = deep_merge(cfg, action_overrides.get(key) or {})
    for key, cfg in action_overrides.items():
        if key not in merged_actions:
            merged_actions[key] = copy.deepcopy(cfg)

    # Calculation profile: deep-merge overrides.
    merged_calc = deep_merge(
        behavior.get("calculation_profile") or {},
        instance_config.get("calculation_profile_overrides") or {},
    )

    # Prioritization: deep-merge instance prioritization_overrides. Top-level
    # `prioritization_weights` on the instance continues to supply the
    # feature weights — we pull those in here too for a single view.
    merged_prio = deep_merge(
        behavior.get("prioritization") or {},
        instance_config.get("prioritization_overrides") or {},
    )
    weights = instance_config.get("prioritization_weights")
    if isinstance(weights, dict):
        merged_prio["weights"] = weights

    # LLM call sites: each site is a dict keyed by site id. Instance config
    # uses `per_call_site_prompts` as the override slot.
    raw_sites = behavior.get("llm_call_sites") or {}
    site_overrides = instance_config.get("per_call_site_prompts") or {}
    if not isinstance(raw_sites, dict):
        raw_sites = {}
    if not isinstance(site_overrides, dict):
        site_overrides = {}
    merged_sites: dict[str, Any] = {}
    all_site_keys = set(raw_sites.keys()) | set(site_overrides.keys())
    for site in all_site_keys:
        merged_sites[site] = deep_merge(raw_sites.get(site) or {}, site_overrides.get(site) or {})

    decision_graph = behavior.get("decision_graph") or []
    if not isinstance(decision_graph, list):
        decision_graph = []
    resolution_to_actions = behavior.get("resolution_to_actions") or {}
    if not isinstance(resolution_to_actions, dict):
        resolution_to_actions = {}

    slot_catalog = behavior.get("slot_catalog") or []
    if not isinstance(slot_catalog, list):
        slot_catalog = []
    intents = behavior.get("intents") or []
    if not isinstance(intents, list):
        intents = []

    return MergedRuntime(
        calculation_profile=merged_calc,
        problem_templates=merged_problems,
        root_cause_templates=merged_rcs,
        resolution_families=merged_resolutions,
        action_templates=merged_actions,
        prioritization=merged_prio,
        llm_call_sites=merged_sites,
        decision_graph=decision_graph,
        resolution_to_actions={k: list(v) for k, v in resolution_to_actions.items() if isinstance(v, list)},
        slot_catalog=slot_catalog,
        intents=intents,
    )


# ------------------------------------------------------------------- helpers

def deep_merge(base: Any, override: Any) -> Any:
    """Recursive merge. Dicts merge key-by-key; everything else is replaced.

    Lists are replaced wholesale (NOT concatenated) — callers who need
    append-semantics use dedicated override keys like `disabled_edges`.
    """
    if isinstance(base, dict) and isinstance(override, dict):
        out: dict[str, Any] = copy.deepcopy(base)
        for k, v in override.items():
            if k in out and isinstance(out[k], dict) and isinstance(v, dict):
                out[k] = deep_merge(out[k], v)
            else:
                out[k] = copy.deepcopy(v)
        return out
    if override is None:
        return copy.deepcopy(base)
    return copy.deepcopy(override)


def _merge_library_list(
    entries: Iterable[dict[str, Any]],
    per_template_overrides: dict[str, Any],
) -> list[dict[str, Any]]:
    """Deep-merge per-entry overrides into a library list keyed by `.key`."""
    merged: list[dict[str, Any]] = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("key") or "")
        override = per_template_overrides.get(key) if isinstance(per_template_overrides.get(key), dict) else None
        merged.append(deep_merge(entry, override or {}))
    return merged


def _find_by_key(entries: list[dict[str, Any]], key: str) -> dict[str, Any] | None:
    for entry in entries:
        if str(entry.get("key") or "") == key:
            return entry
    return None


def _prefer(*values: Any) -> Any:
    """Return the first non-empty value from the sequence."""
    for v in values:
        if v is None:
            continue
        if isinstance(v, (list, dict)) and len(v) == 0:
            # keep looking; legacy empty containers should defer to library
            continue
        return v
    return values[-1] if values else None
