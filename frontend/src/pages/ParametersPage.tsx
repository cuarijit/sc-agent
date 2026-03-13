import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import ContentPasteOutlinedIcon from "@mui/icons-material/ContentPasteOutlined";
import DoneAllOutlinedIcon from "@mui/icons-material/DoneAllOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandLessOutlinedIcon from "@mui/icons-material/ExpandLessOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import RuleOutlinedIcon from "@mui/icons-material/RuleOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { type GridColDef, type GridColumnVisibilityModel, type GridFilterModel, type GridPaginationModel, type GridRowId, type GridRowSelectionModel, type GridSortModel } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";

import type { ParameterException, ParameterValueRecord } from "../types";
import { applyParameterRecommendation, bulkApplyParameterValues, fetchParameterExceptions, fetchParameterValues, pasteParameterValues, runParameterRecommendations, updateParameterValue } from "../services/api";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";
import FilterBuilderDialog from "../components/shared/FilterBuilderDialog";
import ParameterDiagnosticAgent from "./ParameterDiagnosticAgent";
import { EMPTY_FILTER_STATE, applyFilterState, type FilterFieldOption, type FilterState } from "../filtering";

type HierarchyLevel = "global" | "region" | "location" | "sku_location";

function parsePasteRows(input: string, sourceType: string, reason: string) {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const first = lines[0].toLowerCase();
  const hasHeader = first.includes("sku") && first.includes("location") && first.includes("parameter");
  const content = hasHeader ? lines.slice(1) : lines;
  return content
    .map((line) => {
      const parts = (line.includes("\t") ? line.split("\t") : line.split(",")).map((part) => part.trim());
      if (parts.length < 4) return null;
      return {
        sku: parts[0],
        location: parts[1],
        parameter_code: parts[2],
        effective_value: parts[3],
        explicit_value: parts[4] || parts[3],
        source_type: sourceType,
        reason,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row?.sku && row.location && row.parameter_code && row.effective_value));
}

export default function ParametersPage() {
  const { filters } = useOutletContext<ShellContextValue>();
  const navigate = useNavigate();
  const [parameterAgentModalOpen, setParameterAgentModalOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [buildOpen, setBuildOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [bulkValue, setBulkValue] = useState("");
  const [bulkSourceType, setBulkSourceType] = useState("bulk_override");
  const [bulkReason, setBulkReason] = useState("Bulk parameter update from parameter workbench.");
  const [pasteValue, setPasteValue] = useState("");
  const [pasteSourceType, setPasteSourceType] = useState("paste_import");
  const [pasteReason, setPasteReason] = useState("Value imported through paste dialog.");
  const [selectedRowIds, setSelectedRowIds] = useState<GridRowId[]>([]);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [sortModel, setSortModel] = useState<GridSortModel>([{ field: "sku", sort: "asc" }]);
  const [gridFilterModel, setGridFilterModel] = useState<GridFilterModel>({ items: [] });
  const [columnVisibilityModel, setColumnVisibilityModel] = useState<GridColumnVisibilityModel>({});
  const [exceptionPaginationModel, setExceptionPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 10 });
  const [exceptionSortModel, setExceptionSortModel] = useState<GridSortModel>([{ field: "sku", sort: "asc" }]);
  const [exceptionFilterModel, setExceptionFilterModel] = useState<GridFilterModel>({ items: [] });
  const [exceptionColumnVisibilityModel, setExceptionColumnVisibilityModel] = useState<GridColumnVisibilityModel>({});
  const [selectedExceptionRowIds, setSelectedExceptionRowIds] = useState<GridRowId[]>([]);
  const [acceptRecommendedOpen, setAcceptRecommendedOpen] = useState(false);
  const [paramRulesModalOpen, setParamRulesModalOpen] = useState(false);
  const [paramRuleFormOpen, setParamRuleFormOpen] = useState(false);
  const [editingParamRuleId, setEditingParamRuleId] = useState<string | null>(null);
  const [paramRules, setParamRules] = useState<Array<{ id: string; name: string; enabled: boolean; issueType: string; severity: string; description: string }>>(() => [
    { id: "pr1", name: "Missing parameter → Critical", enabled: true, issueType: "missing", severity: "critical", description: "Raise critical when parameter value is missing." },
    { id: "pr2", name: "Stale parameter → Warning", enabled: true, issueType: "stale", severity: "warning", description: "Warn when parameter has not been reviewed within threshold." },
    { id: "pr3", name: "Invalid value → Warning", enabled: true, issueType: "invalid", severity: "warning", description: "Warn when value fails validation." },
    { id: "pr4", name: "Misaligned → Info", enabled: true, issueType: "misaligned", severity: "info", description: "Info when parameter is misaligned with policy." },
    { id: "pr5", name: "Expired override → Critical", enabled: false, issueType: "expired", severity: "critical", description: "Critical when override has expired." },
  ]);
  const [paramRuleForm, setParamRuleForm] = useState({ name: "", issueType: "missing", severity: "critical", description: "" });
  const [paramWorkbenchTab, setParamWorkbenchTab] = useState(0);
  const [paramExceptionDashboardCollapsed, setParamExceptionDashboardCollapsed] = useState(false);
  const [manualOverrideOpen, setManualOverrideOpen] = useState(false);
  const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>("global");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedSkuLocation, setSelectedSkuLocation] = useState("");
  const [hierarchyParameterCode, setHierarchyParameterCode] = useState("");
  const [hierarchyValue, setHierarchyValue] = useState("");
  const [hierarchyReason, setHierarchyReason] = useState("Hierarchy update from Parameter Hierarchy Manager.");
  const queryClient = useQueryClient();
  const filtersKey = globalFiltersKey(filters);
  const valueParams = appendGlobalFilters(new URLSearchParams(), { ...filters, runId: "", category: "", supplier: "", exceptionStatus: "" });
  const exceptionParams = appendGlobalFilters(new URLSearchParams(), { ...filters, runId: "", category: "", supplier: "" });

  const { data: values } = useQuery<ParameterValueRecord[]>({
    queryKey: ["parameter-values", filtersKey],
    queryFn: () => fetchParameterValues(valueParams),
  });

  const { data: exceptions } = useQuery<ParameterException[]>({
    queryKey: ["parameter-exceptions", filtersKey],
    queryFn: () => fetchParameterExceptions(exceptionParams),
  });

  const inlineMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { effective_value: string; explicit_value?: string | null; source_type?: string; reason?: string } }) =>
      updateParameterValue(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parameter-values"] });
      void queryClient.invalidateQueries({ queryKey: ["parameter-exceptions"] });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (payload: { record_ids: number[]; effective_value: string; source_type: string; reason: string }) => bulkApplyParameterValues(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parameter-values"] });
      void queryClient.invalidateQueries({ queryKey: ["parameter-exceptions"] });
    },
  });

  const pasteMutation = useMutation({
    mutationFn: (payload: { rows: Array<{ sku: string; location: string; parameter_code: string; effective_value: string; explicit_value?: string | null; source_type?: string; reason?: string }> }) =>
      pasteParameterValues(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parameter-values"] });
      void queryClient.invalidateQueries({ queryKey: ["parameter-exceptions"] });
    },
  });

  const runMutation = useMutation({
    mutationFn: () => runParameterRecommendations({ parameter_codes: [], scope_filters: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parameter-exceptions"] });
      setParamWorkbenchTab(0);
    },
  });
  const applyMutation = useMutation({
    mutationFn: (recommendationId: string) => applyParameterRecommendation(recommendationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parameter-values"] });
      void queryClient.invalidateQueries({ queryKey: ["parameter-exceptions"] });
    },
  });

  const filterFields = useMemo<FilterFieldOption[]>(
    () => [
      { key: "sku", label: "SKU", type: "text", suggestions: [...new Set((values ?? []).map((row) => row.sku))] },
      { key: "location", label: "Location", type: "text", suggestions: [...new Set((values ?? []).map((row) => row.location))] },
      { key: "region", label: "Region", type: "text", suggestions: [...new Set((values ?? []).map((row) => row.region ?? ""))] },
      { key: "parameter_code", label: "Parameter Code", type: "text", suggestions: [...new Set((values ?? []).map((row) => row.parameter_code))] },
      { key: "parameter_name", label: "Parameter Name", type: "text", suggestions: [...new Set((values ?? []).map((row) => row.parameter_name))] },
      { key: "effective_value", label: "Effective Value", type: "text" },
      { key: "source_type", label: "Source Type", type: "text", suggestions: [...new Set((values ?? []).map((row) => row.source_type))] },
    ],
    [values],
  );
  const rows = useMemo(
    () => applyFilterState(values ?? [], filterFields, filterState),
    [values, filterFields, filterState],
  );

  const columns = useMemo<GridColDef<ParameterValueRecord>[]>(
    () => [
      { field: "sku", headerName: "SKU", minWidth: 140, flex: 1 },
      { field: "location", headerName: "Location", minWidth: 140, flex: 1 },
      { field: "region", headerName: "Region", minWidth: 120, flex: 1 },
      { field: "parameter_code", headerName: "Parameter Code", minWidth: 190, flex: 1.3 },
      { field: "parameter_name", headerName: "Parameter Name", minWidth: 190, flex: 1.3 },
      { field: "effective_value", headerName: "Effective Value", minWidth: 150, flex: 1, editable: true },
      { field: "explicit_value", headerName: "Explicit Value", minWidth: 150, flex: 1, editable: true },
      { field: "source_type", headerName: "Source Type", minWidth: 150, flex: 1, editable: true },
      { field: "reason", headerName: "Reason", minWidth: 260, flex: 1.8, editable: true },
      { field: "inherited_from", headerName: "Inheritance Path", minWidth: 240, flex: 1.8 },
    ],
    [],
  );
  const exceptionRows = useMemo(
    () => (exceptions ?? []).map((row) => ({ ...row, id: row.recommendation_id })),
    [exceptions],
  );
  const exceptionDashboardMetrics = useMemo(() => {
    const ex = exceptions ?? [];
    const issueCounts: Record<string, number> = { missing: 0, stale: 0, invalid: 0, misaligned: 0 };
    ex.forEach((row) => {
      if (row.issue_type in issueCounts) issueCounts[row.issue_type as keyof typeof issueCounts]++;
    });
    const vals = values ?? [];
    const uniqueParams = new Set(vals.map((r) => r.parameter_code)).size;
    const uniqueSkus = new Set(vals.map((r) => r.sku)).size;
    const uniqueNodes = new Set(vals.map((r) => r.location)).size;
    const totalParamRecords = vals.length;
    return { issueCounts, uniqueParams, uniqueSkus, uniqueNodes, totalParamRecords };
  }, [exceptions, values]);
  const parameterCodes = useMemo(
    () => [...new Set((values ?? []).map((row) => row.parameter_code))].sort(),
    [values],
  );
  const regions = useMemo(
    () => [...new Set((values ?? []).map((row) => row.region).filter(Boolean) as string[])].sort(),
    [values],
  );
  const locationsForRegion = useMemo(
    () => [...new Set((values ?? []).filter((row) => !selectedRegion || row.region === selectedRegion).map((row) => row.location))].sort(),
    [values, selectedRegion],
  );
  const skuLocationsForLocation = useMemo(
    () => [...new Set((values ?? []).filter((row) => !selectedLocation || row.location === selectedLocation).map((row) => `${row.sku} | ${row.location}`))].sort(),
    [values, selectedLocation],
  );
  const hierarchyTargetRows = useMemo(() => {
    const base = values ?? [];
    const withParameter = hierarchyParameterCode ? base.filter((row) => row.parameter_code === hierarchyParameterCode) : base;
    if (hierarchyLevel === "global") return withParameter;
    if (hierarchyLevel === "region") return withParameter.filter((row) => row.region === selectedRegion);
    if (hierarchyLevel === "location") return withParameter.filter((row) => row.location === selectedLocation);
    if (!selectedSkuLocation) return [];
    const [sku, location] = selectedSkuLocation.split("|").map((item) => item.trim());
    return withParameter.filter((row) => row.sku === sku && row.location === location);
  }, [values, hierarchyLevel, hierarchyParameterCode, selectedRegion, selectedLocation, selectedSkuLocation]);
  const hierarchyCanApply = Boolean(
    hierarchyValue.trim()
    && hierarchyParameterCode
    && (
      hierarchyLevel === "global"
      || (hierarchyLevel === "region" && selectedRegion)
      || (hierarchyLevel === "location" && selectedLocation)
      || (hierarchyLevel === "sku_location" && selectedSkuLocation)
    )
    && hierarchyTargetRows.length
  );
  const getIssueBadgeTone = (issueTypeValue: string) => {
    const issueType = issueTypeValue.toLowerCase();
    if (issueType === "missing" || issueType === "expired") {
      return "error";
    }
    if (issueType === "invalid" || issueType === "stale") {
      return "warning";
    }
    if (issueType === "misaligned") {
      return "info";
    }
    return "default";
  };
  const exceptionColumns = useMemo<GridColDef<(ParameterException & { id: string })>[]>(
    () => [
      { field: "recommendation_id", headerName: "Recommendation ID", minWidth: 170, flex: 1.1 },
      { field: "sku", headerName: "SKU", minWidth: 130, flex: 1 },
      { field: "product_name", headerName: "Product", minWidth: 180, flex: 1.4 },
      { field: "location", headerName: "Location", minWidth: 130, flex: 1 },
      { field: "parameter_code", headerName: "Parameter Code", minWidth: 170, flex: 1.2 },
      {
        field: "issue_type",
        headerName: "Issue",
        minWidth: 130,
        flex: 1,
        renderCell: (params) => {
          const issueLabel = String(params.row.issue_type ?? "").replace(/_/g, " ");
          const tone = getIssueBadgeTone(issueLabel);
          return (
            <Box
              component="span"
              sx={(theme) => {
                const mainColor =
                  tone === "error"
                    ? theme.palette.error.main
                    : tone === "warning"
                      ? theme.palette.warning.main
                      : tone === "info"
                        ? theme.palette.info.main
                        : theme.palette.text.secondary;
                return {
                  display: "inline-flex",
                  alignItems: "center",
                  border: "1px solid",
                  borderRadius: "999px",
                  px: 1,
                  py: 0.25,
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  lineHeight: 1.2,
                  textTransform: "capitalize",
                  backgroundColor: alpha(mainColor, theme.palette.mode === "dark" ? 0.24 : 0.12),
                  color: theme.palette.mode === "dark" ? theme.palette.getContrastText(alpha(mainColor, 0.7)) : mainColor,
                  borderColor: alpha(mainColor, theme.palette.mode === "dark" ? 0.5 : 0.35),
                };
              }}
            >
              {issueLabel}
            </Box>
          );
        },
      },
      { field: "current_effective_value", headerName: "Current", minWidth: 120, flex: 0.9 },
      { field: "recommended_value", headerName: "Recommended", minWidth: 130, flex: 0.9 },
      { field: "confidence_score", headerName: "Confidence", minWidth: 120, flex: 0.8, type: "number" },
      { field: "status", headerName: "Status", minWidth: 110, flex: 0.8 },
      {
        field: "action",
        headerName: "Action",
        minWidth: 120,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Button
            size="small"
            variant="outlined"
            disabled={params.row.status === "applied" || applyMutation.isPending}
            onClick={() => {
              applyMutation.mutate(params.row.recommendation_id);
            }}
          >
            {params.row.status === "applied" ? "Applied" : "Apply"}
          </Button>
        ),
      },
    ],
    [applyMutation],
  );

  return (
    <div className="page-scroll">
      <SectionCard title="Parameter Exception Workbench" subtitle="Manage-by-exception lead time, service, and safety-stock recommendations">
        <Tabs value={paramWorkbenchTab} onChange={(_event, value) => setParamWorkbenchTab(value)} sx={{ mb: 1 }}>
          <Tab label="Exceptions" />
          <Tab label="Parameter Workbench" />
        </Tabs>

        {paramWorkbenchTab === 0 ? (
          <div>
            <SectionCard title="Parameter exception dashboard" subtitle="Issues and parameter scope KPIs">
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                <Typography variant="subtitle2">Dashboard</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<SmartToyOutlinedIcon />}
                    onClick={() => setParameterAgentModalOpen(true)}
                  >
                    Parameter Diagnostic Agent
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={paramExceptionDashboardCollapsed ? <ExpandMoreOutlinedIcon /> : <ExpandLessOutlinedIcon />}
                    onClick={() => setParamExceptionDashboardCollapsed((prev) => !prev)}
                  >
                    {paramExceptionDashboardCollapsed ? "Expand" : "Collapse"}
                  </Button>
                </Stack>
              </Stack>
              {!paramExceptionDashboardCollapsed ? (
              <div className="alerts-kpi-group-row">
                <Box className="alerts-kpi-group-card alerts-kpi-critical">
                  <Box className="alerts-kpi-group-head">
                    <Box className="alerts-kpi-group-icon">
                      <WarningAmberOutlinedIcon fontSize="small" />
                    </Box>
                    <Typography className="alerts-kpi-group-title">Issues</Typography>
                  </Box>
                  <Stack spacing={0.5}>
                    <Box className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">Missing</Typography>
                      <Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.issueCounts.missing}</Typography>
                    </Box>
                    <Box className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">Stale</Typography>
                      <Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.issueCounts.stale}</Typography>
                    </Box>
                    <Box className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">Invalid</Typography>
                      <Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.issueCounts.invalid}</Typography>
                    </Box>
                    <Box className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">Misaligned</Typography>
                      <Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.issueCounts.misaligned}</Typography>
                    </Box>
                    <Box className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">Total exceptions</Typography>
                      <Typography className="alerts-kpi-line-value">
                        {(exceptions ?? []).length}
                      </Typography>
                    </Box>
                  </Stack>
                </Box>
                <Box className="alerts-kpi-group-card alerts-kpi-network">
                  <Box className="alerts-kpi-group-head">
                    <Box className="alerts-kpi-group-icon">
                      <AssessmentOutlinedIcon fontSize="small" />
                    </Box>
                    <Typography className="alerts-kpi-group-title">Parameter scope</Typography>
                  </Box>
                  <Stack spacing={0.5}>
                    <Box className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">Total parameters</Typography>
                      <Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.uniqueParams}</Typography>
                    </Box>
                    <Box className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">SKUs with parameters</Typography>
                      <Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.uniqueSkus}</Typography>
                    </Box>
                    <Box className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">Nodes with parameters</Typography>
                      <Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.uniqueNodes}</Typography>
                    </Box>
                    <Box className="alerts-kpi-line">
                      <Typography className="alerts-kpi-line-label">Parameter records</Typography>
                      <Typography className="alerts-kpi-line-value">{exceptionDashboardMetrics.totalParamRecords}</Typography>
                    </Box>
                  </Stack>
                </Box>
              </div>
              ) : null}
            </SectionCard>

            <SectionCard title="Exceptions Workbench" subtitle="Select rows and accept recommendations or manage rules">
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: "wrap" }}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<RuleOutlinedIcon />}
                  onClick={() => setParamRulesModalOpen(true)}
                >
                  Rules
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={selectedExceptionRowIds.length < 1}
                  onClick={() => setAcceptRecommendedOpen(true)}
                >
                  Accept recommended actions
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {selectedExceptionRowIds.length > 0 ? `${selectedExceptionRowIds.length} selected` : "Select one or more rows to accept recommendations"}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Review and apply exception recommendations below. Select one or more rows, then use the action button to accept system recommendations.
              </Typography>
              <div className="maintenance-grid-shell">
                <SmartDataGrid
                  rows={exceptionRows}
                  columns={exceptionColumns}
                  checkboxSelection
                  disableRowSelectionOnClick
                  rowSelectionModel={{ type: "include", ids: new Set(selectedExceptionRowIds) } satisfies GridRowSelectionModel}
                  onRowSelectionModelChange={(model) => setSelectedExceptionRowIds(Array.from(model.ids))}
                  pagination
                  paginationModel={exceptionPaginationModel}
                  onPaginationModelChange={setExceptionPaginationModel}
                  pageSizeOptions={[10, 25, 50, 100]}
                  sortModel={exceptionSortModel}
                  onSortModelChange={setExceptionSortModel}
                  filterModel={exceptionFilterModel}
                  onFilterModelChange={setExceptionFilterModel}
                  columnVisibilityModel={exceptionColumnVisibilityModel}
                  onColumnVisibilityModelChange={setExceptionColumnVisibilityModel}
                  sx={{
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: "6px",
                    backgroundColor: "background.paper",
                  }}
                />
              </div>
            </SectionCard>
          </div>
        ) : (
          <div>
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
              <Tooltip title="Advanced Filter">
                <IconButton color="primary" onClick={() => setFilterDialogOpen(true)}>
                  <FilterAltOutlinedIcon />
                </IconButton>
              </Tooltip>
              <Button
                variant="outlined"
                startIcon={<DoneAllOutlinedIcon />}
                onClick={() => setBuildOpen(true)}
                disabled={selectedRowIds.length < 1}
              >
                Bulk
              </Button>
              <Button variant="outlined" startIcon={<ContentPasteOutlinedIcon />} onClick={() => setPasteOpen(true)}>
                Paste
              </Button>
              <Button variant="outlined" onClick={() => setManualOverrideOpen(true)}>
                Manual Override
              </Button>
              <Typography variant="body2">{runMutation.data?.message}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
              Inline edit cells directly. Use Bulk for selected-row updates, Paste for imports, and Manual Override for hierarchy-level updates.
            </Typography>
            <div className="maintenance-grid-shell">
              <SmartDataGrid
                rows={rows}
                columns={columns}
                checkboxSelection
                disableRowSelectionOnClick
                rowSelectionModel={{ type: "include", ids: new Set(selectedRowIds) } satisfies GridRowSelectionModel}
                onRowSelectionModelChange={(model) => setSelectedRowIds(Array.from(model.ids))}
                pagination
                paginationModel={paginationModel}
                onPaginationModelChange={setPaginationModel}
                pageSizeOptions={[10, 25, 50, 100]}
                sortModel={sortModel}
                onSortModelChange={setSortModel}
                filterModel={gridFilterModel}
                onFilterModelChange={setGridFilterModel}
                columnVisibilityModel={columnVisibilityModel}
                onColumnVisibilityModelChange={setColumnVisibilityModel}
                processRowUpdate={async (newRow, oldRow) => {
                  if (
                    newRow.effective_value === oldRow.effective_value
                    && newRow.explicit_value === oldRow.explicit_value
                    && newRow.source_type === oldRow.source_type
                    && newRow.reason === oldRow.reason
                  ) {
                    return oldRow;
                  }
                  const updated = await inlineMutation.mutateAsync({
                    id: Number(newRow.id),
                    payload: {
                      effective_value: String(newRow.effective_value ?? ""),
                      explicit_value: String(newRow.explicit_value ?? newRow.effective_value ?? ""),
                      source_type: String(newRow.source_type ?? "manual_override"),
                      reason: String(newRow.reason ?? "Inline parameter update from editable grid."),
                    },
                  });
                  return updated;
                }}
                onProcessRowUpdateError={() => undefined}
                sx={{
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                  borderRadius: "6px",
                  backgroundColor: "background.paper",
                }}
              />
            </div>
          </div>
        )}
      </SectionCard>
      <FilterBuilderDialog
        open={filterDialogOpen}
        title="Parameter Grid Filters"
        fields={filterFields}
        initialState={filterState}
        onClose={() => {
          setFilterDialogOpen(false);
        }}
        onApply={setFilterState}
        onClear={() => {
          setFilterState(EMPTY_FILTER_STATE);
        }}
      />
      <Dialog open={acceptRecommendedOpen} onClose={() => setAcceptRecommendedOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Accept recommended actions</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Do you want to accept the system recommended actions for the {selectedExceptionRowIds.length} selected record{selectedExceptionRowIds.length !== 1 ? "s" : ""}?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAcceptRecommendedOpen(false)}>No</Button>
          <Button
            variant="contained"
            onClick={() => {
              selectedExceptionRowIds.forEach((id) => applyMutation.mutate(String(id)));
              setAcceptRecommendedOpen(false);
              setSelectedExceptionRowIds([]);
            }}
          >
            Yes
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={paramRulesModalOpen} onClose={() => setParamRulesModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6">Parameter exception rules</Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<RuleOutlinedIcon />}
            onClick={() => {
              setEditingParamRuleId(null);
              setParamRuleForm({ name: "", issueType: "missing", severity: "critical", description: "" });
              setParamRuleFormOpen(true);
            }}
          >
            Create rule
          </Button>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Rules for parameter issues (missing, invalid, stale, expired, misaligned) and severity. Enable or disable rules, or create and edit them below.
          </Typography>
          <Stack spacing={1.5}>
            {paramRules.map((rule) => (
              <Box
                key={rule.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  p: 1.5,
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: rule.enabled ? "background.paper" : "action.hover",
                }}
              >
                <Switch
                  checked={rule.enabled}
                  onChange={(_, checked) => setParamRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: checked } : r)))}
                  color="primary"
                  size="small"
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">{rule.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {rule.issueType} → {rule.severity}
                  </Typography>
                </Box>
                <Chip size="small" label={rule.severity} color={rule.severity === "critical" ? "error" : rule.severity === "warning" ? "warning" : "default"} />
                <Tooltip title="Edit rule">
                  <IconButton
                    size="small"
                    onClick={() => {
                      setEditingParamRuleId(rule.id);
                      setParamRuleForm({ name: rule.name, issueType: rule.issueType, severity: rule.severity, description: rule.description });
                      setParamRuleFormOpen(true);
                    }}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setParamRulesModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={paramRuleFormOpen} onClose={() => setParamRuleFormOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingParamRuleId ? "Edit rule" : "Create rule"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              size="small"
              label="Rule name"
              value={paramRuleForm.name}
              onChange={(e) => setParamRuleForm((f) => ({ ...f, name: e.target.value }))}
              fullWidth
              placeholder="e.g. Missing parameter → Critical"
            />
            <TextField
              select
              size="small"
              label="Issue type"
              value={paramRuleForm.issueType}
              onChange={(e) => setParamRuleForm((f) => ({ ...f, issueType: e.target.value }))}
              fullWidth
            >
              <MenuItem value="missing">Missing</MenuItem>
              <MenuItem value="stale">Stale</MenuItem>
              <MenuItem value="invalid">Invalid</MenuItem>
              <MenuItem value="misaligned">Misaligned</MenuItem>
              <MenuItem value="expired">Expired</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Severity"
              value={paramRuleForm.severity}
              onChange={(e) => setParamRuleForm((f) => ({ ...f, severity: e.target.value }))}
              fullWidth
            >
              <MenuItem value="critical">Critical</MenuItem>
              <MenuItem value="warning">Warning</MenuItem>
              <MenuItem value="info">Info</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="Description"
              value={paramRuleForm.description}
              onChange={(e) => setParamRuleForm((f) => ({ ...f, description: e.target.value }))}
              fullWidth
              multiline
              minRows={2}
              placeholder="Optional description"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setParamRuleFormOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!paramRuleForm.name.trim()}
            onClick={() => {
              if (!paramRuleForm.name.trim()) return;
              if (editingParamRuleId) {
                setParamRules((prev) => prev.map((r) => (r.id === editingParamRuleId ? { ...r, ...paramRuleForm } : r)));
              } else {
                setParamRules((prev) => [...prev, { ...paramRuleForm, id: `pr${Date.now()}`, enabled: true }]);
              }
              setParamRuleFormOpen(false);
            }}
          >
            {editingParamRuleId ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={buildOpen} onClose={() => setBuildOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Bulk Parameter Update</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <TextField size="small" label="Selected Rows" value={String(selectedRowIds.length)} disabled />
            <TextField size="small" label="New Effective Value" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} />
            <TextField size="small" label="Source Type" value={bulkSourceType} onChange={(event) => setBulkSourceType(event.target.value)} />
            <TextField size="small" label="Reason" value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBuildOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!bulkValue.trim() || bulkMutation.isPending || selectedRowIds.length < 1}
            onClick={() => {
              bulkMutation.mutate(
                {
                  record_ids: selectedRowIds.map((id) => Number(id)),
                  effective_value: bulkValue.trim(),
                  source_type: bulkSourceType.trim() || "bulk_override",
                  reason: bulkReason.trim() || "Bulk parameter update from parameter workbench.",
                },
                {
                  onSuccess: () => {
                    setBuildOpen(false);
                    setBulkValue("");
                  },
                },
              );
            }}
          >
            Apply Bulk Update
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={manualOverrideOpen} onClose={() => setManualOverrideOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>Parameter Hierarchy Manager - todays BRE / Manual override</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.2}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button variant={hierarchyLevel === "global" ? "contained" : "outlined"} onClick={() => setHierarchyLevel("global")}>GLOBAL</Button>
              <Button variant={hierarchyLevel === "region" ? "contained" : "outlined"} onClick={() => setHierarchyLevel("region")}>REGION</Button>
              <Button variant={hierarchyLevel === "location" ? "contained" : "outlined"} onClick={() => setHierarchyLevel("location")}>LOCATION</Button>
              <Button variant={hierarchyLevel === "sku_location" ? "contained" : "outlined"} onClick={() => setHierarchyLevel("sku_location")}>SKU + LOCATION</Button>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Chip label={`Global rows: ${(values ?? []).length}`} />
              <Chip label={`Regions: ${regions.length}`} />
              <Chip label={`Locations: ${locationsForRegion.length}`} />
              <Chip label={`Target rows: ${hierarchyTargetRows.length}`} color="primary" variant="outlined" />
            </Stack>
            <Divider />
            <div className="page-grid page-grid-two">
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={1.2}>
                    <Typography variant="subtitle2">Hierarchy Target</Typography>
                    {(hierarchyLevel === "region" || hierarchyLevel === "location" || hierarchyLevel === "sku_location") ? (
                      <TextField
                        select
                        size="small"
                        label="Region"
                        value={selectedRegion}
                        onChange={(event) => {
                          setSelectedRegion(event.target.value);
                          setSelectedLocation("");
                          setSelectedSkuLocation("");
                        }}
                      >
                        {regions.map((region) => <MenuItem key={region} value={region}>{region}</MenuItem>)}
                      </TextField>
                    ) : null}
                    {(hierarchyLevel === "location" || hierarchyLevel === "sku_location") ? (
                      <TextField
                        select
                        size="small"
                        label="Location"
                        value={selectedLocation}
                        onChange={(event) => {
                          setSelectedLocation(event.target.value);
                          setSelectedSkuLocation("");
                        }}
                      >
                        {locationsForRegion.map((location) => <MenuItem key={location} value={location}>{location}</MenuItem>)}
                      </TextField>
                    ) : null}
                    {hierarchyLevel === "sku_location" ? (
                      <TextField
                        select
                        size="small"
                        label="SKU + Location"
                        value={selectedSkuLocation}
                        onChange={(event) => setSelectedSkuLocation(event.target.value)}
                      >
                        {skuLocationsForLocation.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                      </TextField>
                    ) : null}
                  </Stack>
                </CardContent>
              </Card>
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={1.2}>
                    <Typography variant="subtitle2">Set Parameter at Selected Level</Typography>
                    <TextField
                      select
                      size="small"
                      label="Parameter Code"
                      value={hierarchyParameterCode}
                      onChange={(event) => setHierarchyParameterCode(event.target.value)}
                    >
                      {parameterCodes.map((code) => <MenuItem key={code} value={code}>{code}</MenuItem>)}
                    </TextField>
                    <TextField
                      size="small"
                      label="New Effective Value"
                      value={hierarchyValue}
                      onChange={(event) => setHierarchyValue(event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Reason"
                      value={hierarchyReason}
                      onChange={(event) => setHierarchyReason(event.target.value)}
                      multiline
                      minRows={2}
                    />
                    <Button
                      variant="contained"
                      disabled={!hierarchyCanApply || bulkMutation.isPending}
                      onClick={() => {
                        bulkMutation.mutate({
                          record_ids: hierarchyTargetRows.map((row) => row.id),
                          effective_value: hierarchyValue.trim(),
                          source_type: `hierarchy_${hierarchyLevel}`,
                          reason: hierarchyReason.trim() || "Hierarchy update from Parameter Hierarchy Manager.",
                        });
                      }}
                    >
                      Set Value for {hierarchyTargetRows.length} Rows
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </div>
            <Box sx={{ border: "1px dashed rgba(37, 99, 235, 0.25)", borderRadius: "6px", p: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Hierarchy Preview: GLOBAL {selectedRegion ? `> ${selectedRegion}` : ""} {selectedLocation ? `> ${selectedLocation}` : ""} {selectedSkuLocation ? `> ${selectedSkuLocation}` : ""}.
                This applies only to rows for the selected parameter code.
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualOverrideOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={pasteOpen} onClose={() => setPasteOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Paste Parameter Values</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Paste CSV/TSV rows in order: sku, location, parameter_code, effective_value, explicit_value(optional). Header row is optional.
            </Typography>
            <TextField size="small" label="Source Type" value={pasteSourceType} onChange={(event) => setPasteSourceType(event.target.value)} />
            <TextField size="small" label="Reason" value={pasteReason} onChange={(event) => setPasteReason(event.target.value)} />
            <TextField
              label="Paste Data"
              multiline
              minRows={10}
              value={pasteValue}
              onChange={(event) => setPasteValue(event.target.value)}
              placeholder={"sku,location,parameter_code,effective_value,explicit_value\nCHOC-001,DC-ATL,safety_stock_qty,210,210"}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasteOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!pasteValue.trim() || pasteMutation.isPending}
            onClick={() => {
              const parsedRows = parsePasteRows(pasteValue, pasteSourceType, pasteReason);
              pasteMutation.mutate(
                { rows: parsedRows },
                {
                  onSuccess: () => {
                    setPasteOpen(false);
                    setPasteValue("");
                  },
                },
              );
            }}
          >
            Apply Pasted Values
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={parameterAgentModalOpen}
        onClose={() => setParameterAgentModalOpen(false)}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { minHeight: "80vh", maxHeight: "90vh" } } }}
      >
        <DialogTitle>Parameter Diagnostic Agent</DialogTitle>
        <DialogContent dividers sx={{ p: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", p: 2 }}>
            <ParameterDiagnosticAgent
              onOpenInventoryAgent={() => {
                setParameterAgentModalOpen(false);
                navigate("/network?openInventoryAgent=1");
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setParameterAgentModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
