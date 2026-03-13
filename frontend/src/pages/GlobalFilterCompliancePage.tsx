import { Chip, Stack, Typography } from "@mui/material";
import { type GridColDef } from "@mui/x-data-grid";
import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";

import type { ShellContextValue } from "../components/layout/AppShellLayout";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { GLOBAL_FILTER_FIELD_KEYS, type GlobalFilters } from "../types/filters";

type ComplianceStatus = "compliant" | "partial" | "missing" | "idle";

type QueryComplianceRow = {
  id: string;
  route: string;
  page: string;
  query: string;
  consumes: string;
  active_consumed: string;
  active_missing: string;
  status: ComplianceStatus;
};

type QueryRegistryEntry = {
  route: string;
  page: string;
  query: string;
  consumed: Array<keyof GlobalFilters>;
};

const REGISTRY: QueryRegistryEntry[] = [
  { route: "/", page: "Dashboard", query: "dashboard.stockouts", consumed: ["runId", "region", "location", "sku", "category", "supplier", "exceptionStatus"] },
  { route: "/", page: "Dashboard", query: "network.baseline(alerts)", consumed: ["region", "sku", "alertId", "alertType", "severity"] },
  { route: "/", page: "Dashboard", query: "parameters.exceptions", consumed: ["region", "location", "sku", "exceptionStatus", "recommendationId", "parameterCode", "parameterIssueType"] },
  { route: "/", page: "Dashboard", query: "parameters.values", consumed: ["region", "location", "sku", "parameterCode"] },
  { route: "/", page: "Dashboard", query: "replenishment.orders(exception)", consumed: ["region", "location", "sku", "alertId", "orderId", "orderType", "orderStatus", "exceptionReason", "shipFromNodeId", "shipToNodeId"] },

  { route: "/recommendations", page: "Recommendations", query: "dashboard.stockouts", consumed: ["runId", "region", "location", "sku", "category", "supplier", "exceptionStatus"] },
  { route: "/replenishment", page: "Replenishment", query: "replenishment.orders", consumed: ["region", "location", "sku", "alertId", "orderId", "orderType", "orderStatus", "exceptionReason", "shipFromNodeId", "shipToNodeId"] },
  { route: "/replenishment", page: "Replenishment", query: "replenishment.order-details", consumed: ["region", "location", "sku", "alertId", "orderId", "orderType", "orderStatus", "exceptionReason", "shipFromNodeId", "shipToNodeId"] },

  { route: "/network", page: "Network", query: "network.baseline", consumed: ["region", "sku", "alertId", "alertType", "severity"] },
  { route: "/network", page: "Network", query: "network.view", consumed: ["sku", "location", "alertId"] },
  { route: "/network", page: "Network", query: "replenishment.orders(exception)", consumed: ["region", "location", "sku", "alertId", "orderId", "orderType", "orderStatus", "exceptionReason", "shipFromNodeId", "shipToNodeId"] },

  { route: "/parameters", page: "Parameters", query: "parameters.values", consumed: ["region", "location", "sku", "parameterCode"] },
  { route: "/parameters", page: "Parameters", query: "parameters.exceptions", consumed: ["region", "location", "sku", "exceptionStatus", "recommendationId", "parameterCode", "parameterIssueType"] },

  { route: "/documents", page: "Documents", query: "document.search", consumed: ["supplier"] },

  { route: "/maintenance", page: "Maintenance", query: "maintenance.products", consumed: ["sku", "category"] },
  { route: "/maintenance", page: "Maintenance", query: "maintenance.locations", consumed: ["location", "region"] },
  { route: "/maintenance", page: "Maintenance", query: "maintenance.suppliers", consumed: ["supplier", "region"] },
  { route: "/maintenance", page: "Maintenance", query: "maintenance.projected-inventory", consumed: ["sku", "location"] },

  { route: "/chat", page: "Planner Chat", query: "chat.explain", consumed: ["sku", "location"] },
  { route: "/sku/:sku/location/:location", page: "SKU Detail", query: "sku.detail", consumed: ["runId"] },
  { route: "/parameters/:sku/:location", page: "Parameter Detail", query: "parameter.detail", consumed: ["parameterCode", "parameterIssueType"] },

  { route: "/scenarios", page: "Scenarios", query: "scenario.page", consumed: [] },
  { route: "/demand/forecast-alerts", page: "Demand Forecast Alerts", query: "placeholder", consumed: [] },
  { route: "/demand/forecast-modification", page: "Demand Forecast Modification", query: "placeholder", consumed: [] },
  { route: "/agentic-ai/agent-configuration", page: "Agent Configuration", query: "settings", consumed: [] },
  { route: "/agentic-ai/global-filter-compliance", page: "Global Filter Compliance", query: "compliance.registry", consumed: GLOBAL_FILTER_FIELD_KEYS },
];

