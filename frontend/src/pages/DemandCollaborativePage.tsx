import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
import FunctionsOutlinedIcon from "@mui/icons-material/FunctionsOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { type GridColDef } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ShellContextValue } from "../components/layout/AppShellLayout";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { fetchDemandConsensus } from "../services/api";
import type { DemandConsensusResponse } from "../types";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";

function buildConsensusParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), filters);
}

function statusChipColor(status: string): "success" | "warning" | "default" {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "success";
  if (s === "pending") return "warning";
  return "default";
}

function StatusChip({ status }: { status: string }) {
  return <Chip size="small" label={status || "—"} color={statusChipColor(status)} sx={{ height: 22, fontSize: 11 }} />;
}

function weekField(weekIdx: number) {
  return `wk_${weekIdx}`;
}

type TransposedRow = {
  id: string;
  metric: string;
  [key: string]: string | number;
};

export default function DemandCollaborativePage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const filtersKey = globalFiltersKey(filters);
  const params = useMemo(() => buildConsensusParams(filters), [filtersKey]);

  const { data, isLoading } = useQuery<DemandConsensusResponse>({
    queryKey: ["demand-consensus", filtersKey],
    queryFn: () => fetchDemandConsensus(params),
  });

  const rows = data?.rows ?? [];
  const [tab, setTab] = useState(0);
  const [selectedSku, setSelectedSku] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");

  // ── Editable reconciliation state ─────────────────────────────────
  // Key format: "sku||location||week||field"  (field = customer_input | supply_chain_input | marketing_input)
  type EditableField = "customer_input" | "supply_chain_input" | "marketing_input";
  const EDITABLE_FIELDS: EditableField[] = ["customer_input", "supply_chain_input", "marketing_input"];
  const [editMap, setEditMap] = useState<Record<string, number>>({});
  const [lockSet, setLockSet] = useState<Set<string>>(new Set());
  const [inputStr, setInputStr] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [snackOpen, setSnackOpen] = useState(false);
  const [snackMsg, setSnackMsg] = useState("");

  const skuOptions = useMemo(() => [...new Set(rows.map((r) => r.sku))].sort(), [rows]);
  const locationOptions = useMemo(() => {
    const filtered = selectedSku ? rows.filter((r) => r.sku === selectedSku) : rows;
    return [...new Set(filtered.map((r) => r.location))].sort();
  }, [rows, selectedSku]);

  const resolvedSku = selectedSku || skuOptions[0] || "";
  const resolvedLocation = selectedLocation;

  const filteredRows = useMemo(
    () => rows.filter((r) => {
      if (resolvedSku && r.sku !== resolvedSku) return false;
      if (resolvedLocation && r.location !== resolvedLocation) return false;
      return true;
    }),
    [rows, resolvedSku, resolvedLocation],
  );

  // Proportional weights for disaggregation keyed by "sku||location||week"
  const cellWeights = useMemo(() => {
    const weekTotals = new Map<string, number>();
    const entries: { key: string; weekKey: string; qty: number }[] = [];
    for (const r of rows) {
      const q = Math.max(Number(r.consensus_qty) || 0, 1);
      const wk = `${r.sku}||${r.week_start}`;
      weekTotals.set(wk, (weekTotals.get(wk) ?? 0) + q);
      entries.push({ key: `${r.sku}||${r.location}||${r.week_start}`, weekKey: wk, qty: q });
    }
    const weights = new Map<string, number>();
    for (const e of entries) weights.set(e.key, e.qty / (weekTotals.get(e.weekKey) || 1));
    return weights;
  }, [rows]);

  // Helper: get the effective value for an editable field (edited or original)
  const getEffective = useCallback((sku: string, location: string, week: string, field: EditableField, original: number): number => {
    const k = `${sku}||${location}||${week}||${field}`;
    return k in editMap ? editMap[k] : original;
  }, [editMap]);

  // Aggregate filtered rows by week, applying edits
  const sortedWeeks = useMemo(() => {
    const weekMap = new Map<string, {
      weekStart: string;
      sales: number; customer: number; supplyChain: number; marketing: number;
      consensus: number; count: number;
    }>();
    for (const r of filteredRows) {
      const cur = weekMap.get(r.week_start) ?? { weekStart: r.week_start, sales: 0, customer: 0, supplyChain: 0, marketing: 0, consensus: 0, count: 0 };
      cur.sales += r.sales_input;
      cur.customer += getEffective(r.sku, r.location, r.week_start, "customer_input", r.customer_input);
      cur.supplyChain += getEffective(r.sku, r.location, r.week_start, "supply_chain_input", r.supply_chain_input);
      cur.marketing += getEffective(r.sku, r.location, r.week_start, "marketing_input", r.marketing_input);
      cur.consensus += r.consensus_qty;
      cur.count += 1;
      weekMap.set(r.week_start, cur);
    }
    return [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => {
        const newConsensus = (v.sales + v.customer + v.supplyChain + v.marketing) / 4;
        const variancePct = newConsensus > 0 ? ((Math.max(v.sales, v.customer, v.supplyChain, v.marketing) - Math.min(v.sales, v.customer, v.supplyChain, v.marketing)) / newConsensus) * 100 : 0;
        return { ...v, newConsensus, variancePct };
      });
  }, [filteredRows, getEffective]);

  const kpis = useMemo(() => {
    const total = data?.total ?? rows.length;
    let approved = 0;
    let draft = 0;
    let sumAbsVar = 0;
    for (const r of rows) {
      const st = String(r.status || "").toLowerCase();
      if (st === "approved") approved += 1;
      if (st === "draft") draft += 1;
      sumAbsVar += Math.abs(Number(r.variance_pct) || 0);
    }
    const avgVar = rows.length ? sumAbsVar / rows.length : 0;
    return { total, approved, draft, avgVar };
  }, [data?.total, rows]);

  // ── Edit / lock handlers ────────────────────────────────────────────
  const handleInputTyping = useCallback((cellKey: string, value: string) => {
    setInputStr((prev) => ({ ...prev, [cellKey]: value }));
  }, []);

  const commitEdit = useCallback((week: string, field: EditableField) => {
    const uiKey = `${week}||${field}`;
    const raw = inputStr[uiKey] ?? "";
    const num = raw === "" || raw === "-" ? 0 : Number(raw);
    if (Number.isNaN(num)) return;

    setEditMap((prev) => {
      const next = { ...prev };
      if (resolvedSku && resolvedLocation) {
        const k = `${resolvedSku}||${resolvedLocation}||${week}||${field}`;
        if (lockSet.has(k)) return prev;
        next[k] = num;
      } else {
        // Disaggregate across matching rows
        const matching = rows.filter((r) => {
          if (resolvedSku && r.sku !== resolvedSku) return false;
          if (resolvedLocation && r.location !== resolvedLocation) return false;
          return r.week_start === week;
        });
        const totalW = matching.reduce((s, r) => {
          const wk = `${r.sku}||${r.location}||${r.week_start}`;
          return s + (cellWeights.get(wk) ?? 0);
        }, 0);
        for (const r of matching) {
          const k = `${r.sku}||${r.location}||${week}||${field}`;
          if (lockSet.has(k)) continue;
          const wk = `${r.sku}||${r.location}||${r.week_start}`;
          const w = (cellWeights.get(wk) ?? 0) / (totalW || 1);
          next[k] = Math.round(num * w * 100) / 100;
        }
      }
      return next;
    });
    setDirty(true);
  }, [inputStr, resolvedSku, resolvedLocation, rows, lockSet, cellWeights]);

  const toggleCellLock = useCallback((week: string, field: EditableField) => {
    if (resolvedSku && resolvedLocation) {
      const k = `${resolvedSku}||${resolvedLocation}||${week}||${field}`;
      setLockSet((prev) => {
        const next = new Set(prev);
        next.has(k) ? next.delete(k) : next.add(k);
        return next;
      });
    } else {
      const matching = rows.filter((r) => {
        if (resolvedSku && r.sku !== resolvedSku) return false;
        if (resolvedLocation && r.location !== resolvedLocation) return false;
        return r.week_start === week;
      });
      setLockSet((prev) => {
        const next = new Set(prev);
        const anyLocked = matching.some((r) => next.has(`${r.sku}||${r.location}||${week}||${field}`));
        for (const r of matching) {
          const k = `${r.sku}||${r.location}||${week}||${field}`;
          anyLocked ? next.delete(k) : next.add(k);
        }
        return next;
      });
    }
  }, [resolvedSku, resolvedLocation, rows]);

  const isCellLocked = useCallback((week: string, field: EditableField): boolean => {
    if (resolvedSku && resolvedLocation) {
      return lockSet.has(`${resolvedSku}||${resolvedLocation}||${week}||${field}`);
    }
    const matching = filteredRows.filter((r) => r.week_start === week);
    return matching.length > 0 && matching.every((r) => lockSet.has(`${r.sku}||${r.location}||${week}||${field}`));
  }, [resolvedSku, resolvedLocation, filteredRows, lockSet]);

  const handleSave = useCallback(() => {
    setDirty(false);
    const editCount = Object.keys(editMap).filter((k) => editMap[k] !== 0).length;
    setSnackMsg(`Saved ${editCount} edits across ${new Set(Object.keys(editMap).map((k) => k.split("||").slice(0, 3).join("||"))).size} cells`);
    setSnackOpen(true);
  }, [editMap]);

  // ---- Chart data for the time-phased ComposedChart ----
  const chartData = useMemo(
    () =>
      sortedWeeks.map((w, idx) => ({
        week: `Wk ${idx + 1} (${w.weekStart.slice(5)})`,
        sales: w.sales,
        customer: w.customer,
        supplyChain: w.supplyChain,
        marketing: w.marketing,
        consensus: w.newConsensus,
        variance: w.variancePct,
      })),
    [sortedWeeks],
  );

  const chartYDomain = useMemo((): [number, number] | ["auto", "auto"] => {
    if (!chartData.length) return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const d of chartData) {
      const stackTotal = d.sales + d.customer + d.supplyChain + d.marketing;
      min = Math.min(min, d.consensus, stackTotal);
      max = Math.max(max, d.consensus, stackTotal);
    }
    if (!Number.isFinite(min)) return ["auto", "auto"];
    const pad = (max - min) * 0.08;
    return [Math.max(0, min - pad), max + pad];
  }, [chartData]);

  // Editable metric rows configuration for the workbench table
  const editableMetrics: { label: string; field: EditableField; color: string }[] = [
    { label: "Customer Input", field: "customer_input", color: "#16a34a" },
    { label: "Supply Chain Input", field: "supply_chain_input", color: "#f59e0b" },
    { label: "Marketing Input", field: "marketing_input", color: "#883DCF" },
  ];

  // ---- Reconciliation: high-variance items across all SKU-location combos ----
  const highVarianceRows = useMemo(
    () => rows.filter((r) => Math.abs(Number(r.variance_pct) || 0) > 10),
    [rows],
  );

  const filteredHighVarianceRows = useMemo(() => {
    let result = highVarianceRows;
    if (selectedSku) result = result.filter((r) => r.sku === selectedSku);
    if (selectedLocation) result = result.filter((r) => r.location === selectedLocation);
    return result;
  }, [highVarianceRows, selectedSku, selectedLocation]);

  const reconWeekAgg = useMemo(() => {
    const map = new Map<
      string,
      { weekStart: string; sales: number; customer: number; supplyChain: number; marketing: number; consensus: number; varianceSum: number; count: number; hasDraft: boolean; hasPending: boolean }
    >();
    for (const r of filteredHighVarianceRows) {
      const key = r.week_start;
      const cur = map.get(key) ?? { weekStart: key, sales: 0, customer: 0, supplyChain: 0, marketing: 0, consensus: 0, varianceSum: 0, count: 0, hasDraft: false, hasPending: false };
      cur.sales += r.sales_input;
      cur.customer += r.customer_input;
      cur.supplyChain += r.supply_chain_input;
      cur.marketing += r.marketing_input;
      cur.consensus += r.consensus_qty;
      cur.varianceSum += r.variance_pct;
      cur.count += 1;
      const st = String(r.status || "").toLowerCase();
      if (st === "draft") cur.hasDraft = true;
      if (st === "pending") cur.hasPending = true;
      map.set(key, cur);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v], idx) => ({
        weekLabel: `Wk ${idx + 1} (${v.weekStart.slice(5)})`,
        weekStart: v.weekStart,
        sales: v.sales,
        customer: v.customer,
        supplyChain: v.supplyChain,
        marketing: v.marketing,
        consensus: v.consensus,
        variance: v.count ? v.varianceSum / v.count : 0,
        gap: Math.max(v.sales, v.customer, v.supplyChain, v.marketing) - v.consensus,
        status: v.hasDraft ? "Draft" : v.hasPending ? "Pending" : "Approved",
      }));
  }, [filteredHighVarianceRows]);

  const reconChartData = useMemo(
    () =>
      reconWeekAgg.map((w) => ({
        week: w.weekLabel,
        sales: w.sales,
        customer: w.customer,
        supplyChain: w.supplyChain,
        marketing: w.marketing,
        consensus: w.consensus,
        variance: w.variance,
      })),
    [reconWeekAgg],
  );

  const reconChartYDomain = useMemo((): [number, number] | ["auto", "auto"] => {
    if (!reconChartData.length) return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const d of reconChartData) {
      const stackTotal = d.sales + d.customer + d.supplyChain + d.marketing;
      min = Math.min(min, d.consensus, stackTotal);
      max = Math.max(max, d.consensus, stackTotal);
    }
    if (!Number.isFinite(min)) return ["auto", "auto"];
    const pad = (max - min) * 0.08;
    return [Math.max(0, min - pad), max + pad];
  }, [reconChartData]);

  const reconTransposedRows = useMemo<TransposedRow[]>(() => {
    const result: TransposedRow[] = [
      { id: "r_sales_input", metric: "Sales Input" },
      { id: "r_customer_input", metric: "Customer Input" },
      { id: "r_supply_chain_input", metric: "Supply Chain Input" },
      { id: "r_marketing_input", metric: "Marketing Input" },
      { id: "r_consensus_qty", metric: "Consensus Qty" },
      { id: "r_gap", metric: "Gap" },
      { id: "r_variance_pct", metric: "Variance %" },
      { id: "r_status", metric: "Status" },
    ];
    for (let i = 0; i < reconWeekAgg.length; i++) {
      const w = reconWeekAgg[i];
      const f = weekField(i + 1);
      result[0][f] = w.sales;
      result[1][f] = w.customer;
      result[2][f] = w.supplyChain;
      result[3][f] = w.marketing;
      result[4][f] = w.consensus;
      result[5][f] = w.gap;
      result[6][f] = w.variance;
      result[7][f] = w.status;
    }
    return result;
  }, [reconWeekAgg]);

  const reconTransposedColumns = useMemo<GridColDef<TransposedRow>[]>(() => {
    const base: GridColDef<TransposedRow>[] = [
      { field: "metric", headerName: "Metric", minWidth: 180, flex: 1.1, sortable: false },
    ];
    for (let i = 0; i < reconWeekAgg.length; i++) {
      const w = reconWeekAgg[i];
      const f = weekField(i + 1);
      base.push({
        field: f,
        headerName: w.weekLabel,
        minWidth: 130,
        flex: 0.85,
        sortable: false,
        type: "string",
        renderCell: (params) => {
          const rowId = params.row.id;
          const value = params.value;

          if (rowId === "r_status") {
            return <StatusChip status={String(value ?? "")} />;
          }

          if (rowId === "r_variance_pct") {
            const v = Number(value ?? 0);
            const isHigh = Math.abs(v) > 10;
            return (
              <Box
                sx={(theme) => ({
                  width: "100%",
                  px: 0.6,
                  py: 0.2,
                  borderRadius: 0.8,
                  fontWeight: isHigh ? 700 : 400,
                  backgroundColor: isHigh
                    ? alpha(theme.palette.warning.main, theme.palette.mode === "dark" ? 0.42 : 0.22)
                    : "transparent",
                })}
              >
                {v.toFixed(1)}%
              </Box>
            );
          }

          if (rowId === "r_consensus_qty") {
            return (
              <Typography sx={{ fontWeight: 700, fontSize: "inherit" }}>
                {Number(value ?? 0).toFixed(1)}
              </Typography>
            );
          }

          if (rowId === "r_gap") {
            const v = Number(value ?? 0);
            return (
              <Typography sx={{ fontWeight: 600, fontSize: "inherit", color: v > 0 ? "error.main" : "inherit" }}>
                {v.toFixed(1)}
              </Typography>
            );
          }

          return <>{typeof value === "number" ? value.toFixed(1) : value}</>;
        },
      });
    }
    return base;
  }, [reconWeekAgg]);

  return (
    <div className="page-scroll">
      <SectionCard
        title="Collaborative Demand Planning"
        subtitle="Cross-functional demand input from sales, customer, and supply chain teams"
      >
        <Stack spacing={1}>
          <KpiCardRow>
            <KpiCard
              tone="network"
              icon={<AssessmentOutlinedIcon fontSize="small" />}
              title="Total Consensus Items"
              value={isLoading ? "…" : String(kpis.total)}
            />
            <KpiCard
              tone="demand"
              icon={<CheckCircleOutlineOutlinedIcon fontSize="small" />}
              title="Approved"
              value={isLoading ? "…" : String(kpis.approved)}
            />
            <KpiCard
              tone="critical"
              icon={<EditNoteOutlinedIcon fontSize="small" />}
              title="Draft"
              value={isLoading ? "…" : String(kpis.draft)}
            />
            <KpiCard
              tone="money"
              icon={<FunctionsOutlinedIcon fontSize="small" />}
              title="Avg Variance %"
              value={isLoading ? "…" : `${kpis.avgVar.toFixed(1)}%`}
              sub="Mean absolute variance across loaded rows"
            />
          </KpiCardRow>

          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}>
            <Tab label="Consensus Workbench" />
            <Tab label="Cross-functional Inputs" />
            <Tab label="Reconciliation" />
          </Tabs>

          {/* =========== TAB 0: Time-phased workbench =========== */}
          {tab === 0 ? (
            <Stack spacing={1}>
              <SectionCard title="Consensus workbench" subtitle="Select SKU + Location to view and edit cross-functional inputs. Edits at SKU level disaggregate to all locations.">
                <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                    <TextField
                      select
                      size="small"
                      label="Product (SKU)"
                      value={resolvedSku}
                      onChange={(e) => {
                        setSelectedSku(e.target.value);
                        setSelectedLocation("");
                      }}
                      sx={{ minWidth: 200 }}
                    >
                      {skuOptions.map((sku) => (
                        <MenuItem key={sku} value={sku}>{sku}</MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label="Location"
                      value={resolvedLocation || "__all__"}
                      onChange={(e) => setSelectedLocation(e.target.value === "__all__" ? "" : e.target.value)}
                      sx={{ minWidth: 180 }}
                    >
                      <MenuItem value="__all__">All Locations</MenuItem>
                      {locationOptions.map((loc) => (
                        <MenuItem key={loc} value={loc}>{loc}</MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                  <Stack direction="row" spacing={0.7} alignItems="center" sx={{ flexWrap: "wrap" }}>
                    {dirty && <Chip size="small" label="Unsaved changes" color="warning" variant="outlined" sx={{ fontSize: 10, height: 22 }} />}
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<SaveOutlinedIcon sx={{ fontSize: 14 }} />}
                      disabled={!dirty}
                      onClick={handleSave}
                      sx={{ textTransform: "none", fontSize: 11, height: 28, px: 1.5 }}
                    >
                      Save
                    </Button>
                    <Chip label={`Weeks: ${sortedWeeks.length}`} size="small" />
                    <Chip
                      size="small"
                      label={`Consensus Total: ${Math.round(sortedWeeks.reduce((s, w) => s + w.newConsensus, 0)).toLocaleString()}`}
                    />
                  </Stack>
                </Stack>

                {/* ---- Weekly Consensus Chart (reflects edits) ---- */}
                <Box className="content-card" sx={{ p: 1.5, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Weekly Consensus Chart
                  </Typography>
                  <div className="chart-shell">
                    <ResponsiveContainer width="100%" height={300}>
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="week" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis yAxisId="left" domain={chartYDomain} tick={{ fontSize: 11 }} tickFormatter={(v: number) => Math.round(v).toLocaleString()} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                        <RechartsTooltip formatter={(value: number, name: string) => name === "Variance %" ? `${value.toFixed(1)}%` : Math.round(value).toLocaleString()} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="left" dataKey="sales" name="Sales Input" stackId="inputs" fill="#2563eb" barSize={20} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="customer" name="Customer Input" stackId="inputs" fill="#16a34a" barSize={20} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="supplyChain" name="Supply Chain Input" stackId="inputs" fill="#f59e0b" barSize={20} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="marketing" name="Marketing Input" stackId="inputs" fill="#883DCF" barSize={20} isAnimationActive={false} />
                        <Line yAxisId="left" type="monotone" dataKey="consensus" name="Consensus Qty" stroke="#e11d48" strokeWidth={3} dot={{ r: 4, fill: "#e11d48", stroke: "#fff", strokeWidth: 1 }} isAnimationActive={false} />
                        <Line yAxisId="right" type="monotone" dataKey="variance" name="Variance %" stroke="#dc2626" strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                    Stacked bars show input by function; solid line is consensus qty (recalculated from edits); dashed line is variance %.
                  </Typography>
                </Box>

                {/* ---- Time-phased editable grid ---- */}
                <Box sx={{ overflowX: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={{ position: "sticky", left: 0, background: "#f8fafc", padding: "6px 12px", textAlign: "left", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap", minWidth: 180, fontWeight: 600, zIndex: 2 }}>
                          Metric
                        </th>
                        {sortedWeeks.map((w, idx) => (
                          <th key={w.weekStart} style={{ padding: "6px 10px", textAlign: "right", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap", fontSize: 10, fontWeight: 500, minWidth: 100 }}>
                            Wk {idx + 1} ({w.weekStart.slice(5)})
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Sales Input — read-only */}
                      <tr>
                        <td style={{ position: "sticky", left: 0, background: "#fff", padding: "5px 12px", fontWeight: 500, borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap", color: "#2563eb", zIndex: 1 }}>
                          Sales Input
                        </td>
                        {sortedWeeks.map((w) => (
                          <td key={w.weekStart} style={{ padding: "5px 10px", textAlign: "right", borderBottom: "1px solid #f1f5f9", fontVariantNumeric: "tabular-nums" }}>
                            {Math.round(w.sales).toLocaleString()}
                          </td>
                        ))}
                      </tr>

                      {/* Editable rows: Customer, Supply Chain, Marketing */}
                      {editableMetrics.map((metric) => (
                        <tr key={metric.field}>
                          <td style={{ position: "sticky", left: 0, background: "#fffbeb", padding: "4px 12px", fontWeight: 600, borderBottom: "1px solid #fbbf24", whiteSpace: "nowrap", color: metric.color, zIndex: 1 }}>
                            ✏️ {metric.label}
                          </td>
                          {sortedWeeks.map((w) => {
                            const uiKey = `${w.weekStart}||${metric.field}`;
                            const locked = isCellLocked(w.weekStart, metric.field);
                            const displayVal = inputStr[uiKey] ?? (Math.round(w[
                              metric.field === "customer_input" ? "customer" :
                              metric.field === "supply_chain_input" ? "supplyChain" : "marketing"
                            ]).toString());
                            return (
                              <td key={w.weekStart} style={{ padding: "2px 3px", textAlign: "right", borderBottom: "1px solid #fbbf24", background: locked ? "#f1f5f9" : "#fffbeb" }}>
                                <Stack direction="row" spacing={0} alignItems="center" justifyContent="flex-end">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    disabled={locked}
                                    value={displayVal}
                                    placeholder="0"
                                    onChange={(e) => handleInputTyping(uiKey, e.target.value)}
                                    onBlur={() => commitEdit(w.weekStart, metric.field)}
                                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                    style={{
                                      width: 52, textAlign: "right", fontSize: 11,
                                      border: locked ? "1px solid #e2e8f0" : `1px solid ${metric.color}40`,
                                      borderRadius: 3, padding: "3px 4px",
                                      background: locked ? "#f1f5f9" : "#fff",
                                      color: locked ? "#94a3b8" : "#1e293b",
                                      fontVariantNumeric: "tabular-nums", outline: "none",
                                    }}
                                  />
                                  <MuiTooltip title={locked ? "Unlock" : "Lock value"} arrow>
                                    <IconButton
                                      size="small"
                                      onClick={() => toggleCellLock(w.weekStart, metric.field)}
                                      sx={{ p: 0.15, ml: 0.15, color: locked ? metric.color : "#cbd5e1" }}
                                    >
                                      {locked
                                        ? <LockOutlinedIcon sx={{ fontSize: 12 }} />
                                        : <LockOpenOutlinedIcon sx={{ fontSize: 12 }} />}
                                    </IconButton>
                                  </MuiTooltip>
                                </Stack>
                              </td>
                            );
                          })}
                        </tr>
                      ))}

                      {/* Consensus Qty — recalculated */}
                      <tr>
                        <td style={{ position: "sticky", left: 0, background: "rgba(225,29,72,0.06)", padding: "5px 12px", fontWeight: 700, borderBottom: "2px solid #e11d48", whiteSpace: "nowrap", color: "#e11d48", zIndex: 1 }}>
                          Consensus Qty
                        </td>
                        {sortedWeeks.map((w) => (
                          <td key={w.weekStart} style={{ padding: "5px 10px", textAlign: "right", borderBottom: "2px solid #e11d48", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#e11d48", background: "rgba(225,29,72,0.03)" }}>
                            {Math.round(w.newConsensus).toLocaleString()}
                          </td>
                        ))}
                      </tr>

                      {/* Variance % */}
                      <tr>
                        <td style={{ position: "sticky", left: 0, background: "#fff", padding: "5px 12px", fontWeight: 400, borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap", zIndex: 1 }}>
                          Variance %
                        </td>
                        {sortedWeeks.map((w) => {
                          const isHigh = Math.abs(w.variancePct) > 10;
                          return (
                            <td key={w.weekStart} style={{ padding: "5px 10px", textAlign: "right", borderBottom: "1px solid #f1f5f9", fontVariantNumeric: "tabular-nums", fontWeight: isHigh ? 700 : 400, color: isHigh ? "#dc2626" : undefined, background: isHigh ? "rgba(220,38,38,0.06)" : undefined }}>
                              {w.variancePct.toFixed(1)}%
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </Box>
              </SectionCard>
              <Snackbar open={snackOpen} autoHideDuration={3000} onClose={() => setSnackOpen(false)} message={snackMsg} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} />
            </Stack>
          ) : null}

          {/* =========== TAB 1: Cross-functional Inputs (stacked by SKU) =========== */}
          {tab === 1 ? (
            <Stack spacing={1}>
              <SectionCard title="Input contribution by SKU" subtitle="Aggregated cross-functional inputs across all locations and weeks">
                <Box className="content-card" sx={{ p: 1.5, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Stacked Input Volume by SKU
                  </Typography>
                  <div className="chart-shell">
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart
                        data={(() => {
                          const map = new Map<string, { sku: string; Sales: number; Customer: number; SupplyChain: number; Marketing: number; Consensus: number }>();
                          for (const r of rows) {
                            const cur = map.get(r.sku) ?? { sku: r.sku, Sales: 0, Customer: 0, SupplyChain: 0, Marketing: 0, Consensus: 0 };
                            cur.Sales += r.sales_input;
                            cur.Customer += r.customer_input;
                            cur.SupplyChain += r.supply_chain_input;
                            cur.Marketing += r.marketing_input;
                            cur.Consensus += r.consensus_qty;
                            map.set(r.sku, cur);
                          }
                          return [...map.values()];
                        })()}
                        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="sku" tick={{ fontSize: 11 }} interval={0} angle={-28} textAnchor="end" height={56} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip formatter={(v: number) => Math.round(v).toLocaleString()} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="Sales" stackId="inputs" fill="#2563eb" />
                        <Bar dataKey="Customer" stackId="inputs" fill="#16a34a" />
                        <Bar dataKey="SupplyChain" name="Supply Chain" stackId="inputs" fill="#f59e0b" />
                        <Bar dataKey="Marketing" stackId="inputs" fill="#883DCF" />
                        <Line type="monotone" dataKey="Consensus" stroke="#0f172a" strokeWidth={3} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </Box>

                <Box className="content-card" sx={{ p: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Summary Totals by Function
                  </Typography>
                  {(() => {
                    const totals = rows.reduce(
                      (acc, r) => ({
                        sales: acc.sales + r.sales_input,
                        customer: acc.customer + r.customer_input,
                        supply: acc.supply + r.supply_chain_input,
                        marketing: acc.marketing + r.marketing_input,
                        consensus: acc.consensus + r.consensus_qty,
                      }),
                      { sales: 0, customer: 0, supply: 0, marketing: 0, consensus: 0 },
                    );
                    const items = [
                      { label: "Sales", value: totals.sales, color: "#2563eb" },
                      { label: "Customer", value: totals.customer, color: "#16a34a" },
                      { label: "Supply Chain", value: totals.supply, color: "#f59e0b" },
                      { label: "Marketing", value: totals.marketing, color: "#883DCF" },
                      { label: "Consensus", value: totals.consensus, color: "#0f172a" },
                    ];
                    return (
                      <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap" }}>
                        {items.map((item) => (
                          <Box
                            key={item.label}
                            sx={{ p: 1.2, borderRadius: 1, border: "1px solid", borderColor: "divider", minWidth: 120, textAlign: "center" }}
                          >
                            <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>{item.label}</Typography>
                            <Typography sx={{ fontSize: "1.15rem", fontWeight: 700, color: item.color }}>
                              {Math.round(item.value).toLocaleString()}
                            </Typography>
                          </Box>
                        ))}
                      </Stack>
                    );
                  })()}
                </Box>
              </SectionCard>
            </Stack>
          ) : null}

          {/* =========== TAB 2: Reconciliation =========== */}
          {tab === 2 ? (
            <Stack spacing={1}>
              <SectionCard
                title="Reconciliation"
                subtitle={`${filteredHighVarianceRows.length} high-variance items (|variance| > 10%) across ${reconWeekAgg.length} weeks`}
              >
                <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                    <TextField
                      select
                      size="small"
                      label="Product (SKU)"
                      value={selectedSku || "All"}
                      onChange={(e) => {
                        setSelectedSku(e.target.value === "All" ? "" : e.target.value);
                        setSelectedLocation("");
                      }}
                      sx={{ minWidth: 200 }}
                    >
                      <MenuItem value="All">All</MenuItem>
                      {skuOptions.map((sku) => (
                        <MenuItem key={sku} value={sku}>{sku}</MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label="Location"
                      value={selectedLocation || "All"}
                      onChange={(e) => setSelectedLocation(e.target.value === "All" ? "" : e.target.value)}
                      sx={{ minWidth: 180 }}
                    >
                      <MenuItem value="All">All</MenuItem>
                      {locationOptions.map((loc) => (
                        <MenuItem key={loc} value={loc}>{loc}</MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                  <Stack direction="row" spacing={0.7} sx={{ flexWrap: "wrap" }}>
                    <Chip label={`Weeks: ${reconWeekAgg.length}`} />
                    <Chip
                      color={filteredHighVarianceRows.length > 0 ? "warning" : "success"}
                      variant="outlined"
                      label={`High Variance Items: ${filteredHighVarianceRows.length}`}
                    />
                  </Stack>
                </Stack>

                <Box className="content-card" sx={{ p: 1.5, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Reconciliation — Weekly Input vs Consensus
                  </Typography>
                  <div className="chart-shell">
                    <ResponsiveContainer width="100%" height={300}>
                      <ComposedChart data={reconChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="week" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis yAxisId="left" domain={reconChartYDomain} tick={{ fontSize: 11 }} tickFormatter={(v: number) => Math.round(v).toLocaleString()} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                        <RechartsTooltip formatter={(value: number, name: string) => name === "Variance %" ? `${value.toFixed(1)}%` : Math.round(value).toLocaleString()} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="left" dataKey="sales" name="Sales Input" stackId="inputs" fill="#2563eb" barSize={20} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="customer" name="Customer Input" stackId="inputs" fill="#7c3aed" barSize={20} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="supplyChain" name="Supply Chain Input" stackId="inputs" fill="#0d9488" barSize={20} isAnimationActive={false} />
                        <Bar yAxisId="left" dataKey="marketing" name="Marketing Input" stackId="inputs" fill="#f59e0b" barSize={20} isAnimationActive={false} />
                        <Line yAxisId="left" type="monotone" dataKey="consensus" name="Consensus Qty" stroke="#dc2626" strokeWidth={3} isAnimationActive={false} />
                        <Line yAxisId="right" type="monotone" dataKey="variance" name="Variance %" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                    Stacked bars show input by function; solid line is consensus qty; dashed line is variance %.
                  </Typography>
                </Box>

                <div className="maintenance-grid-shell">
                  <SmartDataGrid
                    rows={reconTransposedRows}
                    columns={reconTransposedColumns}
                    disableRowSelectionOnClick
                    loading={isLoading}
                    hideFooter
                    getRowId={(r) => r.id}
                    sx={(theme) => ({
                      border: 0,
                      fontSize: 11,
                      "& .MuiDataGrid-cell": { py: 0.25 },
                      "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 },
                      "& .MuiDataGrid-columnHeader[data-field='metric']": {
                        position: "sticky",
                        left: 0,
                        zIndex: 4,
                        backgroundColor: theme.palette.background.paper,
                        borderRight: `1px solid ${theme.palette.divider}`,
                      },
                      "& .MuiDataGrid-cell[data-field='metric']": {
                        position: "sticky",
                        left: 0,
                        zIndex: 3,
                        backgroundColor: theme.palette.background.paper,
                        borderRight: `1px solid ${theme.palette.divider}`,
                        fontWeight: 600,
                      },
                    })}
                    exportFileName="demand-reconciliation-workbench"
                    slotProps={{ toolbar: { exportFileName: "demand-reconciliation-workbench" } as never }}
                  />
                </div>
              </SectionCard>
            </Stack>
          ) : null}
        </Stack>
      </SectionCard>
    </div>
  );
}
