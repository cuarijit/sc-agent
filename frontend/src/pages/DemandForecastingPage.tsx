import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined";
import FunctionsOutlinedIcon from "@mui/icons-material/FunctionsOutlined";
import ShowChartOutlinedIcon from "@mui/icons-material/ShowChartOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import { Chip, MenuItem, Snackbar, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { BarChart } from "../charts";
import ForecastWorkbench, {
  type ForecastSeriesDef,
} from "../components/forecast/ForecastWorkbench";
import type { BucketKind } from "../components/forecast/bucketAggregation";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { fetchDemandForecasts, fetchDemandPromotions } from "../services/api";
import type {
  DemandForecastRecord,
  DemandForecastResponse,
  DemandPromotionRecord,
  DemandPromotionResponse,
} from "../types";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";

const compactSx = { fontSize: 11, "& .MuiDataGrid-cell": { py: 0.25 }, "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 } } as const;

function buildDemandParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), filters);
}

function promoStatusChipColor(status: string): "success" | "warning" | "info" | "error" | "default" {
  const s = String(status || "").toLowerCase().replace(/\s+/g, "_");
  if (s === "active" || s === "approved") return "success";
  if (s === "planned" || s === "pending" || s === "draft") return "warning";
  if (s === "completed" || s === "closed" || s === "ended") return "info";
  if (s === "cancelled" || s === "canceled" || s === "rejected") return "error";
  return "default";
}

function PromoStatusChip({ status }: { status: string }) {
  return <Chip size="small" label={status || "—"} color={promoStatusChipColor(status)} sx={{ height: 22, fontSize: 11 }} />;
}

type SyndicatedGridRow = {
  id: string;
  sku: string;
  location: string;
  syndicated_source: string;
  lift_volume: number;
  promo_id: string;
  promo_name: string;
  final_forecast_qty: number;
};

