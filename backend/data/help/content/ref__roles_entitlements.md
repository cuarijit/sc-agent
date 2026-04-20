# Roles & Entitlements Reference

## Default roles

| Role | Purpose | Inherits |
|---|---|---|
| `admin` | Full tenant control. | All entitlements. |
| `planner` | Day-to-day supply chain operations. | Read all + write replenishment / parameters / scenarios. |
| `demand_planner` | Demand & financial planning. | Read all + write demand_forecast / consensus / DBF. |
| `analyst` | Read-only across the platform. | Read all. |
| `customer` | Reserved for future per-tenant access. | Read Customer module pages only. |

## Page → entitlement map (excerpt)

| Page | Required entitlement |
|---|---|
| Users & Roles | `page.admin_users` |
| Modules & Pages | `page.admin_modules` |
| Branding & Logos | `page.admin_branding` |
| Documentation Management | `page.admin_documentation` |
| Parameter bulk apply | `action.parameters.bulk_apply` |
| Replenishment create | `action.replenishment.create` |
| Demand Forecasting save | `action.demand.adjust` |
| DBF publish | `action.dbf.publish` |

The full registry lives at **Administration → Users & Roles → Entitlements** tab (read-only). Custom roles can be assembled by admins from this registry.

## How to add a new entitlement
1. Add the entitlement key + description to `auth_store.py` `_ENTITLEMENT_REGISTRY`.
2. Add a default role mapping in `_ROLE_DEFAULTS`.
3. Restart backend — the new entitlement appears in the Entitlements tab and can be added to custom roles.

## Authorization at every layer
- **Frontend**: `<RequireRole allowedRoles={…}>` wrapper around routes; LeftNav filters by entitlement.
- **Backend**: every admin route depends on `Depends(require_admin)`; planner / demand_planner routes use `require_entitlement("…")`.
- **Data**: Data Access Groups (DAGs) apply WHERE-clause filters on row reads.
