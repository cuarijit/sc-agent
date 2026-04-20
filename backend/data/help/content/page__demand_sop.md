# S&OP / IBP

## Purpose
The S&OP / IBP page is the cycle calendar — every Sales & Operations Planning cycle the organization runs, with its dates (demand review, supply review, pre-S&OP, exec S&OP) and status. Underneath sits the queue of review items that planners and execs need to resolve before consensus.

## When to use it
- Tracking where the current cycle stands ("planning / in_review / completed").
- Working the open review-item backlog ahead of pre-S&OP.
- Checking who's on the hook for which open item.

## Layout walkthrough
Two tabs:

### tab__sop_cycles — Cycles
- Grid of cycles: cycle_id, name, month, status, dates (demand / supply / pre / exec), consensus_approved, approved_by.
- Status chip colour coded.

### tab__sop_review_items — Review Items
- Grid of items: review_type (demand / supply / pre_sop / exec_sop), topic, SKU/location, gap_qty, action_required, owner, status, due_date.
- Filterable by review_type and status.

## Key controls explained
| Control | What it does |
|---|---|
| Cycle row click | Opens the cycle detail (summary + linked review items). |
| Review item status chip | Click to advance (`open → resolved` or `open → ignored`). |

## Data flow
- Reads: `/api/demand/sop/cycles`, `/api/demand/sop/review-items?cycle_id=…`.
- Writes: `PATCH /api/demand/sop/review-items/{id}/state`.

## Permissions
Read for all roles. State transitions require **demand_planner** or **admin**.

## Common pitfalls
- A cycle in `planning` status has empty review items until the demand-review date passes.