function isActiveFilter(filters: GlobalFilters, key: keyof GlobalFilters) {
  const value = filters[key];
  if (Array.isArray(value)) {
    return value.some((item) => String(item).trim().length > 0);
  }
  return String(value ?? "").trim().length > 0;
}

function toLabel(key: keyof GlobalFilters): string {
  const value = String(key);
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

export default function GlobalFilterCompliancePage() {
  const { filters } = useOutletContext<ShellContextValue>();

  const activeFilterKeys = useMemo(
    () => GLOBAL_FILTER_FIELD_KEYS.filter((key) => isActiveFilter(filters, key)),
    [filters],
  );

  const rows = useMemo<QueryComplianceRow[]>(() => {
    return REGISTRY.map((entry, index) => {
      const consumedSet = new Set(entry.consumed);
      const activeConsumed = activeFilterKeys.filter((key) => consumedSet.has(key));
      const activeMissing = activeFilterKeys.filter((key) => !consumedSet.has(key));
      let status: ComplianceStatus = "idle";
      if (activeFilterKeys.length === 0) {
        status = "idle";
      } else if (activeMissing.length === 0) {
        status = "compliant";
      } else if (activeConsumed.length > 0) {
        status = "partial";
      } else {
        status = "missing";
      }
      return {
        id: `${entry.route}_${entry.query}_${index}`,
        route: entry.route,
        page: entry.page,
        query: entry.query,
        consumes: entry.consumed.length ? entry.consumed.map(toLabel).join(", ") : "None",
        active_consumed: activeConsumed.length ? activeConsumed.map(toLabel).join(", ") : "None",
        active_missing: activeMissing.length ? activeMissing.map(toLabel).join(", ") : "None",
        status,
      };
    });
  }, [activeFilterKeys]);

  const statusCounts = useMemo(
    () => ({
      compliant: rows.filter((row) => row.status === "compliant").length,
      partial: rows.filter((row) => row.status === "partial").length,
      missing: rows.filter((row) => row.status === "missing").length,
      idle: rows.filter((row) => row.status === "idle").length,
    }),
    [rows],
  );

  const columns = useMemo<GridColDef<QueryComplianceRow>[]>(
    () => [
      { field: "page", headerName: "Page", minWidth: 170, flex: 0.9 },
      { field: "route", headerName: "Route", minWidth: 180, flex: 1 },
      { field: "query", headerName: "Query", minWidth: 230, flex: 1.2 },
      { field: "status", headerName: "Status", minWidth: 120, flex: 0.7 },
      { field: "active_consumed", headerName: "Active Filters Consumed", minWidth: 280, flex: 1.7 },
      { field: "active_missing", headerName: "Active Filters Missing", minWidth: 280, flex: 1.7 },
      { field: "consumes", headerName: "All Supported Filters", minWidth: 320, flex: 2 },
    ],
    [],
  );

  return (
    <div className="page-scroll">
      <SectionCard
        title="Global Filter Compliance Checklist"
        subtitle="Automated route/query matrix showing whether active global filters are consumed"
      >
        <Stack spacing={1.2}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Chip label={`Active filters: ${activeFilterKeys.length}`} color="primary" variant="outlined" />
            <Chip label={`Compliant: ${statusCounts.compliant}`} color="success" variant="outlined" />
            <Chip label={`Partial: ${statusCounts.partial}`} color="warning" variant="outlined" />
            <Chip label={`Missing: ${statusCounts.missing}`} color="error" variant="outlined" />
            <Chip label={`Idle: ${statusCounts.idle}`} variant="outlined" />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Active global filters: {activeFilterKeys.length ? activeFilterKeys.map(toLabel).join(", ") : "None"}
          </Typography>
          <div className="maintenance-grid-shell" style={{ height: 640 }}>
            <SmartDataGrid
              rows={rows}
              columns={columns}
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50, 100]}
              initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
              sx={{ border: 0 }}
            />
          </div>
        </Stack>
      </SectionCard>
    </div>
  );
}