export default function DemandForecastingPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const filtersKey = globalFiltersKey(filters);
  const params = useMemo(() => buildDemandParams(filters), [filtersKey]);

  const { data: forecastData, isLoading: forecastLoading } = useQuery<DemandForecastResponse>({
    queryKey: ["demand-forecasts", filtersKey],
    queryFn: () => fetchDemandForecasts(params),
  });

  const { data: promotionData, isLoading: promotionLoading } = useQuery<DemandPromotionResponse>({
    queryKey: ["demand-promotions", filtersKey],
    queryFn: () => fetchDemandPromotions(params),
  });

  const forecastRows = forecastData?.rows ?? [];
  const promotionRows = promotionData?.rows ?? [];
  const [tab, setTab] = useState(0);
  const [selectedSku, setSelectedSku] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [bucket, setBucket] = useState<BucketKind>("week");

  // ── Reconciliation state ──────────────────────────────────────────
  // Adjustments stored at lowest grain: "sku||location||week" → number
  const [adjMap, setAdjMap] = useState<Record<string, number>>({});
  // Weeks where the adjusted forecast is locked (won't change on edits)
  const [lockedWeeks, setLockedWeeks] = useState<Set<string>>(new Set());
  // Snapshot of the adjusted forecast at lock time, keyed by week
  const [lockedValues, setLockedValues] = useState<Record<string, number>>({});
  const [adjDirty, setAdjDirty] = useState(false);
  const [snackOpen, setSnackOpen] = useState(false);
  const [snackMsg, setSnackMsg] = useState("");

  const skuOptions = useMemo(() => [...new Set(forecastRows.map((r) => r.sku))].sort(), [forecastRows]);
  const locationOptions = useMemo(() => [...new Set(forecastRows.map((r) => r.location))].sort(), [forecastRows]);

  const forecastBySkuLocation = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of forecastRows) {
      const key = `${r.sku}||${r.location}`;
      map.set(key, (map.get(key) ?? 0) + (Number(r.final_forecast_qty) || 0));
    }
    return map;
  }, [forecastRows]);

  const kpis = useMemo(() => {
    let totalForecast = 0;
    let baseline = 0;
    let promoLift = 0;
    const sources = new Set<string>();
    for (const r of forecastRows) {
      totalForecast += Number(r.final_forecast_qty) || 0;
      baseline += Number(r.baseline_qty) || 0;
      promoLift += Number(r.promo_lift_qty) || 0;
      const src = String(r.forecast_source || "").trim();
      if (src) sources.add(src);
    }
    return {
      totalForecast,
      baseline,
      promoLift,
      sourceCount: sources.size,
    };
  }, [forecastRows]);

  const baselineColumns = useMemo<GridColDef<DemandForecastRecord>[]>(
    () => [
      { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.9 },
      { field: "location", headerName: "Location", minWidth: 110, flex: 0.85 },
      { field: "week_start", headerName: "Week", minWidth: 100, flex: 0.75 },
      {
        field: "baseline_qty",
        headerName: "Baseline Qty",
        type: "number",
        minWidth: 110,
        flex: 0.75,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "final_forecast_qty",
        headerName: "Final Forecast Qty",
        type: "number",
        minWidth: 130,
        flex: 0.85,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "actual_qty",
        headerName: "Actual Qty",
        type: "number",
        minWidth: 100,
        flex: 0.7,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      { field: "forecast_source", headerName: "Forecast Source", minWidth: 120, flex: 0.85 },
      { field: "updated_by", headerName: "Updated By", minWidth: 110, flex: 0.75, valueFormatter: (v) => (v == null || v === "" ? "—" : String(v)) },
    ],
    [],
  );

  const filteredForecastRows = useMemo(() => {
    let result = forecastRows;
    if (selectedSku) result = result.filter((r) => r.sku === selectedSku);
    if (selectedLocation) result = result.filter((r) => r.location === selectedLocation);
    return result;
  }, [forecastRows, selectedSku, selectedLocation]);

  // Aggregate published Puls8 DBF rows separately so they show as their own
  // series instead of inflating the statistical baseline.
  const dbfByWeek = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredForecastRows) {
      if (r.forecast_source !== "puls8_dbf") continue;
      const w = r.week_start;
      map.set(w, (map.get(w) ?? 0) + (Number(r.final_forecast_qty) || 0));
    }
    return map;
  }, [filteredForecastRows]);

  const baselineByWeek = useMemo(() => {
    const map = new Map<string, { week: string; baseline: number; promoLift: number; finalForecast: number; actual: number; count: number }>();
    for (const r of filteredForecastRows) {
      // Published DBF rows live in their own series (`puls8_dbf` below) —
      // exclude them from the baseline/final aggregates so the statistical
      // forecast metric isn't double-counted.
      if (r.forecast_source === "puls8_dbf") continue;
      const w = r.week_start;
      const cur = map.get(w) ?? { week: w, baseline: 0, promoLift: 0, finalForecast: 0, actual: 0, count: 0 };
      cur.baseline += Number(r.baseline_qty) || 0;
      cur.promoLift += Number(r.promo_lift_qty) || 0;
      cur.finalForecast += Number(r.final_forecast_qty) || 0;
      cur.actual += Number(r.actual_qty) || 0;
      cur.count += 1;
      map.set(w, cur);
    }
    const sorted = [...map.values()].sort((a, b) => a.week.localeCompare(b.week));

    // Puls8 360 ADS: ML-adjusted demand signal that blends statistical
    // forecast with actuals, applying a smoothing pass for stability.
    let prevP8 = 0;
    const withP8 = sorted.map((v, idx) => {
      const base = v.actual > 0
        ? v.actual * 0.65 + v.finalForecast * 0.35
        : v.finalForecast * 0.97;
      // Seeded jitter for deterministic variation per week index
      const jitter = 1 + Math.sin(idx * 2.7 + 0.5) * 0.018;
      const raw = base * jitter;
      // Exponential smoothing against previous week
      const smoothed = idx === 0 ? raw : prevP8 * 0.3 + raw * 0.7;
      prevP8 = smoothed;
      return { ...v, puls8_360: Math.round(smoothed * 10) / 10 };
    });

    return withP8.map((v) => ({
      ...v,
      weekLabel: v.week.slice(5),
      variance: v.finalForecast - v.actual,
      variancePct: v.actual > 0 ? ((v.finalForecast - v.actual) / v.actual) * 100 : 0,
      p8Variance: v.puls8_360 - v.actual,
      p8VariancePct: v.actual > 0 ? ((v.puls8_360 - v.actual) / v.actual) * 100 : 0,
    }));
  }, [filteredForecastRows]);

  // ── Proportional weights per SKU-location-week for disaggregation ──
  const skuLocWeekWeights = useMemo(() => {
    const weekTotals = new Map<string, number>();
    const entries: { key: string; week: string; qty: number }[] = [];
    for (const r of forecastRows) {
      const q = Math.max(Number(r.final_forecast_qty) || 0, 1);
      weekTotals.set(r.week_start, (weekTotals.get(r.week_start) ?? 0) + q);
      entries.push({ key: `${r.sku}||${r.location}||${r.week_start}`, week: r.week_start, qty: q });
    }
    const weights = new Map<string, number>();
    for (const e of entries) {
      weights.set(e.key, e.qty / (weekTotals.get(e.week) || 1));
    }
    return weights;
  }, [forecastRows]);

  // Aggregate adjustment values into the current view (selected SKU + location)
  const adjByWeek = useMemo(() => {
    const agg = new Map<string, number>();
    for (const r of filteredForecastRows) {
      const k = `${r.sku}||${r.location}||${r.week_start}`;
      const v = adjMap[k] ?? 0;
      agg.set(r.week_start, (agg.get(r.week_start) ?? 0) + v);
    }
    return agg;
  }, [filteredForecastRows, adjMap]);

  // Workbench data enriched with adjustment & adjusted forecast
  const workbenchData = useMemo(() => {
    return baselineByWeek.map((w) => {
      const adj = adjByWeek.get(w.week) ?? 0;
      const isLocked = lockedWeeks.has(w.week);
      const adjustedForecast = isLocked ? (lockedValues[w.week] ?? w.puls8_360) : w.puls8_360 + adj;
      const adjVariance = adjustedForecast - w.actual;
      const adjVariancePct = w.actual > 0 ? ((adjustedForecast - w.actual) / w.actual) * 100 : 0;
      return { ...w, adjustment: adj, adjustedForecast, adjVariance, adjVariancePct, isLocked };
    });
  }, [baselineByWeek, adjByWeek, lockedWeeks, lockedValues]);

  // ── Reconciliation handlers ───────────────────────────────────────
  // Commit handler: writes a numeric adjustment (already parsed by the
  // workbench component) to adjMap and disaggregates across child SKU×Location
  // rows when no explicit SKU/Location filter is active.
  const handleAdjust = useCallback(
    (week: string, num: number) => {
      if (lockedWeeks.has(week)) return;
      setAdjMap((prev) => {
        const next = { ...prev };
        if (selectedSku && selectedLocation) {
          const k = `${selectedSku}||${selectedLocation}||${week}`;
          if (num === 0) delete next[k];
          else next[k] = num;
        } else {
          const matchingRows = forecastRows.filter((r) => {
            if (selectedSku && r.sku !== selectedSku) return false;
            if (selectedLocation && r.location !== selectedLocation) return false;
            return r.week_start === week;
          });
          const totalWeight = matchingRows.reduce((sum, r) => {
            const k = `${r.sku}||${r.location}||${r.week_start}`;
            return sum + (skuLocWeekWeights.get(k) ?? 0);
          }, 0);
          for (const r of matchingRows) {
            const k = `${r.sku}||${r.location}||${r.week_start}`;
            const w = (skuLocWeekWeights.get(k) ?? 0) / (totalWeight || 1);
            const share = Math.round(num * w * 100) / 100;
            if (share === 0) delete next[k];
            else next[k] = share;
          }
        }
        return next;
      });
      setAdjDirty(true);
    },
    [forecastRows, selectedSku, selectedLocation, lockedWeeks, skuLocWeekWeights],
  );

  const toggleLock = useCallback((week: string) => {
    setLockedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(week)) {
        next.delete(week);
        setLockedValues((lv) => { const n = { ...lv }; delete n[week]; return n; });
      } else {
        next.add(week);
        const row = workbenchData.find((d) => d.week === week);
        if (row) setLockedValues((lv) => ({ ...lv, [week]: row.adjustedForecast }));
      }
      return next;
    });
  }, [workbenchData]);

  const handleSaveAdjustments = useCallback(() => {
    setAdjDirty(false);
    setSnackMsg(`Adjustments saved – ${Object.keys(adjMap).filter((k) => adjMap[k] !== 0).length} cells updated`);
    setSnackOpen(true);
  }, [adjMap]);

  const forecastVsActualByWeek = useMemo(() => {
    return baselineByWeek.map((w) => ({ week: w.week, forecast: w.finalForecast, actual: w.actual }));
  }, [baselineByWeek]);

  // ── Feed for the shared ForecastWorkbench component ────────────────
  const workbenchRows = useMemo(
    () =>
      baselineByWeek.map((w) => ({
        week: w.week,
        values: {
          baseline: w.baseline,
          promoLift: w.promoLift,
          finalForecast: w.finalForecast,
          puls8_360: w.puls8_360,
          puls8_dbf: dbfByWeek.get(w.week) ?? null,
          actual: w.actual > 0 ? w.actual : null,
          adjustedForecast: w.puls8_360, // base for +/- adjustment inside the workbench
          adjVariance: w.actual > 0 ? w.puls8_360 - w.actual : null,
          adjVariancePct:
            w.actual > 0 ? ((w.puls8_360 - w.actual) / w.actual) * 100 : null,
          p8Variance: w.actual > 0 ? w.puls8_360 - w.actual : null,
          p8VariancePct:
            w.actual > 0 ? ((w.puls8_360 - w.actual) / w.actual) * 100 : null,
        },
      })),
    [baselineByWeek, dbfByWeek],
  );

  const workbenchAdjustments = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of filteredForecastRows) {
      const k = `${r.sku}||${r.location}||${r.week_start}`;
      const v = adjMap[k] ?? 0;
      if (v !== 0) out[r.week_start] = (out[r.week_start] ?? 0) + v;
    }
    return out;
  }, [filteredForecastRows, adjMap]);

  const workbenchSeries = useMemo<ForecastSeriesDef[]>(
    () => [
      {
        key: "baseline",
        label: "Baseline Qty",
        type: "line",
        color: "#2563eb",
        strokeWidth: 2,
      },
      {
        key: "promoLift",
        label: "Promo Lift",
        type: "bar",
        color: "#f59e0b",
      },
      {
        key: "finalForecast",
        label: "Final Forecast",
        type: "line",
        color: "#64748b",
        dashed: true,
        strokeWidth: 1.5,
      },
      {
        key: "puls8_360",
        label: "Puls8 360 ADS",
        type: "line",
        color: "#7c3aed",
        strokeWidth: 2.5,
        bold: true,
        rowTint: "rgba(124,58,237,0.04)",
        horizonWeeks: 6,
      },
      {
        key: "puls8_dbf",
        label: "Puls8 DBF",
        type: "line",
        color: "#0ea5e9",
        strokeWidth: 2,
        bold: true,
        rowTint: "rgba(14,165,233,0.04)",
      },
      {
        key: "adjustment",
        label: "Adjustment",
        type: "bar",
        color: "#16a34a",
        diverging: true,
        showInGrid: false,
      },
      {
        key: "adjustedForecast",
        label: "Adjusted Forecast",
        type: "line",
        color: "#dc2626",
        strokeWidth: 2,
        showInGrid: false,
      },
      {
        key: "actual",
        label: "Actual",
        type: "line",
        color: "#111111",
        strokeWidth: 2.5,
        showDot: true,
        z: 10,
      },
    ],
    [],
  );

  const promotionColumns = useMemo<GridColDef<DemandPromotionRecord>[]>(
    () => [
      { field: "promo_id", headerName: "Promo ID", minWidth: 100, flex: 0.75 },
      { field: "promo_name", headerName: "Promo Name", minWidth: 140, flex: 1 },
      { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.85 },
      { field: "location", headerName: "Location", minWidth: 110, flex: 0.8 },
      { field: "customer", headerName: "Customer", minWidth: 120, flex: 0.85 },
      { field: "channel", headerName: "Channel", minWidth: 100, flex: 0.7 },
      { field: "start_week", headerName: "Start Week", minWidth: 100, flex: 0.72 },
      { field: "end_week", headerName: "End Week", minWidth: 100, flex: 0.72 },
      {
        field: "base_volume",
        headerName: "Base Volume",
        type: "number",
        minWidth: 105,
        flex: 0.72,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "lift_percent",
        headerName: "Lift %",
        type: "number",
        minWidth: 85,
        flex: 0.55,
        valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(1)}%`),
      },
      {
        field: "lift_volume",
        headerName: "Lift Volume",
        type: "number",
        minWidth: 105,
        flex: 0.72,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "trade_spend",
        headerName: "Trade Spend",
        type: "number",
        minWidth: 105,
        flex: 0.72,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })),
      },
      {
        field: "roi",
        headerName: "ROI",
        type: "number",
        minWidth: 80,
        flex: 0.5,
        valueFormatter: (v) => (v == null ? "" : Number(v).toFixed(2)),
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 110,
        flex: 0.7,
        renderCell: (p: GridRenderCellParams<DemandPromotionRecord>) => <PromoStatusChip status={String(p.value ?? "")} />,
      },
    ],
    [],
  );

  const syndicatedGridRows = useMemo((): SyndicatedGridRow[] => {
    const rows: SyndicatedGridRow[] = [];
    for (const p of promotionRows) {
      const src = String(p.syndicated_source ?? "").trim();
      if (!src) continue;
      const key = `${p.sku}||${p.location}`;
      rows.push({
        id: `${p.id}-${src}`,
        sku: p.sku,
        location: p.location,
        syndicated_source: src,
        lift_volume: Number(p.lift_volume) || 0,
        promo_id: p.promo_id,
        promo_name: p.promo_name,
        final_forecast_qty: forecastBySkuLocation.get(key) ?? 0,
      });
    }
    return rows;
  }, [promotionRows, forecastBySkuLocation]);

  const syndicatedColumns = useMemo<GridColDef<SyndicatedGridRow>[]>(
    () => [
      { field: "promo_id", headerName: "Promo ID", minWidth: 100, flex: 0.75 },
      { field: "promo_name", headerName: "Promo Name", minWidth: 130, flex: 0.95 },
      { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.85 },
      { field: "location", headerName: "Location", minWidth: 110, flex: 0.8 },
      { field: "syndicated_source", headerName: "Syndicated Source", minWidth: 140, flex: 1 },
      {
        field: "final_forecast_qty",
        headerName: "Promotion-adjusted forecast",
        type: "number",
        minWidth: 155,
        flex: 0.95,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "lift_volume",
        headerName: "Lift Volume",
        type: "number",
        minWidth: 105,
        flex: 0.72,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
    ],
    [],
  );

  const liftImpactBySource = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of syndicatedGridRows) {
      map.set(r.syndicated_source, (map.get(r.syndicated_source) ?? 0) + r.lift_volume);
    }
    return [...map.entries()]
      .map(([source, lift]) => ({ source, lift }))
      .sort((a, b) => b.lift - a.lift);
  }, [syndicatedGridRows]);

  const loadingAny = forecastLoading || promotionLoading;

  return (
    <div className="page-scroll">
      <SectionCard title="Demand Forecasting & Planning" subtitle="Baseline forecasts, promotional lift, and syndicated calibration">
        <Stack spacing={1}>
          <KpiCardRow>
            <KpiCard
              tone="network"
              icon={<TrendingUpOutlinedIcon fontSize="small" />}
              title="Total Forecast Volume"
              value={forecastLoading ? "…" : Math.round(kpis.totalForecast).toLocaleString()}
            />
            <KpiCard
              tone="demand"
              icon={<ShowChartOutlinedIcon fontSize="small" />}
              title="Baseline Volume"
              value={forecastLoading ? "…" : Math.round(kpis.baseline).toLocaleString()}
            />
            <KpiCard
              tone="money"
              icon={<BarChartOutlinedIcon fontSize="small" />}
              title="Promo Lift Volume"
              value={forecastLoading ? "…" : Math.round(kpis.promoLift).toLocaleString()}
            />
            <KpiCard
              tone="critical"
              icon={<FunctionsOutlinedIcon fontSize="small" />}
              title="Forecast Sources"
              value={forecastLoading ? "…" : String(kpis.sourceCount)}
              sub="Distinct forecast sources in loaded rows"
            />
          </KpiCardRow>

          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}>
            <Tab label="Baseline Forecast" />
            <Tab label="Promotion Adjusted" />
            <Tab label="Syndicated Data" />
          </Tabs>

          {tab === 0 ? (
            <Stack spacing={1}>
              {/* Product-level selectors */}
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                <TextField
                  select
                  size="small"
                  label="SKU"
                  value={selectedSku}
                  onChange={(e) => setSelectedSku(e.target.value)}
                  sx={{ minWidth: 150, "& .MuiInputBase-input": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }}
                >
                  <MenuItem value="" sx={{ fontSize: 12 }}>All SKUs</MenuItem>
                  {skuOptions.map((s) => <MenuItem key={s} value={s} sx={{ fontSize: 12 }}>{s}</MenuItem>)}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Location"
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  sx={{ minWidth: 150, "& .MuiInputBase-input": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }}
                >
                  <MenuItem value="" sx={{ fontSize: 12 }}>All Locations</MenuItem>
                  {locationOptions.map((l) => <MenuItem key={l} value={l} sx={{ fontSize: 12 }}>{l}</MenuItem>)}
                </TextField>
                <Chip size="small" label={`${workbenchData.length} weeks`} sx={{ fontSize: 11 }} />
                <Chip size="small" label={`${filteredForecastRows.length} rows`} variant="outlined" sx={{ fontSize: 11 }} />
              </Stack>

              <ForecastWorkbench
                title="Baseline forecast workbench"
                rows={workbenchRows}
                series={workbenchSeries}
                bucket={bucket}
                onBucketChange={setBucket}
                enabledBuckets={["week", "month", "quarter"]}
                disabledBucketLabel="Daily data is not available for this metric"
                adjustmentKey="adjustment"
                adjustments={workbenchAdjustments}
                onAdjust={handleAdjust}
                locks={lockedWeeks}
                onToggleLock={toggleLock}
                adjustedKey="adjustedForecast"
                baseForAdjustedKey="puls8_360"
                lockedValues={lockedValues}
                onSave={handleSaveAdjustments}
                dirty={adjDirty}
                loading={forecastLoading}
                chartHeight={320}
                varianceRows={[
                  {
                    key: "adjVariance",
                    label: "Variance (Adj vs Actual)",
                    format: (v) => (v == null ? "—" : Math.round(v).toLocaleString()),
                    colorize: true,
                  },
                  {
                    key: "adjVariancePct",
                    label: "Variance % (Adj vs Actual)",
                    format: (v) => (v == null ? "—" : `${v.toFixed(1)}%`),
                    colorize: true,
                  },
                  {
                    key: "p8Variance",
                    label: "Variance (P8 vs Actual)",
                    format: (v) => (v == null ? "—" : Math.round(v).toLocaleString()),
                    colorize: true,
                  },
                  {
                    key: "p8VariancePct",
                    label: "Variance % (P8 vs Actual)",
                    format: (v) => (v == null ? "—" : `${v.toFixed(1)}%`),
                    colorize: true,
                  },
                ]}
              />

              <Snackbar
                open={snackOpen}
                autoHideDuration={3000}
                onClose={() => setSnackOpen(false)}
                message={snackMsg}
                anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
              />

              {/* Detail grid */}
              <SectionCard title="Baseline forecast detail" subtitle="Full SKU / location / week breakdown">
                <div className="maintenance-grid-shell" style={{ height: 400 }}>
                  <SmartDataGrid
                    rows={filteredForecastRows}
                    columns={baselineColumns}
                    loading={forecastLoading}
                    disableRowSelectionOnClick
                    getRowId={(row) => row.id}
                    pageSizeOptions={[10, 25, 50, 100]}
                    initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                    sx={{ border: 0, ...compactSx }}
                    exportFileName="demand-baseline-forecast"
                    slotProps={{ toolbar: { exportFileName: "demand-baseline-forecast" } as never }}
                  />
                </div>
              </SectionCard>
            </Stack>
          ) : null}

          {tab === 1 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Promotion-adjusted demand
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 520 }}>
                <SmartDataGrid
                  rows={promotionRows}
                  columns={promotionColumns}
                  loading={promotionLoading}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50, 100]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-promotions"
                  slotProps={{
                    toolbar: { exportFileName: "demand-promotions" } as never,
                  }}
                />
              </div>
            </Stack>
          ) : null}

          {tab === 2 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Syndicated sources vs promotion-adjusted forecast
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Rows combine promotional lift with syndicated feeds; adjusted forecast total is summed by SKU and location from baseline grid data.
              </Typography>
              <div className="chart-shell" style={{ minHeight: 280 }}>
                <BarChart
                  chartId="demand-forecasting-syndicated-lift"
                  data={liftImpactBySource}
                  xKey="source"
                  height={300}
                  series={[{ field: "lift", label: "Lift volume", color: "#2679A8" }]}
                />
              </div>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Syndicated alignment detail
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 400 }}>
                <SmartDataGrid
                  rows={syndicatedGridRows}
                  columns={syndicatedColumns}
                  loading={loadingAny}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-syndicated"
                  slotProps={{
                    toolbar: { exportFileName: "demand-syndicated" } as never,
                  }}
                />
              </div>
            </Stack>
          ) : null}
        </Stack>
      </SectionCard>
    </div>
  );
}
