# Users & Roles

## Purpose
The Users & Roles page is the identity-and-access cockpit. Admins create users, assign roles, attach Data Access Groups (DAGs), and inspect the entitlement registry. Roles are bundles of entitlements; entitlements are atomic capabilities (e.g. `page.admin_users`, `action.parameters.bulk_apply`).

## Tabs / sub-sections

### tab__users — Users
Grid: username, name, email, active, roles, DAGs. Actions: create, edit, delete, reset password.

### tab__roles — Roles
Grid: role_id, name, description, entitlement count. Click → see + edit the role's entitlement set.

### tab__data_access_groups — Data Access Groups
DAGs scope what data a user can see (region, supplier, customer). Create a DAG, assign users.

### tab__entitlements — Entitlements
Read-only registry: every entitlement key + description. Used for reference when authoring custom roles.

## Step-by-step workflow (onboard a new planner)
1. Users → **Create User** → fill username, name, email, set active.
2. Assign roles: select `planner` (and optionally `demand_planner`).
3. Assign DAG(s) for region scoping.
4. Save → user appears with a default password (admin must communicate).
5. User logs in, changes password from the avatar menu.

## Key controls explained
| Control | What it does |
|---|---|
| Reset Password | Generates a new temporary password (returned once). |
| Edit role entitlements | Toggles entitlements on / off; takes effect on next login. |
| Active toggle | Disables login without deleting. |

## Data flow
- Reads: `/admin/users`, `/admin/roles`, `/admin/dags`, `/admin/entitlements`.
- Writes: corresponding POST/PATCH/DELETE on the same paths.
- Auth: every change requires the **admin** role.

## Permissions
Admin only.

## Common pitfalls
- A role change does not take effect on the user's current session — they need to log out / in.
- DAG enforcement happens server-side; if a user can see a row they shouldn't, check the DAG SQL filter not the UI.
