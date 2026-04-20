# Forecast Accuracy

## Purpose
The Forecast Accuracy page tracks the gap between forecast and actual on a rolling window. It surfaces overall MAPE / Bias / WMAPE, plots the trend, and lists exceptions (high deviation, trend break, promo miss, bias alert, tracking-signal breach) so planners can investigate the worst offenders.

## When to use it
- Weekly accuracy review: scan KPIs + trend.
- Root-causing a poor week: drill into the exception grid.
- Reporting up: pull MAPE numbers for the executive deck.

## Layout walkthrough
- **KPI cards**: MAPE %, Bias %, WMAPE %, Tracking Signal.
- **Forecast vs Actual + MAPE chart**: dual-axis composed chart over the last 26 weeks.
- **Exception donut**: severity split (critical / high / medium / low).
- **Exception scatter / grid**: one row per exception with type, severity, recommended action.

## Key controls explained
| Control | What it does |
|---|---|
| Severity slice (donut) | Click → filters the exception grid to that severity. |
| Exception row | Click → drills to the SKU/location's Demand Forecasting view. |

## Data flow
- Reads: `/api/demand/accuracy?weeks=26`, `/api/demand/exceptions`.
- Source tables: `demand_forecast_accuracy`, `demand_exceptions`.

## Permissions
Read for all roles.

## Common pitfalls
- MAPE is calculated only where actuals exist (history weeks). Forward weeks contribute zero.
- "Bias %" is signed: positive = systematic over-forecast, negative = under-forecast.
