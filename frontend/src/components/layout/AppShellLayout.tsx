import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Box, Button, Chip, CssBaseline, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, Stack, ThemeProvider, Typography, createTheme } from "@mui/material";
import { Outlet, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import LeftNav from "./LeftNav";
import TopHeader from "./TopHeader";
import GlobalFilterBar from "./GlobalFilterBar";
import ConfigDialog from "./ConfigDialog";
import { fetchAutonomousRuns, fetchLlmOptions, resetDemoData, runAutonomous } from "../../services/api";
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

export default function AppShellLayout() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [filters, setFilters] = useState<GlobalFilters>(defaultFilters);
  const [collapsed, setCollapsed] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoRunModalOpen, setInfoRunModalOpen] = useState(false);
  const [selectedInfoRun, setSelectedInfoRun] = useState<InfoRun | null>(null);
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
  const resetDemoMutation = useMutation({
    mutationFn: resetDemoData,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: themeMode,
          primary: { main: "#0073e6" },
          secondary: { main: "#0b63ce" },
          background: { default: themeMode === "dark" ? "#0e121a" : "#f4f6f9", paper: themeMode === "dark" ? "#121826" : "#ffffff" },
          text: { primary: themeMode === "dark" ? "#e7ebf3" : "#1d1e23", secondary: themeMode === "dark" ? "#acb4c3" : "#545963" },
        },
        shape: { borderRadius: 4 },
        typography: {
          fontSize: 11,
          fontFamily: '"IBM Plex Sans", "Nunito Sans", "Segoe UI", sans-serif',
          h6: { fontWeight: 600, letterSpacing: 0 },
          subtitle1: { fontWeight: 700, fontSize: "18px", lineHeight: "24px" },
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
                borderColor: themeMode === "dark" ? "#2a3346" : "#d8dcde",
              },
            },
          },
          MuiCard: {
            styleOverrides: {
              root: {
                fontSize: 14,
              },
            },
          },
          MuiCardContent: {
            styleOverrides: {
              root: {
                fontSize: 14,
                "& .MuiTypography-root": {
                  fontSize: 14,
                },
              },
            },
          },
          MuiButton: {
            defaultProps: {
              size: "small",
              disableElevation: true,
            },
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
                borderColor: themeMode === "dark" ? "#4ea4ff" : "#0073e6",
                color: themeMode === "dark" ? "#7dbdff" : "#0073e6",
              },
              contained: {
                boxShadow: "none",
              },
            },
          },
          MuiIconButton: {
            defaultProps: {
              size: "small",
            },
            styleOverrides: {
              root: {
                width: 28,
                height: 28,
                borderRadius: 6,
              },
            },
          },
          MuiTextField: {
            defaultProps: {
              size: "small",
              variant: "outlined",
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                minHeight: 32,
                borderRadius: 4,
                fontSize: 11,
              },
              input: {
                padding: "7px 10px",
              },
            },
          },
          MuiInputLabel: {
            styleOverrides: {
              root: {
                fontSize: 11,
              },
            },
          },
          MuiFormLabel: {
            styleOverrides: {
              root: {
                fontSize: 11,
              },
            },
          },
          MuiSelect: {
            defaultProps: {
              size: "small",
            },
          },
          MuiMenuItem: {
            styleOverrides: {
              root: {
                minHeight: 30,
                fontSize: 11,
              },
            },
          },
          MuiAutocomplete: {
            defaultProps: {
              size: "small",
            },
          },
          MuiSwitch: {
            defaultProps: {
              size: "small",
            },
            styleOverrides: {
              root: {
                padding: 6,
              },
            },
          },
          MuiChip: {
            defaultProps: {
              size: "small",
            },
            styleOverrides: {
              root: {
                height: 22,
                fontSize: 11,
              },
            },
          },
          MuiTabs: {
            styleOverrides: {
              root: {
                minHeight: 30,
              },
              indicator: {
                height: 2,
              },
            },
          },
          MuiTab: {
            defaultProps: {
              disableRipple: true,
            },
            styleOverrides: {
              root: {
                minHeight: 30,
                padding: "5px 10px",
                fontSize: 17,
              },
            },
          },
          MuiDialogTitle: {
            styleOverrides: {
              root: {
                padding: "10px 14px",
                fontSize: 16,
                fontWeight: 600,
              },
            },
          },
          MuiDialogContent: {
            styleOverrides: {
              root: {
                padding: "10px 14px",
                fontSize: 11,
              },
            },
          },
          MuiDialogActions: {
            styleOverrides: {
              root: {
                padding: "8px 12px",
                gap: 6,
                fontSize: 11,
              },
            },
          },
          MuiTableCell: {
            styleOverrides: {
              root: {
                borderBottom: `1px solid ${themeMode === "dark" ? "#2a3346" : "#e6e9ef"}`,
                fontSize: "11px",
              },
              head: {
                fontWeight: 600,
                color: themeMode === "dark" ? "#b8c2d5" : "#545963",
                backgroundColor: themeMode === "dark" ? "#162033" : "#fafbfd",
              },
            },
          },
        },
      }),
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

  const runDetailSteps = useMemo(() => {
    if (!selectedInfoRun) return [];
    const status = String(selectedInfoRun.status || "").toLowerCase();
    const base = [
      { id: "step_1", label: "Identify impacted alerts and nodes" },
      { id: "step_2", label: "Evaluate transfer / replenishment options" },
      { id: "step_3", label: "Create stock transfer or replenishment actions" },
      { id: "step_4", label: "Link orders to alerts and update status" },
      { id: "step_5", label: "Validate projection impact and finalize run" },
    ];
    let completedSteps = 0;
    if (status === "completed") completedSteps = base.length;
    else if (status === "needs_user_guidance") completedSteps = 3;
    else if (status === "running") completedSteps = 2;
    return base.map((step, idx) => ({
      ...step,
      state: idx < completedSteps ? "done" : status === "running" && idx === completedSteps ? "in_progress" : "pending",
    }));
  }, [selectedInfoRun]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box className="app-shell">
        <Box className="ambient-shape ambient-shape-a" />
        <Box className="ambient-shape ambient-shape-b" />
        <TopHeader
          themeMode={themeMode}
          collapsed={collapsed}
          onToggleThemeMode={() => setThemeMode((prev) => (prev === "light" ? "dark" : "light"))}
          onOpenSettings={() => setConfigOpen(true)}
          onOpenInformation={() => setInfoOpen(true)}
          onResetDemo={() => {
            if (resetDemoMutation.isPending) return;
            if (!window.confirm("Reset demo data to baseline? This will overwrite current demo state.")) return;
            resetDemoMutation.mutate();
          }}
          resetInProgress={resetDemoMutation.isPending}
        />
        {/* Spacer so content starts below the fixed black brand strip */}
        <Box aria-hidden sx={{ flexShrink: 0, height: { xs: 45, md: 50 }, minHeight: { xs: 45, md: 50 } }} />
        <Box className="app-layout">
          <Box className="side-nav-shell" sx={{ width: collapsed ? 58 : 228, minWidth: collapsed ? 58 : 228 }}>
            <LeftNav collapsed={collapsed} onToggleCollapsed={() => setCollapsed((prev) => !prev)} />
          </Box>
          <Box className="main-pane">
            <Box aria-hidden sx={{ flexShrink: 0, height: { xs: 50, md: 57 }, minHeight: { xs: 50, md: 57 } }} />
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
            <Typography variant="h6">Information</Typography>
            <Typography variant="caption" color="text.secondary">
              Workflow 3 - Fully Autonomous Resolution history and live execution status.
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
                      setSelectedInfoRun(run);
                      setInfoRunModalOpen(true);
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
                        Click to open Inventory Diagnostic Agent details.
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>
          </Stack>
        </Drawer>
        <Dialog
          open={infoRunModalOpen}
          onClose={() => setInfoRunModalOpen(false)}
          fullWidth
          maxWidth="md"
          slotProps={{ paper: { sx: { minHeight: "62vh" } } }}
        >
          <DialogTitle>Inventory Diagnostic Agent</DialogTitle>
          <DialogContent dividers>
            {selectedInfoRun ? (
              <Stack spacing={1.2}>
                <Typography variant="subtitle2">{selectedInfoRun.id}</Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                  <Chip
                    size="small"
                    color={
                      selectedInfoRun.status === "completed"
                        ? "success"
                        : selectedInfoRun.status === "needs_user_guidance"
                          ? "warning"
                          : "info"
                    }
                    label={String(selectedInfoRun.status).replace(/_/g, " ")}
                  />
                  <Chip size="small" label={`Alert: ${selectedInfoRun.alert}`} />
                  <Chip size="small" label={`Actions: ${selectedInfoRun.actions}`} />
                  <Chip size="small" label={`Qty: ${selectedInfoRun.qty.toLocaleString()}`} />
                  <Chip size="small" label={`Cost: $${selectedInfoRun.cost.toLocaleString()}`} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {selectedInfoRun.note}
                </Typography>
                <Divider />
                <Typography variant="subtitle2">Execution Steps</Typography>
                <Stack spacing={0.7}>
                  {runDetailSteps.map((step) => (
                    <Box
                      key={step.id}
                      sx={(theme) => ({
                        p: 0.9,
                        borderRadius: 1,
                        border: `1px solid ${theme.palette.divider}`,
                        backgroundColor:
                          step.state === "done"
                            ? theme.palette.success.light
                            : step.state === "in_progress"
                              ? theme.palette.info.light
                              : theme.palette.background.paper,
                        color: step.state === "done" ? theme.palette.success.contrastText : theme.palette.text.primary,
                      })}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2">{step.label}</Typography>
                        <Chip
                          size="small"
                          label={step.state === "done" ? "completed" : step.state === "in_progress" ? "running" : "not complete"}
                          color={step.state === "done" ? "success" : step.state === "in_progress" ? "info" : "default"}
                        />
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </Stack>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setInfoRunModalOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
}
