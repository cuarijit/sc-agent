# Recommendations

## Purpose
The Recommendations page lists every sourcing / replenishment recommendation the optimizer has produced, ranked by deterministic score (shortage size × urgency × cost-to-serve). Planners triage the table, drill into rationale, and approve or reject items.

## When to use it
- Daily approval pass on system-suggested moves.
- Investigating why a particular SKU is short — the table answers "what does the system think we should do?"
- Bulk filtering by region / status / action type before approving in batches.

## Layout walkthrough
- One full-width grid: Action, Status, Shortage qty, ETA, Score, Rationale snippet.
- Filter bar on top: status, action, region, SKU, location, ETA range.
- Click any row → opens **SKU Detail** for that SKU/location with the policy evidence panel.

## Key controls explained
| Control | What it does |
|---|---|
| Filter Builder dialog | Add multi-condition filters (`status equals open AND shortage > 100`). |
| Status chip cell | Open / approved / rejected / applied; click to advance state. |
| Score column | Ranking score from 0–100; higher = more urgent. |
| Drill-down (row click) | Navigates to /sku/{sku}/{location}. |

## Data flow
- Reads: `/api/recommendations` (filtered by global + page filters).
- Writes: `/api/recommendations/{id}/state` to advance status.
- Score model lives in the optimizer service; rationale comes from the policy evidence index.

## Permissions
Read for all roles; state advancement requires the **planner** role.

## Common pitfalls
- An empty table after a fresh seed = no run has been executed; trigger a run from the Network or Scenarios page.
- "Shortage" is in the SKU's base UOM — not always cases. Check the SKU detail page to confirm the unit.
