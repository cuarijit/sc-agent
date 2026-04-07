import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import {
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { type GridColDef } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

import type { ShellContextValue } from "../components/layout/AppShellLayout";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { fetchSopCycles, fetchSopReviewItems } from "../services/api";
import type {
  SopCycleRecord,
  SopCycleResponse,
  SopReviewItemRecord,
  SopReviewItemResponse,
} from "../types";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";

const compactSx = {
  fontSize: 11,
  "& .MuiTypography-root": { fontSize: 11 },
} as const;

const gridCompactSx = {
  border: 0,
  fontSize: 11,
  "& .MuiDataGrid-cell": { py: 0.25 },
  "& .MuiDataGrid-columnHeaderTitle": { fontSize: 11 },
} as const;

function formatShortDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function statusChipColor(status: string): "success" | "warning" | "info" | "default" {
  const s = status.toLowerCase();
  if (s === "completed") return "success";
  if (s === "in_review") return "warning";
  if (s === "planning") return "info";
  return "default";
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function reviewTypeChipColor(reviewType: string): "info" | "warning" | "secondary" | "error" | "default" {
  switch (reviewType) {
    case "demand_review":
      return "info";
    case "supply_review":
      return "secondary";
    case "pre_sop":
      return "warning";
    case "exec_sop":
      return "error";
    default:
      return "default";
  }
}

function itemStatusChipColor(status: string): "success" | "warning" | "error" | "info" | "default" {
  const s = String(status || "").toLowerCase();
  if (s === "closed" || s === "resolved" || s === "done") return "success";
  if (s === "open" || s === "in_progress") return "warning";
  if (s === "blocked" || s === "escalated") return "error";
  if (s === "new") return "info";
  return "default";
}

type Milestone = { label: string; date: string | null };

function cycleMilestones(cycle: SopCycleRecord): Milestone[] {
  return [
    { label: "Demand Review", date: cycle.demand_review_date },
    { label: "Supply Review", date: cycle.supply_review_date },
    { label: "Pre-S&OP", date: cycle.pre_sop_date },
    { label: "Exec S&OP", date: cycle.exec_sop_date },
  ];
}

function MilestoneStepper({ milestones }: { milestones: Milestone[] }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="stretch" sx={{ flexWrap: "wrap", mt: 0.75 }}>
      {milestones.map((m, i) => (
        <Stack key={m.label} direction="row" alignItems="center" spacing={0.5}>
          <Box
            sx={{
              minWidth: 72,
              px: 0.75,
              py: 0.5,
              borderRadius: 1,
              border: 1,
              borderColor: "divider",
              bgcolor: "action.hover",
            }}
          >
            <Typography sx={{ fontSize: 10, fontWeight: 600, lineHeight: 1.2 }}>{m.label}</Typography>
            <Typography sx={{ fontSize: 10, color: "text.secondary", lineHeight: 1.2 }}>{formatShortDate(m.date)}</Typography>
          </Box>
          {i < milestones.length - 1 ? (
            <Typography sx={{ fontSize: 10, color: "text.disabled", px: 0.25 }} aria-hidden>
              →
            </Typography>
          ) : null}
        </Stack>
      ))}
    </Stack>
  );
}

type ReviewGridRow = SopReviewItemRecord & { id: number };

function CycleHeaderCard({ cycle }: { cycle: SopCycleRecord }) {
  const milestones = cycleMilestones(cycle);
  return (
    <Box
      sx={{
        p: 1,
        minWidth: 200,
        flex: "1 1 200px",
        maxWidth: 320,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
      }}
    >
      <Stack spacing={0.25}>
        <Typography sx={{ fontSize: 11, fontWeight: 600 }} noWrap title={cycle.cycle_name}>
          {cycle.cycle_name}
        </Typography>
        <Typography sx={{ fontSize: 10, color: "text.secondary" }}>{cycle.cycle_month}</Typography>
        <Chip size="small" label={humanizeStatus(cycle.status)} color={statusChipColor(cycle.status)} sx={{ height: 22, fontSize: 10, alignSelf: "flex-start" }} />
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ pt: 0.25 }}>
          {milestones.map((m) => (
            <Typography key={m.label} sx={{ fontSize: 9, color: "text.secondary" }}>
              {m.label}: {formatShortDate(m.date)}
            </Typography>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}

export default function DemandSopPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const filtersKey = globalFiltersKey(filters);
  const params = useMemo(() => appendGlobalFilters(new URLSearchParams(), filters), [filtersKey]);

  const [tab, setTab] = useState(0);
  const [consensusVisual, setConsensusVisual] = useState<Record<string, "approved" | "rejected" | null>>({});

  const cyclesQuery = useQuery<SopCycleResponse>({
    queryKey: ["demand", "sop-cycles", filtersKey],
    queryFn: () => fetchSopCycles(params),
  });

  const reviewItemsQuery = useQuery<SopReviewItemResponse>({
    queryKey: ["demand", "sop-review-items", filtersKey],
    queryFn: () => fetchSopReviewItems(params),
  });

  const cycles = cyclesQuery.data?.cycles ?? [];
  const reviewItems = reviewItemsQuery.data?.items ?? [];

  const cyclesByStatus = useMemo(() => {
    const planning = cycles.filter((c) => c.status === "planning");
    const inReview = cycles.filter((c) => c.status === "in_review");
    const completed = cycles.filter((c) => c.status === "completed");
    return { planning, inReview, completed };
  }, [cycles]);

  const itemsByCycle = useMemo(() => {
    const map = new Map<string, SopReviewItemRecord[]>();
    for (const item of reviewItems) {
      const list = map.get(item.cycle_id) ?? [];
      list.push(item);
      map.set(item.cycle_id, list);
    }
    return map;
  }, [reviewItems]);

  const gridRows: ReviewGridRow[] = useMemo(
    () => reviewItems.map((row) => ({ ...row, id: row.id })),
    [reviewItems],
  );

  const columns = useMemo<GridColDef<ReviewGridRow>[]>(
    () => [
      { field: "cycle_id", headerName: "Cycle ID", minWidth: 110, flex: 0.7 },
      {
        field: "review_type",
        headerName: "Review Type",
        minWidth: 120,
        flex: 0.8,
        renderCell: (params) => (
          <Chip
            size="small"
            label={humanizeStatus(String(params.value))}
            color={reviewTypeChipColor(String(params.value))}
            sx={{ height: 20, fontSize: 10 }}
          />
        ),
      },
      { field: "sku", headerName: "SKU", minWidth: 100, flex: 0.7 },
      { field: "location", headerName: "Location", minWidth: 90, flex: 0.6 },
      { field: "topic", headerName: "Topic", minWidth: 200, flex: 1.2 },
      {
        field: "gap_qty",
        headerName: "Gap Qty",
        type: "number",
        minWidth: 85,
        flex: 0.5,
        valueFormatter: (value) => (value == null ? "" : Number(value).toLocaleString()),
      },
      { field: "action_required", headerName: "Action Required", minWidth: 180, flex: 1 },
      { field: "owner", headerName: "Owner", minWidth: 110, flex: 0.7 },
      {
        field: "status",
        headerName: "Status",
        minWidth: 100,
        flex: 0.55,
        renderCell: (params) => (
          <Chip
            size="small"
            label={String(params.value ?? "—")}
            color={itemStatusChipColor(String(params.value ?? ""))}
            sx={{ height: 20, fontSize: 10 }}
          />
        ),
      },
      { field: "due_date", headerName: "Due Date", minWidth: 100, flex: 0.6, valueFormatter: (v) => formatShortDate(v as string | null) },
    ],
    [],
  );

  const statusLane = (title: string, list: SopCycleRecord[]) => (
    <Box sx={{ flex: "1 1 220px", minWidth: 200 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: "text.secondary", mb: 0.5, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {title}
      </Typography>
      <Stack spacing={0.75}>
        {list.length === 0 ? (
          <Typography sx={{ fontSize: 10, color: "text.disabled" }}>No cycles</Typography>
        ) : (
          list.map((c) => <CycleHeaderCard key={c.cycle_id} cycle={c} />)
        )}
      </Stack>
    </Box>
  );

  return (
    <div className="page-scroll">
      <SectionCard title="S&OP / IBP Cycle Support" subtitle="Demand–supply alignment, review workflow, and executive consensus">
        <Stack spacing={1} sx={compactSx}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-start">
            {statusLane("Planning", cyclesByStatus.planning)}
            {statusLane("In review", cyclesByStatus.inReview)}
            {statusLane("Completed", cyclesByStatus.completed)}
          </Stack>

          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0.5, fontSize: 11 } }}>
            <Tab label="Cycle Overview" />
            <Tab label="Review Items" />
            <Tab label="Consensus Approval" />
          </Tabs>

          {tab === 0 && (
            <Stack spacing={1}>
              {cycles.map((cycle) => (
                <Box
                  key={cycle.cycle_id}
                  sx={{
                    p: 1,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    bgcolor: "background.paper",
                  }}
                >
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} flexWrap="wrap">
                    <Stack spacing={0.25}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{cycle.cycle_name}</Typography>
                      <Typography sx={{ fontSize: 10, color: "text.secondary" }}>{cycle.cycle_month}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={humanizeStatus(cycle.status)} color={statusChipColor(cycle.status)} sx={{ height: 22, fontSize: 10 }} />
                      {cycle.consensus_approved ? (
                        <Chip
                          size="small"
                          icon={<CheckCircleOutlineIcon sx={{ fontSize: "14px !important" }} />}
                          label="Consensus approved"
                          color="success"
                          variant="outlined"
                          sx={{ height: 22, fontSize: 10 }}
                        />
                      ) : (
                        <Chip size="small" label="Consensus pending" color="default" variant="outlined" sx={{ height: 22, fontSize: 10 }} />
                      )}
                    </Stack>
                  </Stack>
                  <MilestoneStepper milestones={cycleMilestones(cycle)} />
                  {cycle.approved_by ? (
                    <Typography sx={{ fontSize: 10, color: "text.secondary", mt: 0.5 }}>Approved by {cycle.approved_by}</Typography>
                  ) : null}
                </Box>
              ))}
              {cycles.length === 0 ? <Typography sx={{ fontSize: 11, color: "text.secondary" }}>No S&OP cycles loaded.</Typography> : null}
            </Stack>
          )}

          {tab === 1 && (
            <div className="maintenance-grid-shell" style={{ height: 520 }}>
              <SmartDataGrid
                rows={gridRows}
                columns={columns}
                loading={reviewItemsQuery.isLoading}
                disableRowSelectionOnClick
                density="compact"
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                sx={gridCompactSx}
                slotProps={{ toolbar: { exportFileName: "sop-review-items" } }}
              />
            </div>
          )}

          {tab === 2 && (
            <Stack spacing={1.25}>
              {cycles.map((cycle) => {
                const grouped = itemsByCycle.get(cycle.cycle_id) ?? [];
                const visual = consensusVisual[cycle.cycle_id] ?? null;
                return (
                  <Box key={cycle.cycle_id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1, bgcolor: "background.paper" }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1}>
                      <Stack spacing={0.25}>
                        <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{cycle.cycle_name}</Typography>
                        <Typography sx={{ fontSize: 10, color: "text.secondary" }}>
                          {cycle.cycle_id} · {cycle.cycle_month}
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                        {cycle.consensus_approved ? (
                          <Badge color="success" variant="dot">
                            <Chip size="small" label="Recorded approved" color="success" variant="outlined" sx={{ height: 24, fontSize: 10 }} />
                          </Badge>
                        ) : null}
                        <Button
                          size="small"
                          variant={visual === "approved" ? "contained" : "outlined"}
                          color="success"
                          sx={{ fontSize: 10, minWidth: 88, py: 0.25 }}
                          onClick={() => setConsensusVisual((prev) => ({ ...prev, [cycle.cycle_id]: "approved" }))}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          variant={visual === "rejected" ? "contained" : "outlined"}
                          color="error"
                          sx={{ fontSize: 10, minWidth: 88, py: 0.25 }}
                          onClick={() => setConsensusVisual((prev) => ({ ...prev, [cycle.cycle_id]: "rejected" }))}
                        >
                          Reject
                        </Button>
                      </Stack>
                    </Stack>
                    <Divider sx={{ my: 0.75 }} />
                    <Typography sx={{ fontSize: 10, fontWeight: 600, color: "text.secondary", mb: 0.5 }}>Consensus-related review items</Typography>
                    {grouped.length === 0 ? (
                      <Typography sx={{ fontSize: 10, color: "text.disabled" }}>No review items for this cycle.</Typography>
                    ) : (
                      <Stack spacing={0.5}>
                        {grouped.map((item) => (
                          <Stack
                            key={item.id}
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            flexWrap="wrap"
                            useFlexGap
                            sx={{ py: 0.25, borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}
                          >
                            <Chip size="small" label={humanizeStatus(item.review_type)} color={reviewTypeChipColor(item.review_type)} sx={{ height: 20, fontSize: 10 }} />
                            <Typography sx={{ fontSize: 10 }}>{item.sku}</Typography>
                            <Typography sx={{ fontSize: 10, color: "text.secondary" }}>{item.location}</Typography>
                            <Typography sx={{ fontSize: 10, flex: 1, minWidth: 160 }}>{item.topic}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    )}
                  </Box>
                );
              })}
            </Stack>
          )}
        </Stack>
      </SectionCard>
    </div>
  );
}
