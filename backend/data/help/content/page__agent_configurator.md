# Agent Configurator

## Purpose
The Agent Configurator manages the lifecycle of the agentic AI features. Each agent is two things: a **template** (JSON shape — handler key, prompt sections, behaviour overrides, decision tree, capability dots, key-column mappings) and one or more **instances** that bind a template to a name + role + module assignment + LLM provider.

## When to use it
- Editing an existing agent's behaviour (e.g. raise its confidence threshold).
- Creating a new instance for a different customer or scenario.
- Publishing a draft template so its changes go live.
- Syncing instances after a template version bump.

## Tabs / sub-sections

### tab__instances — Instances
Grid of instances: instance_id, agent_type, template, status, modules, roles, owner. Actions: edit, delete, sync to template version, seed demo.

### tab__templates — Templates
Grid of templates: type_key, display_name, handler, version, status (draft / active). Click → opens the editor.

#### Template editor (tabs inside the right pane)
- **Prompt sections** — system prompt + per-stage section overrides.
- **Behaviour overrides** — sliders / numeric thresholds (confidence, max_steps).
- **Decision tree** — graph of intents → handlers.
- **Metrics & capabilities** — dot list (the green/red Capability dots planners see in the consoles).
- **Key columns** — column-mapping config used by data tools.

## Step-by-step workflow (publish a template change)
1. Open the template, switch to Edit.
2. Make a change (e.g. add a metric).
3. Click **Save Draft** → template_version increments.
4. Click **Publish** → status flips to active.
5. Hit **Sync to Template** on each affected instance to pick up the new version.

## Key controls explained
| Control | What it does |
|---|---|
| Save Draft | Persists changes without affecting live instances. |
| Publish | Activates the template; subsequent runs use the published version. |
| Sync (instance row) | Re-binds the instance to the latest template version. |
| Seed Demo | One-click insert of the canonical demo instances. |

## Data flow
- Reads: `/admin/agent-templates`, `/admin/agent-instances`.
- Writes: `POST/PATCH /admin/agent-templates`, `POST/PATCH /admin/agent-instances`, `POST /admin/agent-instances/{id}/sync`.

## Permissions
Admin only.

## Common pitfalls
- Editing a draft template and forgetting to publish means consoles still see the old version.
- Deleting an instance that's in use returns 409; archive instead.
