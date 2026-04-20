# Dashboard

## Purpose
The Dashboard is the planner's morning landing page. It surfaces network alerts, parameter exceptions, ranked recommendations, and headline KPIs in one scrollable view so issues become visible within seconds of login.

## When to use it
- Start-of-shift triage: scan red KPIs and the alerts dashboard for anything new since yesterday.
- Mid-day check-in: re-open after a run completes to see updated exception counts.
- Pre-meeting prep: glance at the ranked recommendations table before a planning huddle.

## Layout walkthrough
- **KPI cards** (top row): hero numbers — total alerts by severity, impacted nodes / SKUs, financial impact, demand & accuracy.
- **Alerts dashboard** (collapsible): severity donut + per-severity drill chips + click-to-filter behaviour.
- **Network baseline**: 4-card row showing node count, lane count, average lead time, average safety stock.
- **Parameter exceptions**: queue of flagged parameters needing planner attention.
- **Open exceptions / ranked recommendations**: two side-by-side grids for the highest-impact items.

## Step-by-step workflow
1. Scan the KPI cards. A red border = critical exceeds threshold.
2. Click a severity number on the Alert Severity card → the alerts grid filters to that severity.
3. Click a row in the recommendations grid → drills to **SKU Detail** for that SKU/location.
4. Use the **right-side filter / agent buttons** in the page header to narrow scope or launch the diagnostic agent.

## Key controls explained
| Control | What it does |
|---|---|
| KPI card severity numbers | Click to filter the Alerts grid by that severity. |
| "Inventory Diagnostic Agent" button | Opens the diagnostic-agent modal with the page's filter context pre-loaded. |
| Page header Filter icon | Opens the global Manual Filter dialog. |
| Page header Agent icon | Opens the Data Search agent for free-text MEIO queries. |

## Data flow
- Reads: `/api/dashboard/stockouts`, `/api/network/baseline`, `/api/parameters/exceptions`, `/api/recommendations`, `/admin/agent-instances`.
- Writes: none (read-only page).
- Global filter keys consumed: `runId`, `region`, `location`, `sku`, `severity`.

## Permissions
Visible to all logged-in users.

## Common pitfalls
- Dashboard "spins forever" usually means a query is firing against a stale port or a backend that's down. React-Query is configured `retry: 1` so the spinner stops within ~6 seconds; check the browser Network tab.
- The KPI numbers are scoped to the global filter — if you set `region=EMEA` you'll get only EMEA alerts.
