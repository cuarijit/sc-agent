# Planning Analytics

## Purpose
Planning Analytics is the macro analytics dashboard for the Demand Planning module. It rolls up the cycle KPIs (forecast accuracy, demand vs supply, S&OP cycle health) into one place for executive review.

## When to use it
- Pre-S&OP exec briefing.
- Monthly planning health check.
- Identifying which sub-area is dragging down overall plan quality.

## Tabs / sub-sections

### tab__exec_summary — Executive Summary
Headline KPIs (MAPE %, Bias %, On-time S&OP cycles, Open review items) + a 13-week MAPE trend.

### tab__forecast_accuracy_report — Forecast Accuracy Report
Detailed accuracy by SKU / location / week — same data as Forecast Accuracy page but with extra grouping options.

### tab__demand_vs_supply — Demand vs Supply
Gap analysis + capacity utilization rolled to month / quarter buckets.

### tab__sop_kpis — S&OP KPIs
Cycle metrics: time to close, % cycles completed on schedule, average open review items per cycle.

## Key controls explained
| Control | What it does |
|---|---|
| Month / Quarter toggle | Bucket all visualizations. |
| Tab switch | Loads the corresponding KPI block. |

## Data flow
- Reads: `/api/demand/analytics/{tab}` (one endpoint per tab).
- Most data is aggregated server-side from the same tables that power the focused pages.

## Permissions
Read for all roles.

## Common pitfalls
- The MAPE trend is empty if no historical accuracy rows exist; bounce the backend so seed populates.
