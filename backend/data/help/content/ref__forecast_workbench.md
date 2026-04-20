# Forecast Workbench Reference

The ForecastWorkbench component powers both the Demand Forecasting page and every tab of the DBF Driver Workbench. Same controls, same behaviour.

## Bucket aggregation
| Bucket | Behaviour |
|---|---|
| Day | Daily aggregation; only available for metrics with daily granularity. |
| Week | Default — ISO week starting Monday. |
| Month | Calendar month aggregation (sum / mean depending on metric). |
| Quarter | Calendar quarter. |

Bucket toggles disable themselves with a tooltip when a metric isn't available at that granularity (e.g. drivers are weekly-only, so Day disables on DBF tabs).

## Lock semantics
The lock icon on the Adjusted Forecast row freezes a future bucket. Once locked:
- Subsequent edits to other buckets do not change the locked bucket's value.
- The locked snapshot value is preserved across re-aggregations.
- Save Adjustments still ships the dirty buckets but skips the locked ones.

## Past-period read-only behaviour
A bucket is "past" if its `sortKey` (first day of the bucket) is strictly before today AND it isn't the current bucket. Past buckets:
- Render their adjustment cell as disabled, greyed background, "Past period — read only" tooltip.
- Show a static lock icon (no toggle).
- Are stripped from the Save batch client-side AND server-side.

Reason: history is immutable. Adjusting a past period is meaningless because the actual is already known.

## Keyboard
- Tab / Shift-Tab: navigate adjustment cells.
- Enter: commit the typed value (same as blur).
- Escape: revert.

## Chart vs grid sync
The grid mirrors the chart's data-zoom window — moving the zoom slider in the chart changes which buckets the grid shows. The grid is not independently scrollable.
