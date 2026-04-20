# Global Filters Reference

The global filter bar lives in the page header (right side, the funnel icon) and feeds every list / chart / KPI on every page. Filters are stored in the React shell context and serialized into every API request.

## Filter keys

| Key | Type | Used by |
|---|---|---|
| `runId` | string | All pages — anchors data to a specific planning run. |
| `region` | string | Dashboard, Network, Replenishment, Recommendations. |
| `location` | string[] | Dashboard, Replenishment, Network, Demand pages. |
| `sku` | string[] | Most pages — single most common filter. |
| `category` | string | Demand pages, Documents. |
| `supplier` | string | Documents, Network, Parameters. |
| `exceptionStatus` | string | Parameters, Replenishment, Dashboard. |
| `recommendationId` | string[] | Recommendations, SKU Detail. |
| `alertId` | string[] | Network, Dashboard. |
| `alertType` | string[] | Network, Dashboard. |
| `severity` | string[] | Network, Dashboard, Demand Sensing. |
| `orderId` | string[] | Replenishment. |
| `orderType` | string[] | Replenishment. |
| `orderStatus` | string[] | Replenishment. |
| `exceptionReason` | string[] | Replenishment, Parameters. |
| `shipFromNodeId` | string[] | Replenishment, Network. |
| `shipToNodeId` | string[] | Replenishment, Network. |
| `parameterCode` | string[] | Parameters. |
| `parameterIssueType` | string[] | Parameters. |
| `sourceMode` | string[] | Network. |
| `nodeType` | string[] | Network. |

## How to use the filter
- Click the funnel icon → opens the **Manual Filter** dialog with multi-condition AND/OR builder.
- Click a chip on a KPI / chart → applies that value as a filter (e.g. severity click).
- Active filter count is shown as a badge on the funnel icon.
- "Clear" wipes all filters back to defaults.

## Auditing what consumes a filter
Open **Puls8 Agents → Filter Compliance** to see every page / query and the filters it consumes vs ignores.
