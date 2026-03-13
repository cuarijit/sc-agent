import type { Dispatch, SetStateAction } from "react";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import { IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [chatbotOpen, setChatbotOpen] = useState(false);
  const { data: options } = useQuery<MasterDataOptions>({
    queryKey: ["master-data-options"],
    queryFn: fetchMasterDataOptions,
  });
  const fields = useMemo<FilterFieldOption[]>(
    () => {
      const globalValues = options?.global_filter_values ?? {};
      return [
        { key: "runId", label: "Run", type: "text", suggestions: globalValues.run_id ?? [] },
        { key: "region", label: "Region", type: "text", suggestions: options?.regions ?? [] },
        {
          key: "location",
          label: "Location",
          type: "text",
          suggestions: (options?.locations ?? []).map((item) => item.code),
        },
        {
          key: "sku",
          label: "SKU",
          type: "text",
          suggestions: (options?.products ?? []).map((item) => item.sku),
        },
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
    },
    [options],
  );

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

  const applyDialogFilters = (state: FilterState) => {
    const next: GlobalFilters = {
      runId: "",
      region: "",
      location: [],
      sku: [],
      category: "",
      supplier: "",
      exceptionStatus: "",
      recommendationId: [],
      alertId: [],
      alertType: [],
      severity: [],
      orderId: [],
      orderType: [],
      orderStatus: [],
      exceptionReason: [],
      shipFromNodeId: [],
      shipToNodeId: [],
      parameterCode: [],
      parameterIssueType: [],
      sourceMode: [],
      nodeType: [],
    };
    for (const condition of state.conditions) {
      const key = condition.column as keyof GlobalFilters;
      if (!(key in next)) continue;
      if (
        key === "sku"
        || key === "location"
        || key === "alertId"
        || key === "recommendationId"
        || key === "alertType"
        || key === "severity"
        || key === "orderId"
        || key === "orderType"
        || key === "orderStatus"
        || key === "exceptionReason"
        || key === "shipFromNodeId"
        || key === "shipToNodeId"
        || key === "parameterCode"
        || key === "parameterIssueType"
        || key === "sourceMode"
        || key === "nodeType"
      ) {
        const values = condition.values?.length
          ? normalizedFilterList(condition.values)
          : condition.value
            ? normalizedFilterList([condition.value])
            : [];
        next[key] = values as never;
        continue;
      }
      next[key] = ((condition.values?.[0] ?? condition.value) || "") as never;
    }
    setFilters(next);
  };

  return (
    <Paper elevation={0} className="filter-bar">
      <Stack direction={{ xs: "column", md: "row" }} spacing={0.5} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip title="Global filters">
            <IconButton
              size="small"
              color="primary"
              aria-label="Open global filters"
              onClick={() => {
                setDialogOpen(true);
              }}
            >
              <FilterAltOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="RAG assistant">
            <IconButton
              size="small"
              color="primary"
              aria-label="Open data assistant"
              onClick={() => {
                setChatbotOpen(true);
              }}
            >
              <AutoAwesomeOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="caption" color="text.secondary">
            {initialState.conditions.length
              ? `${initialState.conditions.length} filters active`
              : "No filters applied"}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Global Filter
        </Typography>
      </Stack>
      <FilterBuilderDialog
        open={dialogOpen}
        title="Global Filters"
        fields={fields}
        initialState={initialState}
        onClose={() => {
          setDialogOpen(false);
        }}
        onApply={applyDialogFilters}
        onClear={() => {
          setFilters({
            runId: "",
            region: "",
            location: [],
            sku: [],
            category: "",
            supplier: "",
            exceptionStatus: "",
            recommendationId: [],
            alertId: [],
            alertType: [],
            severity: [],
            orderId: [],
            orderType: [],
            orderStatus: [],
            exceptionReason: [],
            shipFromNodeId: [],
            shipToNodeId: [],
            parameterCode: [],
            parameterIssueType: [],
            sourceMode: [],
            nodeType: [],
          });
        }}
      />
      <GlobalFilterChatbotModal
        open={chatbotOpen}
        onClose={() => setChatbotOpen(false)}
        filters={filters}
        setFilters={setFilters}
        config={config}
        openAiApiKey={openAiApiKey}
        assistantMode="meio-data-assistant"
        defaultGridCollapsed
      />
    </Paper>
  );
}
