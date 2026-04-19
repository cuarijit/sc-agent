/**
 * GlobalFilterBar — now a polished page-header strip.
 *
 * Layout:
 *   [ PAGE TITLE / BREADCRUMB (left) ]   [ N active  🔽 Filters  ✨ Data Search (right) ]
 *
 * The bar sits immediately below the brand strip and above the scrollable
 * page content so every page automatically gets the same header treatment
 * without per-page changes.
 */
import type { Dispatch, SetStateAction } from "react";
import { useLocation } from "react-router-dom";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import { Box, Button, Chip, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { fetchMasterDataOptions } from "../../services/api";
import type { MasterDataOptions, UiConfig } from "../../types";
import type { GlobalFilters } from "../../types/filters";
import { normalizedFilterList } from "../../types/filters";
import FilterBuilderDialog from "../shared/FilterBuilderDialog";
import {
  createFilterCondition,
  type FilterCondition,
  type FilterFieldOption,
  type FilterState,
} from "../../filtering";
import GlobalFilterChatbotModal from "./GlobalFilterChatbotModal";

// Route → { title, module } map for the header breadcrumb
const ROUTE_META: Record<string, { title: string; module: string }> = {
  "/": { title: "Dashboard", module: "Smart Execution" },
  "/replenishment": { title: "Replenishment", module: "Smart Execution" },
  "/recommendations": { title: "Recommendations", module: "Smart Execution" },
  "/scenarios": { title: "Scenarios", module: "Smart Execution" },
  "/network": { title: "Network", module: "Smart Execution" },
  "/parameters": { title: "Parameters", module: "Smart Execution" },
  "/maintenance": { title: "Analytics", module: "Smart Execution" },
  "/documents": { title: "Documents", module: "Smart Execution" },
  "/chat": { title: "Chat", module: "Smart Execution" },
  "/demand/forecasting": { title: "Demand Forecasting", module: "Intelligent Planning" },
  "/demand/collaborative": { title: "Collaborative Planning", module: "Intelligent Planning" },
  "/demand/accuracy": { title: "Forecast Accuracy", module: "Intelligent Planning" },
  "/demand/sop": { title: "S&OP / IBP", module: "Intelligent Planning" },
  "/demand/supply-integration": { title: "Supply Integration", module: "Intelligent Planning" },
  "/demand/financial": { title: "Financial Planning", module: "Intelligent Planning" },
  "/demand/trade-promotion": { title: "Trade Promotion", module: "Intelligent Planning" },
  "/demand/analytics": { title: "Planning Analytics", module: "Intelligent Planning" },
  "/demand/customers": { title: "Customers", module: "Intelligent Planning" },
  "/agentic-ai/agent-configuration": { title: "Agent Configurator", module: "Agentic AI" },
  "/agentic-ai/inventory-diagnostic": { title: "Inventory Diagnostic", module: "Agentic AI" },
  "/agentic-ai/global-filter-compliance": { title: "Filter Compliance", module: "Agentic AI" },
  "/agentic-ai/admin/users": { title: "Users & Roles", module: "Administration" },
  "/agentic-ai/admin/modules": { title: "Modules & Pages", module: "Administration" },
  "/agentic-ai/admin/branding": { title: "Branding & Logos", module: "Administration" },
};

function resolveRouteMeta(pathname: string) {
  if (ROUTE_META[pathname]) return ROUTE_META[pathname];
  // prefix match for param routes
  let best = "";
  let bestMeta = { title: "Supply Chain Planning", module: "" };
  for (const route of Object.keys(ROUTE_META)) {
    if (route !== "/" && pathname.startsWith(route) && route.length > best.length) {
      best = route;
      bestMeta = ROUTE_META[route];
    }
  }
  return bestMeta;
}

export default function GlobalFilterBar({
  filters,
  setFilters,
  config,
  openAiApiKey,
}: {
  filters: GlobalFilters;
  setFilters: Dispatch<SetStateAction<GlobalFilters>>;
  config: UiConfig;
  openAiApiKey: string;
}) {
  const location = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [chatbotOpen, setChatbotOpen] = useState(false);

  const { data: options } = useQuery<MasterDataOptions>({
    queryKey: ["master-data-options"],
    queryFn: fetchMasterDataOptions,
    staleTime: 60_000,
  });

  const fields = useMemo<FilterFieldOption[]>(() => {
    const globalValues = options?.global_filter_values ?? {};
    return [
      { key: "runId", label: "Run", type: "text", suggestions: globalValues.run_id ?? [] },
      { key: "region", label: "Region", type: "text", suggestions: options?.regions ?? [] },
      { key: "location", label: "Location", type: "text", suggestions: (options?.locations ?? []).map((i) => i.code) },
      { key: "sku", label: "SKU", type: "text", suggestions: (options?.products ?? []).map((i) => i.sku) },
      { key: "category", label: "Category", type: "text", suggestions: options?.categories ?? [] },
      { key: "supplier", label: "Supplier", type: "text", suggestions: options?.suppliers ?? [] },
      { key: "exceptionStatus", label: "Exception Status", type: "text", suggestions: globalValues.exception_status ?? ["open", "accepted", "applied"] },
      { key: "recommendationId", label: "Recommendation ID", type: "text", suggestions: globalValues.recommendation_id ?? [] },
      { key: "alertId", label: "Alert ID", type: "text", suggestions: globalValues.alert_id ?? [] },
      { key: "alertType", label: "Alert Type", type: "text", suggestions: globalValues.alert_type ?? [] },
      { key: "severity", label: "Alert Severity", type: "text", suggestions: globalValues.severity ?? [] },
      { key: "orderId", label: "Order ID", type: "text", suggestions: globalValues.order_id ?? [] },
      { key: "orderType", label: "Order Type", type: "text", suggestions: globalValues.order_type ?? [] },
      { key: "orderStatus", label: "Order Status", type: "text", suggestions: globalValues.status ?? [] },
      { key: "exceptionReason", label: "Exception Reason", type: "text", suggestions: globalValues.exception_reason ?? [] },
      { key: "shipFromNodeId", label: "Ship From", type: "text", suggestions: globalValues.ship_from_node_id ?? [] },
      { key: "shipToNodeId", label: "Ship To", type: "text", suggestions: globalValues.ship_to_node_id ?? [] },
      { key: "parameterCode", label: "Parameter Code", type: "text", suggestions: globalValues.parameter_code ?? [] },
      { key: "parameterIssueType", label: "Parameter Issue Type", type: "text", suggestions: globalValues.issue_type ?? [] },
      { key: "sourceMode", label: "Source Mode", type: "text", suggestions: globalValues.source_mode ?? [] },
      { key: "nodeType", label: "Node Type", type: "text", suggestions: globalValues.node_type ?? [] },
    ];
  }, [options]);

  const initialState = useMemo<FilterState>(() => {
    const conditions: FilterCondition[] = [];
    for (const [key, value] of Object.entries(filters)) {
      const field = fields.find((item) => item.key === key);
      if (!field) continue;
      if (Array.isArray(value)) {
        const nextValues = normalizedFilterList(value);
        if (!nextValues.length) continue;
        conditions.push({ ...createFilterCondition(field.key, field.type), operator: "in", value: "", values: nextValues });
        continue;
      }
      if (!value) continue;
      conditions.push({ ...createFilterCondition(field.key, field.type), operator: "equals", value: String(value), values: undefined });
    }
    return { joinMode: "and", conditions };
  }, [fields, filters]);

  const activeCount = initialState.conditions.length;

  const applyDialogFilters = (state: FilterState) => {
    const next: GlobalFilters = {
      runId: "", region: "", location: [], sku: [], category: "", supplier: "",
      exceptionStatus: "", recommendationId: [], alertId: [], alertType: [], severity: [],
      orderId: [], orderType: [], orderStatus: [], exceptionReason: [], shipFromNodeId: [],
      shipToNodeId: [], parameterCode: [], parameterIssueType: [], sourceMode: [], nodeType: [],
    };
    for (const condition of state.conditions) {
      const key = condition.column as keyof GlobalFilters;
      if (!(key in next)) continue;
      if (Array.isArray(next[key])) {
        const values = condition.values?.length
          ? normalizedFilterList(condition.values)
          : condition.value ? normalizedFilterList([condition.value]) : [];
        next[key] = values as never;
        continue;
      }
      next[key] = ((condition.values?.[0] ?? condition.value) || "") as never;
    }
    setFilters(next);
  };

  const clearFilters = () => {
    setFilters({
      runId: "", region: "", location: [], sku: [], category: "", supplier: "",
      exceptionStatus: "", recommendationId: [], alertId: [], alertType: [], severity: [],
      orderId: [], orderType: [], orderStatus: [], exceptionReason: [], shipFromNodeId: [],
      shipToNodeId: [], parameterCode: [], parameterIssueType: [], sourceMode: [], nodeType: [],
    });
  };

  const meta = resolveRouteMeta(location.pathname);

  return (
    <>
      {/* ── Page header strip ── */}
      <Paper
        elevation={0}
        square
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 0,
          minHeight: 40,
          flexShrink: 0,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          gap: 1,
        }}
      >
        {/* LEFT — page title + module breadcrumb */}
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
          {meta.module ? (
            <>
              <Typography
                sx={{
                  fontSize: "11px",
                  color: "text.secondary",
                  fontFamily: '"IBM Plex Sans", sans-serif',
                  whiteSpace: "nowrap",
                }}
              >
                {meta.module}
              </Typography>
              <Box sx={{ width: 4, height: 4, borderRadius: "50%", bgcolor: "divider", flexShrink: 0 }} />
            </>
          ) : null}
          <Typography
            sx={{
              fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif',
              fontWeight: 700,
              fontSize: "13px",
              color: "text.primary",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {meta.title}
          </Typography>
        </Stack>

        {/* RIGHT — filter badge + filter button + data search agent */}
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
          {activeCount > 0 ? (
            <Chip
              size="small"
              label={`${activeCount} active`}
              color="primary"
              variant="outlined"
              onDelete={clearFilters}
              sx={{ height: 22, fontSize: "10px", fontFamily: '"IBM Plex Sans", sans-serif' }}
            />
          ) : null}

          <Tooltip title="Global Filters">
            <Button
              size="small"
              variant={activeCount > 0 ? "contained" : "outlined"}
              startIcon={<FilterAltOutlinedIcon sx={{ fontSize: "13px !important" }} />}
              onClick={() => setDialogOpen(true)}
              disableElevation
              sx={{
                height: 26,
                fontSize: "11px",
                fontFamily: '"IBM Plex Sans", sans-serif',
                fontWeight: 500,
                px: 1,
                minWidth: 0,
                borderColor: activeCount > 0 ? undefined : "divider",
                color: activeCount > 0 ? undefined : "text.secondary",
              }}
            >
              Filters
            </Button>
          </Tooltip>

          <Tooltip title="Data Search Agent">
            <Button
              size="small"
              variant="outlined"
              startIcon={<AutoAwesomeOutlinedIcon sx={{ fontSize: "13px !important" }} />}
              onClick={() => setChatbotOpen(true)}
              disableElevation
              sx={{
                height: 26,
                fontSize: "11px",
                fontFamily: '"IBM Plex Sans", sans-serif',
                fontWeight: 500,
                px: 1,
                minWidth: 0,
                borderColor: "divider",
                color: "text.secondary",
              }}
            >
              Data Search
            </Button>
          </Tooltip>
        </Stack>
      </Paper>

      {/* Dialogs — rendered outside the strip so they can be portal-mounted */}
      <FilterBuilderDialog
        open={dialogOpen}
        title="Global Filters"
        fields={fields}
        initialState={initialState}
        onClose={() => setDialogOpen(false)}
        onApply={applyDialogFilters}
        onClear={clearFilters}
      />
      <GlobalFilterChatbotModal
        open={chatbotOpen}
        onClose={() => setChatbotOpen(false)}
        filters={filters}
        setFilters={setFilters}
        config={config}
        openAiApiKey={openAiApiKey}
        assistantMode="asc-data-assistant"
        defaultGridCollapsed
      />
    </>
  );
}
