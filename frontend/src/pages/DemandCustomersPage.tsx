import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import { Box, Chip, Stack, Tab, Tabs, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { BarChart } from "../charts";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { fetchCustomerHierarchy } from "../services/api";
import type { CustomerHierarchyRecord, CustomerHierarchyResponse } from "../types";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";

const compactSx = { fontSize: 11, "& .MuiDataGrid-cell": { py: 0.25 }, "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 } } as const;

function buildParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), filters);
}

function normalizeType(raw: string) {
  return String(raw || "")
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function customerTypeChipColor(t: string): "primary" | "secondary" | "info" | "warning" | "default" {
  const s = normalizeType(t);
  if (s.includes("direct")) return "primary";
  if (s.includes("indirect")) return "secondary";
  if (s.includes("broker")) return "info";
  if (s.includes("distributor") || s.includes("wholesale")) return "warning";
  return "default";
}

function CustomerTypeChip({ type }: { type: string }) {
  return <Chip size="small" label={type || "—"} color={customerTypeChipColor(type)} sx={{ height: 22, fontSize: 11 }} />;
}

export default function DemandCustomersPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const filtersKey = globalFiltersKey(filters);
  const params = useMemo(() => buildParams(filters), [filtersKey]);

  const { data, isLoading } = useQuery<CustomerHierarchyResponse>({
    queryKey: ["demand-customer-hierarchy", filtersKey],
    queryFn: () => fetchCustomerHierarchy(params),
  });

  const customers = data?.customers ?? [];
  const totalReported = data?.total ?? customers.length;
  const [tab, setTab] = useState(0);

  const nameByCustomerId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) {
      m.set(c.customer_id, c.customer_name);
    }
    return m;
  }, [customers]);

  const kpis = useMemo(() => {
    let direct = 0;
    let indirect = 0;
    let brokers = 0;
    for (const c of customers) {
      const s = normalizeType(c.customer_type);
      if (s.includes("broker")) brokers += 1;
      else if (s.includes("direct")) direct += 1;
      else if (s.includes("indirect")) indirect += 1;
    }
    return { direct, indirect, brokers };
  }, [customers]);

  const planningLevelSummary = useMemo(() => {
    const map = new Map<string, number>();
    let directLevel = 0;
    let indirectLevel = 0;
    for (const c of customers) {
      const level = String(c.planning_level || "").trim() || "—";
      map.set(level, (map.get(level) ?? 0) + 1);
      const pl = normalizeType(level);
      if (pl.includes("direct")) directLevel += 1;
      else if (pl.includes("indirect")) indirectLevel += 1;
    }
    const rows = [...map.entries()]
      .map(([planning_level, count]) => ({ planning_level, count }))
      .sort((a, b) => b.count - a.count || a.planning_level.localeCompare(b.planning_level));
    return { rows, directLevel, indirectLevel };
  }, [customers]);

  const hierarchyColumns = useMemo<GridColDef<CustomerHierarchyRecord>[]>(
    () => [
      { field: "customer_id", headerName: "Customer ID", minWidth: 120, flex: 0.85 },
      { field: "customer_name", headerName: "Customer name", minWidth: 160, flex: 1 },
      {
        field: "parent_customer_id",
        headerName: "Parent customer",
        minWidth: 150,
        flex: 0.95,
        valueGetter: (_v, row) => {
          const pid = row.parent_customer_id;
          if (pid == null || pid === "") return "—";
          return nameByCustomerId.get(pid) ?? pid;
        },
      },
      {
        field: "customer_type",
        headerName: "Type",
        minWidth: 110,
        flex: 0.72,
        renderCell: (p: GridRenderCellParams<CustomerHierarchyRecord>) => <CustomerTypeChip type={String(p.value ?? "")} />,
      },
      { field: "channel", headerName: "Channel", minWidth: 100, flex: 0.7 },
      { field: "region", headerName: "Region", minWidth: 100, flex: 0.68 },
      {
        field: "bill_to",
        headerName: "Bill to",
        minWidth: 120,
        flex: 0.85,
        valueFormatter: (v) => (v == null || v === "" ? "—" : String(v)),
      },
      {
        field: "sold_to",
        headerName: "Sold to",
        minWidth: 120,
        flex: 0.85,
        valueFormatter: (v) => (v == null || v === "" ? "—" : String(v)),
      },
      { field: "planning_level", headerName: "Planning level", minWidth: 130, flex: 0.85 },
    ],
    [nameByCustomerId],
  );

  const planningColumns = useMemo<GridColDef<{ id: string; planning_level: string; count: number }>[]>(
    () => [
      { field: "planning_level", headerName: "Planning level", minWidth: 180, flex: 1 },
      {
        field: "count",
        headerName: "Customers",
        type: "number",
        minWidth: 110,
        flex: 0.5,
        valueFormatter: (v) => (v == null ? "" : Number(v).toLocaleString()),
      },
    ],
    [],
  );

  const planningGridRows = useMemo(
    () => planningLevelSummary.rows.map((r, i) => ({ ...r, id: `pl-${i}-${r.planning_level}` })),
    [planningLevelSummary.rows],
  );

  const planningBarData = useMemo(
    () => [
      { bucket: "Direct (planning level)", count: planningLevelSummary.directLevel },
      { bucket: "Indirect (planning level)", count: planningLevelSummary.indirectLevel },
      {
        bucket: "Other levels",
        count: Math.max(0, customers.length - planningLevelSummary.directLevel - planningLevelSummary.indirectLevel),
      },
    ],
    [planningLevelSummary.directLevel, planningLevelSummary.indirectLevel, customers.length],
  );

  return (
    <div className="page-scroll">
      <SectionCard title="Customer hierarchy" subtitle="Direct and indirect customers, channels, and planning levels">
        <Stack spacing={1}>
          <KpiCardRow>
            <KpiCard
              tone="network"
              icon={<GroupsOutlinedIcon fontSize="small" />}
              title="Total customers"
              value={isLoading ? "…" : String(totalReported)}
            />
            <KpiCard
              tone="demand"
              icon={<PersonOutlinedIcon fontSize="small" />}
              title="Direct"
              value={isLoading ? "…" : String(kpis.direct)}
            />
            <KpiCard
              tone="money"
              icon={<HubOutlinedIcon fontSize="small" />}
              title="Indirect"
              value={isLoading ? "…" : String(kpis.indirect)}
            />
            <KpiCard
              tone="critical"
              icon={<AccountTreeOutlinedIcon fontSize="small" />}
              title="Brokers"
              value={isLoading ? "…" : String(kpis.brokers)}
            />
          </KpiCardRow>

          <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5, fontSize: 11 } }}>
            <Tab label="Customer hierarchy" />
            <Tab label="Planning levels" />
          </Tabs>

          {tab === 0 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Customer master
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 480 }}>
                <SmartDataGrid
                  rows={customers}
                  columns={hierarchyColumns}
                  loading={isLoading}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50, 100]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-customer-hierarchy"
                  slotProps={{
                    toolbar: { exportFileName: "demand-customer-hierarchy" },
                  }}
                />
              </div>
            </Stack>
          ) : null}

          {tab === 1 ? (
            <Stack spacing={1}>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Planning level distribution
              </Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: "stretch" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontSize: 11, mb: 0.5 }} color="text.secondary">
                    Direct vs indirect (planning level label contains &quot;direct&quot; / &quot;indirect&quot;)
                  </Typography>
                  <Stack spacing={0.5} sx={{ fontSize: 11 }}>
                    <Typography sx={{ fontSize: 11 }}>
                      <strong>Direct planning levels:</strong> {planningLevelSummary.directLevel.toLocaleString()} customers
                    </Typography>
                    <Typography sx={{ fontSize: 11 }}>
                      <strong>Indirect planning levels:</strong> {planningLevelSummary.indirectLevel.toLocaleString()} customers
                    </Typography>
                    <Typography sx={{ fontSize: 11 }} color="text.secondary">
                      Remaining rows use other planning level labels or do not match those keywords.
                    </Typography>
                  </Stack>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }} className="chart-shell" style={{ minHeight: 220 }}>
                  <BarChart
                    chartId="demand-customers-planning-bar"
                    data={planningBarData}
                    xKey="bucket"
                    height={240}
                    series={[{ field: "count", label: "Customers", color: "#2679A8" }]}
                  />
                </Box>
              </Stack>
              <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                Count by planning level
              </Typography>
              <div className="maintenance-grid-shell" style={{ height: 360 }}>
                <SmartDataGrid
                  rows={planningGridRows}
                  columns={planningColumns}
                  loading={isLoading}
                  disableRowSelectionOnClick
                  getRowId={(row) => row.id}
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0, ...compactSx }}
                  exportFileName="demand-planning-levels"
                  slotProps={{
                    toolbar: { exportFileName: "demand-planning-levels" },
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
