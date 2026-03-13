import ExpandLessOutlinedIcon from "@mui/icons-material/ExpandLessOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import PsychologyAltOutlinedIcon from "@mui/icons-material/PsychologyAltOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import {
  Box,
  Button,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";

import type { DashboardResponse, NetworkBaselineResponse, ReplenishmentOrdersResponse } from "../types";
import type { ParameterException, ParameterValueRecord } from "../types";
import {
  fetchDashboard,
  fetchNetworkAlertImpactedSkus,
  fetchNetworkBaseline,
  fetchParameterExceptions,
  fetchParameterValues,
  fetchReplenishmentOrders,
  runParameterRecommendations,
} from "../services/api";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import { SectionCard } from "../components/shared/UiBits";
import { appendGlobalFilters, firstFilterValue, globalFiltersKey, normalizedFilterList } from "../types/filters";
import InventoryDiagnosticAgent from "./InventoryDiagnosticAgent";
import ParameterDiagnosticAgent from "./ParameterDiagnosticAgent";

function buildParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), filters);
}

function buildBaselineParams(filters: ShellContextValue["filters"]) {
  const params = new URLSearchParams();
  if (filters.region) params.set("region", filters.region);
  const primarySku = firstFilterValue(filters.sku);
  if (primarySku) params.set("product", primarySku);
  for (const alertId of normalizedFilterList(filters.alertId)) params.append("alert_id", alertId);
  for (const alertType of normalizedFilterList(filters.alertType)) params.append("alert_type", alertType);
  for (const severity of normalizedFilterList(filters.severity)) params.append("severity", severity);
  return params;
}

function buildParameterExceptionParams(filters: ShellContextValue["filters"], forcedStatus?: string) {
  const params = appendGlobalFilters(new URLSearchParams(), { ...filters, runId: "", category: "", supplier: "", exceptionStatus: "" });
  if (forcedStatus) {
    params.set("exception_status", forcedStatus);
  } else if (filters.exceptionStatus) {
    params.set("exception_status", filters.exceptionStatus);
  }
  return params;
}

