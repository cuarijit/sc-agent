import AttachMoneyOutlinedIcon from "@mui/icons-material/AttachMoneyOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import EventAvailableOutlinedIcon from "@mui/icons-material/EventAvailableOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import { Box, Chip, Stack, Tab, Tabs, Typography } from "@mui/material";

import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { BarChart, LineChart, ScatterChart } from "../charts";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { fetchDemandPromotions } from "../services/api";
import type { DemandPromotionRecord, DemandPromotionResponse } from "../types";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";

const compactSx = { fontSize: 11, "& .MuiDataGrid-cell": { py: 0.25 }, "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 } } as const;

function buildDemandParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), filters);
}

function promoStatusChipColor(status: string): "success" | "info" | "default" {
  const s = String(status || "").toLowerCase().replace(/\s+/g, "_");
  if (s === "active") return "success";
  if (s === "planned") return "info";
  if (s === "completed") return "default";
  return "default";
}

function PromoStatusChip({ status }: { status: string }) {
  return <Chip size="small" label={status || "—"} color={promoStatusChipColor(status)} sx={{ height: 22, fontSize: 11 }} />;
}

function weekSeries(startWeek: string, endWeek: string): string[] {
  const start = new Date(`${startWeek}T12:00:00Z`);
  const end = new Date(`${endWeek}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return startWeek ? [startWeek] : [];
  }
  const weeks: string[] = [];
  const step = 7 * 24 * 60 * 60 * 1000;
  for (let t = start.getTime(); t <= end.getTime(); t += step) {
    weeks.push(new Date(t).toISOString().slice(0, 10));
  }
  return weeks;
}

type IntegrationPlanRow = {
  id: string;
  promo_id: string;
  promo_name: string;
  sku: string;
  location: string;
  forecast_week: string;
  planned_lift_qty: number;
  trade_spend_share: number;
  status: string;
};

export default function DemandTradePromotionPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const filtersKey = globalFiltersKey(filters);
  const params = useMemo(() => buildDemandParams(filters), [filtersKey]);

  const { data: promotionData, isLoading: promotionLoading } = useQuery<DemandPromotionResponse>({
    queryKey: ["demand-promotions-trade", filtersKey],
    queryFn: () => fetchDemandPromotions(params),
  });

  const rows = promotionData?.rows ?? [];
  const [tab, setTab] = useState(0);

  const kpis = useMemo(() => {
    let active = 0;
    let planned = 0;
    let roiSum = 0;
    let roiN = 0;
    let tradeSpend = 0;
    let liftVol = 0;
    for (const r of rows) {
      const st = String(r.status || "").toLowerCase().replace(/\s+/g, "_");
      if (st === "active") active += 1;
      if (st === "planned") planned += 1;
      const roi = Number(r.roi);
      if (!Number.isNaN(roi)) {
        roiSum += roi;
        roiN += 1;
      }
      tradeSpend += Number(r.trade_spend) || 0;
      liftVol += Number(r.lift_volume) || 0;
    }
    return {
      total: rows.length,
      active,
      planned,
      avgRoi: roiN ? roiSum / roiN : 0,
      tradeSpend,
      liftVol,
    };
  }, [rows]);

  const promotionColumns = useMemo<GridColDef<DemandPromotionRecord>[]>(
    () => [
      { field: "promo_id", headerName: "Promo ID", minWidth: 100, flex: 0.75 },
      { field: "promo_name", headerName: "Promo Name", minWidth: 140, flex: 1 },
      { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.85 },
      { field: "location", headerName: "Location", minWidth: 110, flex: 0.8 },
      { field: "customer", headerName: "Customer", minWidth: 120, flex: 0.85 },
      { field: "customer_type", headerName: "Customer Type", minWidth: 120, flex: 0.8 },
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
      {
        field: "syndicated_source",
        headerName: "Syndicated Source",
        minWidth: 130,
        flex: 0.9,
        valueFormatter: (v) => (v == null || v === "" ? "—" : String(v)),
      },
      {
        field: "historical_performance",
        headerName: "Historical Performance",
        type: "number",
        minWidth: 140,
        flex: 0.85,
        valueFormatter: (v) => (v == null ? "—" : Number(v).toFixed(2)),
      },
    ],
    [],
  );

  // Aggregate promotion metrics by week for the time-phased workbench
  const promoByWeek = useMemo(() => {
    const weekMap = new Map<string, { baseVol: number; liftVol: number; tradeSpend: number; activeCount: number; roiSum: number; roiN: number }>();
    for (const r of rows) {
      const weeks = weekSeries(r.start_week, r.end_week);
      const wn = weeks.length || 1;
      const perWeekBase = (Number(r.base_volume) || 0) / wn;
      const perWeekLift = (Number(r.lift_volume) || 0) / wn;
      const perWeekSpend = (Number(r.trade_spend) || 0) / wn;
      const roi = Number(r.roi) || 0;
      for (const w of weeks) {
        const cur = weekMap.get(w) ?? { baseVol: 0, liftVol: 0, tradeSpend: 0, activeCount: 0, roiSum: 0, roiN: 0 };
        cur.baseVol += perWeekBase;
        cur.liftVol += perWeekLift;
        cur.tradeSpend += perWeekSpend;
        cur.activeCount += 1;
        cur.roiSum += roi;
        cur.roiN += 1;
        weekMap.set(w, cur);
      }
    }
    return [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, v]) => ({
        week,
        weekLabel: week.slice(5),
        baseVol: v.baseVol,
        liftVol: v.liftVol,
        tradeSpend: v.tradeSpend,
        totalVol: v.baseVol + v.liftVol,
        activeCount: v.activeCount,
        avgRoi: v.roiN ? v.roiSum / v.roiN : 0,
      }));
  }, [rows]);

  const liftByPromotion = useMemo(() => {
    return rows.map((r) => ({
      name: `${r.promo_id}`.slice(0, 14),
      fullName: r.promo_name,
      lift: Number(r.lift_volume) || 0,
    }));
  }, [rows]);

  const roiVsSpend = useMemo(() => {
    return rows.map((r) => ({
      promo_id: r.promo_id,
      promo_name: r.promo_name,
      trade_spend: Number(r.trade_spend) || 0,
      roi: Number(r.roi) || 0,
      lift_volume: Number(r.lift_volume) || 0,
    }));
  }, [rows]);

  const integrationRows = useMemo((): IntegrationPlanRow[] => {
    const out: IntegrationPlanRow[] = [];
    for (const r of rows) {
      const weeks = weekSeries(r.start_week, r.end_week);
      const wn = weeks.length || 1;
      const lift = Number(r.lift_volume) || 0;
      const spend = Number(r.trade_spend) || 0;
      const perWeekLift = lift / wn;
      const perWeekSpend = spend / wn;
      for (const w of weeks) {
        out.push({
          id: `${r.id}-${w}`,
          promo_id: r.promo_id,
          promo_name: r.promo_name,
          sku: r.sku,
          location: r.location,
          forecast_week: w,
          planned_lift_qty: perWeekLift,
          trade_spend_share: perWeekSpend,
          status: r.status,
        });
      }
    }
    return out.sort((a, b) => a.forecast_week.localeCompare(b.forecast_week) || a.promo_id.localeCompare(b.promo_id));
  }, [rows]);

  const integrationSummaryByWeek = useMemo(() => {
    const liftMap = new Map<string, number>();
    const spendMap = new Map<string, number>();
    for (const r of integrationRows) {
      liftMap.set(r.forecast_week, (liftMap.get(r.forecast_week) ?? 0) + r.planned_lift_qty);
      spendMap.set(r.forecast_week, (spendMap.get(r.forecast_week) ?? 0) + r.trade_spend_share);
    }
    const sorted = [...liftMap.keys()].sort();
    let cumulative = 0;
    return sorted.map((week) => {
      const plannedLift = liftMap.get(week) ?? 0;
      cumulative += plannedLift;
      return { week, plannedLift, tradeSpend: spendMap.get(week) ?? 0, cumulativeLift: cumulative };
    });
  }, [integrationRows]);

  const integrationColumns = useMemo<GridColDef<IntegrationPlanRow>[]>(
    () => [
      { field: "promo_id", headerName: "Promo ID", minWidth: 100, flex: 0.75 },
      { field: "promo_name", headerName: "Promo Name", minWidth: 130, flex: 1 },
      { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.85 },
      { field: "location", headerName: "Location", minWidth: 110, flex: 0.8 },
      { field: "forecast_week", headerName: "Forecast Week (IBP)", minWidth: 130, flex: 0.85 },
      {
        field: "planned_lift_qty",
        headerName: "Planned promo lift",
        type: "number",
        minWidth: 130,
        flex: 0.85,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })),
      },
      {
        field: "trade_spend_share",
        headerName: "Trade spend (week share)",
        type: "number",
        minWidth: 150,
        flex: 0.9,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })),
      },
      {
        field: "status",
        headerName: "Promo status",
        minWidth: 110,
        flex: 0.7,
        renderCell: (p: GridRenderCellParams<IntegrationPlanRow>) => <PromoStatusChip status={String(p.value ?? "")} />,
      },
    ],
    [],
  );

  return (
    <div className="page-scroll">
      <SectionCard title="Trade Promotion Management" subtitle="TPM programs, lift analytics, and IBP demand-plan integration">
        <Stack spacing={1}>
          <KpiCardRow>
            <KpiCard
              tone="network"
              icon={<CampaignOutlinedIcon fontSize="small" />}
              title="Total Promotions"
              value={promotionLoading ? "…" : String(kpis.total)}
            />
            <KpiCard
              tone="demand"
              icon={<EventAvailableOutlinedIcon fontSize="small" />}
              title="Active"
              value={promotionLoading ? "…" : String(kpis.active)}
            />
            <KpiCard
              tone="critical"
              icon={<CalendarMonthOutlinedIcon fontSize="small" />}
              title="Planned"
              value={promotionLoading ? "…" : String(kpis.planned)}
            />
            <KpiCard
              tone="money"
              icon={<InsightsOutlinedIcon fontSize="small" />}
              title="Avg ROI"
              value={promotionLoading ? "…" : kpis.avgRoi.toFixed(2)}
            />
            <KpiCard
              tone="money"
              icon={<AttachMoneyOutlinedIcon fontSize="small" />}
              title="Total Trade Spend"
              value={promotionLoading ? "…" : Math.round(kpis.tradeSpend).toLocaleString()}
            />
            <KpiCard
              tone="demand"
              icon={<TrendingUpOutlinedIcon fontSize="small" />}
              title="Total Lift Volume"
              value={promotionLoading ? "…" : Math.round(kpis.liftVol).toLocaleString()}
            />
          </KpiCardRow>

          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}>
            <Tab label="Promotion Calendar" />
            <Tab label="Lift Analysis" />
            <Tab label="TPM-IBP Integration" />
          </Tabs>

          {tab === 0 ? (
            <Stack spacing={1}>
              <SectionCard title="Promotion calendar workbench" subtitle={`${promoByWeek.length} weeks · ${rows.length} promotions`}>
                {/* Time-phased chart */}
                <Box className="content-card" sx={{ p: 1.5, mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                    Weekly promotion volume & spend
                  </Typography>
                  <div className="chart-shell">
                    <LineChart
                      chartId="demand-tpm-weekly-volume"
                      data={promoByWeek}
                      xKey="weekLabel"
                      height={280}
                      series={[
                        { field: "baseVol", label: "Base Volume", type: "bar", color: "#2563eb" },
                        { field: "liftVol", label: "Lift Volume", type: "bar", color: "#16a34a" },
                        { field: "tradeSpend", label: "Trade Spend", type: "line", color: "#f59e0b", strokeWidth: 2 },
                        { field: "avgRoi", label: "Avg ROI", type: "line", color: "#7c3aed", strokeWidth: 2, strokeDasharray: "dashed" },
                      ]}
                    />
                  </div>
                </Box>

                {/* Transposed time-phased grid */}
                <Box sx={{ overflowX: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={{ position: "sticky", left: 0, background: "#f8fafc", padding: "6px 12px", textAlign: "left", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap", minWidth: 140, fontWeight: 600 }}>
                          Metric
                        </th>
                        {promoByWeek.map((d) => (
                          <th key={d.week} style={{ padding: "6px 10px", textAlign: "right", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap", fontSize: 10, fontWeight: 500 }}>
                            {d.weekLabel}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        { label: "Base Volume", key: "baseVol" as const, fmt: (v: number) => Math.round(v).toLocaleString() },
                        { label: "Lift Volume", key: "liftVol" as const, fmt: (v: number) => Math.round(v).toLocaleString() },
                        { label: "Total Volume", key: "totalVol" as const, fmt: (v: number) => Math.round(v).toLocaleString() },
                        { label: "Trade Spend", key: "tradeSpend" as const, fmt: (v: number) => `$${Math.round(v).toLocaleString()}` },
                        { label: "Active Promos", key: "activeCount" as const, fmt: (v: number) => String(v) },
                        { label: "Avg ROI", key: "avgRoi" as const, fmt: (v: number) => v.toFixed(2) },
                      ] as const).map((metric) => (
                        <tr key={metric.label}>
                          <td style={{ position: "sticky", left: 0, background: "#fff", padding: "5px 12px", fontWeight: metric.label === "Total Volume" ? 600 : 400, borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>
                            {metric.label}
                          </td>
                          {promoByWeek.map((d) => (
                            <td
                              key={d.week}
                              style={{
                                padding: "5px 10px",
                                textAlign: "right",
                                borderBottom: "1px solid #f1f5f9",
                                fontWeight: metric.label === "Total Volume" ? 600 : 400,
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {metric.fmt(d[metric.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </SectionCard>

              {/* Detail grid below */}
              <SectionCard title="Promotion detail" subtitle="All promotions with full attributes">
                <div className="maintenance-grid-shell" style={{ height: 400 }}>
                  <SmartDataGrid
                    rows={rows}
                    columns={promotionColumns}
                    loading={promotionLoading}
                    disableRowSelectionOnClick
                    getRowId={(row) => row.id}
                    pageSizeOptions={[10, 25, 50, 100]}
                    initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                    sx={{ border: 0, ...compactSx }}
                    exportFileName="demand-trade-promotions-calendar"
                    slotProps={{ toolbar: { exportFileName: "demand-trade-promotions-calendar" } }}
                  />
                </div>
              </SectionCard>
            </Stack>
          ) : null}

          {tab === 1 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Lift volume by promotion
              </Typography>
              <div className="chart-shell" style={{ minHeight: 320 }}>
                <BarChart
                  chartId="demand-tpm-lift-by-promotion"
                  data={liftByPromotion}
                  xKey="name"
                  height={320}
                  series={[{ field: "lift", label: "Lift volume", color: "#2563eb" }]}
                />
              </div>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                ROI vs trade spend
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Bubble area reflects lift volume (larger promotions).
              </Typography>
              <div className="chart-shell" style={{ minHeight: 320 }}>
                <ScatterChart
                  chartId="demand-tpm-roi-vs-spend"
                  data={roiVsSpend}
                  xField="trade_spend"
                  yField="roi"
                  sizeField="lift_volume"
                  xLabel="Trade spend"
                  yLabel="ROI"
                  height={320}
                  defaultColor="#7c3aed"
                  tooltipFields={["promo_id", "promo_name"]}
                  aliasOf={(f) =>
                    f === "trade_spend" ? "Trade spend" :
                    f === "roi" ? "ROI" :
                    f === "lift_volume" ? "Lift volume" :
                    f === "promo_id" ? "Promo ID" :
                    f === "promo_name" ? "Promo name" : f
                  }
                />
              </div>
            </Stack>
          ) : null}

          {tab === 2 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Promotional lift flowing into demand forecast weeks
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Each promotion’s lift is spread evenly across its active weeks and appears as planned incremental volume in the IBP horizon.
              </Typography>
              <div className="chart-shell" style={{ minHeight: 320 }}>
                <LineChart
                  chartId="demand-tpm-ibp-integration"
                  data={integrationSummaryByWeek}
                  xKey="week"
                  height={320}
                  series={[
                    { field: "plannedLift", label: "Planned Lift", type: "bar", color: "#0d9488" },
                    { field: "tradeSpend", label: "Trade Spend Share", type: "bar", color: "#f59e0b" },
                    { field: "cumulativeLift", label: "Cumulative Lift", type: "line", color: "#2563eb", strokeWidth: 2 },
                  ]}
                />
              </div>

              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Time-phased integration summary
              </Typography>
              <Box sx={{ overflowX: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          position: "sticky",
                          left: 0,
                          background: "#f5f5f5",
                          padding: "6px 12px",
                          textAlign: "left",
                          borderBottom: "2px solid #e0e0e0",
                          whiteSpace: "nowrap",
                          minWidth: 130,
                        }}
                      >
                        Metric
                      </th>
                      {integrationSummaryByWeek.map((d) => (
                        <th
                          key={d.week}
                          style={{
                            padding: "6px 10px",
                            textAlign: "right",
                            borderBottom: "2px solid #e0e0e0",
                            whiteSpace: "nowrap",
                            fontSize: 10,
                          }}
                        >
                          {d.week}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td
                        style={{
                          position: "sticky",
                          left: 0,
                          background: "#fff",
                          padding: "5px 12px",
                          fontWeight: 600,
                          borderBottom: "1px solid #f0f0f0",
                          whiteSpace: "nowrap",
                          color: "#0d9488",
                        }}
                      >
                        Planned Lift
                      </td>
                      {integrationSummaryByWeek.map((d) => (
                        <td key={d.week} style={{ padding: "5px 10px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>
                          {d.plannedLift.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td
                        style={{
                          position: "sticky",
                          left: 0,
                          background: "#fff",
                          padding: "5px 12px",
                          fontWeight: 600,
                          borderBottom: "1px solid #f0f0f0",
                          whiteSpace: "nowrap",
                          color: "#f59e0b",
                        }}
                      >
                        Trade Spend
                      </td>
                      {integrationSummaryByWeek.map((d) => (
                        <td key={d.week} style={{ padding: "5px 10px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>
                          {d.tradeSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td
                        style={{
                          position: "sticky",
                          left: 0,
                          background: "#fff",
                          padding: "5px 12px",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: "#2563eb",
                        }}
                      >
                        Cumulative Lift
                      </td>
                      {integrationSummaryByWeek.map((d) => (
                        <td key={d.week} style={{ padding: "5px 10px", textAlign: "right" }}>
                          {d.cumulativeLift.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </Box>

              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Week-level integration detail
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 440 }}>
                <SmartDataGrid
                  rows={integrationRows}
                  columns={integrationColumns}
                  loading={promotionLoading}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50, 100]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-tpm-ibp-integration"
                  slotProps={{
                    toolbar: { exportFileName: "demand-tpm-ibp-integration" },
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
