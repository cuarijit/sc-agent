# Scenarios

## Purpose
The Scenarios page is the macro what-if console: change a forecast multiplier or a lead-time delay across the whole network and see the deterministic recommendation delta. Useful for stress tests ("what if demand surges 20%?") and contingency planning ("what if my key supplier slips 7 days?").

## When to use it
- Pre-quarter risk analysis: model a plausible demand swing.
- Sourcing risk review: bump lead times for a vendor and inspect downstream shortages.
- Pre-meeting scenario prep: build 2–3 named scenarios to compare side-by-side.

## Layout walkthrough
- Two-column layout: **Scenario Controls** (left), **Scenario Delta + Recommendations** (right).
- Controls: Scenario Name, Forecast Multiplier (default 1.0), Lead Time Delay Days (default 0).
- Right side: Delta chart (bars per metric: shortage qty, expediting cost, service level), Recommendations table for the scenario.

## Step-by-step workflow
1. Name the scenario.
2. Set the multiplier and / or lead-time delay.
3. Click **Run Scenario**.
4. The optimizer recomputes; the Delta chart and Recommendations table populate.
5. Compare with the baseline by reading the chart bars (positive = worse, negative = better).

## Key controls explained
| Control | What it does |
|---|---|
| Forecast Multiplier | Scales every demand point uniformly before recompute. |
| Lead Time Delay Days | Adds N days to every lane lead time. |
| Run Scenario | POSTs to `/api/scenarios/run` and waits for the deterministic result. |

## Data flow
- Reads: baseline from `/api/network/baseline`.
- Writes: `POST /api/scenarios/run` with `{name, forecast_multiplier, lead_time_delay_days}`.
- The deterministic result is short-lived (in-memory); save to the Network → Scenarios tab to persist.

## Permissions
Read for all roles. Run requires **planner**.

## Common pitfalls
- Big multipliers (> 2.0) can produce thousands of new shortages and slow down the page; start small.
- Scenarios are not persisted on this page; for durable scenarios use Network → Scenarios.
