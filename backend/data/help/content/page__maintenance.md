# Analytics

## Purpose
The Analytics page (originally "Maintenance") is the diagnostic console for ad-hoc questions and projected-inventory inspection. It blends an LLM-driven on-demand analysis chat with a fully manual projected inventory calculator.

## When to use it
- Answering an exec question that doesn't fit any standard report.
- Debugging an inventory mismatch by walking the projection week-by-week with manual inputs.

## Tabs / sub-sections

### tab__on_demand_analysis — On-Demand Analysis
A chat surface backed by the same LLM provider configured under Settings. Ask a planning question in plain English; the agent retrieves matching data + builds a chart inline. The conversation history is per-session (not persisted across reloads).

### tab__projected_inventory — Projected Inventory
A calculator: pick SKU + location, enter weekly demand and supply, and the page draws the projected on-hand chart. Used to verify a planner hypothesis without writing data back.

## Key controls explained
| Control | What it does |
|---|---|
| Chat input | Free-text question → LLM round-trip → answer + optional chart. |
| SKU / location dropdowns (Projected Inventory) | Anchor the calculator. |
| Weekly demand / supply inputs | Manual override; not persisted. |

## Data flow
- On-Demand Analysis: `POST /api/analysis/run` (LLM provider, e.g. OpenAI gpt-4.1-mini).
- Projected Inventory: client-side calculation only; reads starting on-hand from `/api/replenishment/projected-inventory`.

## Permissions
Read for all roles. The On-Demand chat respects the user's data access groups (DAGs).

## Common pitfalls
- The chat session is not durable — refreshing the page clears it.
- Charts in the chat sometimes need a second to render; don't double-submit.
