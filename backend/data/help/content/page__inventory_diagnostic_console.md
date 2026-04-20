# Inventory Diagnostic Console

## Purpose
The Inventory Diagnostic console runs the structured Inventory Diagnostic agent against your inventory state. Ask a planning question — "why is BAR-002 short at DC-CHI?" — and the agent runs a full pipeline (parse intent → load data → analyze root cause → enumerate resolutions → score → narrate). Every step is recorded as an artifact and shown in the Pipeline panel for full audit.

## When to use it
- Diagnosing a stockout root cause without spelunking through grids.
- Generating a candidate list of mitigations for an exception.
- Producing an audit-quality narrative explanation for an exec or customer.

## Layout walkthrough
- **Left pane**: agent instance picker, capability dots (green = ready / red = missing), chat-style conversation.
- **Right pane**: tabbed view — **Results / Pipeline / Audit**.

## Tabs / sub-sections

### tab__query_builder — Query Builder (left pane)
Free-text question + suggested follow-ups. Submitting POSTs to `/api/inventory-diagnostic/run`.

### tab__pipeline_steps — Pipeline (right pane)
Per-step artifact cards. Each card shows the step name (intent_parse, scope, capability, detect_signals, prioritize, analyze_root_cause, enumerate_resolutions), the decision the agent made, confidence, and the JSON artifact. Click a card → JSON viewer modal.

### tab__audit_log — Audit (right pane)
Full request / response history (input, scope, structured output, narrative, llm_calls, warnings, status, duration_ms). Copy-to-JSON button for export.

## Step-by-step workflow
1. Pick the instance (defaults to `inventory-diagnostic-demo`).
2. Verify the capability dots are green for the intent you want.
3. Type the question (or pick a suggested follow-up).
4. Hit Enter — pipeline panel populates as steps complete.
5. Read the narrative answer; expand any pipeline step for details.
6. Use the Audit tab to copy the JSON for ticketing.

## Key controls explained
| Control | What it does |
|---|---|
| Instance picker | Switches the active agent instance (different prompts / overrides). |
| Capability dot | Green = the agent has the data / capability; click for details. |
| Suggested follow-ups | Pre-canned next questions surfaced by the agent. |
| Reset | Clears the conversation. |

## Data flow
- Reads: `/admin/agent-instances?agent_type=inventory_diagnostic_agent`.
- Writes: `POST /api/inventory-diagnostic/run` → returns run_id + structured + narrative.
- Steps: `GET /api/inventory-diagnostic/runs/{run_id}/steps` (persisted via `recorder.flush(self.db, run_id)` in the runner).

## Permissions
All logged-in users can run; data scoped by DAGs.

## Common pitfalls
- "No instances yet" → run **Agent Configurator → Seed Demo**.
- A capability dot turning red mid-conversation usually means the question requires data the instance isn't configured for (e.g. asking for promo lift on a non-promo SKU).
