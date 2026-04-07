import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import PercentOutlinedIcon from "@mui/icons-material/PercentOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import TrendingFlatOutlinedIcon from "@mui/icons-material/TrendingFlatOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

import type { ShellContextValue } from "../components/layout/AppShellLayout";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { fetchDemandAccuracy, fetchDemandExceptions } from "../services/api";
import type {
  DemandExceptionRecord,
  DemandForecastAccuracyRecord,
  DemandForecastAccuracyResponse,
  DemandExceptionResponse,
} from "../types";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";

const compactSx = { fontSize: 11, "& .MuiDataGrid-cell": { py: 0.25 }, "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 } } as const;

function buildDemandParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), filters);
}

function severityChipColor(severity: string): "error" | "warning" | "info" | "default" {
  const s = String(severity || "").toLowerCase();
  if (s === "critical") return "error";
  if (s === "high") return "warning";
  if (s === "medium") return "info";
  return "default";
}

function SeverityChip({ severity }: { severity: string }) {
  return (
    <Chip
      size="small"
      label={severity || "—"}
      color={severityChipColor(severity)}
      sx={{ height: 22, fontSize: 11 }}
    />
  );
}

function exceptionTypeChipColor(t: string): "primary" | "secondary" | "info" | "warning" | "error" | "success" | "default" {
  const s = String(t || "").toLowerCase();
  if (s.includes("under") || s.includes("short")) return "warning";
  if (s.includes("over") || s.includes("spike")) return "info";
  if (s.includes("bias")) return "secondary";
  if (s.includes("mape") || s.includes("accuracy")) return "error";
  if (s.includes("promo")) return "success";
  return "primary";
}

function ExceptionTypeChip({ type }: { type: string }) {
  return (
    <Chip
      size="small"
      label={type || "—"}
      color={exceptionTypeChipColor(type)}
      variant="outlined"
      sx={{ height: 22, fontSize: 11 }}
    />
  );
}

function statusColor(s: string): string {
  const lower = String(s || "").toLowerCase();
  if (lower === "resolved") return "#16a34a";
  if (lower === "acknowledged") return "#2563eb";
  if (lower === "in_progress" || lower === "in progress") return "#7c3aed";
  return "#64748b";
}

function StatusChip({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      label={status || "—"}
      sx={{
        height: 22,
        fontSize: 10,
        fontWeight: 600,
        color: "#fff",
        backgroundColor: statusColor(status),
      }}
    />
  );
}

const SEVERITY_FILTER_KEYS = ["all", "critical", "high", "medium", "low"] as const;
type SeverityFilterKey = (typeof SEVERITY_FILTER_KEYS)[number];

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#94a3b8",
};

