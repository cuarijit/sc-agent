# Modules & Pages

## Purpose
The Modules & Pages page configures the application's information architecture. Each module has a slug, label, icon, sort order, active flag, and a list of pages. Each page has its own slug, label, icon, route mapping, and role-access list. Editing a label here is the source of truth — the LeftNav re-renders from this configuration on next load.

## When to use it
- Renaming a module (e.g. **Smart Execution** → **Puls8 Supply Planning**).
- Hiding a page from non-admin roles.
- Adding a new module / page after a feature ships.
- Assigning agent instances to a page.

## Layout walkthrough
- **Module list** grid: slug, label, description, active, sort_order. Actions: Open, Edit, Delete.
- **Module detail** (right pane after Open): label / description / icon / sort_order edit form, then a **Pages** grid for that module.
- **Page edit dialog**: page_slug, label, page_type, config_ref, icon, sort_order, is_active.

## Step-by-step workflow (add a new page)
1. Open the target module.
2. Pages tab → **+ New Page**.
3. Set page_slug, label, icon (must exist in the icon registry), sort_order.
4. Save → page appears in LeftNav for users with the right entitlement.
5. (If the page is a custom React route) ensure the corresponding `<Route>` is wired in `main.tsx` and the slug→route mapping in `useDynamicNavigation.SLUG_TO_ROUTE` exists. The admin UI does not auto-generate React code.

## Key controls explained
| Control | What it does |
|---|---|
| Edit module label | PATCHes `modules.label`; admin edits stick across restarts (seed will not overwrite). |
| Active toggle | Hides module / page from LeftNav without deleting. |
| Sort order | LeftNav order. |
| Set role access | Comma-separated role IDs allowed to see the module / page. |
| Set page agents | Bind agent instances to a page. |

## Data flow
- Reads: `/admin/modules`, `/admin/modules/{slug}`, `/admin/modules/{slug}/pages`.
- Writes: `POST/PATCH/DELETE /admin/modules`, `/admin/modules/{slug}/pages/{page_slug}`, `/admin/modules/{slug}/roles`, `/admin/modules/{slug}/pages/{page_slug}/roles`, `/admin/modules/{slug}/pages/{page_slug}/agents`.
- The dynamic LeftNav reads from `/api/nav/modules`, which serves the same data with role filtering applied.

## Permissions
Admin only.

## Common pitfalls
- Adding a page slug that doesn't have a corresponding React route results in a 404 when the user clicks it.
- The 5 system module slugs (`smart-execution`, `intelligent-planning`, `agentic-ai`, `puls8-dbf`, `administration`) are protected from delete.
