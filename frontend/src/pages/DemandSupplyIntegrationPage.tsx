import BalanceOutlinedIcon from "@mui/icons-material/BalanceOutlined";
import InventoryOutlinedIcon from "@mui/icons-material/InventoryOutlined";
import PercentOutlinedIcon from "@mui/icons-material/PercentOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import { Box, Chip, Stack, Tab, Tabs, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { LineChart } from "../charts";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { fetchDemandForecasts, fetchReplenishmentOrders } from "../services/api";
import type { DemandForecastRecord, DemandForecastResponse, ReplenishmentOrderRecord, ReplenishmentOrdersResponse } from "../types";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";

const compactSx = { fontSize: 11, "& .MuiDataGrid-cell": { py: 0.25 }, "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 } } as const;

function buildParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), filters);
}

function skuLocationKey(sku: string, location: string) {
  return `${sku}||${location}`;
}

type GapGridRow = {
  id: string;
  sku: string;
  location: string;
  week_start: string;
  demand_qty: number;
  supply_qty: number;
  gap_qty: number;
  coverage_pct: number;
};

type CapacityLocationRow = {
  id: string;
  location: string;
  constrained_orders: number;
  production_flags: string;
  logistics_flags: string;
  total_order_qty: number;
};

type AlignmentGridRow = {
  id: string;
  order_id: string;
  sku: string;
  ship_to_node_id: string;
  order_qty: number;
  planned_demand: number;
  delta: number;
  alignment: string;
};

function alignmentChipColor(status: string): "success" | "warning" | "error" | "default" {
  const s = String(status || "").toLowerCase();
  if (s === "aligned" || s === "covered") return "success";
  if (s === "partial") return "warning";
  if (s === "short" || s === "gap") return "error";
  return "default";
}

function AlignmentChip({ status }: { status: string }) {
  return <Chip size="small" label={status || "—"} color={alignmentChipColor(status)} sx={{ height: 22, fontSize: 11 }} />;
}

export default function DemandSupplyIntegrationPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const filtersKey = globalFiltersKey(filters);
  const params = useMemo(() => buildParams(filters), [filtersKey]);

  const { data: forecastData, isLoading: forecastLoading } = useQuery<DemandForecastResponse>({
    queryKey: ["demand-supply-forecasts", filtersKey],
    queryFn: () => fetchDemandForecasts(params),
  });

  const { data: ordersData, isLoading: ordersLoading } = useQuery<ReplenishmentOrdersResponse>({
    queryKey: ["demand-supply-orders", filtersKey],
    queryFn: () => fetchReplenishmentOrders(params),
  });

  const forecastRows = forecastData?.rows ?? [];
  const orderRows = ordersData?.rows ?? [];
  const [tab, setTab] = useState(0);

  const totalSupplyBySkuLoc = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orderRows) {
      const sku = String(o.sku ?? "").trim();
      const loc = String(o.ship_to_node_id ?? "").trim();
      if (!sku || !loc) continue;
      const key = skuLocationKey(sku, loc);
      map.set(key, (map.get(key) ?? 0) + (Number(o.order_qty) || 0));
    }
    return map;
  }, [orderRows]);

  const totalDemandBySkuLoc = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of forecastRows) {
      const key = skuLocationKey(r.sku, r.location);
      map.set(key, (map.get(key) ?? 0) + (Number(r.final_forecast_qty) || 0));
    }
    return map;
  }, [forecastRows]);

  const gapRows = useMemo((): GapGridRow[] => {
    return forecastRows.map((r: DemandForecastRecord) => {
      const key = skuLocationKey(r.sku, r.location);
      const demand = Number(r.final_forecast_qty) || 0;
      const totalS = totalSupplyBySkuLoc.get(key) ?? 0;
      const totalD = totalDemandBySkuLoc.get(key) ?? 0;
      const supply = totalD > 0 ? (totalS * demand) / totalD : 0;
      const gap = demand - supply;
      const coverage_pct = demand > 0 ? Math.min(100, (supply / demand) * 100) : 0;
      return {
        id: `${r.id}-gap`,
        sku: r.sku,
        location: r.location,
        week_start: r.week_start,
        demand_qty: demand,
        supply_qty: supply,
        gap_qty: gap,
        coverage_pct,
      };
    });
  }, [forecastRows, totalSupplyBySkuLoc, totalDemandBySkuLoc]);

  const gapByWeek = useMemo(() => {
    const map = new Map<string, { week: string; demand: number; supply: number; gap: number }>();
    for (const row of gapRows) {
      const cur = map.get(row.week_start) ?? { week: row.week_start, demand: 0, supply: 0, gap: 0 };
      cur.demand += row.demand_qty;
      cur.supply += row.supply_qty;
      cur.gap += row.gap_qty;
      map.set(row.week_start, cur);
    }
    return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
  }, [gapRows]);

  const gapByWeekWithCoverage = useMemo(
    () =>
      gapByWeek.map((w) => ({
        ...w,
        coverage: w.demand > 0 ? Math.min(100, (w.supply / w.demand) * 100) : 0,
      })),
    [gapByWeek],
  );

  const kpis = useMemo(() => {
    let totalDemand = 0;
    let totalSupply = 0;
    let gapItems = 0;
    for (const row of gapRows) {
      totalDemand += row.demand_qty;
      totalSupply += row.supply_qty;
      if (row.gap_qty > 0.5) gapItems += 1;
    }
    const coveragePct = totalDemand > 0 ? Math.min(100, (totalSupply / totalDemand) * 100) : 0;
    return { totalDemand, totalSupply, coveragePct, gapItems };
  }, [gapRows]);

  const capacityLocationRows = useMemo((): CapacityLocationRow[] => {
    const byLoc = new Map<
      string,
      { constrained_orders: number; production: Set<string>; logistics: Set<string>; total_order_qty: number }
    >();
    for (const o of orderRows) {
      const loc = String(o.ship_to_node_id ?? "").trim();
      if (!loc) continue;
      const prod = String(o.production_impact ?? "").trim();
      const log = String(o.logistics_impact ?? "").trim();
      const constrained = Boolean(prod || log || o.is_exception);
      if (!constrained) continue;
      const cur = byLoc.get(loc) ?? {
        constrained_orders: 0,
        production: new Set<string>(),
        logistics: new Set<string>(),
        total_order_qty: 0,
      };
      cur.constrained_orders += 1;
      cur.total_order_qty += Number(o.order_qty) || 0;
      if (prod) cur.production.add(prod);
      if (log) cur.logistics.add(log);
      byLoc.set(loc, cur);
    }
    return [...byLoc.entries()].map(([location, v], idx) => ({
      id: `cap-${idx}-${location}`,
      location,
      constrained_orders: v.constrained_orders,
      production_flags: [...v.production].slice(0, 3).join("; ") || "—",
      logistics_flags: [...v.logistics].slice(0, 3).join("; ") || "—",
      total_order_qty: v.total_order_qty,
    }));
  }, [orderRows]);

  const capacityConstraintCount = capacityLocationRows.length;

  const alignmentRows = useMemo((): AlignmentGridRow[] => {
    return orderRows
      .filter((o) => String(o.sku ?? "").trim() && String(o.ship_to_node_id ?? "").trim())
      .map((o: ReplenishmentOrderRecord) => {
        const sku = String(o.sku);
        const loc = String(o.ship_to_node_id);
        const key = skuLocationKey(sku, loc);
        const planned = totalDemandBySkuLoc.get(key) ?? 0;
        const qty = Number(o.order_qty) || 0;
        const delta = qty - planned;
        let alignment = "partial";
        if (planned <= 0) alignment = qty > 0 ? "covered" : "—";
        else if (qty >= planned * 0.95) alignment = "aligned";
        else if (qty < planned * 0.95) alignment = "short";
        return {
          id: `${o.order_id}-${sku}-${loc}`,
          order_id: o.order_id,
          sku,
          ship_to_node_id: loc,
          order_qty: qty,
          planned_demand: planned,
          delta,
          alignment,
        };
      });
  }, [orderRows, totalDemandBySkuLoc]);

  const gapColumns = useMemo<GridColDef<GapGridRow>[]>(
    () => [
      { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.9 },
      { field: "location", headerName: "Location", minWidth: 110, flex: 0.85 },
      { field: "week_start", headerName: "Week", minWidth: 100, flex: 0.75 },
      {
        field: "demand_qty",
        headerName: "Demand",
        type: "number",
        minWidth: 100,
        flex: 0.72,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })),
      },
      {
        field: "supply_qty",
        headerName: "Supply (alloc.)",
        type: "number",
        minWidth: 115,
        flex: 0.78,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })),
      },
      {
        field: "gap_qty",
        headerName: "Gap",
        type: "number",
        minWidth: 90,
        flex: 0.6,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })),
      },
      {
        field: "coverage_pct",
        headerName: "Coverage %",
        type: "number",
        minWidth: 95,
        flex: 0.62,
        valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(1)}%`),
      },
    ],
    [],
  );

  const capacityColumns = useMemo<GridColDef<CapacityLocationRow>[]>(
    () => [
      { field: "location", headerName: "Location", minWidth: 120, flex: 1 },
      {
        field: "constrained_orders",
        headerName: "Orders w/ constraint",
        type: "number",
        minWidth: 140,
        flex: 0.75,
      },
      {
        field: "total_order_qty",
        headerName: "Order qty (sum)",
        type: "number",
        minWidth: 120,
        flex: 0.72,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      { field: "production_flags", headerName: "Production impact", minWidth: 160, flex: 1 },
      { field: "logistics_flags", headerName: "Logistics impact", minWidth: 160, flex: 1 },
    ],
    [],
  );

  const alignmentColumns = useMemo<GridColDef<AlignmentGridRow>[]>(
    () => [
      { field: "order_id", headerName: "Order ID", minWidth: 120, flex: 0.9 },
      { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.85 },
      { field: "ship_to_node_id", headerName: "Ship-to", minWidth: 110, flex: 0.85 },
      {
        field: "order_qty",
        headerName: "Order qty",
        type: "number",
        minWidth: 100,
        flex: 0.7,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "planned_demand",
        headerName: "Planned demand",
        type: "number",
        minWidth: 120,
        flex: 0.78,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "delta",
        headerName: "Delta",
        type: "number",
        minWidth: 90,
        flex: 0.62,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
      {
        field: "alignment",
        headerName: "Alignment",
        minWidth: 110,
        flex: 0.65,
        renderCell: (p: GridRenderCellParams<AlignmentGridRow>) => <AlignmentChip status={String(p.value ?? "")} />,
      },
    ],
    [],
  );

  const loadingAny = forecastLoading || ordersLoading;

  return (
    <div className="page-scroll">
      <SectionCard
        title="Supply & inventory integration"
        subtitle="Connect demand plan to replenishment and inventory — gap, capacity signals, and order alignment"
      >
        <Stack spacing={1}>
          <KpiCardRow>
            <KpiCard
              tone="demand"
              icon={<InventoryOutlinedIcon fontSize="small" />}
              title="Total demand"
              value={loadingAny ? "…" : Math.round(kpis.totalDemand).toLocaleString()}
              sub="Sum of final forecast (loaded rows)"
            />
            <KpiCard
              tone="network"
              icon={<PercentOutlinedIcon fontSize="small" />}
              title="Supply coverage %"
              value={loadingAny ? "…" : `${kpis.coveragePct.toFixed(1)}%`}
              sub="Allocated supply vs demand"
            />
            <KpiCard
              tone="critical"
              icon={<WarningAmberOutlinedIcon fontSize="small" />}
              title="Gap items"
              value={loadingAny ? "…" : String(kpis.gapItems)}
              sub="SKU-location-weeks with positive gap"
            />
            <KpiCard
              tone="money"
              icon={<BalanceOutlinedIcon fontSize="small" />}
              title="Capacity constraints"
              value={loadingAny ? "…" : String(capacityConstraintCount)}
              sub="Locations with production/logistics impact"
            />
          </KpiCardRow>

          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}>
            <Tab label="Demand-supply gap" />
            <Tab label="Capacity constraints" />
            <Tab label="Replenishment alignment" />
          </Tabs>

          {tab === 0 ? (
            <Stack spacing={1}>
              {/* ── ComposedChart: Demand/Supply bars + Gap & Coverage lines ── */}
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Demand vs supply by week
              </Typography>
              <div className="chart-shell" style={{ minHeight: 320 }}>
                <LineChart
                  chartId="demand-supply-gap-by-week"
                  data={gapByWeekWithCoverage}
                  xKey="week"
                  height={340}
                  series={[
                    { field: "demand", label: "Demand", type: "bar", color: "#2563eb" },
                    { field: "supply", label: "Supply", type: "bar", color: "#16a34a" },
                    { field: "gap", label: "Gap", type: "line", color: "#dc2626", strokeWidth: 2, strokeDasharray: "dashed", showDot: false },
                    { field: "coverage", label: "Coverage %", type: "line", color: "#d97706", strokeWidth: 2, showDot: false },
                  ]}
                />
              </div>

              {/* ── Transposed time-phased grid ── */}
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Weekly summary
              </Typography>
              <Box
                sx={{
                  overflowX: "auto",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                }}
              >
                <Box
                  component="table"
                  sx={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 11,
                    "& th, & td": {
                      px: 1.25,
                      py: 0.5,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      whiteSpace: "nowrap",
                      textAlign: "right",
                    },
                    "& th:first-of-type, & td:first-of-type": { textAlign: "left", fontWeight: 600 },
                    "& th": { fontWeight: 600, bgcolor: "action.hover" },
                  }}
                >
                  <thead>
                    <tr>
                      <th>Metric</th>
                      {gapByWeekWithCoverage.map((w) => (
                        <th key={w.week}>{w.week}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Total Demand</td>
                      {gapByWeekWithCoverage.map((w) => (
                        <td key={w.week}>{Math.round(w.demand).toLocaleString()}</td>
                      ))}
                    </tr>
                    <tr>
                      <td>Total Supply</td>
                      {gapByWeekWithCoverage.map((w) => (
                        <td key={w.week}>{Math.round(w.supply).toLocaleString()}</td>
                      ))}
                    </tr>
                    <tr>
                      <td>Net Gap</td>
                      {gapByWeekWithCoverage.map((w) => (
                        <td key={w.week} style={{ color: w.gap > 0 ? "#dc2626" : "inherit", fontWeight: w.gap > 0 ? 700 : 400 }}>
                          {Math.round(w.gap).toLocaleString()}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>Coverage %</td>
                      {gapByWeekWithCoverage.map((w) => (
                        <td
                          key={w.week}
                          style={{
                            backgroundColor: w.coverage < 80 ? "rgba(217, 119, 6, 0.15)" : "transparent",
                            fontWeight: w.coverage < 80 ? 700 : 400,
                          }}
                        >
                          {w.coverage.toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </Box>
              </Box>

              {/* ── Detailed drill-down grid ── */}
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Detail by SKU, location &amp; week
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Supply is total replenishment quantity for the SKU-location, allocated across weeks in proportion to weekly forecast.
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 420 }}>
                <SmartDataGrid
                  rows={gapRows}
                  columns={gapColumns}
                  loading={loadingAny}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50, 100]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-supply-gap"
                  slotProps={{
                    toolbar: { exportFileName: "demand-supply-gap" },
                  }}
                />
              </div>
            </Stack>
          ) : null}

          {tab === 1 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Locations with capacity or fulfillment constraints
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Rolled up from replenishment orders reporting production or logistics impact, or flagged as exceptions.
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 440 }}>
                <SmartDataGrid
                  rows={capacityLocationRows}
                  columns={capacityColumns}
                  loading={ordersLoading}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-capacity-constraints"
                  slotProps={{
                    toolbar: { exportFileName: "demand-capacity-constraints" },
                  }}
                />
              </div>
            </Stack>
          ) : null}

          {tab === 2 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Replenishment vs planned demand
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                Planned demand is the total forecast quantity for the same SKU and ship-to location in the current data slice.
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 480 }}>
                <SmartDataGrid
                  rows={alignmentRows}
                  columns={alignmentColumns}
                  loading={ordersLoading}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50, 100]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-replenishment-alignment"
                  slotProps={{
                    toolbar: { exportFileName: "demand-replenishment-alignment" },
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