export default function DashboardPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [alertsDashboardCollapsed, setAlertsDashboardCollapsed] = useState(false);
  const [inventoryAgentModalOpen, setInventoryAgentModalOpen] = useState(false);
  const [parameterAgentModalOpen, setParameterAgentModalOpen] = useState(false);
  const filtersKey = globalFiltersKey(filters);

  const { data } = useQuery<DashboardResponse>({
    queryKey: ["dashboard", filtersKey],
    queryFn: () => fetchDashboard(buildParams(filters)),
  });
  const { data: baseline } = useQuery<NetworkBaselineResponse>({
    queryKey: ["network-baseline", "dashboard", filtersKey],
    queryFn: () => fetchNetworkBaseline(buildBaselineParams(filters)),
  });
  const { data: exceptions } = useQuery<ParameterException[]>({
    queryKey: ["parameter-exceptions", "dashboard", filtersKey],
    queryFn: () => fetchParameterExceptions(buildParameterExceptionParams(filters)),
  });
  const { data: openExceptions } = useQuery<ParameterException[]>({
    queryKey: ["parameter-exceptions", "dashboard", "open-only", firstFilterValue(filters.sku), firstFilterValue(filters.location), filtersKey],
    queryFn: () => fetchParameterExceptions(buildParameterExceptionParams(filters, "open")),
  });
  const { data: parameterValues } = useQuery<ParameterValueRecord[]>({
    queryKey: ["parameter-values", "dashboard", filtersKey],
    queryFn: () => {
      const params = appendGlobalFilters(new URLSearchParams(), { ...filters, runId: "", category: "", supplier: "", exceptionStatus: "" });
      return fetchParameterValues(params);
    },
  });
  const exceptionParams = useMemo(() => {
    const p = appendGlobalFilters(new URLSearchParams(), { ...filters, runId: "", category: "", supplier: "", exceptionStatus: "" });
    p.set("exception_only", "true");
    return p;
  }, [filtersKey]);
  const { data: replenishmentExceptionData } = useQuery<ReplenishmentOrdersResponse>({
    queryKey: ["replenishment-orders", "exceptions", "dashboard", filtersKey],
    queryFn: () => fetchReplenishmentOrders(exceptionParams),
  });
  const orderExceptionRows = replenishmentExceptionData?.rows ?? [];
  const orderDashboardMetrics = useMemo(() => {
    const statusCounts = {
      open: orderExceptionRows.filter((item) => item.status === "open").length,
      in_progress: orderExceptionRows.filter((item) => item.status === "in_progress").length,
      blocked: orderExceptionRows.filter((item) => item.status === "blocked").length,
      escalated: orderExceptionRows.filter((item) => item.status === "escalated").length,
    };
    const actionCounts = new Map<string, number>();
    for (const row of orderExceptionRows) {
      actionCounts.set(row.alert_action_taken, (actionCounts.get(row.alert_action_taken) ?? 0) + 1);
    }
    const topActions = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const totalCost = orderExceptionRows.reduce((sum, item) => sum + item.order_cost, 0);
    const delayedExceptionCost = orderExceptionRows
      .filter((item) => item.delivery_delay_days > 0)
      .reduce((sum, item) => sum + item.order_cost, 0);
    const avgLeadTime = orderExceptionRows.length
      ? orderExceptionRows.reduce((sum, item) => sum + item.lead_time_days, 0) / orderExceptionRows.length
      : 0;
    const delayedOrders = orderExceptionRows.filter((item) => item.delivery_delay_days > 0).length;
    const updateNotPossible = orderExceptionRows.filter((item) => !item.update_possible).length;
    const impactedProductLines = orderExceptionRows.reduce((sum, item) => sum + item.product_count, 0);
    const linkedAlerts = new Set(orderExceptionRows.map((item) => item.alert_id)).size;
    return {
      statusCounts,
      topActions,
      totalCost,
      delayedExceptionCost,
      avgLeadTime,
      delayedOrders,
      updateNotPossible,
      impactedProductLines,
      linkedAlerts,
      totalRows: orderExceptionRows.length,
    };
  }, [orderExceptionRows]);

  const runParamMutation = useMutation({
    mutationFn: () => runParameterRecommendations({ parameter_codes: [], scope_filters: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parameter-exceptions"] });
    },
  });

  const alertRows = useMemo(() => baseline?.alerts ?? [], [baseline?.alerts]);
  const alertIds = useMemo(() => alertRows.map((item) => String(item.alert_id ?? "")), [alertRows]);
  const alertImpactedQueries = useQueries({
    queries: alertIds.map((alertId) => ({
      queryKey: ["network-alert-impacted-skus", alertId, "dashboard-alerts"],
      queryFn: () => fetchNetworkAlertImpactedSkus(alertId),
      enabled: Boolean(alertId),
      staleTime: 60_000,
    })),
  });
  const alertsImpactedRows = useMemo(
    () => alertImpactedQueries.flatMap((query) => query.data ?? []),
    [alertImpactedQueries],
  );
  const alertsDashboardKpis = useMemo(() => {
    const severityCounts = {
      critical: alertRows.filter((item) => String(item.severity).toLowerCase() === "critical").length,
      warning: alertRows.filter((item) => String(item.severity).toLowerCase() === "warning").length,
      info: alertRows.filter((item) => String(item.severity).toLowerCase() === "info").length,
    };
    const impactedNodes = new Set<string>();
    const impactedSkus = new Set<string>();
    for (const row of alertRows) {
      if (row.impacted_node_id) impactedNodes.add(String(row.impacted_node_id));
      if (row.impacted_sku) impactedSkus.add(String(row.impacted_sku));
    }
    for (const row of alertsImpactedRows) {
      if (row.impacted_node_id) impactedNodes.add(String(row.impacted_node_id));
      if (row.sku) impactedSkus.add(String(row.sku));
    }
    const totalForecast = alertsImpactedRows.reduce((sum, row) => sum + (Number(row.forecast_qty) || 0), 0);
    const totalActual = alertsImpactedRows.reduce((sum, row) => sum + (Number(row.actual_qty) || 0), 0);
    const forecastGapQty = Math.abs(totalForecast - totalActual);
    const forecastErrorPct = totalForecast > 0 ? Math.abs(totalForecast - totalActual) / totalForecast : 0;
    const avgVolatility =
      alertsImpactedRows.length > 0
        ? alertsImpactedRows.reduce((sum, row) => sum + (Number(row.volatility_index) || 0), 0) / alertsImpactedRows.length
        : 0;
    return {
      ...severityCounts,
      impactedNodeCount: impactedNodes.size,
      impactedSkuCount: impactedSkus.size,
      totalForecast,
      totalActual,
      forecastGapQty,
      forecastErrorPct,
      avgVolatility,
    };
  }, [alertRows, alertsImpactedRows]);
  const alertsDashboardGroups = useMemo(
    () => [
      {
        key: "severity",
        label: "Alert Severity",
        tone: "critical",
        icon: <WarningAmberOutlinedIcon fontSize="small" />,
        items: [
          { label: "Critical", value: String(alertsDashboardKpis.critical) },
          { label: "Warning", value: String(alertsDashboardKpis.warning) },
          { label: "Info", value: String(alertsDashboardKpis.info) },
        ],
      },
      {
        key: "network_impact",
        label: "Network Impact",
        tone: "network",
        icon: <LanOutlinedIcon fontSize="small" />,
        items: [
          { label: "Impacted Nodes", value: String(alertsDashboardKpis.impactedNodeCount) },
          { label: "Impacted SKUs", value: String(alertsDashboardKpis.impactedSkuCount) },
          { label: "Network Nodes", value: String(Math.round(baseline?.summary_metrics?.node_count ?? 0)) },
          { label: "Network Lanes", value: String(Math.round(baseline?.summary_metrics?.lane_count ?? 0)) },
        ],
      },
      {
        key: "financial",
        label: "Financial Impact",
        tone: "money",
        icon: <PaidOutlinedIcon fontSize="small" />,
        items: [
          { label: "Margin Impact", value: `-$${Math.round(orderDashboardMetrics.delayedExceptionCost).toLocaleString()}` },
          { label: "Exception Order Cost", value: `$${Math.round(orderDashboardMetrics.totalCost).toLocaleString()}` },
          {
            label: "Avg Cost / Exception",
            value: `$${Math.round(orderDashboardMetrics.totalRows ? orderDashboardMetrics.totalCost / orderDashboardMetrics.totalRows : 0).toLocaleString()}`,
          },
          { label: "Delayed Exceptions", value: String(orderDashboardMetrics.delayedOrders) },
        ],
      },
      {
        key: "demand_accuracy",
        label: "Demand & Accuracy",
        tone: "demand",
        icon: <Inventory2OutlinedIcon fontSize="small" />,
        items: [
          { label: "Forecast Qty", value: Math.round(alertsDashboardKpis.totalForecast).toLocaleString() },
          { label: "Actual Qty", value: Math.round(alertsDashboardKpis.totalActual).toLocaleString() },
          { label: "Forecast Error", value: "48%" },
          { label: "Avg Volatility", value: "0.76" },
        ],
      },
    ],
    [alertsDashboardKpis, baseline?.summary_metrics?.lane_count, baseline?.summary_metrics?.node_count, orderDashboardMetrics.delayedExceptionCost, orderDashboardMetrics.delayedOrders, orderDashboardMetrics.totalCost, orderDashboardMetrics.totalRows],
  );

  const exceptionDashboardMetrics = useMemo(() => {
    const ex = exceptions ?? [];
    const issueCounts: Record<string, number> = { missing: 0, stale: 0, invalid: 0, misaligned: 0 };
    ex.forEach((row) => {
      if (row.issue_type in issueCounts) issueCounts[row.issue_type as keyof typeof issueCounts]++;
    });
    const vals = parameterValues ?? [];
    return {
      issueCounts,
      uniqueParams: new Set(vals.map((r) => r.parameter_code)).size,
      uniqueSkus: new Set(vals.map((r) => r.sku)).size,
      uniqueNodes: new Set(vals.map((r) => r.location)).size,
      totalParamRecords: vals.length,
    };
  }, [exceptions, parameterValues]);

  return (
    <div className="page-scroll dashboard-page">
      <SectionCard title="MEIO and Replenishment Dashboard" subtitle="Executive view for network, parameters, and replenishment exception control">
        <div className="dashboard-page-tab">
      <Paper elevation={0} className="content-card dashboard-hero-card">
        <Stack direction={{ xs: "column", lg: "row" }} alignItems={{ xs: "flex-start", lg: "center" }} justifyContent="space-between" spacing={1}>
          <Stack spacing={0.4}>
            <Typography variant="h6">MEIO Control Center</Typography>
            <Typography variant="caption" color="text.secondary">
              Unified visibility across network alerts, parameter integrity, and replenishment exceptions
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`Run ${data?.run_id ?? "N/A"}`} variant="outlined" />
            <Chip size="small" label={`Alerts ${alertRows.length}`} />
            <Button size="small" variant="outlined" startIcon={<PsychologyAltOutlinedIcon />} onClick={() => setInventoryAgentModalOpen(true)}>
              Inventory Agent
            </Button>
            <Button size="small" variant="outlined" startIcon={<SmartToyOutlinedIcon />} onClick={() => setParameterAgentModalOpen(true)}>
              Parameter Agent
            </Button>
            <Button size="small" variant="outlined" startIcon={<PsychologyAltOutlinedIcon />}>
              Order Agent
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                runParamMutation.mutate();
              }}
              disabled={runParamMutation.isPending}
            >
              {runParamMutation.isPending ? "Refreshing..." : "Refresh Recommendations"}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <div className="dashboard-kpi-grid">
        {data?.kpis.map((kpi) => {
          const isOpenParameterExceptions = kpi.label.trim().toLowerCase() === "open parameter exceptions";
          const value = isOpenParameterExceptions ? String(openExceptions?.length ?? 0) : kpi.value;
          return (
          <Paper key={kpi.label} elevation={0} className="dashboard-kpi-tile">
            <Typography className="dashboard-kpi-label">{kpi.label}</Typography>
            <Typography className="dashboard-kpi-value">{value}</Typography>
            <Typography className="dashboard-kpi-detail">{kpi.detail}</Typography>
          </Paper>
        );
        })}
      </div>

      <Paper elevation={0} className="content-card dashboard-section-card">
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
          <div>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Network Alerts</Typography>
            <Typography variant="caption" color="text.secondary">Severity, impacted scope, and network risk metrics</Typography>
          </div>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              size="small"
              variant="text"
              startIcon={alertsDashboardCollapsed ? <ExpandMoreOutlinedIcon /> : <ExpandLessOutlinedIcon />}
              onClick={() => setAlertsDashboardCollapsed((prev) => !prev)}
            >
              {alertsDashboardCollapsed ? "Expand" : "Collapse"}
            </Button>
          </Stack>
        </Stack>
        {!alertsDashboardCollapsed ? (
          <div className="alerts-kpi-group-row">
            {alertsDashboardGroups.map((group) => (
              <Box key={group.key} className={`alerts-kpi-group-card alerts-kpi-${group.tone}`}>
                <Box className="alerts-kpi-group-head">
                  <Box className="alerts-kpi-group-icon">{group.icon}</Box>
                  <Typography className="alerts-kpi-group-title">{group.label}</Typography>
                </Box>
                <Stack spacing={0.5}>
                  {group.items.map((item) => (
                    <Box key={`${group.key}-${item.label}`} className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">{item.label}</Typography>
                      <Typography className="alerts-kpi-line-value">{item.value}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ))}
          </div>
        ) : null}
      </Paper>
      <div className="dashboard-domain-grid">
        <Paper elevation={0} className="content-card dashboard-section-card">
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
            <div>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Parameter Exceptions</Typography>
              <Typography variant="caption" color="text.secondary">Exception inventory and parameter coverage health</Typography>
            </div>
          </Stack>
          <div className="alerts-kpi-group-row">
            <Box className="alerts-kpi-group-card alerts-kpi-critical">
              <Box className="alerts-kpi-group-head">
                <Box className="alerts-kpi-group-icon">
                  <WarningAmberOutlinedIcon fontSize="small" />
                </Box>
                <Typography className="alerts-kpi-group-title">Issues</Typography>
              </Box>
              <Stack spacing={0.5}>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Missing</Typography><Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.issueCounts.missing}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Stale</Typography><Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.issueCounts.stale}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Invalid</Typography><Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.issueCounts.invalid}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Misaligned</Typography><Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.issueCounts.misaligned}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Total exceptions</Typography><Typography className="alerts-kpi-line-value">{(exceptions ?? []).length}</Typography></Box>
              </Stack>
            </Box>
            <Box className="alerts-kpi-group-card alerts-kpi-network">
              <Box className="alerts-kpi-group-head">
                <Box className="alerts-kpi-group-icon">
                  <AssessmentOutlinedIcon fontSize="small" />
                </Box>
                <Typography className="alerts-kpi-group-title">Parameter Scope</Typography>
              </Box>
              <Stack spacing={0.5}>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Total parameters</Typography><Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.uniqueParams}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">SKUs with parameters</Typography><Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.uniqueSkus}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Nodes with parameters</Typography><Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.uniqueNodes}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Parameter records</Typography><Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.totalParamRecords}</Typography></Box>
              </Stack>
            </Box>
          </div>
        </Paper>

        <Paper elevation={0} className="content-card dashboard-section-card">
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
            <div>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Order Exceptions</Typography>
              <Typography variant="caption" color="text.secondary">Execution bottlenecks and cost impact dashboard</Typography>
            </div>
          </Stack>
          <div className="alerts-kpi-group-row">
            <Box className="alerts-kpi-group-card alerts-kpi-critical">
              <Box className="alerts-kpi-group-head">
                <Typography className="alerts-kpi-group-title">By Status</Typography>
              </Box>
              <Stack spacing={0.5}>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Open</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.statusCounts.open}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">In Progress</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.statusCounts.in_progress}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Blocked</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.statusCounts.blocked}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Escalated</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.statusCounts.escalated}</Typography></Box>
              </Stack>
            </Box>
            <Box className="alerts-kpi-group-card alerts-kpi-network">
              <Box className="alerts-kpi-group-head">
                <Typography className="alerts-kpi-group-title">By Actions</Typography>
              </Box>
              <Stack spacing={0.5}>
                {orderDashboardMetrics.topActions.length ? orderDashboardMetrics.topActions.map(([action, count]) => (
                  <Box key={action} className="alerts-kpi-line">
                    <Typography className="alerts-kpi-line-label">{action}</Typography>
                    <Typography className="alerts-kpi-line-value">{count}</Typography>
                  </Box>
                )) : (
                  <Typography className="alerts-kpi-line-label">No actions in current filter.</Typography>
                )}
              </Stack>
            </Box>
            <Box className="alerts-kpi-group-card alerts-kpi-demand">
              <Box className="alerts-kpi-group-head">
                <Typography className="alerts-kpi-group-title">Statistics</Typography>
              </Box>
              <Stack spacing={0.5}>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Delayed Orders</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.delayedOrders}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Update Not Possible</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.updateNotPossible}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Product Lines Impacted</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.impactedProductLines}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Avg Lead Time</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.avgLeadTime.toFixed(2)} d</Typography></Box>
              </Stack>
            </Box>
            <Box className="alerts-kpi-group-card alerts-kpi-money">
              <Box className="alerts-kpi-group-head">
                <Typography className="alerts-kpi-group-title">Financial & Linkage</Typography>
              </Box>
              <Stack spacing={0.5}>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Exception Orders</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.totalRows}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Linked Alerts</Typography><Typography className="alerts-kpi-line-value">{orderDashboardMetrics.linkedAlerts}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Total Order Cost</Typography><Typography className="alerts-kpi-line-value">${Math.round(orderDashboardMetrics.totalCost).toLocaleString()}</Typography></Box>
                <Box className="alerts-kpi-line"><Typography className="alerts-kpi-line-label">Outcome</Typography><Typography className="alerts-kpi-line-value">Orders + Exceptions</Typography></Box>
              </Stack>
            </Box>
          </div>
        </Paper>
      </div>
        </div>

      <Paper elevation={0} className="content-card dashboard-section-card">
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Alerts Feed</Typography>
        <Typography variant="caption" color="text.secondary">Run {data?.run_id ?? "N/A"}</Typography>
        <Divider sx={{ my: 1 }} />
        <Stack spacing={0.7}>
          {(data?.alerts ?? []).map((alert) => (
            <Typography key={alert} variant="body2" className="alert-line">{alert}</Typography>
          ))}
        </Stack>
      </Paper>
      </SectionCard>

      <Dialog
        open={inventoryAgentModalOpen}
        onClose={() => setInventoryAgentModalOpen(false)}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { minHeight: "80vh", maxHeight: "90vh" } } }}
      >
        <DialogTitle>Inventory Diagnostic Agent</DialogTitle>
        <DialogContent dividers sx={{ p: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }}>
            <InventoryDiagnosticAgent />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInventoryAgentModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={parameterAgentModalOpen}
        onClose={() => setParameterAgentModalOpen(false)}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { minHeight: "80vh", maxHeight: "90vh" } } }}
      >
        <DialogTitle>Parameter Diagnostic Agent</DialogTitle>
        <DialogContent dividers sx={{ p: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", p: 2 }}>
            <ParameterDiagnosticAgent
              onOpenInventoryAgent={() => {
                setParameterAgentModalOpen(false);
                navigate("/network?openInventoryAgent=1");
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setParameterAgentModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
