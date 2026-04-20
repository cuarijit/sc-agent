# Demand Sensing Console

## Purpose
The Demand Sensing console runs the structured Demand Sensing agent against real-time POS / order signals. Use it to detect divergence between actuals and forecast over short horizons (next 6–72 hours), surface stockout risk, and recommend pre-positioning moves before the daily batch catches up.

## When to use it
- Morning: "what's diverging today?"
- During the day: "did POS surge anywhere unexpectedly?"
- Pre-promo: "is the early lift signal real?"

## Layout walkthrough
Same shape as the Inventory Diagnostic console: left pane (instance picker + chat), right pane (Results / **Pipeline** / Audit tabs).

## Tabs / sub-sections

### Query Builder
Type a question or pick a sample (e.g. *"Show current on-hand vs next 6 hours of predicted POS for MILK-FULL-1L network-wide."*).

### Pipeline
Per-step artifact cards. As of this release, the runner correctly persists step artifacts via `recorder.flush(self.db, run_id)` after `audit.write(record)` — so the panel is no longer empty after a run.

### Audit
Full request / response payload + LLM call log.

## Step-by-step workflow
1. Pick the `dairy-pos-sensing` instance (or another sensing agent).
2. Type the divergence question.
3. Watch the Pipeline panel populate with steps: `intent_parse → scope → capability → detect_signals → prioritize → (analyze_root_cause | enumerate_resolutions)` depending on intent.
4. Read the structured narrative + suggested follow-ups.
5. Drill into any step's JSON to verify the underlying numbers.

## Key controls explained
| Control | What it does |
|---|---|
| Instance picker | Switches between sensing agents (e.g. dairy-pos vs dry-grocery). |
| Capability dot | 9 ok / 8 missing — tells you what the agent can vs cannot answer for this instance. |
| Suggested follow-ups | Triggered by the agent (e.g. "Should I re-forecast the short horizon now?"). |

## Data flow
- Reads: `/admin/agent-instances?agent_type=demand_sensing_agent`.
- Writes: `POST /api/demand-sensing/run`.
- Steps: `GET /api/demand-sensing/runs/{run_id}/steps`.

## Permissions
All logged-in users.

## Common pitfalls
- Earlier release showed "No step artifacts recorded for this run." The orchestrator now flushes — if you still see it, restart the backend to pick up the fix.
