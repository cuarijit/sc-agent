# Demand Forecasting & Planning

## Purpose
The Demand Forecasting workbench is where the planner reconciles the statistical / ML / DBF baseline with judgement. It pairs a multi-line chart (baseline / Puls8 360 ADS / Puls8 DBF / actual / adjusted) with a transposed grid of editable adjustments. Past periods are read-only; current and future weeks are editable and save back to `demand_forecast.adjusted_qty`.

## When to use it
- Weekly forecast cycle: review baseline, apply adjustments, save, then publish through Collaborative Planning.
- Investigating accuracy: compare Adjusted vs Actual and the variance % rows in the grid below the chart.
- Promo override: apply lift on top of statistical baseline for promo weeks.

## Layout walkthrough
- **KPI cards** (top): Total Forecast Volume, Baseline Volume, Promo Lift Volume, Forecast Sources count.
- **Filter row**: SKU, Location, Customer + bucket toggle (Day/Week/Month/Quarter).
- **ForecastWorkbench** (main): chart on top, grid below.
  - Chart: stacked baseline + lift bars, line series for Total / Last Year / Adjustment / Adjusted Consumption / Actual.
  - "Now" vertical marker shows the boundary between actuals and forecast.
  - Grid below: one row per metric, one column per bucket; the Adjustment row is editable, the Adjusted Forecast row is read-only and updates as you type.
- **Promotion grid** (right rail): list of active promos affecting the SKU/location.

## Step-by-step workflow
1. Pick SKU + Location at the top.
2. Review the chart — does the Adjusted line track Actual?
3. Type into the Adjustment row for the weeks you want to override (positive or negative).
4. Optionally **Lock** a future bucket (lock icon) to freeze the Adjusted Forecast at its current value.
5. Click **Save Adjustments** — POSTs to `/api/demand/adjust`.
6. Move to Collaborative Planning to gather consensus, then to Forecast Accuracy to track impact.

## Key controls explained
| Control | What it does |
|---|---|
| Bucket toggle | Day/Week/Month/Quarter aggregation; some metrics are weekly-only and disable the toggle. |
| Lock icon (Adjusted Forecast row) | Freezes a bucket's adjusted value; subsequent adjustments don't change it. |
| Save Adjustments | POSTs the diff for unlocked future buckets only. |
| Variance rows | Adjusted-vs-Actual + Puls8-vs-Actual gap per bucket (colour coded). |

## Data flow
- Reads: `/api/demand/forecasts?sku=…&location=…`. Records carry `forecast_source` (statistical / ml_xgboost / dl_lstm / consensus / customer_input / puls8_dbf).
- Writes: `POST /api/demand/adjust` with `{sku, location, week_start, delta}` per dirty bucket. Past buckets are stripped client-side AND server-side.

## Permissions
Read for all roles. Save Adjustments requires the **demand_planner** entitlement.

## Common pitfalls
- Past periods read-only — typing into a past bucket is silently ignored.
- The Puls8 DBF series will be flat-zero until the DBF demo seed runs; bounce the backend if it's missing.
