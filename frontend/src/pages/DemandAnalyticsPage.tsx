import AttachMoneyOutlinedIcon from "@mui/icons-material/AttachMoneyOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import PercentOutlinedIcon from "@mui/icons-material/PercentOutlined";
import TrendingFlatOutlinedIcon from "@mui/icons-material/TrendingFlatOutlined";
import { Box, Divider, Stack, Tab, Tabs, Typography } from "@mui/material";
import { type GridColDef } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import { AreaChart, BarChart, LineChart } from "../charts";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { fetchDemandAccuracy, fetchDemandPlanningKpis } from "../services/api";
import type {
  DemandForecastAccuracyRecord,
  DemandForecastAccuracyResponse,
  DemandPlanningKpiResponse,
  Tone,
} from "../types";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";

const compactSx = {
  fontSize: 11,
  "& .MuiDataGrid-cell": { py: 0.25 },
  "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 },
} as const;

function mapApiToneToClass(tone: Tone): "critical" | "warning" | "info" | "network" | "money" | "demand" | "risk" {
  if (tone === "positive") return "demand";
  if (tone === "warning") return "warning";
  if (tone === "critical") return "critical";
  return "network";
}

function kpiIconForLabel(label: string): ReactNode {
  const key = label.toLowerCase();
  if (key.includes("mape")) return <PercentOutlinedIcon fontSize="small" />;
  if (key.includes("bias")) return <TrendingFlatOutlinedIcon fontSize="small" />;
  if (key.includes("exception")) return <FlagOutlinedIcon fontSize="small" />;
  if (key.includes("revenue")) return <AttachMoneyOutlinedIcon fontSize="small" />;
  if (key.includes("promotion")) return <LocalOfferOutlinedIcon fontSize="small" />;
  return <ErrorOutlineOutlinedIcon fontSize="small" />;
}

function buildDemandParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), filters);
}

function formatPromoValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

const TAB_LABELS = ["Executive Summary", "Forecast Accuracy Report", "Demand vs Supply", "S&OP KPIs"] as const;

