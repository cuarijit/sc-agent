import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import PublishOutlinedIcon from "@mui/icons-material/PublishOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import ShowChartOutlinedIcon from "@mui/icons-material/ShowChartOutlined";
import StackedLineChartOutlinedIcon from "@mui/icons-material/StackedLineChartOutlined";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import ForecastWorkbench, {
  type ForecastSeriesDef,
} from "../components/forecast/ForecastWorkbench";
import type { BucketKind } from "../components/forecast/bucketAggregation";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import { SectionCard } from "../components/shared/UiBits";
import {
  createDbfScenario,
  fetchDbfConsumption,
  fetchDbfDrivers,
  fetchDbfReference,
  fetchDbfScenarios,
  patchDbfConsumption,
  patchDbfDrivers,
  publishDbfScenario,
  type DbfAdjustment,
  type DbfDriverRow,
} from "../services/api";

type DriverTabKey = "price" | "acv" | "display" | "feature";

interface DriverMetric {
  field: string;
  label: string;
  color: string;
  /** Headline metric used as the editable / "actual" line for the chart. */
  primary?: boolean;
  /** Bar instead of line in the chart. */
  type?: "line" | "bar";
  /** Format for grid display. */
  format?: (v: number | null) => string;
  dashed?: boolean;
}

const fmtPct = (v: number | null) =>
  v == null ? "—" : `${(Math.round(v * 1000) / 10).toLocaleString()}%`;
