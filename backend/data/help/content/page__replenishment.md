# Replenishment

## Purpose
The Replenishment page is the order book — every replenishment order the system has generated or a planner has manually added. It pairs that order header view with line-level Order Details and a Projected Inventory workbench so planners can verify the impact of an order before it cuts.

## When to use it
- Reviewing today's order queue for exceptions (late, partial, bypassed).
- Manually creating a one-off replenishment.
- Inspecting projected on-hand week-by-week for a SKU/location.

## Layout walkthrough
- **Orders grid** (top half): order_id, sku, ship_from / ship_to, qty, status, exception_reason.
- **Order Details panel** (right): expanded view of selected order's lines + key dates.
- **Projected Inventory workbench** (bottom): chart + grid of on-hand evolution by week for the selected SKU/location.

## Step-by-step workflow
1. Filter orders by status (`open`, `accepted`, `applied`) or exception reason.
2. Click an order row → Order Details populates on the right.
3. Edit the qty or notes inline → save persists via PATCH.
4. To create a new order: click **+ New Order** → fill the modal → Save.
5. Use the Projected Inventory chart to confirm the order resolves the projected dip.

## Key controls explained
| Control | What it does |
|---|---|
| **+ New Order** button | Opens an order-creation modal pre-filled with the global SKU/location. |
| Inline edit on qty | PATCHes the order; row turns yellow until saved. |
| Status chip | Click to transition state; certain transitions require admin. |
| Filter Builder | Multi-condition AND/OR filtering on every column. |

## Data flow
- Reads: `/api/replenishment/orders`, `/api/replenishment/orders/{id}/details`, `/api/replenishment/projected-inventory`.
- Writes: `POST /api/replenishment/orders`, `PATCH /api/replenishment/orders/{id}`.
- Saving an edit invalidates the orders + projected-inventory queries.

## Permissions
Read for all roles. Create / edit / state transitions require the **planner** role.

## Common pitfalls
- After creating a new order, the projected inventory does not redraw until you re-select the row (deliberate — avoids flicker).
- Bulk status changes are not yet supported; use the API directly for batches > 50.
