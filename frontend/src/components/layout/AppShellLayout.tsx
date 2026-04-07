import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Box, Button, Chip, CssBaseline, Divider, Drawer, Stack, ThemeProvider, Typography, createTheme } from "@mui/material";
import type {} from "@mui/x-data-grid/themeAugmentation";
import { Outlet, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import LeftNav from "./LeftNav";
import TopHeader from "./TopHeader";
import GlobalFilterBar from "./GlobalFilterBar";
import ConfigDialog from "./ConfigDialog";
import { fetchAutonomousRuns, fetchLlmOptions, runAutonomous } from "../../services/api";
import type { AutonomousResponse, LlmOptionsResponse, UiConfig } from "../../types";
import type { GlobalFilters } from "../../types/filters";

export interface ShellContextValue {
  filters: GlobalFilters;
  setFilters: Dispatch<SetStateAction<GlobalFilters>>;
  config: UiConfig;
  setConfig: Dispatch<SetStateAction<UiConfig>>;
  openAiApiKey: string;
  setOpenAiApiKey: Dispatch<SetStateAction<string>>;
}

export const defaultFilters: GlobalFilters = {
  runId: "RUN-BASELINE-001",
  region: "",
  location: [],
  sku: [],
  category: "",
  supplier: "",
  exceptionStatus: "",
  recommendationId: [],
  alertId: [],
  alertType: [],
  severity: [],
  orderId: [],
  orderType: [],
  orderStatus: [],
  exceptionReason: [],
  shipFromNodeId: [],
  shipToNodeId: [],
  parameterCode: [],
  parameterIssueType: [],
  sourceMode: [],
  nodeType: [],
};

type InfoRunStatus = "completed" | "needs_user_guidance" | "running" | string;

type InfoRun = {
  id: string;
  status: InfoRunStatus;
  alert: string;
  actions: number;
  qty: number;
  cost: number;
  note: string;
  time: string;
};

function mapAutonomousRunStatusToInventoryPreset(status: string): "complete" | "need_guidance" | null {
  const raw = String(status || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  if (raw === "completed" || raw === "complete") return "complete";
  if (raw === "needs_user_guidance" || raw === "need_user_guidance") return "need_guidance";
  return null;
}

export default function AppShellLayout() {
  const navigate = useNavigate();
  const COLLAPSED_NAV_WIDTH = 46;
  const EXPANDED_NAV_WIDTH = 195;
  const queryClient = useQueryClient();
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [filters, setFilters] = useState<GlobalFilters>(defaultFilters);
  const [collapsed, setCollapsed] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [llmApiKeys, setLlmApiKeys] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<UiConfig>(() => {
    const raw = localStorage.getItem("meio_ui_config");
    return raw ? JSON.parse(raw) as UiConfig : { llmProvider: "openai", llmModel: "gpt-4.1-mini" };
  });
  const openAiApiKey = llmApiKeys[config.llmProvider] ?? "";
  const setOpenAiApiKey: Dispatch<SetStateAction<string>> = (value) => {
    setLlmApiKeys((prev) => {
      const current = prev[config.llmProvider] ?? "";
      const nextValue = typeof value === "function" ? value(current) : value;
      return { ...prev, [config.llmProvider]: nextValue };
    });
  };
  const { data: llmOptions } = useQuery<LlmOptionsResponse>({ queryKey: ["llm-options"], queryFn: fetchLlmOptions });
  const { data: autonomousRuns } = useQuery<AutonomousResponse>({
    queryKey: ["autonomous-runs"],
    queryFn: fetchAutonomousRuns,
  });
  const autonomousTriggerMutation = useMutation({
    mutationFn: () =>
      runAutonomous({
        enabled: true,
        trigger: "manual",
        notes: "Triggered from Information panel.",
        initiated_by: "planner",
        max_actions: 6,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["autonomous-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["network-baseline"] });
      await queryClient.invalidateQueries({ queryKey: ["network-view"] });
      await queryClient.invalidateQueries({ queryKey: ["replenishment-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory-projection"] });
      await queryClient.invalidateQueries({ queryKey: ["demo-alerts"] });
    },
  });
  const theme = useMemo(
    () => {
      const isLight = themeMode === "light";
      return createTheme({
        palette: {
          mode: themeMode,
          primary: {
            main: isLight ? "#2679A8" : "#519BC5",
            light: "#7AC6E9",
            dark: "#16608B",
            contrastText: "#ffffff",
          },
          secondary: {
            main: isLight ? "#883DCF" : "#A064D9",
            light: "#B88BE2",
            dark: "#662E9B",
            contrastText: "#ffffff",
          },
          background: {
            default: isLight ? "#f1f5fa" : "#080c14",
            paper: isLight ? "#ffffff" : "#0d1320",
          },
          text: {
            primary: isLight ? "#0B4A6F" : "#D9F3FF",
            secondary: isLight ? "#4a6680" : "#7AC6E9",
          },
          info: { main: isLight ? "#2679A8" : "#519BC5" },
          success: { main: "#059669" },
          warning: { main: "#d97706" },
          error: { main: "#dc2626" },
        },
        shape: { borderRadius: 4 },
        typography: {
          fontSize: 11,
          fontFamily: '"IBM Plex Sans", "Nunito Sans", "Segoe UI", sans-serif',
          h5: { fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif', fontWeight: 700, letterSpacing: "-0.01em" },
          h6: { fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif', fontWeight: 700, letterSpacing: "-0.01em" },
          subtitle1: { fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif', fontWeight: 700, fontSize: "14px", lineHeight: "20px" },
          subtitle2: { fontSize: "11px", lineHeight: "16px" },
          body1: { fontSize: "11px", lineHeight: "16px" },
          body2: { fontSize: "11px", lineHeight: "16px" },
          button: { textTransform: "none", fontWeight: 500 },
          caption: { fontSize: "11px", lineHeight: "16px" },
        },
        components: {
          MuiPaper: {
            styleOverrides: {
              root: {
                borderRadius: 4,
                borderColor: isLight ? "#cdd8e4" : "#1b2a40",
              },
            },
          },
          MuiCard: {
            styleOverrides: { root: { fontSize: 14 } },
          },
          MuiCardContent: {
            styleOverrides: {
              root: {
                fontSize: 14,
                "& .MuiTypography-root": { fontSize: 14 },
              },
            },
          },
          MuiButton: {
            defaultProps: { size: "small", disableElevation: true },
            styleOverrides: {
              root: {
                borderRadius: 4,
                minHeight: 28,
                padding: "4px 10px",
                fontSize: 11,
                lineHeight: 1.2,
                gap: 6,
              },
              outlined: {
                borderColor: "#519BC5",
                color: isLight ? "#16608B" : "#7AC6E9",
              },
              contained: {
                boxShadow: "none",
                background: isLight
                  ? "linear-gradient(135deg, #2679A8 0%, #16608B 100%)"
                  : "linear-gradient(135deg, #519BC5 0%, #2679A8 100%)",
                "&:hover": {
                  background: isLight
                    ? "linear-gradient(135deg, #16608B 0%, #0B4A6F 100%)"
                    : "linear-gradient(135deg, #7AC6E9 0%, #519BC5 100%)",
                },
              },
            },
          },
          MuiIconButton: {
            defaultProps: { size: "small" },
            styleOverrides: { root: { width: 28, height: 28, borderRadius: 6 } },
          },
          MuiTextField: {
            defaultProps: { size: "small", variant: "outlined" },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: { minHeight: 32, borderRadius: 4, fontSize: 11 },
              input: { padding: "7px 10px" },
            },
          },
          MuiInputLabel: {
            styleOverrides: { root: { fontSize: 11 } },
          },
          MuiFormLabel: {
            styleOverrides: { root: { fontSize: 11 } },
          },
          MuiSelect: {
            defaultProps: { size: "small" },
          },
          MuiMenuItem: {
            styleOverrides: { root: { minHeight: 30, fontSize: 11 } },
          },
          MuiAutocomplete: {
            defaultProps: { size: "small" },
          },
          MuiSwitch: {
            defaultProps: { size: "small" },
            styleOverrides: {
              root: { padding: 6 },
              switchBase: {
                "&.Mui-checked": {
                  color: isLight ? "#2679A8" : "#519BC5",
                },
                "&.Mui-checked + .MuiSwitch-track": {
                  backgroundColor: isLight ? "#7AC6E9" : "#2679A8",
                },
              },
            },
          },
          MuiChip: {
            defaultProps: { size: "small" },
            styleOverrides: { root: { height: 22, fontSize: 11 } },
          },
          MuiTabs: {
            styleOverrides: {
              root: { minHeight: 30 },
              indicator: {
                height: 2,
                background: "linear-gradient(90deg, #2679A8 0%, #883DCF 100%)",
              },
            },
          },
          MuiTab: {
            defaultProps: { disableRipple: true },
            styleOverrides: {
              root: {
                minHeight: 30,
                padding: "5px 10px",
                fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif',
                fontSize: 12,
                fontWeight: 600,
                "&.Mui-selected": {
                  color: isLight ? "#16608B" : "#B5E7FD",
                },
              },
            },
          },
          MuiDialogTitle: {
            styleOverrides: {
              root: {
                padding: "10px 14px",
                fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif',
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: isLight ? "#0B4A6F" : "#D9F3FF",
              },
            },
          },
          MuiDialogContent: {
            styleOverrides: { root: { padding: "10px 14px", fontSize: 11 } },
          },
          MuiDialogActions: {
            styleOverrides: { root: { padding: "8px 12px", gap: 6, fontSize: 11 } },
          },
          MuiTableCell: {
            styleOverrides: {
              root: {
                borderBottom: `1px solid ${isLight ? "rgba(38,121,168,0.10)" : "rgba(81,155,197,0.10)"}`,
                fontSize: "11px",
              },
              head: {
                fontWeight: 600,
                color: isLight ? "#16608B" : "#7AC6E9",
                backgroundColor: isLight ? "#f8fcff" : "rgba(11,74,111,0.12)",
              },
            },
          },
          MuiDataGrid: {
            styleOverrides: {
              root: { borderRadius: 4 },
              columnHeaders: { minHeight: "36px !important" },
              columnHeader: { minHeight: "36px !important" },
              row: { maxHeight: "30px !important" },
            },
          },
        },
      });
    },
    [themeMode],
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem("meio_ui_config", JSON.stringify(config));
  }, [config]);

  const showGlobalFilterBar = true;
  const infoRuns = useMemo<InfoRun[]>(() => {
    const liveRuns = (autonomousRuns?.runs ?? []).slice(0, 4).map((run) => ({
      id: run.run_id,
      status: String(run.status || "completed"),
      alert: String(run.actions?.[0]?.alert_id ?? "Multiple alerts"),
      actions: Number((run.summary?.actions_executed as number) ?? run.actions?.length ?? 0),
      qty: Number((run.summary?.total_qty_moved as number) ?? 0),
      cost: Number((run.summary?.total_estimated_cost as number) ?? 0),
      note: "Autonomous neighbor transfer actions executed.",
      time: run.completed_at ?? run.started_at,
    }));
    const sample = [
      {
        id: "AUTO-RUN-SAMPLE-SUCCESS-001",
        status: "completed",
        alert: "ALERT-INV-STOCKOUT-002",
        actions: 4,
        qty: 640,
        cost: 11850,
        note: "Resolved store stockout by balancing RDC inventory and expediting one transfer lane.",
        time: "2026-03-07 09:40",
      },
      {
        id: "AUTO-RUN-SAMPLE-SUCCESS-002",
        status: "completed",
        alert: "ALERT-SKUNODE-001",
        actions: 3,
        qty: 430,
        cost: 7820,
        note: "Recovered service risk using neighbor transfer and updated replenishment priority.",
        time: "2026-03-06 16:15",
      },
      {
        id: "AUTO-RUN-SAMPLE-SUCCESS-003",
        status: "completed",
        alert: "ALERT-NODE-001",
        actions: 5,
        qty: 910,
        cost: 15420,
        note: "Closed node-level capacity alert after staged transfers across CDC and RDC network.",
        time: "2026-03-05 13:05",
      },
      {
        id: "AUTO-RUN-SAMPLE-NEEDS-GUIDANCE",
        status: "needs_user_guidance",
        alert: "ALERT-PARAM-NODE-014",
        actions: 2,
        qty: 180,
        cost: 5100,
        note: "Supplier capacity conflict detected. Awaiting planner guidance on source-node preference.",
        time: "Recent",
      },
      {
        id: "AUTO-RUN-SAMPLE-RUNNING",
        status: autonomousTriggerMutation.isPending ? "running" : "running",
        alert: "ALERT-TRANSIT-DELAY-022",
        actions: 1,
        qty: 95,
        cost: 1700,
        note: "Execution in progress for reroute and expedite decision.",
        time: "Now",
      },
    ];
    return [...liveRuns, ...sample].slice(0, 6);
  }, [autonomousRuns?.runs, autonomousTriggerMutation.isPending]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box className="app-shell">
        <Box className="ambient-shape ambient-shape-a" />
        <Box className="ambient-shape ambient-shape-b" />
        <TopHeader
          themeMode={themeMode}
          onToggleThemeMode={() => setThemeMode((prev) => (prev === "light" ? "dark" : "light"))}
          onOpenSettings={() => setConfigOpen(true)}
          onOpenInformation={() => setInfoOpen(true)}
        />
        {/* Spacer so content starts below the fixed brand strip */}
        <Box aria-hidden sx={{ flexShrink: 0, height: { xs: 34, md: 38 }, minHeight: { xs: 34, md: 38 } }} />
        <Box className="app-layout">
          <Box className="side-nav-shell" sx={{ width: collapsed ? COLLAPSED_NAV_WIDTH : EXPANDED_NAV_WIDTH, minWidth: collapsed ? COLLAPSED_NAV_WIDTH : EXPANDED_NAV_WIDTH }}>
            <LeftNav collapsed={collapsed} onToggleCollapsed={() => setCollapsed((prev) => !prev)} />
          </Box>
          <Box className="main-pane">
            {showGlobalFilterBar ? <GlobalFilterBar filters={filters} setFilters={setFilters} config={config} openAiApiKey={openAiApiKey} /> : null}
            <Box className="main-content-wrap" sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <Outlet context={{ filters, setFilters, config, setConfig, openAiApiKey, setOpenAiApiKey } satisfies ShellContextValue} />
            </Box>
          </Box>
        </Box>
        <ConfigDialog
          open={configOpen}
          config={config}
          llmOptions={llmOptions ?? null}
          llmApiKeys={llmApiKeys}
          onLlmApiKeyChange={(provider, value) => {
            setLlmApiKeys((prev) => ({ ...prev, [provider]: value }));
          }}
          onClose={() => setConfigOpen(false)}
          onSave={setConfig}
        />
        <Drawer anchor="right" open={infoOpen} onClose={() => setInfoOpen(false)} PaperProps={{ sx: { width: { xs: "92vw", sm: 460 }, p: 2 } }}>
          <Stack spacing={1.25} sx={{ height: "100%" }}>
            <Typography variant="h6">Agent information desk</Typography>
            <Typography variant="caption" color="text.secondary">
              Autonomous agent progress: run history, status (completed, needs guidance, running), and actions. Click a run to open the Inventory Diagnostic Agent on the Network page.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Button
                variant="contained"
                size="small"
                onClick={() => autonomousTriggerMutation.mutate()}
                disabled={autonomousTriggerMutation.isPending}
              >
                {autonomousTriggerMutation.isPending ? "Triggering..." : "Trigger autonomous execution"}
              </Button>
              <Chip
                size="small"
                color={autonomousTriggerMutation.isPending ? "warning" : "success"}
                label={autonomousTriggerMutation.isPending ? "One run currently running" : "Ready"}
              />
            </Stack>
            <Divider />
            <Box sx={{ overflowY: "auto", pr: 0.5 }}>
              <Stack spacing={1}>
                {infoRuns.map((run) => (
                  <Box
                    key={run.id}
                    onClick={() => {
                      if (run.status === "running") return;
                      const preset = mapAutonomousRunStatusToInventoryPreset(String(run.status));
                      if (preset) {
                        navigate(`/network?openInventoryAgent=1&inventoryAgentPreset=${preset}`);
                      }
                      setInfoOpen(false);
                    }}
                    sx={{
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      p: 1,
                      cursor: run.status === "running" ? "not-allowed" : "pointer",
                      opacity: run.status === "running" ? 0.7 : 1,
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="subtitle2">{run.id}</Typography>
                      <Chip
                        size="small"
                        color={
                          run.status === "completed"
                            ? "success"
                            : run.status === "needs_user_guidance"
                              ? "warning"
                              : "info"
                        }
                        label={run.status.replace(/_/g, " ")}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.4 }}>
                      Alert: {run.alert} | Actions: {run.actions} | Qty: {run.qty.toLocaleString()} | Cost: ${run.cost.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.35 }}>
                      {run.note}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.2 }}>
                      Time: {run.time}
                    </Typography>
                    {run.status === "running" ? (
                      <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.35 }}>
                        Run is in progress. Details open after completion.
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="primary.main" sx={{ display: "block", mt: 0.35 }}>
                        Click to open Inventory Diagnostic Agent on the Network page (completed runs show full workflow; guided runs pause at source selection).
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>
          </Stack>
        </Drawer>
      </Box>
    </ThemeProvider>
  );
}