const fmtCurrency = (v: number | null) =>
  v == null ? "—" : `$${(Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNumber1 = (v: number | null) =>
  v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString();
const fmtCount = (v: number | null) =>
  v == null ? "—" : Math.round(v).toLocaleString();

const DRIVER_TABS: Array<{
  key: DriverTabKey;
  label: string;
  /** Headline metric (the line being adjusted in the workbench). */
  primaryField: string;
  metrics: DriverMetric[];
}> = [
  {
    key: "price",
    label: "Price",
    primaryField: "discount_pct",
    metrics: [
      { field: "base_price",   label: "Base Price",   color: "#94a3b8", format: fmtCurrency, type: "line", dashed: true },
      { field: "promo_price",  label: "Promo Price",  color: "#0ea5e9", format: fmtCurrency, type: "line" },
      { field: "discount_pct", label: "Discount %",   color: "#dc2626", format: fmtPct,      type: "bar", primary: true },
      { field: "price_index",  label: "Price Index",  color: "#7c3aed", format: fmtNumber1,  type: "line", dashed: true },
    ],
  },
  {
    key: "acv",
    label: "Distribution",
    primaryField: "acv_pct",
    metrics: [
      { field: "acv_pct",            label: "ACV %",              color: "#0ea5e9", format: fmtNumber1, type: "line", primary: true },
      { field: "tdp",                label: "Total Distribution Points", color: "#94a3b8", format: fmtNumber1, type: "line", dashed: true },
      { field: "distribution_index", label: "Distribution Index", color: "#7c3aed", format: fmtNumber1, type: "line", dashed: true },
    ],
  },
  {
    key: "display",
    label: "Display",
    primaryField: "display_count",
    metrics: [
      { field: "display_count", label: "Display Count", color: "#f59e0b", format: fmtCount,   type: "bar", primary: true },
      { field: "linear_feet",   label: "Linear Feet",   color: "#0ea5e9", format: fmtNumber1, type: "line" },
      { field: "end_cap_flag",  label: "End-Cap (1/0)", color: "#94a3b8", format: fmtCount,   type: "line", dashed: true },
    ],
  },
  {
    key: "feature",
    label: "Feature",
    primaryField: "feature_count",
    metrics: [
      { field: "feature_count", label: "Feature Count", color: "#84cc16", format: fmtCount,    type: "bar", primary: true },
      { field: "media_spend",   label: "Media Spend",   color: "#0ea5e9", format: fmtCurrency, type: "line" },
    ],
  },
];

export default function DbfWorkbenchPage() {
  const qc = useQueryClient();

  // ── Reference data ───────────────────────────────────────────────
  const { data: ref } = useQuery({
    queryKey: ["dbf-reference"],
    queryFn: fetchDbfReference,
  });

  // ── Scenario selection ───────────────────────────────────────────
  const { data: scenarios } = useQuery({
    queryKey: ["dbf-scenarios"],
    queryFn: fetchDbfScenarios,
  });
  const scenarioOptions = scenarios?.scenarios ?? [];
  const [scenarioId, setScenarioId] = useState("production");

  // ── Filters ──────────────────────────────────────────────────────
  const [sku, setSku] = useState("");
  const [customer, setCustomer] = useState("");
  const [bucket, setBucket] = useState<BucketKind>("week");
  const [tab, setTab] = useState(0);

  const skus = ref?.skus ?? [];
  const customers = ref?.customers ?? [];

  // Default sku/customer to first option once reference loads.
  useMemo(() => {
    if (!sku && skus.length > 0) setSku(skus[0]);
    if (!customer && customers.length > 0) setCustomer(customers[0]);
  }, [skus, customers, sku, customer]);

  // ── Data queries ─────────────────────────────────────────────────
  const driversQ = useQuery({
    queryKey: ["dbf-drivers", scenarioId, sku, customer],
    queryFn: () => fetchDbfDrivers({ scenario_id: scenarioId, sku, customer }),
    enabled: !!sku && !!customer,
  });
  const consumptionQ = useQuery({
    queryKey: ["dbf-consumption", scenarioId, sku, customer],
    queryFn: () => fetchDbfConsumption({ scenario_id: scenarioId, sku, customer }),
    enabled: !!sku && !!customer,
  });

  // ── Adjustment state (local; flushed on Save) ────────────────────
  const [driverAdjustments, setDriverAdjustments] = useState<
    Record<DriverTabKey, Record<string, number>>
  >({ price: {}, acv: {}, display: {}, feature: {} });
  const [consumptionAdjustments, setConsumptionAdjustments] = useState<Record<string, number>>({});
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; msg: string }>({ open: false, msg: "" });

  // ── Save mutations ───────────────────────────────────────────────
  const saveDriverMutation = useMutation({
    mutationFn: async ({ driver, batch }: { driver: DriverTabKey; batch: DbfAdjustment[] }) => {
      void driver;
      return patchDbfDrivers(scenarioId, batch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dbf-drivers"] });
      qc.invalidateQueries({ queryKey: ["dbf-consumption"] });
      qc.invalidateQueries({ queryKey: ["dbf-shipment"] });
      setDirty(false);
      setDriverAdjustments({ price: {}, acv: {}, display: {}, feature: {} });
      setSnack({ open: true, msg: "Driver adjustments applied; downstream forecast recomputed." });
    },
    onError: (e: Error) => setSnack({ open: true, msg: `Save failed: ${e.message}` }),
  });

  const saveConsumptionMutation = useMutation({
    mutationFn: async (batch: { sku: string; customer: string; week: string; delta: number }[]) =>
      patchDbfConsumption(scenarioId, batch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dbf-consumption"] });
      qc.invalidateQueries({ queryKey: ["dbf-shipment"] });
      setDirty(false);
      setConsumptionAdjustments({});
      setSnack({ open: true, msg: "Consumption adjustments saved." });
    },
    onError: (e: Error) => setSnack({ open: true, msg: `Save failed: ${e.message}` }),
  });

  const publishMutation = useMutation({
    mutationFn: () => publishDbfScenario(scenarioId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["dbf-scenarios"] });
      qc.invalidateQueries({ queryKey: ["demand-forecasts"] });
      setSnack({ open: true, msg: `Published — ${r.published_rows} rows added to Demand Forecasting.` });
    },
    onError: (e: Error) => setSnack({ open: true, msg: `Publish failed: ${e.message}` }),
  });

  // ── New scenario dialog ──────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const createScenarioMutation = useMutation({
    mutationFn: () =>
      createDbfScenario({ name: newName, parent_scenario_id: scenarioId }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["dbf-scenarios"] });
      setScenarioId(r.scenario_id);
      setDialogOpen(false);
      setNewName("");
      setSnack({ open: true, msg: `Scenario created: ${r.name}` });
    },
  });

  // ── Build driver-tab rows ────────────────────────────────────────
  // For each (sku, customer, week) row from the API we expand every metric
  // declared on the tab into the WeeklyRow `values` map. The chart's primary
  // metric also drives the editable adjustment + forecast lines.
  const driverRows = useCallback(
    (driverKey: DriverTabKey) => {
      const drv = driversQ.data;
      if (!drv) return [];
      const apiKey =
        driverKey === "price"
          ? "price"
          : driverKey === "acv"
          ? "distribution"
          : driverKey === "display"
          ? "display"
          : "feature";
      const tab = DRIVER_TABS.find((t) => t.key === driverKey)!;
      const arr = (drv[apiKey as keyof typeof drv] as DbfDriverRow[]) ?? [];
      return arr.map((r) => {
        const values: Record<string, number | null> = {};
        for (const m of tab.metrics) {
          const raw = r[m.field];
          values[m.field] = raw == null ? null : Number(raw);
        }
        // Editable workbench needs an "actual" / "forecast" pair on the
        // primary metric so the adjustment + lock plumbing keeps working.
        const primary = Number(r[tab.primaryField] ?? 0);
        values.actual = primary;
        values.forecast = primary;
        return { week: String(r.week_start), values };
      });
    },
    [driversQ.data],
  );

  const driverSeries = useCallback(
    (driverKey: DriverTabKey): ForecastSeriesDef[] => {
      const tab = DRIVER_TABS.find((t) => t.key === driverKey)!;
      const metricSeries: ForecastSeriesDef[] = tab.metrics.map((m) => ({
        key: m.field,
        label: m.label,
        type: m.type ?? "line",
        color: m.color,
        dashed: m.dashed,
        strokeWidth: m.primary ? 2 : 1.5,
        format: m.format,
        showInGrid: true,
        // Hide the primary metric from the chart series list — it's already
        // rendered as the editable "Forecasted driver" line below.
      }));
      return [
        ...metricSeries,
        {
          key: "actual",
          label: "Actual",
          type: "line",
          color: "#111111",
          strokeWidth: 2.5,
          z: 10,
          showInGrid: false,
        },
        {
          key: "forecast",
          label: "Forecasted driver",
          type: "line",
          color: "#2563eb",
          strokeWidth: 2,
          showInGrid: false,
        },
      ];
    },
    [],
  );

  // ── Consumption tab data ─────────────────────────────────────────
  const consumptionRows = useMemo(() => {
    const rows = consumptionQ.data?.rows ?? [];
    return rows.map((r) => ({
      week: String(r.week_start),
      values: {
        base_qty:        r.base_qty,
        price_effect:    r.price_effect,
        acv_effect:      r.acv_effect,
        display_effect:  r.display_effect,
        feature_effect:  r.feature_effect,
        total_qty:       r.total_qty,
        last_year_qty:   r.last_year_qty,
        actual_qty:      r.actual_qty > 0 ? r.actual_qty : null,
        adjusted_qty:    r.adjusted_qty,
        variance_pct:    r.actual_qty > 0 ? ((r.adjusted_qty - r.actual_qty) / r.actual_qty) * 100 : null,
      },
    }));
  }, [consumptionQ.data]);

  const consumptionSeries = useMemo<ForecastSeriesDef[]>(
    () => [
      { key: "base_qty",        label: "Base Consumption",  type: "line", color: "#94a3b8", strokeWidth: 1.5 },
      { key: "price_effect",    label: "Price Effect",      type: "bar",  color: "#7c3aed", showInGrid: true },
      { key: "acv_effect",      label: "ACV Effect",        type: "bar",  color: "#0ea5e9", showInGrid: true },
      { key: "display_effect",  label: "Display Effect",    type: "bar",  color: "#f59e0b", showInGrid: true },
      { key: "feature_effect",  label: "Feature Effect",    type: "bar",  color: "#84cc16", showInGrid: true },
      { key: "total_qty",       label: "Total Consumption", type: "line", color: "#2563eb", strokeWidth: 2 },
      { key: "last_year_qty",   label: "Last Year",         type: "line", color: "#cbd5e1", dashed: true, strokeWidth: 1.5 },
      { key: "adjustment",      label: "Adjustment",        type: "bar",  color: "#16a34a", diverging: true, showInGrid: false },
      { key: "adjusted_qty",    label: "Adjusted Consumption", type: "line", color: "#dc2626", strokeWidth: 2.5, showInGrid: false },
      { key: "actual_qty",      label: "Actual",            type: "line", color: "#111111", strokeWidth: 2.5, z: 10 },
    ],
    [],
  );

  // ── KPIs ─────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const rows = consumptionQ.data?.rows ?? [];
    const totalCons = rows.reduce((s, r) => s + (r.adjusted_qty || 0), 0);
    const draftScenarios = scenarioOptions.filter((s) => s.status === "draft").length;
    const activeStatus = scenarioOptions.find((s) => s.scenario_id === scenarioId)?.status ?? "—";
    return {
      totalCons,
      draftScenarios,
      activeStatus,
      totalScenarios: scenarioOptions.length,
    };
  }, [consumptionQ.data, scenarioOptions, scenarioId]);

  // ── Driver-tab handlers ──────────────────────────────────────────
  // Tab 0 is Consumption, tabs 1..DRIVER_TABS.length are drivers, the
  // last tab is Shipment.
  const activeDriverKey: DriverTabKey | null =
    tab >= 1 && tab <= DRIVER_TABS.length ? DRIVER_TABS[tab - 1].key : null;

  const handleDriverAdjust = useCallback(
    (driver: DriverTabKey) => (week: string, value: number) => {
      setDriverAdjustments((prev) => ({
        ...prev,
        [driver]: { ...prev[driver], [week]: value },
      }));
      setDirty(true);
    },
    [],
  );

  const handleConsumptionAdjust = useCallback((week: string, value: number) => {
    setConsumptionAdjustments((prev) => ({ ...prev, [week]: value }));
    setDirty(true);
  }, []);

  const toggleLock = useCallback((week: string) => {
    setLocks((prev) => {
      const next = new Set(prev);
      if (next.has(week)) next.delete(week);
      else next.add(week);
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    // Past-week adjustments are filtered server-side as well, but we strip
    // them here so the dirty/save flow doesn't ship adjustments that the
    // backend will reject.
    const todayIso = new Date().toISOString().slice(0, 10);
    const isFuture = (week: string) => week >= todayIso;
    if (activeDriverKey) {
      const adjs = driverAdjustments[activeDriverKey];
      const batch: DbfAdjustment[] = Object.entries(adjs)
        .filter(([week]) => isFuture(week))
        .map(([week, value]) => ({
          sku, customer, week, driver: activeDriverKey, value,
        }));
      if (batch.length > 0) saveDriverMutation.mutate({ driver: activeDriverKey, batch });
    } else if (tab === 0) {
      // Consumption tab is index 0
      const batch = Object.entries(consumptionAdjustments)
        .filter(([week]) => isFuture(week))
        .map(([week, delta]) => ({ sku, customer, week, delta }));
      if (batch.length > 0) saveConsumptionMutation.mutate(batch);
    }
  }, [activeDriverKey, driverAdjustments, consumptionAdjustments, sku, customer, tab, saveDriverMutation, saveConsumptionMutation]);

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="page-scroll">
      <SectionCard
        title="Driver Forecast Workbench"
        subtitle="Independently forecast each demand driver, compose consumption, derive shipment."
      >
        <Stack spacing={1}>
          <KpiCardRow>
            <KpiCard tone="network" icon={<TrendingUpOutlinedIcon fontSize="small" />} title="Adjusted Consumption" value={Math.round(kpis.totalCons).toLocaleString()} />
            <KpiCard tone="demand" icon={<ShowChartOutlinedIcon fontSize="small" />} title="Active Scenario" value={kpis.activeStatus} sub={scenarioId} />
            <KpiCard tone="money" icon={<StackedLineChartOutlinedIcon fontSize="small" />} title="Draft Scenarios" value={String(kpis.draftScenarios)} sub={`${kpis.totalScenarios} total`} />
            <KpiCard tone="critical" icon={<LocalShippingOutlinedIcon fontSize="small" />} title="Publish Status" value={publishMutation.isPending ? "Publishing…" : kpis.activeStatus === "published" ? "Live" : "Draft"} />
          </KpiCardRow>

          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
            <TextField
              select size="small" label="Scenario" value={scenarioId}
              onChange={(e) => { setScenarioId(e.target.value); setDirty(false); }}
              sx={{ minWidth: 220, "& .MuiInputBase-input": { fontSize: 12 } }}
            >
              {scenarioOptions.map((s) => (
                <MenuItem key={s.scenario_id} value={s.scenario_id} sx={{ fontSize: 12 }}>
                  {s.name} {s.status === "published" ? "✓" : s.status === "draft" ? "✎" : ""}
                </MenuItem>
              ))}
            </TextField>
            <Button
              size="small" variant="outlined"
              startIcon={<AddOutlinedIcon sx={{ fontSize: 14 }} />}
              onClick={() => setDialogOpen(true)}
              sx={{ textTransform: "none", fontSize: 11, height: 32 }}
            >
              New scenario
            </Button>
            <Button
              size="small" variant="contained"
              startIcon={<PublishOutlinedIcon sx={{ fontSize: 14 }} />}
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending || scenarioId === ""}
              sx={{ textTransform: "none", fontSize: 11, height: 32 }}
            >
              Publish to Demand Forecasting
            </Button>

            <TextField
              select size="small" label="SKU" value={sku}
              onChange={(e) => setSku(e.target.value)}
              sx={{ minWidth: 140, ml: 2, "& .MuiInputBase-input": { fontSize: 12 } }}
            >
              {skus.map((s) => <MenuItem key={s} value={s} sx={{ fontSize: 12 }}>{s}</MenuItem>)}
            </TextField>
            <TextField
              select size="small" label="Customer" value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              sx={{ minWidth: 200, "& .MuiInputBase-input": { fontSize: 12 } }}
            >
              {customers.map((c) => <MenuItem key={c} value={c} sx={{ fontSize: 12 }}>{c}</MenuItem>)}
            </TextField>
            <Chip size="small" label={`${consumptionQ.data?.total ?? 0} weeks loaded`} sx={{ fontSize: 11 }} />
          </Stack>

          {/* Tab order: Consumption (composite output) first, then per-driver
              tabs, then Shipment. */}
          <Tabs value={tab} onChange={(_e, v) => { setTab(v); setDirty(false); }} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}>
            <Tab label="Consumption" />
            {DRIVER_TABS.map((d) => <Tab key={d.key} label={d.label} />)}
            <Tab label="Shipment" />
          </Tabs>

          {/* Consumption tab (index 0) */}
          {tab === 0 ? (
            <ForecastWorkbench
              title={`Consumption forecast — ${sku} × ${customer}`}
              rows={consumptionRows}
              series={consumptionSeries}
              bucket={bucket}
              onBucketChange={setBucket}
              enabledBuckets={["day", "week", "month", "quarter"]}
              adjustmentKey="adjustment"
              adjustments={consumptionAdjustments}
              onAdjust={handleConsumptionAdjust}
              locks={locks}
              onToggleLock={toggleLock}
              adjustedKey="adjusted_qty"
              baseForAdjustedKey="total_qty"
              onSave={handleSave}
              dirty={dirty}
              loading={consumptionQ.isLoading}
              chartHeight={320}
              varianceRows={[
                {
                  key: "variance_pct",
                  label: "Variance % (Adj vs Actual)",
                  format: (v) => (v == null ? "—" : `${v.toFixed(1)}%`),
                  colorize: true,
                },
              ]}
            />
          ) : null}

          {/* Driver tabs (indices 1..DRIVER_TABS.length) */}
          {DRIVER_TABS.map((d, idx) =>
            tab === idx + 1 ? (
              <ForecastWorkbench
                key={d.key}
                title={`${d.label} driver — ${sku} × ${customer}`}
                rows={driverRows(d.key)}
                series={driverSeries(d.key)}
                bucket={bucket}
                onBucketChange={setBucket}
                enabledBuckets={["week", "month", "quarter"]}
                disabledBucketLabel="Drivers are forecasted weekly"
                adjustmentKey="adjustment"
                adjustments={driverAdjustments[d.key]}
                onAdjust={handleDriverAdjust(d.key)}
                locks={locks}
                onToggleLock={toggleLock}
                adjustedKey="forecast"
                baseForAdjustedKey="forecast"
                onSave={handleSave}
                dirty={dirty}
                loading={driversQ.isLoading}
                chartHeight={300}
              />
            ) : null,
          )}

          {/* Shipment tab (last index) */}
          {tab === DRIVER_TABS.length + 1 ? (
            <ShipmentTab scenarioId={scenarioId} sku={sku} customer={customer} bucket={bucket} onBucketChange={setBucket} />
          ) : null}

          <Snackbar
            open={snack.open}
            autoHideDuration={3000}
            onClose={() => setSnack((s) => ({ ...s, open: false }))}
            message={snack.msg}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          />
        </Stack>
      </SectionCard>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>New DBF scenario</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Forks from: {scenarioOptions.find((s) => s.scenario_id === scenarioId)?.name ?? scenarioId}
          </Typography>
          <TextField
            autoFocus fullWidth label="Scenario name" size="small"
            value={newName} onChange={(e) => setNewName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newName.trim() || createScenarioMutation.isPending}
            onClick={() => createScenarioMutation.mutate()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

// ── Shipment tab — separate component to use its own queries ────────────
function ShipmentTab({
  scenarioId, sku, customer, bucket, onBucketChange,
}: {
  scenarioId: string;
  sku: string;
  customer: string;
  bucket: BucketKind;
  onBucketChange: (b: BucketKind) => void;
}) {
  // Local-only fetch — Shipment is read-only in this iteration.
  const { data, isLoading } = useQuery({
    queryKey: ["dbf-shipment", scenarioId, sku, customer],
    queryFn: () =>
      import("../services/api").then((m) =>
        m.fetchDbfShipment({ scenario_id: scenarioId, sku, customer }),
      ),
    enabled: !!sku && !!customer,
  });
  const rows = useMemo(() => {
    const ship = data?.rows ?? [];
    // Aggregate by week (sum across all locations for a single chart line)
    const byWeek = new Map<string, { cons: number; ship: number; inv: number }>();
    for (const r of ship) {
      const cur = byWeek.get(r.week_start) ?? { cons: 0, ship: 0, inv: 0 };
      cur.cons += r.consumption_qty;
      cur.ship += r.shipment_qty;
      cur.inv += r.inventory_position;
      byWeek.set(r.week_start, cur);
    }
    return [...byWeek.entries()].map(([week, v]) => ({
      week,
      values: {
        consumption_qty: Math.round(v.cons),
        shipment_qty: Math.round(v.ship),
        inventory_position: Math.round(v.inv),
      },
    }));
  }, [data]);

  const series = useMemo<ForecastSeriesDef[]>(
    () => [
      { key: "consumption_qty",    label: "Consumption (driver-based)", type: "line", color: "#7c3aed", strokeWidth: 2 },
      { key: "shipment_qty",       label: "Derived shipment forecast",  type: "line", color: "#0ea5e9", strokeWidth: 2.5 },
      { key: "inventory_position", label: "Inventory position",         type: "bar",  color: "#cbd5e1" },
    ],
    [],
  );

  return (
    <ForecastWorkbench
      title={`Derived shipment forecast — ${sku} × ${customer} (across all locations)`}
      rows={rows}
      series={series}
      bucket={bucket}
      onBucketChange={onBucketChange}
      enabledBuckets={["week", "month", "quarter"]}
      adjustments={{}}
      onAdjust={() => undefined}
      locks={new Set()}
      onToggleLock={() => undefined}
      loading={isLoading}
      chartHeight={300}
    />
  );
}
