import { Button, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import type { DashboardResponse } from "../types";
import { fetchDashboard } from "../services/api";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";
import { RecommendationTable, SectionCard } from "../components/shared/UiBits";
import FilterBuilderDialog from "../components/shared/FilterBuilderDialog";
import { EMPTY_FILTER_STATE, applyFilterState, type FilterFieldOption, type FilterState } from "../filtering";

export default function RecommendationsPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>(EMPTY_FILTER_STATE);
  const params = appendGlobalFilters(new URLSearchParams(), filters);
  const filtersKey = globalFiltersKey(filters);
  const { data } = useQuery<DashboardResponse>({
    queryKey: ["recommendations", filtersKey],
    queryFn: () => fetchDashboard(params),
  });
  const fields: FilterFieldOption[] = [
    { key: "sku", label: "SKU", type: "text", suggestions: data?.recommendations.map((row) => row.sku) ?? [] },
    { key: "location", label: "Location", type: "text", suggestions: data?.recommendations.map((row) => row.location) ?? [] },
    { key: "region", label: "Region", type: "text", suggestions: data?.recommendations.map((row) => row.region) ?? [] },
    { key: "status", label: "Status", type: "text", suggestions: data?.recommendations.map((row) => row.status) ?? [] },
    { key: "action", label: "Action", type: "text", suggestions: data?.recommendations.map((row) => row.action) ?? [] },
    { key: "shortage_qty", label: "Shortage", type: "number" },
    { key: "eta", label: "ETA", type: "date" },
  ];
  const rows = useMemo(() => applyFilterState(data?.recommendations ?? [], fields, filterState), [data?.recommendations, fields, filterState]);

  return (
    <div className="page-scroll">
      <SectionCard title="Ranked Sourcing Recommendations" subtitle="Deterministic scoring with planner-facing rationale">
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Button variant="outlined" onClick={() => setFilterDialogOpen(true)}>Advanced Filters</Button>
          <Typography variant="caption" color="text.secondary">
            {filterState.conditions.length ? `${filterState.conditions.length} advanced filters applied` : "No advanced filters"}
          </Typography>
        </Stack>
        <RecommendationTable rows={rows} />
      </SectionCard>
      <FilterBuilderDialog
        open={filterDialogOpen}
        title="Recommendation Filters"
        fields={fields}
        initialState={filterState}
        onClose={() => setFilterDialogOpen(false)}
        onApply={setFilterState}
        onClear={() => setFilterState(EMPTY_FILTER_STATE)}
      />
    </div>
  );
}
