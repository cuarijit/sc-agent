import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import ReplayOutlinedIcon from "@mui/icons-material/ReplayOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { type GridColDef } from "@mui/x-data-grid";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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

import { EMPTY_FILTER_STATE, applyFilterState, type FilterFieldOption, type FilterState } from "../../filtering";
import {
  fetchInventoryProjection,
  fetchMasterDataOptions,
  fetchNetworkView,
  fetchParameterExceptions,
  fetchParameterValues,
  saveInventorySimulation,
} from "../../services/api";
import type { InventoryProjectionWeek, NetworkViewResponse, ParameterException, ParameterValueRecord } from "../../types";
import FilterBuilderDialog from "../shared/FilterBuilderDialog";
import SmartDataGrid from "../shared/SmartDataGrid";
import { SectionCard } from "../shared/UiBits";

type ProjectionRow = InventoryProjectionWeek & { id: number };

type FilterableProjectionRow = ProjectionRow & {
  sku: string;
  node: string;
  location: string;
  product_name: string;
  category: string;
  brand: string;
  projected_on_hand_scenario_qty: number;
  baseline_projected_on_hand_actual_qty: number;
  baseline_projected_on_hand_planned_qty: number;
};

type TransposedRow = {
  id:
    | "current_on_hand"
    | "forecast"
    | "orders"
    | "orders_actual"
    | "order_refs"
    | "safety_stock"
    | "reorder_point"
    | "projected_on_hand_actual"
    | "projected_on_hand_planned"
    | "projected_on_hand_scenario";
  metric: string;
  editable: boolean;
  [key: string]: string | number | boolean;
};

