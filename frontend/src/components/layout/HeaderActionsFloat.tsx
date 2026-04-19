/**
 * HeaderActionsFloat — top-right floating widget with filter + agent tray.
 *
 * Sits above the page content (no separate global filter strip), so the
 * filter and data-search agent buttons visually appear in the right side of
 * each page's own header. The agent opens as a right-side Drawer ("agent
 * tray") modeled on puls8 Instinct runtime, not a modal.
 */
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { Badge, Box, IconButton, Tooltip } from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import { useQuery } from "@tanstack/react-query";

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

const EMPTY_FILTERS: GlobalFilters = {
  runId: "", region: "", location: [], sku: [], category: "", supplier: "",
  exceptionStatus: "", recommendationId: [], alertId: [], alertType: [], severity: [],
  orderId: [], orderType: [], orderStatus: [], exceptionReason: [], shipFromNodeId: [],
  shipToNodeId: [], parameterCode: [], parameterIssueType: [], sourceMode: [], nodeType: [],
};

export default function HeaderActionsFloat({
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  const { data: options } = useQuery<MasterDataOptions>({
    queryKey: ["master-data-options"],
    queryFn: fetchMasterDataOptions,
    staleTime: 60_000,
    retry: false,
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
    const next: GlobalFilters = { ...EMPTY_FILTERS };
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

  return (
    <>
      {/* Floating widget — top-right of main-pane (which has position: relative) */}
      <Box
        sx={{
          position: "absolute",
          top: 8,
          right: 16,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          background: (theme) => theme.palette.mode === "dark" ? "rgba(24,28,36,0.92)" : "rgba(255,255,255,0.92)",
          backdropFilter: "blur(6px)",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: "999px",
          px: 0.5,
          py: 0.25,
          boxShadow: "0 2px 8px rgba(11, 24, 48, 0.08)",
        }}
      >
        <Tooltip title={activeCount > 0 ? `${activeCount} active filter${activeCount === 1 ? "" : "s"}` : "Manual filter"} placement="bottom">
          <IconButton
            size="small"
            color={activeCount > 0 ? "primary" : "default"}
            onClick={() => setFilterOpen(true)}
            sx={{ width: 30, height: 30 }}
            aria-label="Open manual filter"
          >
            <Badge
              badgeContent={activeCount > 0 ? activeCount : undefined}
              color="primary"
              overlap="circular"
              sx={{ "& .MuiBadge-badge": { fontSize: 9, height: 14, minWidth: 14, padding: "0 4px" } }}
            >
              <FilterAltOutlinedIcon sx={{ fontSize: 16 }} />
            </Badge>
          </IconButton>
        </Tooltip>
        <Tooltip title="Open Data Search Agent" placement="bottom">
          <IconButton
            size="small"
            color="primary"
            onClick={() => setAgentOpen(true)}
            sx={{ width: 30, height: 30 }}
            aria-label="Open data search agent"
          >
            <AutoAwesomeOutlinedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Manual filter dialog */}
      <FilterBuilderDialog
        open={filterOpen}
        title="Manual Filter"
        fields={fields}
        initialState={initialState}
        onClose={() => setFilterOpen(false)}
        onApply={applyDialogFilters}
        onClear={() => setFilters({ ...EMPTY_FILTERS })}
      />

      {/* Agent tray (right-side drawer like puls8 Instinct runtime) */}
      <GlobalFilterChatbotModal
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
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