export default function DemandAnalyticsPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const filtersKey = globalFiltersKey(filters);
  const params = useMemo(() => buildDemandParams(filters), [filtersKey]);

  const [tab, setTab] = useState(0);

  const kpisQuery = useQuery<DemandPlanningKpiResponse>({
    queryKey: ["demand-planning-kpis"],
    queryFn: () => fetchDemandPlanningKpis(),
  });

  const accuracyQuery = useQuery<DemandForecastAccuracyResponse>({
    queryKey: ["demand-accuracy", filtersKey],
    queryFn: () => fetchDemandAccuracy(params),
  });

  const kpiList = kpisQuery.data?.kpis ?? [];
  const trend = kpisQuery.data?.forecast_accuracy_trend ?? [];
  const gapRows = useMemo(() => {
    const raw = kpisQuery.data?.demand_vs_supply_gap ?? [];
    return raw.map((row) => {
      const week = String(row.week ?? "");
      const demand = Number(row.demand) || 0;
      const supply = Number(row.supply) || 0;
      return { week, demand, supply, gap: demand - supply };
    });
  }, [kpisQuery.data?.demand_vs_supply_gap]);

  const accuracyRows = accuracyQuery.data?.rows ?? [];

  const mapeTrendFromAccuracy = useMemo(() => {
    const map = new Map<string, { week_start: string; sum: number; n: number }>();
    for (const row of accuracyRows) {
      const w = row.week_start;
      const cur = map.get(w) ?? { week_start: w, sum: 0, n: 0 };
      cur.sum += Number(row.mape) || 0;
      cur.n += 1;
      map.set(w, cur);
    }
    return [...map.values()]
      .map((x) => ({
        week_start: x.week_start,
        avg_mape: x.n ? x.sum / x.n : 0,
      }))
      .sort((a, b) => a.week_start.localeCompare(b.week_start));
  }, [accuracyRows]);

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
        valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(1)}%`),
      },
      {
        field: "bias",
        headerName: "Bias",
        type: "number",
        minWidth: 88,
        flex: 0.55,
        valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(1)}%`),
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
        valueFormatter: (v) => (v == null ? "" : Number(v).toFixed(2)),
      },
    ],
    [],
  );

  const promoSummary = kpisQuery.data?.promo_impact_summary ?? {};
  const promoEntries = useMemo(() => Object.entries(promoSummary).sort(([a], [b]) => a.localeCompare(b)), [promoSummary]);

  const loadingKpis = kpisQuery.isLoading;

  return (
    <div className="page-scroll">
      <SectionCard title="IBP Analytics & Reporting" subtitle="Demand planning KPIs, forecast accuracy, and supply alignment">
        <Stack spacing={1}>
          <KpiCardRow>
            {kpiList.map((kpi, i) => (
              <KpiCard
                key={`${kpi.label}-${i}`}
                title={kpi.label}
                icon={kpiIconForLabel(kpi.label)}
                tone={mapApiToneToClass(kpi.tone)}
                value={loadingKpis ? "…" : String(kpi.value ?? "—")}
                sub={kpi.detail}
              />
            ))}
            {loadingKpis && kpiList.length === 0
              ? Array.from({ length: 5 }, (_, i) => (
                  <KpiCard key={`sk-${i}`} title="—" tone="network" value="…" />
                ))
              : null}
          </KpiCardRow>

          <Tabs
            value={tab}
            onChange={(_e, v) => setTab(v)}
            sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}
          >
            {TAB_LABELS.map((label) => (
              <Tab key={label} label={label} />
            ))}
          </Tabs>

          {tab === 0 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Executive overview
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1} useFlexGap>
                <Box sx={{ flex: "1 1 160px", minWidth: 140, p: 1, borderRadius: 1, border: 1, borderColor: "divider", fontSize: 11 }}>
                  <Typography sx={{ fontSize: 11, color: "text.secondary" }}>Avg MAPE (filtered accuracy)</Typography>
                  <Typography sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
                    {accuracyQuery.isLoading ? "…" : `${(accuracyQuery.data?.avg_mape ?? 0).toFixed(1)}%`}
                  </Typography>
                </Box>
                <Box sx={{ flex: "1 1 160px", minWidth: 140, p: 1, borderRadius: 1, border: 1, borderColor: "divider", fontSize: 11 }}>
                  <Typography sx={{ fontSize: 11, color: "text.secondary" }}>Avg bias</Typography>
                  <Typography sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
                    {accuracyQuery.isLoading ? "…" : `${(accuracyQuery.data?.avg_bias ?? 0).toFixed(1)}%`}
                  </Typography>
                </Box>
                <Box sx={{ flex: "1 1 160px", minWidth: 140, p: 1, borderRadius: 1, border: 1, borderColor: "divider", fontSize: 11 }}>
                  <Typography sx={{ fontSize: 11, color: "text.secondary" }}>Accuracy rows</Typography>
                  <Typography sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
                    {accuracyQuery.isLoading ? "…" : String(accuracyQuery.data?.total ?? accuracyRows.length)}
                  </Typography>
                </Box>
                <Box sx={{ flex: "1 1 160px", minWidth: 140, p: 1, borderRadius: 1, border: 1, borderColor: "divider", fontSize: 11 }}>
                  <Typography sx={{ fontSize: 11, color: "text.secondary" }}>Weeks in supply gap series</Typography>
                  <Typography sx={{ fontSize: "1.1rem", fontWeight: 600 }}>
                    {kpisQuery.isLoading ? "…" : String(gapRows.length)}
                  </Typography>
                </Box>
              </Stack>

              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600, mt: 0.5 }}>
                MAPE trend
              </Typography>
              <div className="chart-shell" style={{ minHeight: 260 }}>
                <LineChart
                  chartId="demand-analytics-mape-trend"
                  data={trend as Array<Record<string, unknown>>}
                  xKey="week"
                  height={280}
                  series={[{ field: "mape", label: "MAPE %", color: "#2679A8", strokeWidth: 2 }]}
                />
              </div>

              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Demand vs supply gap by week
              </Typography>
              <div className="chart-shell" style={{ minHeight: 260 }}>
                <BarChart
                  chartId="demand-analytics-gap-bars"
                  data={gapRows}
                  xKey="week"
                  height={280}
                  series={[
                    { field: "demand", label: "Demand", color: "#2679A8" },
                    { field: "supply", label: "Supply", color: "#883DCF" },
                    { field: "gap", label: "Gap (D−S)", color: "#c2410c" },
                  ]}
                />
              </div>
            </Stack>
          ) : null}

          {tab === 1 ? (
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                {accuracyQuery.data?.total ?? accuracyRows.length} row
                {(accuracyQuery.data?.total ?? accuracyRows.length) === 1 ? "" : "s"}
                {accuracyQuery.data?.avg_wmape != null ? ` · Avg WMAPE ${accuracyQuery.data.avg_wmape.toFixed(1)}%` : null}
              </Typography>
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
                  slotProps={{ toolbar: { exportFileName: "demand-forecast-accuracy-report" } }}
                />
              </div>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                MAPE trend (from filtered accuracy)
              </Typography>
              <div className="chart-shell" style={{ minHeight: 260 }}>
                <LineChart
                  chartId="demand-analytics-mape-from-accuracy"
                  data={mapeTrendFromAccuracy}
                  xKey="week_start"
                  height={280}
                  series={[{ field: "avg_mape", label: "Avg MAPE %", color: "#2679A8", strokeWidth: 2 }]}
                />
              </div>
            </Stack>
          ) : null}

          {tab === 2 ? (
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Demand (forecast) and network supply by week; shaded gap shows demand minus supply.
              </Typography>
              <div className="chart-shell" style={{ minHeight: 320 }}>
                <AreaChart
                  chartId="demand-analytics-gap-area"
                  data={gapRows}
                  xKey="week"
                  height={340}
                  series={[
                    { field: "demand", label: "Demand", color: "#2679A8" },
                    { field: "supply", label: "Supply", color: "#883DCF" },
                    { field: "gap", label: "Gap (D−S)", color: "#dc2626" },
                  ]}
                />
              </div>
            </Stack>
          ) : null}

          {tab === 3 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Promotion impact summary
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1} useFlexGap>
                {promoEntries.map(([key, val]) => (
                  <Box key={key} sx={{ flex: "1 1 200px", minWidth: 160, p: 1, borderRadius: 1, border: 1, borderColor: "divider" }}>
                    <Typography sx={{ fontSize: 11, color: "text.secondary", textTransform: "capitalize" }}>
                      {key.replace(/_/g, " ")}
                    </Typography>
                    <Typography sx={{ fontSize: "1.05rem", fontWeight: 600 }}>{formatPromoValue(val)}</Typography>
                  </Box>
                ))}
              </Stack>
              <Divider sx={{ my: 0.5 }} />
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                S&OP dashboard snapshot
              </Typography>
              <KpiCardRow>
                {(["Promo", "Exception", "Revenue", "MAPE"] as const).map((needle) => {
                  const kpi = kpiList.find((k) => k.label.includes(needle));
                  return (
                    <KpiCard
                      key={needle}
                      title={kpi?.label ?? "—"}
                      icon={kpi ? kpiIconForLabel(kpi.label) : undefined}
                      tone={kpi ? mapApiToneToClass(kpi.tone) : "network"}
                      value={loadingKpis ? "…" : String(kpi?.value ?? "—")}
                      sub={kpi?.detail}
                    />
                  );
                })}
              </KpiCardRow>
            </Stack>
          ) : null}
        </Stack>
      </SectionCard>
    </div>
  );
}