function toNum(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function weekField(weekOffset: number) {
  return `wk_${weekOffset}`;
}

function weekLabel(weekOffset: number) {
  return `Wk ${weekOffset}`;
}

export default function ProjectedInventoryWorkbench({
  initialSku,
  initialLocation,
}: {
  initialSku?: string;
  initialLocation?: string;
}) {
  const navigate = useNavigate();
  const orderDetailsHref = (orderId: string) => {
    const params = new URLSearchParams();
    params.set("tab", "order-details");
    params.set("order_id", orderId);
    if (resolvedSku) params.set("sku", resolvedSku);
    if (resolvedNode) params.set("location", resolvedNode);
    params.set("source", "projection");
    return `/replenishment?${params.toString()}`;
  };
  const [selectedSku, setSelectedSku] = useState(initialSku ?? "");
  const [selectedNode, setSelectedNode] = useState(initialLocation ?? "");
  const [scenarioId, setScenarioId] = useState<string>("");
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [edited, setEdited] = useState<Record<number, { forecast?: number; orders?: number }>>({});
  const [visibleWeeksCount, setVisibleWeeksCount] = useState<4 | 6 | 8 | 10 | 12>(12);

  useEffect(() => {
    setSelectedSku(initialSku ?? "");
  }, [initialSku]);

  useEffect(() => {
    setSelectedNode(initialLocation ?? "");
  }, [initialLocation]);

  const { data: masterOptions } = useQuery({
    queryKey: ["master-data-options", "projected-inventory"],
    queryFn: fetchMasterDataOptions,
  });

  const { data: sourcingView } = useQuery<NetworkViewResponse>({
    queryKey: ["projected-inventory-sourcing-selector-options"],
    queryFn: () => fetchNetworkView(new URLSearchParams()),
  });

  const sourcingPairs = useMemo(
    () => (sourcingView?.rows ?? []).map((row) => ({ sku: String(row.sku), node: String(row.node_id) })),
    [sourcingView],
  );

  const skuOptions = useMemo(() => {
    const base = new Set(sourcingPairs.map((item) => item.sku));
    if (selectedSku) base.add(selectedSku);
    return [...base].sort();
  }, [sourcingPairs, selectedSku]);
  const resolvedSku = selectedSku;
  const resolvedNode = selectedNode;
  const isSelectionReady = Boolean(resolvedSku && resolvedNode);

  const selectedProduct = useMemo(
    () => (masterOptions?.products ?? []).find((item) => item.sku === resolvedSku),
    [masterOptions, resolvedSku],
  );

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["inventory-projection", resolvedSku, resolvedNode, scenarioId],
    queryFn: () => fetchInventoryProjection(resolvedSku, { location: resolvedNode || undefined, scenario_id: scenarioId || undefined }),
    enabled: isSelectionReady,
  });

  const nodeOptions = useMemo(() => {
    const scopedNodes = resolvedSku
      ? sourcingPairs.filter((item) => item.sku === resolvedSku).map((item) => item.node)
      : sourcingPairs.map((item) => item.node);
    const base = new Set(scopedNodes);
    if (selectedNode) base.add(selectedNode);
    return [...base].sort();
  }, [sourcingPairs, resolvedSku, selectedNode]);

  const { data: selectedNodeParameters, isFetching: isFetchingParameters } = useQuery<ParameterValueRecord[]>({
    queryKey: ["projected-inventory-parameters", resolvedSku, resolvedNode],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("sku", resolvedSku);
      params.set("location", resolvedNode);
      return fetchParameterValues(params);
    },
    enabled: Boolean(resolvedSku && resolvedNode),
  });

  const { data: selectedNodeExceptions } = useQuery<ParameterException[]>({
    queryKey: ["projected-inventory-parameter-exceptions", resolvedSku, resolvedNode],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("sku", resolvedSku);
      params.set("location", resolvedNode);
      return fetchParameterExceptions(params);
    },
    enabled: Boolean(resolvedSku && resolvedNode),
  });

  const simulationMutation = useMutation({
    mutationFn: () =>
      saveInventorySimulation({
        scenario_id: scenarioId || undefined,
        user_id: "planner",
        sku: resolvedSku,
        location: resolvedNode,
        overrides: Object.entries(edited).map(([week, values]) => ({
          week_offset: Number(week),
          modified_forecast: values.forecast ?? null,
          modified_orders: values.orders ?? null,
        })),
      }),
    onSuccess: (result) => {
      setScenarioId(result.scenario_id);
      setEdited({});
      refetch();
    },
  });

  const baselineWeeks = useMemo<ProjectionRow[]>(() => {
    const weeks = data?.weeks ?? [];
    return [...weeks].sort((a, b) => a.week_offset - b.week_offset).map((week) => ({ ...week, id: week.week_offset }));
  }, [data]);

  const scenarioWeeks = useMemo<ProjectionRow[]>(() => {
    const baseWeeks = data?.weeks ?? [];
    if (!baseWeeks.length) return [];
    const sorted = [...baseWeeks].sort((a, b) => a.week_offset - b.week_offset);
    const editedWeeks = Object.keys(edited).map(Number).filter((n) => Number.isFinite(n));
    const firstEdited = editedWeeks.length ? Math.min(...editedWeeks) : Number.POSITIVE_INFINITY;
    let runningScenario = data?.opening_stock ?? 0;
    return sorted.map((week) => {
      const override = edited[week.week_offset];
      const forecast = override?.forecast ?? week.forecast_qty;
      // Scenario baseline follows "Actual": use non-exception future orders by default.
      const ordersForScenario = override?.orders ?? week.orders_non_exception_qty;
      const projectedScenario = runningScenario - forecast + ordersForScenario;
      const next: ProjectionRow = {
        ...week,
        id: week.week_offset,
        forecast_qty: Number(forecast.toFixed(2)),
        // Keep raw planned/actual quantities unchanged; row "orders_qty" is the editable scenario input.
        orders_qty: Number(ordersForScenario.toFixed(2)),
        projected_on_hand_qty: Number(projectedScenario.toFixed(2)),
        below_rop: projectedScenario < week.reorder_point_qty,
        below_safety_stock: projectedScenario < week.safety_stock_qty,
        stockout: projectedScenario < 0,
        simulated: week.week_offset >= firstEdited || week.simulated,
      };
      runningScenario = projectedScenario;
      return next;
    });
  }, [data, edited]);

  const filterRows = useMemo<FilterableProjectionRow[]>(
    () =>
      scenarioWeeks.map((week) => ({
        ...week,
        sku: resolvedSku,
        node: resolvedNode || "",
        location: resolvedNode || "",
        product_name: selectedProduct?.name ?? data?.product_name ?? "",
        category: selectedProduct?.category ?? "",
        brand: selectedProduct?.brand ?? "",
        projected_on_hand_scenario_qty: week.projected_on_hand_qty,
        baseline_projected_on_hand_actual_qty:
          baselineWeeks.find((item) => item.week_offset === week.week_offset)?.projected_on_hand_actual_qty ?? week.projected_on_hand_actual_qty,
        baseline_projected_on_hand_planned_qty:
          baselineWeeks.find((item) => item.week_offset === week.week_offset)?.projected_on_hand_planned_qty ?? week.projected_on_hand_planned_qty,
      })),
    [scenarioWeeks, resolvedSku, resolvedNode, selectedProduct, data, baselineWeeks],
  );

  const brandOptions = useMemo(
    () => [...new Set((masterOptions?.products ?? []).map((item) => item.brand))].sort(),
    [masterOptions],
  );

  const filterFields = useMemo<FilterFieldOption[]>(
    () => [
      { key: "sku", label: "SKU", type: "text", suggestions: skuOptions },
      { key: "node", label: "Node", type: "text", suggestions: nodeOptions },
      { key: "product_name", label: "Product", type: "text", suggestions: (masterOptions?.products ?? []).map((item) => item.name) },
      { key: "category", label: "Category", type: "text", suggestions: masterOptions?.categories ?? [] },
      { key: "brand", label: "Brand", type: "text", suggestions: brandOptions },
      { key: "below_rop", label: "Below ROP", type: "text", suggestions: ["true", "false"] },
      { key: "below_safety_stock", label: "Below Safety Stock", type: "text", suggestions: ["true", "false"] },
      { key: "stockout", label: "Stockout", type: "text", suggestions: ["true", "false"] },
    ],
    [skuOptions, nodeOptions, masterOptions, brandOptions],
  );

  const filteredWeeks = useMemo(
    () => applyFilterState(filterRows, filterFields, filterState) as FilterableProjectionRow[],
    [filterRows, filterFields, filterState],
  );
  const displayWeeks = useMemo(
    () => filteredWeeks.filter((row) => row.week_offset <= visibleWeeksCount),
    [filteredWeeks, visibleWeeksCount],
  );

  const weekStatus = useMemo(() => {
    const byWeek: Record<number, { stockout: boolean; belowRopPositive: boolean; simulated: boolean }> = {};
    for (const row of displayWeeks) {
      byWeek[row.week_offset] = {
        stockout: row.stockout,
        belowRopPositive: row.below_rop && row.projected_on_hand_scenario_qty > 0,
        simulated: row.simulated,
      };
    }
    return byWeek;
  }, [displayWeeks]);

  const chartData = useMemo(
    () =>
      displayWeeks.map((row) => ({
        week: weekLabel(row.week_offset),
        currentOnHand: row.current_on_hand_qty ?? null,
        projectedActual: row.projected_on_hand_actual_qty,
        projectedPlanned: row.projected_on_hand_planned_qty,
        projectedScenario: row.projected_on_hand_scenario_qty,
        forecast: row.forecast_qty,
        ordersNonException: row.orders_non_exception_qty,
        ordersException: row.orders_exception_qty,
        rop: row.reorder_point_qty,
        safety: row.safety_stock_qty,
      })),
    [displayWeeks],
  );

  const transposedRows = useMemo<TransposedRow[]>(() => {
    const rows: TransposedRow[] = [
      { id: "current_on_hand", metric: "Current On-Hand", editable: false },
      { id: "forecast", metric: "Forecast (Edit)", editable: true },
      { id: "orders", metric: "Future Orders (Edit)", editable: true },
      { id: "orders_actual", metric: "Future Orders (Actual)", editable: false },
      { id: "order_refs", metric: "Future Order #", editable: false },
      { id: "safety_stock", metric: "Safety Stock", editable: false },
      { id: "reorder_point", metric: "Re-Order Point", editable: false },
      { id: "projected_on_hand_actual", metric: "Projected Inventory Actual", editable: false },
      { id: "projected_on_hand_planned", metric: "Projected Inventory Planned", editable: false },
      { id: "projected_on_hand_scenario", metric: "Projected Inventory Scenario", editable: false },
    ];

    for (const week of displayWeeks) {
      const field = weekField(week.week_offset);
      const totalOrderDetailQty = Number(
        (
          Number(week.orders_non_exception_qty ?? 0)
          + Number(week.orders_exception_qty ?? 0)
        ).toFixed(2),
      );
      rows[0][field] = week.current_on_hand_qty ?? "";
      rows[1][field] = week.forecast_qty;
      rows[2][field] = week.orders_qty;
      rows[3][field] = totalOrderDetailQty;
      rows[4][field] = week.order_ids?.length ? week.order_ids.slice(0, 2).join(", ") + (week.order_ids.length > 2 ? ` +${week.order_ids.length - 2}` : "") : "-";
      rows[5][field] = week.safety_stock_qty;
      rows[6][field] = week.reorder_point_qty;
      rows[7][field] = week.projected_on_hand_actual_qty;
      rows[8][field] = week.projected_on_hand_planned_qty;
      rows[9][field] = week.projected_on_hand_scenario_qty;
    }

    return rows;
  }, [displayWeeks]);

  const columns = useMemo<GridColDef<TransposedRow>[]>(() => {
    const base: GridColDef<TransposedRow>[] = [
      { field: "metric", headerName: "Metric", minWidth: 190, flex: 1.1, sortable: false, editable: false },
    ];

    for (const week of displayWeeks) {
      const field = weekField(week.week_offset);
      base.push({
        field,
        headerName: `${weekLabel(week.week_offset)} (${week.week_start_date.slice(5)})`,
        minWidth: 138,
        flex: 0.92,
        sortable: false,
        // Keep week columns editable and gate actual edits via isCellEditable at grid level.
        editable: true,
        type: "number",
        renderCell: (params) => {
          if (params.row.id === "order_refs") {
            const weekRow = displayWeeks.find((item) => item.week_offset === week.week_offset);
            const ids = weekRow?.order_ids ?? [];
            const exceptionIds = new Set(weekRow?.order_exception_ids ?? []);
            if (!ids.length) {
              return <>-</>;
            }
            return (
              <Stack direction="column" spacing={0.3} sx={{ py: 0.25 }}>
                {ids.slice(0, 3).map((id) => (
                  <Stack key={id} direction="row" spacing={0.4} alignItems="center">
                    {exceptionIds.has(id) ? (
                      <ErrorOutlineOutlinedIcon fontSize="inherit" sx={{ color: "error.main" }} />
                    ) : null}
                    <Typography
                      component={Link}
                      to={orderDetailsHref(id)}
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                      sx={(theme) => ({
                        fontSize: "inherit",
                        lineHeight: 1.1,
                        fontWeight: exceptionIds.has(id) ? 700 : 500,
                        color: exceptionIds.has(id) ? theme.palette.error.main : theme.palette.text.primary,
                        textDecoration: "underline",
                      })}
                    >
                      {id}
                    </Typography>
                  </Stack>
                ))}
                {ids.length > 3 ? (
                  <Typography component="span" sx={{ fontSize: "inherit", lineHeight: 1.1, color: "text.secondary" }}>
                    +{ids.length - 3} more
                  </Typography>
                ) : null}
              </Stack>
            );
          }
          if (
            params.row.id !== "projected_on_hand_actual"
            && params.row.id !== "projected_on_hand_planned"
            && params.row.id !== "projected_on_hand_scenario"
          ) {
            const value = params.value;
            return <>{typeof value === "number" ? Number(value).toFixed(2) : value}</>;
          }
          const status = weekStatus[week.week_offset];
          return (
            <Box
              sx={(theme) => ({
                width: "100%",
                px: 0.6,
                py: 0.2,
                borderRadius: 0.8,
                fontWeight: 700,
                backgroundColor: status?.stockout
                  ? alpha(theme.palette.error.main, theme.palette.mode === "dark" ? 0.48 : 0.24)
                  : status?.belowRopPositive
                    ? alpha(theme.palette.warning.main, theme.palette.mode === "dark" ? 0.42 : 0.26)
                    : status?.simulated
                      ? alpha(theme.palette.warning.main, theme.palette.mode === "dark" ? 0.32 : 0.2)
                      : "transparent",
              })}
            >
              {Number(params.value ?? 0).toFixed(2)}
            </Box>
          );
        },
      });
    }
    return base;
  }, [displayWeeks, weekStatus]);

  const exceptionByCode = useMemo(() => {
    const map = new Map<string, ParameterException>();
    for (const item of selectedNodeExceptions ?? []) {
      if (!map.has(item.parameter_code)) {
        map.set(item.parameter_code, item);
      }
    }
    return map;
  }, [selectedNodeExceptions]);

  const parameterRows = useMemo(
    () =>
      (selectedNodeParameters ?? []).map((row) => {
        const ex = exceptionByCode.get(row.parameter_code);
        let inferredRecommended = "-";
        const numeric = Number(row.effective_value);
        if (Number.isFinite(numeric)) {
          if (row.parameter_code === "safety_stock_qty" || row.parameter_code === "reorder_point_qty") {
            inferredRecommended = String(Math.round(numeric * 1.1));
          } else if (row.parameter_code === "lead_time_days") {
            inferredRecommended = String(Math.max(1, Math.round(numeric)));
          } else if (row.parameter_code === "service_level_target") {
            inferredRecommended = String(Math.min(0.99, Math.max(0.95, numeric)).toFixed(2));
          } else {
            inferredRecommended = String(Math.round(numeric));
          }
        }
        return {
          id: row.id,
          parameter_code: row.parameter_code,
          effective_value: row.effective_value,
          recommended_value: ex?.recommended_value ?? inferredRecommended,
          parameter_exception: ex?.issue_type ?? "none",
          source_type: row.source_type,
        };
      }),
    [selectedNodeParameters, exceptionByCode],
  );

  const helpGroups = useMemo(() => {
    const all = data?.demo_examples ?? [];
    return [
      {
        title: "0. Perfect saw-tooth (no stockout for all 12 weeks)",
        rows: all.filter((item) => item.key.startsWith("perfect_sawtooth_no_stockout")),
      },
      {
        title: "1. Stock out in next 2-3 weeks",
        rows: all.filter((item) => item.key.startsWith("stockout_next_2_3_weeks")),
      },
      {
        title: "2. Stock below re-order point without any future orders",
        rows: all.filter((item) => item.key.startsWith("below_rop_no_future_orders")),
      },
      {
        title: "3. Excess inventory with low or zero forecast and high on-hand",
        rows: all.filter((item) => item.key.startsWith("excess_inventory_low_forecast")),
      },
    ];
  }, [data]);

  return (
    <Stack spacing={1}>
      <SectionCard title="Projection dashboard" subtitle="Product context, node context, and projection baseline KPIs">
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
            <TextField
              select
              size="small"
              label="Product (SKU)"
              value={resolvedSku}
              onChange={(event) => {
                setSelectedSku(event.target.value);
                setEdited({});
                setScenarioId("");
              }}
              sx={{ minWidth: 210 }}
            >
              <MenuItem value="">
                <em>Select SKU</em>
              </MenuItem>
              {skuOptions.map((sku) => (
                <MenuItem key={sku} value={sku}>
                  {sku}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Location / Node"
              value={selectedNode}
              onChange={(event) => {
                setSelectedNode(event.target.value);
                setEdited({});
                setScenarioId("");
              }}
              sx={{ minWidth: 190 }}
            >
              <MenuItem value="">
                <em>Select Location</em>
              </MenuItem>
              {nodeOptions.map((node) => (
                <MenuItem key={node} value={node}>
                  {node}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction="row" spacing={0.7} sx={{ flexWrap: "wrap" }}>
            <Chip label={`Current On-Hand: ${(data?.opening_stock ?? 0).toFixed(0)}`} />
            <Chip label={`Lead Time: ${data?.lead_time_days ?? 0} d`} />
            <Chip label={`Service Level: ${((data?.service_level_target ?? 0) * 100).toFixed(0)}%`} />
            <Chip label={`Category: ${selectedProduct?.category ?? "n/a"}`} />
            <Chip label={`Brand: ${selectedProduct?.brand ?? "n/a"}`} />
            <Chip color="primary" variant="outlined" label={`Scenario: ${scenarioId || "Base"}`} />
          </Stack>
        </Stack>
      </SectionCard>

      <SectionCard title="Projection workbench" subtitle="Filter by SKU/node/product attributes, simulate, and evaluate projected inventory">
        <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="outlined" startIcon={<HelpOutlineOutlinedIcon />} onClick={() => setHelpOpen(true)}>
            Help
          </Button>
          <Tooltip title="Advanced Filter">
            <IconButton color="primary" onClick={() => setFilterDialogOpen(true)}>
              <FilterAltOutlinedIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            startIcon={<ReplayOutlinedIcon />}
            onClick={() => {
              setEdited({});
            }}
            disabled={!isSelectionReady}
          >
            Reset Modifications
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveOutlinedIcon />}
            disabled={!isSelectionReady || !Object.keys(edited).length || simulationMutation.isPending}
            onClick={() => simulationMutation.mutate()}
          >
            Commit Scenario
          </Button>
          <Typography variant="caption" color="text.secondary">
            {Object.keys(edited).length > 0 ? `${Object.keys(edited).length} week edit(s) pending commit` : "No pending edits"}
          </Typography>
          <TextField
            select
            size="small"
            label="Weeks"
            value={visibleWeeksCount}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (next === 4 || next === 6 || next === 8 || next === 10 || next === 12) {
                setVisibleWeeksCount(next);
              }
            }}
            sx={{ minWidth: 92 }}
          >
            {[4, 6, 8, 10, 12].map((weekCount) => (
              <MenuItem key={weekCount} value={weekCount}>
                {weekCount}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {!isSelectionReady ? (
          <Box className="content-card" sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Select both `Product (SKU)` and `Location / Node` to load weekly chart, projection grid, and parameter panel.
            </Typography>
          </Box>
        ) : (
          <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems="stretch">
            <Box sx={{ flex: 1.35, minWidth: 0 }}>
              <Box className="content-card" sx={{ p: 1.5, mb: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Weekly Projection Chart
                </Typography>
                <div className="chart-shell">
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="week" />
                      <YAxis domain={[-10, "auto"]} allowDataOverflow />
                      <RechartsTooltip />
                      <Legend />
                      <Bar dataKey="currentOnHand" name="Current On-Hand (Wk1)" fill="#475569" barSize={16} />
                      <Bar dataKey="ordersNonException" name="Future Orders (Non-Exception)" stackId="orders" fill="#059669" barSize={16} />
                      <Bar dataKey="ordersException" name="Future Orders (Exception)" stackId="orders" fill="#dc2626" barSize={16} />
                      <Line type="monotone" dataKey="projectedActual" name="Projected Inventory Actual" stroke="#1d4ed8" strokeWidth={3} />
                      <Line type="monotone" dataKey="projectedPlanned" name="Projected Inventory Planned" stroke="#2563eb" strokeWidth={2.5} strokeDasharray="6 4" />
                      <Line type="monotone" dataKey="projectedScenario" name="Projected Inventory Scenario" stroke="#0f766e" strokeWidth={2.5} strokeDasharray="5 3" />
                      <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#7c3aed" strokeWidth={2} />
                      <Line type="monotone" dataKey="safety" name="Safety Stock" stroke="#f97316" strokeWidth={2} />
                      <Line type="monotone" dataKey="rop" name="Re-Order Point" stroke="#dc2626" strokeWidth={2} strokeDasharray="6 4" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                  Actual excludes exception future orders; Planned includes all future orders.
                </Typography>
              </Box>

              <div className="maintenance-grid-shell">
                <SmartDataGrid
                  rows={transposedRows}
                  columns={columns}
                  disableRowSelectionOnClick
                  isCellEditable={(params) => params.row.id === "forecast" || params.row.id === "orders"}
                  loading={isFetching}
                  hideFooter
                  processRowUpdate={async (newRow, oldRow) => {
                    const rowId = String(newRow.id);
                    if (rowId !== "forecast" && rowId !== "orders") return oldRow;

                    let changedWeek: number | null = null;
                    let changedValue: number | null = null;
                    for (const week of displayWeeks) {
                      const field = weekField(week.week_offset);
                      const before = toNum((oldRow as Record<string, unknown>)[field], NaN);
                      const after = toNum((newRow as Record<string, unknown>)[field], before);
                      if (Number.isFinite(after) && after !== before) {
                        changedWeek = week.week_offset;
                        changedValue = after;
                        break;
                      }
                    }

                    if (changedWeek !== null && changedValue !== null) {
                      setEdited((prev) => {
                        const current = prev[changedWeek] ?? {};
                        return {
                          ...prev,
                          [changedWeek]: {
                            ...current,
                            ...(rowId === "forecast" ? { forecast: changedValue } : { orders: changedValue }),
                          },
                        };
                      });
                    }
                    return newRow;
                  }}
                onProcessRowUpdateError={() => undefined}
                sx={(theme) => ({
                  border: 0,
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
                  },
                })}
              />
            </div>
            </Box>

            <Box sx={{ width: { xs: "100%", md: 420 }, flexShrink: 0 }}>
              <SectionCard title="Parameters" subtitle="Selected SKU + location from page filter">
                <Stack spacing={0.75}>
                  <Typography variant="caption" color="text.secondary">
                    SKU: {resolvedSku || "n/a"} | Location: {resolvedNode || "n/a"}
                  </Typography>
                  <div className="maintenance-grid-shell" style={{ maxHeight: 430 }}>
                    <SmartDataGrid
                      rows={parameterRows}
                      columns={[
                        { field: "parameter_code", headerName: "Parameter", minWidth: 150, flex: 1.1 },
                        { field: "effective_value", headerName: "Value", minWidth: 90, flex: 0.7 },
                        { field: "recommended_value", headerName: "Recommended", minWidth: 110, flex: 0.8 },
                        { field: "parameter_exception", headerName: "Exception", minWidth: 120, flex: 0.8 },
                      ] satisfies GridColDef[]}
                      disableRowSelectionOnClick
                      hideFooter
                      loading={isFetchingParameters}
                      sx={{ border: 0 }}
                    />
                  </div>
                </Stack>
              </SectionCard>
            </Box>
          </Stack>
        )}
      </SectionCard>

      <FilterBuilderDialog
        open={filterDialogOpen}
        title="Projected Inventory Filters"
        fields={filterFields}
        initialState={filterState}
        onClose={() => setFilterDialogOpen(false)}
        onApply={setFilterState}
        onClear={() => setFilterState(EMPTY_FILTER_STATE)}
      />

      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Projected Inventory Demo Help</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25}>
            {helpGroups.map((group) => (
              <Stack key={group.title} spacing={0.75}>
                <Typography variant="subtitle2">{group.title}</Typography>
                {group.rows.map((example) => (
                  <Box
                    key={example.key}
                    sx={(theme) => ({
                      p: 1,
                      borderRadius: 1,
                      border: `1px solid ${alpha(theme.palette.divider, 0.75)}`,
                    })}
                  >
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                      <Box>
                        <Typography variant="body2">{example.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          SKU: {example.sku} | Location: {example.location || "Auto"} | Alert: {example.alert_id || "n/a"}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.75}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setSelectedSku(example.sku);
                            setSelectedNode(example.location ?? "");
                            setScenarioId("");
                            setEdited({});
                            setHelpOpen(false);
                          }}
                        >
                          Load Example
                        </Button>
                        {example.alert_id ? (
                          <Button
                            size="small"
                            onClick={() => {
                              navigate(`/network?alert_id=${encodeURIComponent(example.alert_id || "")}`);
                            }}
                          >
                            Open Alert
                          </Button>
                        ) : null}
                      </Stack>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHelpOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
