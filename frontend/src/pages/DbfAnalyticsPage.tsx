import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import ShowChartOutlinedIcon from "@mui/icons-material/ShowChartOutlined";
import TrackChangesOutlinedIcon from "@mui/icons-material/TrackChangesOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import { MenuItem, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { type GridColDef } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { LineChart } from "../charts";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import {
  fetchDbfAccuracy,
  fetchDbfScenarios,
  type DbfAccuracyResponse,
} from "../services/api";

const TIERS = [
  { key: "driver" as const,      label: "Driver Accuracy" },
  { key: "consumption" as const, label: "Consumption Accuracy" },
  { key: "shipment" as const,    label: "Shipment Accuracy" },
];

const compactSx = {
  fontSize: 11,
  "& .MuiDataGrid-cell": { py: 0.25 },
  "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 },
} as const;

export default function DbfAnalyticsPage() {
  const { data: scenarios } = useQuery({
    queryKey: ["dbf-scenarios"],
    queryFn: fetchDbfScenarios,
  });
  const [scenarioId, setScenarioId] = useState("production");
  const [tab, setTab] = useState(0);
  const tier = TIERS[tab].key;

  const accuracyQ = useQuery<DbfAccuracyResponse>({
    queryKey: ["dbf-accuracy", scenarioId, tier],
    queryFn: () => fetchDbfAccuracy(tier, scenarioId),
  });
  const overall = accuracyQ.data?.overall ?? { mape: 0, bias: 0, wmape: 0, weeks: 0 };
  const trend = accuracyQ.data?.trend ?? [];
  const detail = accuracyQ.data?.detail ?? [];

  const detailRows = useMemo(
    () => detail.map((r, idx) => ({ id: `${r.entity}-${idx}`, ...r })),
    [detail],
  );

  const detailColumns: GridColDef[] = [
    { field: "entity", headerName: tier === "driver" ? "Driver" : "SKU", minWidth: 140, flex: 1 },
    { field: "mape",   headerName: "MAPE %",   type: "number", minWidth: 90, flex: 0.6,
      valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(2)}%`) },
    { field: "bias",   headerName: "Bias %",   type: "number", minWidth: 90, flex: 0.6,
      valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(2)}%`) },
    { field: "wmape",  headerName: "WMAPE %",  type: "number", minWidth: 90, flex: 0.6,
      valueFormatter: (v) => (v == null ? "" : `${Number(v).toFixed(2)}%`) },
    { field: "weeks",  headerName: "Weeks",    type: "number", minWidth: 70, flex: 0.4 },
  ];

  return (
    <div className="page-scroll">
      <SectionCard
        title="DBF Analytics"
        subtitle="MAPE / bias / WMAPE for driver, consumption, and derived shipment forecasts."
      >
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              select size="small" label="Scenario" value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
              sx={{ minWidth: 220, "& .MuiInputBase-input": { fontSize: 12 } }}
            >
              {(scenarios?.scenarios ?? []).map((s) => (
                <MenuItem key={s.scenario_id} value={s.scenario_id} sx={{ fontSize: 12 }}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              Past 26 weeks of forecast vs. actual
            </Typography>
          </Stack>

          <KpiCardRow>
            <KpiCard tone="network" icon={<TrendingUpOutlinedIcon fontSize="small" />} title="MAPE"  value={`${overall.mape.toFixed(2)}%`} sub={`${overall.weeks} weeks`} />
            <KpiCard tone="demand"  icon={<TrackChangesOutlinedIcon fontSize="small" />} title="Bias"  value={`${overall.bias.toFixed(2)}%`} />
            <KpiCard tone="money"   icon={<ShowChartOutlinedIcon fontSize="small" />}    title="WMAPE" value={`${overall.wmape.toFixed(2)}%`} />
            <KpiCard tone="critical" icon={<AssessmentOutlinedIcon fontSize="small" />}   title="Tier" value={TIERS[tab].label} />
          </KpiCardRow>

          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}>
            {TIERS.map((t) => <Tab key={t.key} label={t.label} />)}
          </Tabs>

          <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mt: 1 }}>
            Accuracy trend ({TIERS[tab].label})
          </Typography>
          <div className="chart-shell" style={{ minHeight: 280 }}>
            <LineChart
              chartId={`dbf-accuracy-trend-${tier}`}
              data={trend}
              xKey="week_start"
              height={280}
              series={[
                { field: "mape",  label: "MAPE %",  type: "line", color: "#dc2626", strokeWidth: 2 },
                { field: "wmape", label: "WMAPE %", type: "line", color: "#7c3aed", strokeWidth: 1.5, strokeDasharray: "dashed" },
                { field: "bias",  label: "Bias %",  type: "line", color: "#16a34a", strokeWidth: 1.5 },
              ]}
            />
          </div>

          <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600, mt: 1 }}>
            Per-{tier === "driver" ? "driver" : "SKU"} accuracy detail
          </Typography>
          <div className="maintenance-grid-shell" style={{ height: 360 }}>
            <SmartDataGrid
              rows={detailRows}
              columns={detailColumns}
              loading={accuracyQ.isLoading}
              disableRowSelectionOnClick
              getRowId={(row) => row.id}
              pageSizeOptions={[10, 25, 50]}
              initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
              sx={{ border: 0, ...compactSx }}
              exportFileName={`dbf-accuracy-${tier}`}
              slotProps={{ toolbar: { exportFileName: `dbf-accuracy-${tier}` } as never }}
            />
          </div>
        </Stack>
      </SectionCard>
    </div>
  );
}