export default function DemandAccuracyPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const filtersKey = globalFiltersKey(filters);
  const params = useMemo(() => buildDemandParams(filters), [filtersKey]);
  const navigate = useNavigate();

  const [tab, setTab] = useState(0);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilterKey>("all");

  // ── Exception action state ──────────────────────────────────────────
  const [statusOverrides, setStatusOverrides] = useState<Record<number, string>>({});
  const [rootCauseOverrides, setRootCauseOverrides] = useState<Record<number, string>>({});
  const [rootCauseInputs, setRootCauseInputs] = useState<Record<number, string>>({});
  const [editingRootCause, setEditingRootCause] = useState<number | null>(null);
  const [detailRow, setDetailRow] = useState<DemandExceptionRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const [snackOpen, setSnackOpen] = useState(false);
  const [snackMsg, setSnackMsg] = useState("");

  const accuracyQuery = useQuery<DemandForecastAccuracyResponse>({
    queryKey: ["demand-accuracy", filtersKey],
    queryFn: () => fetchDemandAccuracy(params),
  });

  const exceptionsQuery = useQuery<DemandExceptionResponse>({
    queryKey: ["demand-exceptions", filtersKey],
    queryFn: () => fetchDemandExceptions(params),
  });

  const accuracyRows = accuracyQuery.data?.rows ?? [];
  const exceptionRowsAll = exceptionsQuery.data?.rows ?? [];

  const getStatus = useCallback((r: DemandExceptionRecord) => statusOverrides[r.id] ?? r.status, [statusOverrides]);
  const getRootCause = useCallback((r: DemandExceptionRecord) => rootCauseOverrides[r.id] ?? r.root_cause ?? "", [rootCauseOverrides]);

  const filteredExceptionRows = useMemo(() => {
    let result = exceptionRowsAll;
    if (severityFilter !== "all") result = result.filter((r) => String(r.severity || "").toLowerCase() === severityFilter);
    return result;
  }, [exceptionRowsAll, severityFilter]);

  // ── KPIs (recalculated with overrides) ──────────────────────────────
  const exceptionKpis = useMemo(() => {
    let open = 0;
    let acknowledged = 0;
    let resolved = 0;
    let critical = 0;
    for (const r of exceptionRowsAll) {
      const st = getStatus(r).toLowerCase();
      if (st === "open") open += 1;
      else if (st === "acknowledged") acknowledged += 1;
      else resolved += 1;
      if (String(r.severity || "").toLowerCase() === "critical") critical += 1;
    }
    return { open, acknowledged, resolved, critical, total: exceptionRowsAll.length };
  }, [exceptionRowsAll, getStatus]);

  // ── Action handlers ─────────────────────────────────────────────────
  const cycleStatus = useCallback((id: number, currentStatus: string) => {
    const lower = currentStatus.toLowerCase();
    let next: string;
    if (lower === "open") next = "acknowledged";
    else if (lower === "acknowledged") next = "resolved";
    else next = "open";
    setStatusOverrides((prev) => ({ ...prev, [id]: next }));
    setDirty(true);
  }, []);

  const startEditRootCause = useCallback((r: DemandExceptionRecord) => {
    setEditingRootCause(r.id);
    setRootCauseInputs((prev) => ({ ...prev, [r.id]: getRootCause(r) }));
  }, [getRootCause]);

  const commitRootCause = useCallback((id: number) => {
    const val = rootCauseInputs[id] ?? "";
    setRootCauseOverrides((prev) => ({ ...prev, [id]: val }));
    setEditingRootCause(null);
    setDirty(true);
  }, [rootCauseInputs]);

  const handleSaveAll = useCallback(() => {
    const statusChanges = Object.keys(statusOverrides).length;
    const rootChanges = Object.keys(rootCauseOverrides).length;
    setDirty(false);
    setSnackMsg(`Saved ${statusChanges} status update${statusChanges !== 1 ? "s" : ""} and ${rootChanges} root cause edit${rootChanges !== 1 ? "s" : ""}`);
    setSnackOpen(true);
  }, [statusOverrides, rootCauseOverrides]);

  const navigateToForecast = useCallback((sku: string, location: string) => {
    navigate(`/demand/forecasting?sku=${encodeURIComponent(sku)}&location=${encodeURIComponent(location)}`);
  }, [navigate]);

  // ── Weekly accuracy aggregates ──────────────────────────────────────
  const weeklyAggregates = useMemo(() => {
    const map = new Map<
      string,
      { week_start: string; sumF: number; sumA: number; sumMape: number; sumBias: number; sumWmape: number; sumTS: number; n: number }
    >();
    for (const row of accuracyRows) {
      const w = row.week_start;
      const cur = map.get(w) ?? { week_start: w, sumF: 0, sumA: 0, sumMape: 0, sumBias: 0, sumWmape: 0, sumTS: 0, n: 0 };
      cur.sumF += Number(row.forecast_qty) || 0;
      cur.sumA += Number(row.actual_qty) || 0;
      cur.sumMape += Number(row.mape) || 0;
      cur.sumBias += Number(row.bias) || 0;
      cur.sumWmape += Number(row.wmape) || 0;
      cur.sumTS += Number(row.tracking_signal) || 0;
      cur.n += 1;
      map.set(w, cur);
    }
    return [...map.values()]
      .map((x) => ({
        week_start: x.week_start,
        avg_forecast_qty: x.n ? Math.round(x.sumF / x.n) : 0,
        avg_actual_qty: x.n ? Math.round(x.sumA / x.n) : 0,
        avg_mape: x.n ? x.sumMape / x.n : 0,
        avg_bias: x.n ? x.sumBias / x.n : 0,
        avg_wmape: x.n ? x.sumWmape / x.n : 0,
        avg_tracking_signal: x.n ? x.sumTS / x.n : 0,
      }))
      .sort((a, b) => a.week_start.localeCompare(b.week_start));
  }, [accuracyRows]);

  const { transposedRows, transposedColumns } = useMemo(() => {
    const METRICS: { id: string; label: string; fmt: (v: number) => string }[] = [
      { id: "avg_forecast_qty", label: "Avg Forecast Qty", fmt: (v) => Math.round(v).toLocaleString() },
      { id: "avg_actual_qty", label: "Avg Actual Qty", fmt: (v) => Math.round(v).toLocaleString() },
      { id: "avg_mape", label: "Avg MAPE", fmt: (v) => `${v.toFixed(1)}%` },
      { id: "avg_bias", label: "Avg Bias", fmt: (v) => `${v.toFixed(1)}%` },
      { id: "avg_wmape", label: "Avg WMAPE", fmt: (v) => `${v.toFixed(1)}%` },
      { id: "avg_tracking_signal", label: "Avg Tracking Signal", fmt: (v) => v.toFixed(2) },
    ];
    const weeks = weeklyAggregates.map((w) => w.week_start);
    const rows = METRICS.map((m) => {
      const row: Record<string, unknown> = { id: m.id, metric: m.label };
      for (const w of weeklyAggregates) row[w.week_start] = (w as Record<string, unknown>)[m.id];
      return row;
    });
    const cols: GridColDef[] = [
      { field: "metric", headerName: "Metric", minWidth: 150, flex: 1, sortable: false },
      ...weeks.map(
        (w): GridColDef => ({
          field: w,
          headerName: w,
          minWidth: 105,
          flex: 0.7,
          sortable: false,
          renderCell: (params: GridRenderCellParams) => {
            const metricId = String(params.row.id);
            const val = params.value as number;
            if (val == null) return "—";
            const metric = METRICS.find((mm) => mm.id === metricId);
            const txt = metric ? metric.fmt(val) : String(val);
            if (metricId === "avg_mape" && val > 15)
              return <span style={{ color: "#dc2626", fontWeight: 700 }}>{txt}</span>;
            if (metricId === "avg_bias" && Math.abs(val) > 5)
              return (
                <span style={{ background: alpha("#f59e0b", 0.18), padding: "2px 6px", borderRadius: 4 }}>{txt}</span>
              );
            return txt;
          },
        }),
      ),
    ];
    return { transposedRows: rows, transposedColumns: cols };
  }, [weeklyAggregates]);

  // ── Exception analytics ──────────────────────────────────────────────
  // Weekly trend: total count, avg deviation, max deviation, resolution rate
  const exceptionWeekly = useMemo(() => {
    const map = new Map<string, {
      week_start: string; total: number; open: number; resolved: number;
      sumDev: number; maxDev: number;
      criticalCount: number; highCount: number;
    }>();
    for (const row of exceptionRowsAll) {
      const w = row.week_start;
      const cur = map.get(w) ?? { week_start: w, total: 0, open: 0, resolved: 0, sumDev: 0, maxDev: 0, criticalCount: 0, highCount: 0 };
      cur.total += 1;
      const st = getStatus(row).toLowerCase();
      if (st === "open") cur.open += 1;
      else if (st === "resolved") cur.resolved += 1;
      const dev = Math.abs(Number(row.deviation_pct) || 0);
      cur.sumDev += dev;
      cur.maxDev = Math.max(cur.maxDev, dev);
      const sev = String(row.severity || "").toLowerCase();
      if (sev === "critical") cur.criticalCount += 1;
      if (sev === "high") cur.highCount += 1;
      map.set(w, cur);
    }
    return [...map.values()]
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .map((w) => ({
        ...w,
        avgDev: w.total ? +(w.sumDev / w.total).toFixed(1) : 0,
        resolutionRate: w.total ? +((w.resolved / w.total) * 100).toFixed(0) : 0,
        critHigh: w.criticalCount + w.highCount,
      }));
  }, [exceptionRowsAll, getStatus]);

  // Scatter-style data: each exception as a point for the deviation distribution chart
  const exceptionScatter = useMemo(() => {
    return exceptionRowsAll.map((r) => ({
      week: r.week_start,
      deviation: Math.abs(Number(r.deviation_pct) || 0),
      severity: String(r.severity || "").toLowerCase(),
      sku: r.sku,
      id: r.exception_id,
    }));
  }, [exceptionRowsAll]);

  // Distribution by exception type
  const typeDistribution = useMemo(() => {
    const map = new Map<string, { type: string; count: number; avgDev: number; sumDev: number }>();
    for (const r of exceptionRowsAll) {
      const t = r.exception_type || "Unknown";
      const cur = map.get(t) ?? { type: t, count: 0, avgDev: 0, sumDev: 0 };
      cur.count += 1;
      cur.sumDev += Math.abs(Number(r.deviation_pct) || 0);
      map.set(t, cur);
    }
    return [...map.values()]
      .map((x) => ({ ...x, avgDev: x.count ? +(x.sumDev / x.count).toFixed(1) : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [exceptionRowsAll]);

  // ── Accuracy grid columns ────────────────────────────────────────────
  const accuracyColumns = useMemo<GridColDef<DemandForecastAccuracyRecord>[]>(
    () => [
      { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.85 },
      { field: "location", headerName: "Location", minWidth: 110, flex: 0.8 },
      { field: "week_start", headerName: "Week", minWidth: 100, flex: 0.75 },
      {
        field: "forecast_qty",
        headerName: "Forecast Qty",
        type: "number",
        minWidth: 110,
        flex: 0.75,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "actual_qty",
        headerName: "Actual Qty",
        type: "number",
        minWidth: 105,
        flex: 0.75,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "mape",
        headerName: "MAPE",
        type: "number",
        minWidth: 88,
        flex: 0.55,
        renderCell: (p: GridRenderCellParams<DemandForecastAccuracyRecord>) => {
          const v = Number(p.value ?? 0);
          const isHigh = v > 15;
          return (
            <span style={{ color: isHigh ? "#dc2626" : undefined, fontWeight: isHigh ? 700 : 400 }}>
              {v.toFixed(1)}%
            </span>
          );
        },
      },
      {
        field: "bias",
        headerName: "Bias",
        type: "number",
        minWidth: 88,
        flex: 0.55,
        renderCell: (p: GridRenderCellParams<DemandForecastAccuracyRecord>) => {
          const v = Number(p.value ?? 0);
          return (
            <span style={{ color: v > 0 ? "#dc2626" : v < 0 ? "#2563eb" : undefined }}>
              {v.toFixed(1)}%
            </span>
          );
        },
      },
      {
        field: "wmape",
        headerName: "WMAPE",
        type: "number",
        minWidth: 92,
        flex: 0.55,
        valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(1)}%`),
      },
      {
        field: "tracking_signal",
        headerName: "Tracking Signal",
        type: "number",
        minWidth: 120,
        flex: 0.65,
        renderCell: (p: GridRenderCellParams<DemandForecastAccuracyRecord>) => {
          const v = Number(p.value ?? 0);
          const outOfBounds = Math.abs(v) > 4;
          return (
            <span style={{ color: outOfBounds ? "#dc2626" : undefined, fontWeight: outOfBounds ? 700 : 400 }}>
              {v.toFixed(2)}
            </span>
          );
        },
      },
    ],
    [],
  );

  // ── Exception grid columns (with actions) ────────────────────────────
  const exceptionColumns = useMemo<GridColDef<DemandExceptionRecord>[]>(
    () => [
      { field: "exception_id", headerName: "Exception ID", minWidth: 115, flex: 0.7 },
      { field: "sku", headerName: "SKU", minWidth: 100, flex: 0.7 },
      { field: "location", headerName: "Location", minWidth: 95, flex: 0.65 },
      { field: "week_start", headerName: "Week", minWidth: 90, flex: 0.6 },
      {
        field: "exception_type",
        headerName: "Type",
        minWidth: 125,
        flex: 0.8,
        renderCell: (p: GridRenderCellParams<DemandExceptionRecord>) => (
          <ExceptionTypeChip type={String(p.value ?? "")} />
        ),
      },
      {
        field: "severity",
        headerName: "Severity",
        minWidth: 95,
        flex: 0.55,
        renderCell: (p: GridRenderCellParams<DemandExceptionRecord>) => (
          <SeverityChip severity={String(p.value ?? "")} />
        ),
      },
      {
        field: "deviation_pct",
        headerName: "Deviation %",
        type: "number",
        minWidth: 95,
        flex: 0.55,
        renderCell: (p: GridRenderCellParams<DemandExceptionRecord>) => {
          const v = Number(p.value ?? 0);
          const isHigh = Math.abs(v) > 50;
          return (
            <Box sx={{
              px: 0.6, py: 0.15, borderRadius: 0.5, fontSize: 11, fontWeight: isHigh ? 700 : 500,
              color: isHigh ? "#dc2626" : "#1e293b",
              backgroundColor: isHigh ? alpha("#dc2626", 0.08) : "transparent",
            }}>
              {v.toFixed(1)}%
            </Box>
          );
        },
      },
      {
        field: "forecast_qty",
        headerName: "Forecast Qty",
        type: "number",
        minWidth: 100,
        flex: 0.6,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "actual_qty",
        headerName: "Actual Qty",
        type: "number",
        minWidth: 95,
        flex: 0.6,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 110,
        flex: 0.65,
        renderCell: (p: GridRenderCellParams<DemandExceptionRecord>) => (
          <StatusChip status={getStatus(p.row)} />
        ),
      },
      { field: "assigned_to", headerName: "Assigned To", minWidth: 110, flex: 0.7 },
      {
        field: "root_cause",
        headerName: "Root Cause",
        minWidth: 180,
        flex: 1.1,
        renderCell: (p: GridRenderCellParams<DemandExceptionRecord>) => {
          const id = p.row.id;
          const isEditing = editingRootCause === id;
          const displayValue = getRootCause(p.row);
          if (isEditing) {
            return (
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ width: "100%" }}>
                <input
                  type="text"
                  autoFocus
                  value={rootCauseInputs[id] ?? ""}
                  onChange={(e) => setRootCauseInputs((prev) => ({ ...prev, [id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRootCause(id); if (e.key === "Escape") setEditingRootCause(null); }}
                  onBlur={() => commitRootCause(id)}
                  style={{ flex: 1, fontSize: 11, border: "1px solid #3b82f6", borderRadius: 3, padding: "3px 6px", outline: "none", background: "#eff6ff" }}
                />
              </Stack>
            );
          }
          return (
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ width: "100%" }}>
              <Typography noWrap sx={{ fontSize: 11, flex: 1, color: displayValue ? "#1e293b" : "#94a3b8", fontStyle: displayValue ? "normal" : "italic" }}>
                {displayValue || "Click to add…"}
              </Typography>
              <MuiTooltip title="Edit root cause" arrow>
                <IconButton size="small" onClick={() => startEditRootCause(p.row)} sx={{ p: 0.2 }}>
                  <EditOutlinedIcon sx={{ fontSize: 13, color: "#64748b" }} />
                </IconButton>
              </MuiTooltip>
            </Stack>
          );
        },
      },
      {
        field: "actions",
        headerName: "Actions",
        minWidth: 120,
        flex: 0.7,
        sortable: false,
        filterable: false,
        renderCell: (p: GridRenderCellParams<DemandExceptionRecord>) => {
          const st = getStatus(p.row).toLowerCase();
          return (
            <Stack direction="row" spacing={0.25} alignItems="center">
              <MuiTooltip title={st === "open" ? "Acknowledge" : st === "acknowledged" ? "Resolve" : "Re-open"} arrow>
                <IconButton
                  size="small"
                  onClick={() => cycleStatus(p.row.id, getStatus(p.row))}
                  sx={{
                    p: 0.4,
                    color: st === "open" ? "#2563eb" : st === "acknowledged" ? "#16a34a" : "#64748b",
                  }}
                >
                  {st === "resolved"
                    ? <VisibilityOutlinedIcon sx={{ fontSize: 15 }} />
                    : <CheckCircleOutlinedIcon sx={{ fontSize: 15 }} />}
                </IconButton>
              </MuiTooltip>
              <MuiTooltip title="View in Forecast Workbench" arrow>
                <IconButton
                  size="small"
                  onClick={() => navigateToForecast(p.row.sku, p.row.location)}
                  sx={{ p: 0.4, color: "#7c3aed" }}
                >
                  <OpenInNewOutlinedIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </MuiTooltip>
              <MuiTooltip title="View details" arrow>
                <IconButton
                  size="small"
                  onClick={() => setDetailRow(p.row)}
                  sx={{ p: 0.4, color: "#64748b" }}
                >
                  <VisibilityOutlinedIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </MuiTooltip>
            </Stack>
          );
        },
      },
    ],
    [getStatus, getRootCause, editingRootCause, rootCauseInputs, commitRootCause, startEditRootCause, cycleStatus, navigateToForecast],
  );

  const loadingKpiAccuracy = accuracyQuery.isLoading;

  // ── Severity summary for filter bar ──────────────────────────────────
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { all: exceptionRowsAll.length, critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of exceptionRowsAll) {
      const s = String(r.severity || "").toLowerCase();
      if (s in counts) counts[s] += 1;
    }
    return counts;
  }, [exceptionRowsAll]);

  return (
    <div className="page-scroll">
      <SectionCard title="Forecast Accuracy & Exception Management" subtitle="Monitor forecast performance, track deviations, and take corrective actions">
        <Stack spacing={1}>
          <KpiCardRow>
            <KpiCard
              tone="network"
              icon={<PercentOutlinedIcon fontSize="small" />}
              title="Avg MAPE"
              value={loadingKpiAccuracy ? "…" : `${(accuracyQuery.data?.avg_mape ?? 0).toFixed(1)}%`}
              sub="Lower is better"
            />
            <KpiCard
              tone="demand"
              icon={<TrendingFlatOutlinedIcon fontSize="small" />}
              title="Avg Bias"
              value={loadingKpiAccuracy ? "…" : `${(accuracyQuery.data?.avg_bias ?? 0).toFixed(1)}%`}
              sub="Positive = over-forecast"
            />
            <KpiCard
              tone="money"
              icon={<FlagOutlinedIcon fontSize="small" />}
              title="Open Exceptions"
              value={exceptionsQuery.isLoading ? "…" : String(exceptionKpis.open)}
              sub={`${exceptionKpis.acknowledged} acknowledged · ${exceptionKpis.resolved} resolved`}
            />
            <KpiCard
              tone="critical"
              icon={<ErrorOutlineOutlinedIcon fontSize="small" />}
              title="Critical Exceptions"
              value={exceptionsQuery.isLoading ? "…" : String(exceptionKpis.critical)}
              sub={`of ${exceptionKpis.total} total`}
            />
          </KpiCardRow>

          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}>
            <Tab label="Exception Management" />
            <Tab label="Accuracy Metrics" />
          </Tabs>

          {/* ═══════════ TAB 1: Accuracy Metrics ═══════════ */}
          {tab === 1 ? (
            <Stack spacing={1.5}>
              <Box className="content-card" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                  Forecast vs Actual & MAPE trend
                </Typography>
                <div className="chart-shell">
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={weeklyAggregates} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="week_start" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="left" dataKey="avg_forecast_qty" name="Forecast Qty" fill="#2563eb" radius={[3, 3, 0, 0]} barSize={16} />
                      <Bar yAxisId="left" dataKey="avg_actual_qty" name="Actual Qty" fill="#16a34a" radius={[3, 3, 0, 0]} barSize={16} />
                      <Line yAxisId="right" type="monotone" dataKey="avg_mape" name="Avg MAPE %" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Box>

              <SectionCard title="Time-phased accuracy summary" subtitle="Weekly aggregated accuracy metrics">
                <div className="maintenance-grid-shell" style={{ height: 280 }}>
                  <SmartDataGrid
                    rows={transposedRows}
                    columns={transposedColumns}
                    loading={accuracyQuery.isLoading}
                    disableRowSelectionOnClick
                    getRowId={(row) => String(row.id)}
                    hideFooter
                    sx={{ border: 0, ...compactSx }}
                  />
                </div>
              </SectionCard>

              <SectionCard title="SKU / location accuracy" subtitle={`${accuracyQuery.data?.total ?? accuracyRows.length} rows${accuracyQuery.data?.avg_wmape != null ? ` · Avg WMAPE ${accuracyQuery.data.avg_wmape.toFixed(1)}%` : ""}`}>
                <div className="maintenance-grid-shell" style={{ height: 480 }}>
                  <SmartDataGrid
                    rows={accuracyRows}
                    columns={accuracyColumns}
                    loading={accuracyQuery.isLoading}
                    disableRowSelectionOnClick
                    getRowId={(row) => row.id}
                    pageSizeOptions={[10, 25, 50, 100]}
                    initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                    sx={{ border: 0, ...compactSx }}
                    slotProps={{ toolbar: { exportFileName: "demand-forecast-accuracy" } }}
                  />
                </div>
              </SectionCard>
            </Stack>
          ) : null}

          {/* ═══════════ TAB 0: Exception Management ═══════════ */}
          {tab === 0 ? (
            <Stack spacing={1.5}>
              {/* ── Row 1: Weekly trend + Type distribution ── */}
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                {/* Primary chart: Exception volume, severity, and deviation over time */}
                <Box className="content-card" sx={{ p: 1.5, flex: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                    Weekly exception volume & deviation severity
                  </Typography>
                  <div className="chart-shell">
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={exceptionWeekly} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="devGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#dc2626" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#dc2626" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="week_start" tick={{ fontSize: 9 }} tickFormatter={(v: string) => v.slice(5)} />
                        <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={{ value: "Count", angle: -90, position: "insideLeft", style: { fontSize: 9, fill: "#94a3b8" } }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit="%" label={{ value: "Avg Dev %", angle: 90, position: "insideRight", style: { fontSize: 9, fill: "#94a3b8" } }} />
                        <Tooltip contentStyle={{ fontSize: 11 }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Area yAxisId="right" type="monotone" dataKey="avgDev" name="Avg Deviation %" fill="url(#devGradient)" stroke="#dc2626" strokeWidth={2} dot={false} />
                        <Bar yAxisId="left" dataKey="critHigh" name="Critical + High" fill="#e11d48" radius={[3, 3, 0, 0]} barSize={12} />
                        <Bar yAxisId="left" dataKey="total" name="Total Exceptions" fill="#3b82f6" radius={[3, 3, 0, 0]} barSize={12} opacity={0.5} />
                        <Line yAxisId="right" type="monotone" dataKey="resolutionRate" name="Resolution Rate %" stroke="#16a34a" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3, fill: "#16a34a" }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, mt: 0.5, display: "block" }}>
                    Bars = exception count (solid = critical+high, translucent = all); red area = avg deviation %; dashed green = resolution rate
                  </Typography>
                </Box>

                {/* Side panel: Exception type distribution + severity donut */}
                <Stack spacing={1.5} sx={{ flex: 1, minWidth: 260 }}>
                  {/* Severity donut */}
                  <Box className="content-card" sx={{ p: 1.5 }}>
                    <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                      Severity breakdown
                    </Typography>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <ResponsiveContainer width={100} height={100}>
                        <PieChart>
                          <Pie
                            data={[
                              { name: "Critical", value: severityCounts.critical ?? 0 },
                              { name: "High", value: severityCounts.high ?? 0 },
                              { name: "Medium", value: severityCounts.medium ?? 0 },
                              { name: "Low", value: severityCounts.low ?? 0 },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={28}
                            outerRadius={45}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            <Cell fill="#dc2626" />
                            <Cell fill="#f59e0b" />
                            <Cell fill="#3b82f6" />
                            <Cell fill="#94a3b8" />
                          </Pie>
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <Stack spacing={0.5}>
                        {([
                          { label: "Critical", count: severityCounts.critical ?? 0, color: "#dc2626" },
                          { label: "High", count: severityCounts.high ?? 0, color: "#f59e0b" },
                          { label: "Medium", count: severityCounts.medium ?? 0, color: "#3b82f6" },
                          { label: "Low", count: severityCounts.low ?? 0, color: "#94a3b8" },
                        ]).map((s) => (
                          <Stack key={s.label} direction="row" alignItems="center" spacing={0.5}>
                            <Box sx={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: s.color, flexShrink: 0 }} />
                            <Typography sx={{ fontSize: 11, color: "#64748b" }}>{s.label}</Typography>
                            <Typography sx={{ fontSize: 11, fontWeight: 700 }}>{s.count}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Stack>
                  </Box>

                  {/* Exception type distribution */}
                  <Box className="content-card" sx={{ p: 1.5, flex: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mb: 0.75 }}>
                      By exception type
                    </Typography>
                    <Stack spacing={0.5}>
                      {typeDistribution.slice(0, 6).map((t) => {
                        const maxCount = typeDistribution[0]?.count ?? 1;
                        const pct = (t.count / maxCount) * 100;
                        return (
                          <Stack key={t.type} spacing={0.15}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Typography sx={{ fontSize: 10.5, color: "#475569", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>
                                {t.type.replace(/_/g, " ")}
                              </Typography>
                              <Typography sx={{ fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap" }}>
                                {t.count} · {t.avgDev}%
                              </Typography>
                            </Stack>
                            <Box sx={{ height: 4, borderRadius: 2, backgroundColor: "#f1f5f9", overflow: "hidden" }}>
                              <Box sx={{ height: "100%", width: `${pct}%`, borderRadius: 2, backgroundColor: pct > 75 ? "#dc2626" : pct > 40 ? "#f59e0b" : "#3b82f6", transition: "width 0.3s" }} />
                            </Box>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Box>
                </Stack>
              </Stack>

              {/* ── Row 2: Deviation scatter plot ── */}
              <Box className="content-card" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                  Deviation distribution by week
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mb: 0.5 }}>
                  Each dot is an exception. Higher = larger deviation. Color = severity. Spot outliers and clustering patterns.
                </Typography>
                <div className="chart-shell">
                  <ResponsiveContainer width="100%" height={180}>
                    <ScatterChart margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="week" tick={{ fontSize: 9 }} tickFormatter={(v: string) => v.slice(5)} />
                      <YAxis dataKey="deviation" tick={{ fontSize: 10 }} unit="%" name="Deviation %" />
                      <ZAxis range={[30, 30]} />
                      <Tooltip
                        contentStyle={{ fontSize: 11 }}
                        formatter={(value: number, name: string) => name === "deviation" ? [`${value.toFixed(1)}%`, "Deviation"] : [value, name]}
                        labelFormatter={(label) => `Week: ${label}`}
                      />
                      <Scatter data={exceptionScatter.filter((d) => d.severity === "critical")} name="Critical" fill="#dc2626" />
                      <Scatter data={exceptionScatter.filter((d) => d.severity === "high")} name="High" fill="#f59e0b" />
                      <Scatter data={exceptionScatter.filter((d) => d.severity === "medium")} name="Medium" fill="#3b82f6" />
                      <Scatter data={exceptionScatter.filter((d) => d.severity === "low")} name="Low" fill="#94a3b8" opacity={0.6} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Box>

              {/* Severity filter bar + action toolbar */}
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, mr: 0.25, fontWeight: 600 }}>
                    Severity
                  </Typography>
                  {SEVERITY_FILTER_KEYS.map((key) => (
                    <Chip
                      key={key}
                      size="small"
                      label={`${key === "all" ? "All" : key.charAt(0).toUpperCase() + key.slice(1)} (${severityCounts[key] ?? 0})`}
                      onClick={() => setSeverityFilter(key)}
                      sx={{
                        height: 26,
                        fontSize: 11,
                        fontWeight: severityFilter === key ? 700 : 400,
                        borderWidth: severityFilter === key ? 2 : 1,
                        borderColor: key === "all" ? "#64748b" : SEVERITY_COLORS[key],
                        color: severityFilter === key ? "#fff" : (key === "all" ? "#64748b" : SEVERITY_COLORS[key]),
                        backgroundColor: severityFilter === key ? (key === "all" ? "#64748b" : SEVERITY_COLORS[key]) : "transparent",
                        "&:hover": { backgroundColor: alpha(key === "all" ? "#64748b" : SEVERITY_COLORS[key], 0.15) },
                      }}
                      variant={severityFilter === key ? "filled" : "outlined"}
                    />
                  ))}
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                  {dirty && <Chip size="small" label="Unsaved changes" color="warning" variant="outlined" sx={{ fontSize: 10, height: 22 }} />}
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<SaveOutlinedIcon sx={{ fontSize: 14 }} />}
                    disabled={!dirty}
                    onClick={handleSaveAll}
                    sx={{ textTransform: "none", fontSize: 11, height: 28, px: 1.5 }}
                  >
                    Save All Changes
                  </Button>
                </Stack>
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Showing {filteredExceptionRows.length} of {exceptionRowsAll.length} exceptions · Click ✓ to cycle status (open → acknowledged → resolved) · Click ✏️ to edit root cause · Click ↗ to open forecast workbench
              </Typography>

              <div className="maintenance-grid-shell" style={{ height: 520 }}>
                <SmartDataGrid
                  rows={filteredExceptionRows}
                  columns={exceptionColumns}
                  loading={exceptionsQuery.isLoading}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50, 100]}
                  initialState={{
                    pagination: { paginationModel: { pageSize: 25, page: 0 } },
                    sorting: { sortModel: [{ field: "deviation_pct", sort: "desc" }] },
                  }}
                  sx={{
                    border: 0,
                    ...compactSx,
                    "& .MuiDataGrid-row:hover": { backgroundColor: alpha("#3b82f6", 0.04) },
                  }}
                  slotProps={{ toolbar: { exportFileName: "demand-exceptions" } }}
                />
              </div>
            </Stack>
          ) : null}
        </Stack>
      </SectionCard>

      {/* ── Exception detail dialog ── */}
      <Dialog
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 2.5 } } }}
      >
        {detailRow && (
          <>
            <DialogTitle sx={{ fontSize: 14, fontWeight: 700, pb: 0.5 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <span>Exception {detailRow.exception_id}</span>
                <SeverityChip severity={detailRow.severity} />
                <StatusChip status={getStatus(detailRow)} />
              </Stack>
            </DialogTitle>
            <DialogContent>
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                <Stack direction="row" spacing={3}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>SKU</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{detailRow.sku}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Location</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{detailRow.location}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Week</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{detailRow.week_start}</Typography>
                  </Box>
                </Stack>

                <Stack direction="row" spacing={3}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Type</Typography>
                    <Box sx={{ mt: 0.25 }}><ExceptionTypeChip type={detailRow.exception_type} /></Box>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Deviation</Typography>
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>{detailRow.deviation_pct.toFixed(1)}%</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Forecast / Actual</Typography>
                    <Typography sx={{ fontSize: 13 }}>
                      {Number(detailRow.forecast_qty).toLocaleString()} / {Number(detailRow.actual_qty).toLocaleString()}
                    </Typography>
                  </Box>
                </Stack>

                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Assigned To</Typography>
                  <Typography sx={{ fontSize: 13 }}>{detailRow.assigned_to || "—"}</Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, mb: 0.5, display: "block" }}>Root Cause</Typography>
                  <TextField
                    fullWidth
                    size="small"
                    multiline
                    minRows={2}
                    value={rootCauseInputs[detailRow.id] ?? getRootCause(detailRow)}
                    onChange={(e) => setRootCauseInputs((prev) => ({ ...prev, [detailRow.id]: e.target.value }))}
                    onBlur={() => {
                      const val = rootCauseInputs[detailRow.id];
                      if (val !== undefined) {
                        setRootCauseOverrides((prev) => ({ ...prev, [detailRow.id]: val }));
                        setDirty(true);
                      }
                    }}
                    placeholder="Enter root cause analysis…"
                    sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
                  />
                </Box>

                {detailRow.resolution && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Resolution</Typography>
                    <Typography sx={{ fontSize: 12 }}>{detailRow.resolution}</Typography>
                  </Box>
                )}

                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => {
                      cycleStatus(detailRow.id, getStatus(detailRow));
                    }}
                    sx={{ textTransform: "none", fontSize: 11 }}
                  >
                    {getStatus(detailRow).toLowerCase() === "open" ? "Acknowledge" : getStatus(detailRow).toLowerCase() === "acknowledged" ? "Mark Resolved" : "Re-open"}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<OpenInNewOutlinedIcon sx={{ fontSize: 14 }} />}
                    onClick={() => {
                      setDetailRow(null);
                      navigateToForecast(detailRow.sku, detailRow.location);
                    }}
                    sx={{ textTransform: "none", fontSize: 11 }}
                  >
                    Open Forecast Workbench
                  </Button>
                </Stack>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button size="small" onClick={() => setDetailRow(null)} sx={{ textTransform: "none", fontSize: 11 }}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Snackbar
        open={snackOpen}
        autoHideDuration={3000}
        onClose={() => setSnackOpen(false)}
        message={snackMsg}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </div>
  );
}
