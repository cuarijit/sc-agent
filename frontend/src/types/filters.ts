export interface GlobalFilters {
  runId: string;
  region: string;
  location: string[];
  sku: string[];
  category: string;
  supplier: string;
  exceptionStatus: string;
  recommendationId: string[];
  alertId: string[];
  alertType: string[];
  severity: string[];
  orderId: string[];
  orderType: string[];
  orderStatus: string[];
  exceptionReason: string[];
  shipFromNodeId: string[];
  shipToNodeId: string[];
  parameterCode: string[];
  parameterIssueType: string[];
  sourceMode: string[];
  nodeType: string[];
}

export const GLOBAL_FILTER_FIELD_KEYS: Array<keyof GlobalFilters> = [
  "runId",
  "region",
  "location",
  "sku",
  "category",
  "supplier",
  "exceptionStatus",
  "recommendationId",
  "alertId",
  "alertType",
  "severity",
  "orderId",
  "orderType",
  "orderStatus",
  "exceptionReason",
  "shipFromNodeId",
  "shipToNodeId",
  "parameterCode",
  "parameterIssueType",
  "sourceMode",
  "nodeType",
];

export function normalizedFilterList(values: string[] | undefined | null): string[] {
  const unique = new Set<string>();
  for (const item of values ?? []) {
    const value = String(item ?? "").trim();
    if (value) unique.add(value);
  }
  return [...unique];
}

export function firstFilterValue(values: string[] | undefined | null): string {
  return normalizedFilterList(values)[0] ?? "";
}

export function appendGlobalFilters(params: URLSearchParams, filters: GlobalFilters): URLSearchParams {
  if (filters.runId) params.set("run_id", filters.runId);
  if (filters.region) params.set("region", filters.region);
  if (filters.category) params.set("category", filters.category);
  if (filters.supplier) params.set("supplier", filters.supplier);
  if (filters.exceptionStatus) params.set("exception_status", filters.exceptionStatus);
  const repeated: Record<string, string[]> = {
    sku: normalizedFilterList(filters.sku),
    location: normalizedFilterList(filters.location),
    alert_id: normalizedFilterList(filters.alertId),
    recommendation_id: normalizedFilterList(filters.recommendationId),
    alert_type: normalizedFilterList(filters.alertType),
    severity: normalizedFilterList(filters.severity),
    order_id: normalizedFilterList(filters.orderId),
    order_type: normalizedFilterList(filters.orderType),
    status: normalizedFilterList(filters.orderStatus),
    exception_reason: normalizedFilterList(filters.exceptionReason),
    ship_from_node_id: normalizedFilterList(filters.shipFromNodeId),
    ship_to_node_id: normalizedFilterList(filters.shipToNodeId),
    parameter_code: normalizedFilterList(filters.parameterCode),
    issue_type: normalizedFilterList(filters.parameterIssueType),
    source_mode: normalizedFilterList(filters.sourceMode),
    node_type: normalizedFilterList(filters.nodeType),
  };
  for (const [key, values] of Object.entries(repeated)) {
    for (const value of values) {
      params.append(key, value);
    }
  }
  return params;
}

export function globalFiltersKey(filters: GlobalFilters): string {
  return JSON.stringify({
    ...filters,
    sku: normalizedFilterList(filters.sku),
    location: normalizedFilterList(filters.location),
    alertId: normalizedFilterList(filters.alertId),
    recommendationId: normalizedFilterList(filters.recommendationId),
    alertType: normalizedFilterList(filters.alertType),
    severity: normalizedFilterList(filters.severity),
    orderId: normalizedFilterList(filters.orderId),
    orderType: normalizedFilterList(filters.orderType),
    orderStatus: normalizedFilterList(filters.orderStatus),
    exceptionReason: normalizedFilterList(filters.exceptionReason),
    shipFromNodeId: normalizedFilterList(filters.shipFromNodeId),
    shipToNodeId: normalizedFilterList(filters.shipToNodeId),
    parameterCode: normalizedFilterList(filters.parameterCode),
    parameterIssueType: normalizedFilterList(filters.parameterIssueType),
    sourceMode: normalizedFilterList(filters.sourceMode),
    nodeType: normalizedFilterList(filters.nodeType),
  });
}
