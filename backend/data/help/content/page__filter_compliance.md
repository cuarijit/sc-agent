# Filter Compliance

## Purpose
The Filter Compliance page audits how every page / API query consumes the global filter bar. It surfaces queries that are missing filter wiring (would return wrong data when filters change), partially compliant queries, and idle ones that are not used anywhere.

## When to use it
- Pre-release sweep: catch new pages that forgot to plumb a filter.
- Bug investigation: "page X ignores my region filter" — check here first.
- Architecture audit: which filters are actually used vs theoretical.

## Layout walkthrough
- Compliance matrix grid: route, page, query name, consumed filters (chips), active filters (chips), missing filters (chips), status.
- Status colour: green = compliant, amber = partial, red = missing, grey = idle.

## Key controls explained
| Control | What it does |
|---|---|
| Status chip | Filter the grid by status. |
| Filter-name chip | Click → filter to all queries that consume / fail to consume that filter. |

## Data flow
- Reads: `/api/filter-compliance/registry` — backend introspects every registered query and returns its filter signature.
- The "active filters" column comes from the live global-filter context.

## Permissions
Read for all roles.

## Common pitfalls
- "Missing filter" doesn't always mean a bug — some queries are scope-free by design (e.g. master data lookups). Verify before raising a ticket.
