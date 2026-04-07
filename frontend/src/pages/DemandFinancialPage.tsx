import AccountBalanceOutlinedIcon from "@mui/icons-material/AccountBalanceOutlined";
import AttachMoneyOutlinedIcon from "@mui/icons-material/AttachMoneyOutlined";
import PercentOutlinedIcon from "@mui/icons-material/PercentOutlined";
import SavingsOutlinedIcon from "@mui/icons-material/SavingsOutlined";
import { Box, Stack, Tab, Tabs, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { type GridColDef } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ShellContextValue } from "../components/layout/AppShellLayout";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { fetchFinancialPlans } from "../services/api";
import type { FinancialPlanRecord, FinancialPlanResponse } from "../types";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";

const compactSx = { fontSize: 11, "& .MuiDataGrid-cell": { py: 0.25 }, "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 } } as const;

function buildFinancialParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), filters);
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type SkuSummaryRow = {
  id: string;
  sku: string;
  revenue: number;
  cogs: number;
  gross_margin: number;
  volume_units: number;
  margin_pct: number;
};

export default function DemandFinancialPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const filtersKey = globalFiltersKey(filters);
  const params = useMemo(() => buildFinancialParams(filters), [filtersKey]);

  const { data, isLoading } = useQuery<FinancialPlanResponse>({
    queryKey: ["demand-financial-plans", filtersKey],
    queryFn: () => fetchFinancialPlans(params),
  });

  const rows = data?.rows ?? [];
  const [tab, setTab] = useState(0);

  const kpis = useMemo(() => {
    if (data) {
      return {
        totalRevenue: data.total_revenue,
        totalCogs: data.total_cogs,
        totalMargin: data.total_margin,
        avgMarginPct: data.avg_margin_pct,
      };
    }
    let revenue = 0;
    let cogs = 0;
    let margin = 0;
    let marginPctSum = 0;
    let marginPctCount = 0;
    for (const r of rows) {
      revenue += Number(r.revenue) || 0;
      cogs += Number(r.cogs) || 0;
      margin += Number(r.gross_margin) || 0;
      if (r.margin_pct != null && !Number.isNaN(Number(r.margin_pct))) {
        marginPctSum += Number(r.margin_pct);
        marginPctCount += 1;
      }
    }
    return {
      totalRevenue: revenue,
      totalCogs: cogs,
      totalMargin: margin,
      avgMarginPct: marginPctCount ? marginPctSum / marginPctCount : 0,
    };
  }, [data, rows]);

  const plColumns = useMemo<GridColDef<FinancialPlanRecord>[]>(
    () => [
      { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.85 },
      { field: "location", headerName: "Location", minWidth: 110, flex: 0.8 },
      { field: "month", headerName: "Month", minWidth: 100, flex: 0.72 },
      {
        field: "volume_units",
        headerName: "Volume Units",
        type: "number",
        minWidth: 110,
        flex: 0.75,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "revenue",
        headerName: "Revenue",
        type: "number",
        minWidth: 100,
        flex: 0.72,
        valueFormatter: (v) => (v == null ? "" : fmtMoney(Number(v))),
      },
      {
        field: "cogs",
        headerName: "COGS",
        type: "number",
        minWidth: 100,
        flex: 0.72,
        valueFormatter: (v) => (v == null ? "" : fmtMoney(Number(v))),
      },
      {
        field: "gross_margin",
        headerName: "Gross Margin",
        type: "number",
        minWidth: 115,
        flex: 0.78,
        valueFormatter: (v) => (v == null ? "" : fmtMoney(Number(v))),
      },
      {
        field: "margin_pct",
        headerName: "Margin %",
        type: "number",
        minWidth: 90,
        flex: 0.6,
        valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(1)}%`),
      },
      {
        field: "trade_spend",
        headerName: "Trade Spend",
        type: "number",
        minWidth: 105,
        flex: 0.72,
        valueFormatter: (v) => (v == null ? "" : fmtMoney(Number(v))),
      },
      {
        field: "net_revenue",
        headerName: "Net Revenue",
        type: "number",
        minWidth: 110,
        flex: 0.75,
        valueFormatter: (v) => (v == null ? "" : fmtMoney(Number(v))),
      },
      { field: "plan_type", headerName: "Plan Type", minWidth: 100, flex: 0.7 },
      { field: "version", headerName: "Version", minWidth: 90, flex: 0.65 },
    ],
    [],
  );

  const revenueCogsByMonth = useMemo(() => {
    const map = new Map<string, { month: string; revenue: number; cogs: number; grossMargin: number; tradeSpend: number; netRevenue: number }>();
    for (const r of rows) {
      const m = r.month;
      const cur = map.get(m) ?? { month: m, revenue: 0, cogs: 0, grossMargin: 0, tradeSpend: 0, netRevenue: 0 };
      cur.revenue += Number(r.revenue) || 0;
      cur.cogs += Number(r.cogs) || 0;
      cur.grossMargin += Number(r.gross_margin) || 0;
      cur.tradeSpend += Number(r.trade_spend) || 0;
      cur.netRevenue += Number(r.net_revenue) || 0;
      map.set(m, cur);
    }
    return [...map.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((d) => ({
        ...d,
        marginPct: d.revenue > 0 ? ((d.revenue - d.cogs) / d.revenue) * 100 : 0,
      }));
  }, [rows]);

  const revenueBySku = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.sku, (map.get(r.sku) ?? 0) + (Number(r.revenue) || 0));
    }
    return [...map.entries()]
      .map(([sku, revenue]) => ({ sku, revenue }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  const skuSummaryRows = useMemo((): SkuSummaryRow[] => {
    const map = new Map<string, { revenue: number; cogs: number; gross_margin: number; volume_units: number }>();
    for (const r of rows) {
      const cur = map.get(r.sku) ?? { revenue: 0, cogs: 0, gross_margin: 0, volume_units: 0 };
      cur.revenue += Number(r.revenue) || 0;
      cur.cogs += Number(r.cogs) || 0;
      cur.gross_margin += Number(r.gross_margin) || 0;
      cur.volume_units += Number(r.volume_units) || 0;
      map.set(r.sku, cur);
    }
    return [...map.entries()].map(([sku, agg]) => ({
      id: sku,
      sku,
      revenue: agg.revenue,
      cogs: agg.cogs,
      gross_margin: agg.gross_margin,
      volume_units: agg.volume_units,
      margin_pct: agg.revenue > 0 ? (agg.gross_margin / agg.revenue) * 100 : 0,
    }));
  }, [rows]);

  const skuSummaryColumns = useMemo<GridColDef<SkuSummaryRow>[]>(
    () => [
      { field: "sku", headerName: "SKU", minWidth: 120, flex: 1 },
      {
        field: "revenue",
        headerName: "Revenue",
        type: "number",
        minWidth: 110,
        flex: 0.85,
        valueFormatter: (v) => (v == null ? "" : fmtMoney(Number(v))),
      },
      {
        field: "cogs",
        headerName: "COGS",
        type: "number",
        minWidth: 100,
        flex: 0.75,
        valueFormatter: (v) => (v == null ? "" : fmtMoney(Number(v))),
      },
      {
        field: "gross_margin",
        headerName: "Gross Margin",
        type: "number",
        minWidth: 115,
        flex: 0.85,
        valueFormatter: (v) => (v == null ? "" : fmtMoney(Number(v))),
      },
      {
        field: "margin_pct",
        headerName: "Margin %",
        type: "number",
        minWidth: 90,
        flex: 0.65,
        valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(1)}%`),
      },
      {
        field: "volume_units",
        headerName: "Volume Units",
        type: "number",
        minWidth: 110,
        flex: 0.8,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
    ],
    [],
  );

  const forecastRows = useMemo(
    () => rows.filter((r) => String(r.plan_type || "").toLowerCase() === "forecast"),
    [rows],
  );

  const actualRows = useMemo(
    () => rows.filter((r) => String(r.plan_type || "").toLowerCase() === "actual"),
    [rows],
  );

  const forecastVsActualByMonth = useMemo(() => {
    const months = new Set<string>();
    const fcMap = new Map<string, number>();
    const actMap = new Map<string, number>();
    for (const r of rows) {
      const pt = String(r.plan_type || "").toLowerCase();
      if (pt === "forecast") {
        months.add(r.month);
        fcMap.set(r.month, (fcMap.get(r.month) ?? 0) + (Number(r.revenue) || 0));
      } else if (pt === "actual") {
        months.add(r.month);
        actMap.set(r.month, (actMap.get(r.month) ?? 0) + (Number(r.revenue) || 0));
      }
    }
    return [...months].sort((a, b) => a.localeCompare(b)).map((month) => {
      const fc = fcMap.get(month) ?? 0;
      const act = actMap.get(month) ?? 0;
      return {
        month,
        forecast: fc,
        actual: act,
        variance: fc - act,
        variancePct: act > 0 ? ((fc - act) / act) * 100 : 0,
      };
    });
  }, [rows]);

  return (
    <div className="page-scroll">
      <SectionCard title="Financial Planning" subtitle="Revenue, COGS, and margin projections by SKU, location, and plan version">
        <Stack spacing={1}>
          <KpiCardRow>
            <KpiCard
              tone="money"
              icon={<AttachMoneyOutlinedIcon fontSize="small" />}
              title="Total Revenue"
              value={isLoading ? "…" : fmtMoney(kpis.totalRevenue)}
            />
            <KpiCard
              tone="critical"
              icon={<SavingsOutlinedIcon fontSize="small" />}
              title="Total COGS"
              value={isLoading ? "…" : fmtMoney(kpis.totalCogs)}
            />
            <KpiCard
              tone="network"
              icon={<AccountBalanceOutlinedIcon fontSize="small" />}
              title="Total Margin"
              value={isLoading ? "…" : fmtMoney(kpis.totalMargin)}
            />
            <KpiCard
              tone="demand"
              icon={<PercentOutlinedIcon fontSize="small" />}
              title="Avg Margin %"
              value={isLoading ? "…" : `${Number(kpis.avgMarginPct).toFixed(1)}%`}
              sub="Portfolio average from API or loaded rows"
            />
          </KpiCardRow>

          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}>
            <Tab label="P&L Overview" />
            <Tab label="Revenue by SKU" />
            <Tab label="Forecast vs Actual" />
          </Tabs>

          {tab === 0 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Revenue vs COGS by month
              </Typography>
              <div className="chart-shell" style={{ minHeight: 340 }}>
                <ResponsiveContainer width="100%" height={360}>
                  <ComposedChart data={revenueCogsByMonth} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip
                      formatter={(v: number, name: string) =>
                        name === "Margin %" ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v))
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#2563eb" radius={[3, 3, 0, 0]} barSize={18} />
                    <Bar yAxisId="left" dataKey="cogs" name="COGS" fill="#dc2626" radius={[3, 3, 0, 0]} barSize={18} />
                    <Line yAxisId="left" type="monotone" dataKey="grossMargin" name="Gross Margin" stroke="#16a34a" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="marginPct" name="Margin %" stroke="#16a34a" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Time-phased P&amp;L
              </Typography>
              <Box sx={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e0e0e0" }}>
                      <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, position: "sticky", left: 0, background: "#fff", minWidth: 120 }}>
                        Metric
                      </th>
                      {revenueCogsByMonth.map((d) => (
                        <th key={d.month} style={{ textAlign: "right", padding: "6px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {d.month}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(["Revenue", "COGS", "Gross Margin", "Margin %", "Trade Spend", "Net Revenue"] as const).map((metric, idx) => (
                      <tr key={metric} style={{ borderBottom: "1px solid #eee", background: idx % 2 === 0 ? alpha("#f5f5f5", 0.5) : "transparent" }}>
                        <td style={{ padding: "5px 10px", fontWeight: 600, position: "sticky", left: 0, background: idx % 2 === 0 ? "#fafafa" : "#fff" }}>
                          {metric}
                        </td>
                        {revenueCogsByMonth.map((d) => {
                          const val =
                            metric === "Revenue" ? d.revenue
                            : metric === "COGS" ? d.cogs
                            : metric === "Gross Margin" ? d.grossMargin
                            : metric === "Margin %" ? d.marginPct
                            : metric === "Trade Spend" ? d.tradeSpend
                            : d.netRevenue;
                          const isMarginRow = metric === "Margin %" || metric === "Gross Margin";
                          const cellColor =
                            isMarginRow && d.marginPct > 30 ? "#16a34a"
                            : isMarginRow && d.marginPct < 15 ? "#dc2626"
                            : undefined;
                          return (
                            <td
                              key={d.month}
                              style={{
                                textAlign: "right",
                                padding: "5px 10px",
                                color: cellColor,
                                fontWeight: isMarginRow ? 700 : undefined,
                              }}
                            >
                              {metric === "Margin %" ? `${val.toFixed(1)}%` : fmtMoney(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>

              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                P&amp;L detail
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 420 }}>
                <SmartDataGrid
                  rows={rows}
                  columns={plColumns}
                  loading={isLoading}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50, 100]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-financial-pl"
                  slotProps={{
                    toolbar: { exportFileName: "demand-financial-pl" } as never,
                  }}
                />
              </div>
            </Stack>
          ) : null}

          {tab === 1 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Revenue by SKU
              </Typography>
              <div className="chart-shell" style={{ minHeight: 300 }}>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={revenueBySku} margin={{ top: 8, right: 16, left: 0, bottom: 56 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="sku" tick={{ fontSize: 10 }} interval={0} angle={-28} textAnchor="end" height={64} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => fmtMoney(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="revenue" name="Revenue" fill="#2679A8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                SKU summary
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 400 }}>
                <SmartDataGrid
                  rows={skuSummaryRows}
                  columns={skuSummaryColumns}
                  loading={isLoading}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-financial-sku-summary"
                  slotProps={{
                    toolbar: { exportFileName: "demand-financial-sku-summary" } as never,
                  }}
                />
              </div>
            </Stack>
          ) : null}

          {tab === 2 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Forecast vs Actual
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Bars compare forecast and actual revenue by month; dashed line shows variance.
              </Typography>
              <div className="chart-shell" style={{ minHeight: 320 }}>
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={forecastVsActualByMonth} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v: number, name: string) =>
                        name === "Variance %" ? `${Number(v).toFixed(1)}%` : fmtMoney(Number(v))
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="forecast" name="Forecast Revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="left" dataKey="actual" name="Actual Revenue" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="variance" name="Variance" stroke="#dc2626" strokeWidth={2} strokeDasharray="6 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Forecast vs Actual by month
              </Typography>
              <Box sx={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e0e0e0" }}>
                      <th style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, position: "sticky", left: 0, background: "#fff", minWidth: 140 }}>
                        Metric
                      </th>
                      {forecastVsActualByMonth.map((d) => (
                        <th key={d.month} style={{ textAlign: "right", padding: "6px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {d.month}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(["Forecast Revenue", "Actual Revenue", "Variance", "Variance %"] as const).map((metric, idx) => (
                      <tr key={metric} style={{ borderBottom: "1px solid #eee", background: idx % 2 === 0 ? alpha("#f5f5f5", 0.5) : "transparent" }}>
                        <td style={{ padding: "5px 10px", fontWeight: 600, position: "sticky", left: 0, background: idx % 2 === 0 ? "#fafafa" : "#fff" }}>
                          {metric}
                        </td>
                        {forecastVsActualByMonth.map((d) => {
                          const val =
                            metric === "Forecast Revenue" ? d.forecast
                            : metric === "Actual Revenue" ? d.actual
                            : metric === "Variance" ? d.variance
                            : d.variancePct;
                          const isVar = metric === "Variance" || metric === "Variance %";
                          const cellColor = isVar
                            ? d.variance > 0 ? "#dc2626" : d.variance < 0 ? "#16a34a" : undefined
                            : undefined;
                          return (
                            <td
                              key={d.month}
                              style={{
                                textAlign: "right",
                                padding: "5px 10px",
                                color: cellColor,
                                fontWeight: isVar ? 700 : undefined,
                              }}
                            >
                              {metric === "Variance %" ? `${val.toFixed(1)}%` : fmtMoney(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>

              <Box
                sx={{
                  display: "grid",
                  gap: 1,
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                }}
              >
                <Box>
                  <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                    Forecast
                  </Typography>
                  <div className="maintenance-grid-shell" style={{ height: 360 }}>
                    <SmartDataGrid
                      rows={forecastRows}
                      columns={plColumns}
                      loading={isLoading}
                      disableRowSelectionOnClick
                      getRowId={(row) => row.id}
                      pageSizeOptions={[10, 25, 50]}
                      initialState={{ pagination: { paginationModel: { pageSize: 15, page: 0 } } }}
                      sx={{ border: 0, ...compactSx }}
                      exportFileName="demand-financial-forecast"
                      slotProps={{
                        toolbar: { exportFileName: "demand-financial-forecast" } as never,
                      }}
                    />
                  </div>
                </Box>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                    Actual
                  </Typography>
                  <div className="maintenance-grid-shell" style={{ height: 360 }}>
                    <SmartDataGrid
                      rows={actualRows}
                      columns={plColumns}
                      loading={isLoading}
                      disableRowSelectionOnClick
                      getRowId={(row) => row.id}
                      pageSizeOptions={[10, 25, 50]}
                      initialState={{ pagination: { paginationModel: { pageSize: 15, page: 0 } } }}
                      sx={{ border: 0, ...compactSx }}
                      exportFileName="demand-financial-actual"
                      slotProps={{
                        toolbar: { exportFileName: "demand-financial-actual" } as never,
                      }}
                    />
                  </div>
                </Box>
              </Box>
            </Stack>
          ) : null}
        </Stack>
      </SectionCard>
    </div>
  );
}
