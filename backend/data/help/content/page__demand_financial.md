# Financial Planning

## Purpose
Financial Planning translates the consensus demand into Revenue / COGS / Gross Margin per SKU per location per month. It's the bridge between Demand Planning and Finance — the page exec planners pull just before the financial review meeting.

## When to use it
- Monthly financial review prep.
- Margin erosion investigation: which SKUs dropped vs last month?
- Sanity check after a big forecast adjustment: did revenue / COGS swing as expected?

## Layout walkthrough
Three sub-sections (rendered as scroll-pinned sections):

### tab__financial_summary — Summary
KPI cards: Total Revenue, Total COGS, Gross Margin $, Avg Margin %, Plan vs Last Period delta.

### tab__financial_by_sku — Financial Plan by SKU
Grid: SKU, revenue, COGS, margin $, margin %, volume. Sortable by margin %.

### tab__financial_margin_trend — Margin Trend
Composed chart over months: Revenue (bar), COGS (bar), Margin % (line on right axis).

## Key controls explained
| Control | What it does |
|---|---|
| Month picker | Anchor month for all three sections. |
| Sort by Margin % | One-click toggle on the Plan grid. |

## Data flow
- Reads: `/api/demand/financial/plan`, `/api/demand/financial/trend`.
- Backend joins consensus forecast × cost master × price master.

## Permissions
Read for all roles. Direct edits to financial plans not yet supported in UI (use S&OP cycle approvals).

## Common pitfalls
- Margins can look wrong if cost master is stale — verify via Documents → vendor cost agreements.
