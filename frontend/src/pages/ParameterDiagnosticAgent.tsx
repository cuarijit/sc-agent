import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import RestartAltOutlinedIcon from "@mui/icons-material/RestartAltOutlined";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import {
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { type GridColDef, type GridRowId, type GridRowSelectionModel } from "@mui/x-data-grid";
import { useCallback, useEffect, useRef, useState } from "react";
import SmartDataGrid from "../components/shared/SmartDataGrid";

// ---------------------------------------------------------------------------
// Demo data: Parameter exception rows (SKU, location, parameter, current vs recommended)
// ---------------------------------------------------------------------------

export interface ParamExceptionRow {
  id: string;
  sku: string;
  location: string;
  parameter_code: string;
  parameter_name: string;
  current_value: string;
  recommended_value: string;
  issue_type: string;
  source?: string;
}

export interface ParamToSetRow {
  id: string;
  parameter_code: string;
  parameter_name: string;
  current_value: string;
  recommended_value: string;
  is_optimizer_based: boolean;
  userValue: string;
  optimizerRequested: boolean;
}

const HELP_PROMPTS = [
  { id: "missing_bar", label: "Missing parameters for BAR", text: "Find all missing parameter for BAR?" },
  { id: "critical_optimize", label: "Critical missing or need optimization", text: "Show all critical parameter that are missing or need optimization?" },
  { id: "misaligned", label: "Misaligned with optimizer", text: "Show me mis-aligned parameter between optimizer recommendation and what user has set?" },
  { id: "new_cdc", label: "Parameters for new CDC-980 SKUs", text: "Show parameter that needs to be set for all the SKUs that will belong to the new CDC-980?" },
] as const;

type ParamQuestionType = "missing_for_bar" | "critical_optimize" | "misaligned" | "new_cdc_skus" | "generic";

// Demo exception rows by question type
const DEMO_MISSING_BAR: ParamExceptionRow[] = [
  { id: "e1", sku: "BAR-002", location: "CDC-001", parameter_code: "safety_stock_qty", parameter_name: "Safety Stock", current_value: "—", recommended_value: "180", issue_type: "missing", source: "default" },
  { id: "e2", sku: "BAR-002", location: "RDC-001", parameter_code: "lead_time_days", parameter_name: "Lead Time (days)", current_value: "—", recommended_value: "3", issue_type: "missing", source: "default" },
  { id: "e3", sku: "BAR-002", location: "STORE-NYC-01", parameter_code: "service_level_target", parameter_name: "Service Level Target", current_value: "—", recommended_value: "0.97", issue_type: "missing", source: "optimizer" },
  { id: "e4", sku: "BAR-002", location: "CDC-002", parameter_code: "fill_rate_target", parameter_name: "Fill Rate Target", current_value: "—", recommended_value: "0.98", issue_type: "missing", source: "optimizer" },
];

const DEMO_CRITICAL_OPTIMIZE: ParamExceptionRow[] = [
  { id: "c1", sku: "CHOC-001", location: "CDC-001", parameter_code: "safety_stock_qty", parameter_name: "Safety Stock", current_value: "80", recommended_value: "210", issue_type: "stale", source: "optimizer" },
  { id: "c2", sku: "WATER-006", location: "RDC-002", parameter_code: "service_level_target", parameter_name: "Service Level", current_value: "0.90", recommended_value: "0.97", issue_type: "invalid", source: "optimizer" },
  { id: "c3", sku: "BAR-002", location: "STORE-PHL-01", parameter_code: "fill_rate_target", parameter_name: "Fill Rate", current_value: "0.92", recommended_value: "0.98", issue_type: "missing", source: "optimizer" },
  { id: "c4", sku: "GUM-004", location: "CDC-001", parameter_code: "reorder_point_qty", parameter_name: "Reorder Point", current_value: "50", recommended_value: "120", issue_type: "stale", source: "default" },
];

const DEMO_MISALIGNED: ParamExceptionRow[] = [
  { id: "m1", sku: "SNACK-003", location: "RDC-001", parameter_code: "safety_stock_qty", parameter_name: "Safety Stock", current_value: "100", recommended_value: "250", issue_type: "misaligned", source: "optimizer" },
  { id: "m2", sku: "CEREAL-005", location: "CDC-002", parameter_code: "service_level_target", parameter_name: "Service Level", current_value: "0.94", recommended_value: "0.97", issue_type: "misaligned", source: "optimizer" },
  { id: "m3", sku: "WATER-006", location: "STORE-BOS-02", parameter_code: "lead_time_days", parameter_name: "Lead Time", current_value: "5", recommended_value: "2", issue_type: "misaligned", source: "default" },
];

const DEMO_NEW_CDC_980: ParamExceptionRow[] = [
  { id: "d1", sku: "CHOC-001", location: "CDC-980", parameter_code: "safety_stock_qty", parameter_name: "Safety Stock", current_value: "—", recommended_value: "200", issue_type: "missing", source: "default" },
  { id: "d2", sku: "BAR-002", location: "CDC-980", parameter_code: "lead_time_days", parameter_name: "Lead Time (days)", current_value: "—", recommended_value: "2", issue_type: "missing", source: "default" },
  { id: "d3", sku: "WATER-006", location: "CDC-980", parameter_code: "service_level_target", parameter_name: "Service Level", current_value: "—", recommended_value: "0.98", issue_type: "missing", source: "optimizer" },
  { id: "d4", sku: "SNACK-003", location: "CDC-980", parameter_code: "fill_rate_target", parameter_name: "Fill Rate", current_value: "—", recommended_value: "0.97", issue_type: "missing", source: "optimizer" },
  { id: "d5", sku: "GUM-004", location: "CDC-980", parameter_code: "reorder_point_qty", parameter_name: "Reorder Point", current_value: "—", recommended_value: "80", issue_type: "missing", source: "default" },
];

const OPTIMIZER_BASED_PARAMS = new Set(["fill_rate_target", "safety_stock_qty", "service_level_target"]);

function detectParamQuestionType(q: string): ParamQuestionType {
  const lower = q.toLowerCase();
  if (lower.includes("missing") && (lower.includes("bar") || lower.includes("bar?"))) return "missing_for_bar";
  if (lower.includes("critical") && (lower.includes("missing") || lower.includes("optimization"))) return "critical_optimize";
  if (lower.includes("mis-aligned") || lower.includes("misaligned") || lower.includes("optimizer recommendation")) return "misaligned";
  if (lower.includes("cdc-980") || lower.includes("new cdc")) return "new_cdc_skus";
  return "generic";
}

function getDemoExceptionRows(type: ParamQuestionType): ParamExceptionRow[] {
  switch (type) {
    case "missing_for_bar":
      return DEMO_MISSING_BAR;
    case "critical_optimize":
      return DEMO_CRITICAL_OPTIMIZE;
    case "misaligned":
      return DEMO_MISALIGNED;
    case "new_cdc_skus":
      return DEMO_NEW_CDC_980;
    default:
      return DEMO_MISSING_BAR;
  }
}

function getParamIntroMessage(type: ParamQuestionType): string {
  switch (type) {
    case "missing_for_bar":
      return "Searching for missing parameters for BAR across locations...";
    case "critical_optimize":
      return "Identifying critical parameters that are missing or need optimization...";
    case "misaligned":
      return "Comparing optimizer recommendations with user-set values to find misalignments...";
    case "new_cdc_skus":
      return "Fetching parameters that need to be set for SKUs belonging to the new CDC-980...";
    default:
      return "Analyzing your question and fetching parameter exceptions...";
  }
}

function getParamResultsMessage(type: ParamQuestionType): string {
  switch (type) {
    case "missing_for_bar":
      return "Here are **BAR** SKU–location combinations with missing parameters and recommended values. Select the rows you want to update, then click **Proceed** to set values or run the optimizer where applicable.";
    case "critical_optimize":
      return "Here are critical parameter exceptions (missing or needing optimization). Select rows and click **Proceed** to set values manually or run the optimizer for fill-rate, safety stock, and service level.";
    case "misaligned":
      return "Here are parameters where the optimizer recommendation differs from what is currently set. Select rows and click **Proceed** to align values or run the optimizer.";
    case "new_cdc_skus":
      return "Here are parameters that need to be set for SKUs in the new **CDC-980**. Select rows and click **Proceed** to set values or run the optimizer.";
    default:
      return "Here are the parameter exceptions that match your query. Select one or more rows and click **Proceed** to set values or optimize.";
  }
}

// Build params-to-set from selected exception rows (dedupe by parameter_code for demo)
function buildParamsToSet(rows: ParamExceptionRow[], selectedIds: GridRowId[]): ParamToSetRow[] {
  const selected = rows.filter((r) => selectedIds.includes(r.id));
  const byParam = new Map<string, ParamExceptionRow>();
  selected.forEach((r) => {
    if (!byParam.has(r.parameter_code)) byParam.set(r.parameter_code, r);
  });
  return Array.from(byParam.values()).map((r, i) => ({
    id: `param-${i}-${r.parameter_code}`,
    parameter_code: r.parameter_code,
    parameter_name: r.parameter_name,
    current_value: r.current_value,
    recommended_value: r.recommended_value,
    is_optimizer_based: OPTIMIZER_BASED_PARAMS.has(r.parameter_code),
    userValue: r.recommended_value,
    optimizerRequested: false,
  }));
}

function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type ParamAgentStepId = "idle" | "show_exceptions_grid" | "show_parameters_to_set" | "ask_network_impact" | "flow_complete";

const PARAM_ALL_STEPS: { id: ParamAgentStepId; label: string }[] = [
  { id: "idle", label: "Enter your question" },
  { id: "show_exceptions_grid", label: "Review parameter exceptions" },
  { id: "show_parameters_to_set", label: "Set value or run optimizer" },
  { id: "ask_network_impact", label: "Check network impact?" },
  { id: "flow_complete", label: "Complete" },
];

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface ParameterDiagnosticAgentProps {
  onOpenInventoryAgent?: () => void;
}

export default function ParameterDiagnosticAgent({ onOpenInventoryAgent }: ParameterDiagnosticAgentProps) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStepId, setCurrentStepId] = useState<ParamAgentStepId>("idle");
  const [currentQuestionType, setCurrentQuestionType] = useState<ParamQuestionType>("generic");
  const [exceptionRows, setExceptionRows] = useState<ParamExceptionRow[]>(DEMO_MISSING_BAR);
  const [selectedExceptionRowIds, setSelectedExceptionRowIds] = useState<GridRowId[]>([]);
  const [paramsToSet, setParamsToSet] = useState<ParamToSetRow[]>([]);
  const [networkImpactChoice, setNetworkImpactChoice] = useState<"yes" | "no" | null>(null);
  const [loading, setLoading] = useState(false);
  const [flowEndMessage, setFlowEndMessage] = useState<string | null>(null);
  const [stepSelections, setStepSelections] = useState<Partial<Record<ParamAgentStepId, string>>>({});
  const [helpAnchorEl, setHelpAnchorEl] = useState<HTMLElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const progressSteps = PARAM_ALL_STEPS.map((s, idx) => {
    const currentIdx = PARAM_ALL_STEPS.findIndex((x) => x.id === currentStepId);
    let status: "pending" | "current" | "done" = "pending";
    if (idx < currentIdx) status = "done";
    else if (idx === currentIdx) status = "current";
    const selection = stepSelections[s.id];
    return { ...s, status, selection };
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = useCallback((role: "user" | "assistant", content: string) => {
    setMessages((prev) => [...prev, { id: `msg-${Date.now()}`, role, content, createdAt: Date.now() }]);
  }, []);

  const runAfterDelay = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  }, []);

  const handleSubmitPrompt = useCallback(() => {
    const q = prompt.trim();
    if (!q) return;
    setPrompt("");
    addMessage("user", q);
    setLoading(true);
    const questionType = detectParamQuestionType(q);
    setCurrentQuestionType(questionType);
    const rows = getDemoExceptionRows(questionType);
    setExceptionRows(rows);
    addMessage("assistant", getParamIntroMessage(questionType));
    runAfterDelay(1500, () => {
      setLoading(false);
      addMessage("assistant", getParamResultsMessage(questionType));
      setCurrentStepId("show_exceptions_grid");
    });
  }, [prompt, addMessage, runAfterDelay]);

  const handleProceedFromGrid = useCallback(() => {
    if (selectedExceptionRowIds.length === 0) return;
    const count = selectedExceptionRowIds.length;
    setStepSelections((prev) => ({ ...prev, show_exceptions_grid: count === 1 ? "1 record selected" : `${count} records selected` }));
    addMessage("user", `Proceed with ${count} selected exception(s).`);
    const params = buildParamsToSet(exceptionRows, selectedExceptionRowIds);
    setParamsToSet(params);
    addMessage(
      "assistant",
      "Here are the parameters to set or optimize. **Optimizer-based** parameters (Fill Rate, Safety Stock, Service Level) can be set manually or you can **Run optimizer** to compute the value. Other parameters: set the value manually, then click **Save & apply**.",
    );
    setCurrentStepId("show_parameters_to_set");
  }, [exceptionRows, selectedExceptionRowIds, addMessage]);

  const handleParamValueChange = useCallback((paramId: string, value: string) => {
    setParamsToSet((prev) => prev.map((p) => (p.id === paramId ? { ...p, userValue: value } : p)));
  }, []);

  const handleOptimizerRequest = useCallback((paramId: string) => {
    setParamsToSet((prev) => prev.map((p) => (p.id === paramId ? { ...p, optimizerRequested: true, userValue: p.recommended_value } : p)));
  }, []);

  const handleSaveAndApply = useCallback(() => {
    setStepSelections((prev) => ({ ...prev, show_parameters_to_set: "Values saved / optimizer requested" }));
    addMessage("user", "Save & apply parameter changes.");
    addMessage("assistant", "Parameter values have been saved. Optimizer has been queued for the selected optimizer-based parameters; results will appear on the Exceptions tab.");
    setFlowEndMessage("Parameter updates applied. Run the optimizer from the Exceptions tab to refresh recommended values.");
    setCurrentStepId("ask_network_impact");
    setNetworkImpactChoice(null);
    addMessage(
      "assistant",
      "Do you want me to look for **network issues** that are impacted because of these parameter changes? (e.g. stockouts or replenishment alerts)",
    );
  }, [addMessage]);

  const handleNetworkImpactChoice = useCallback(
    (choice: "yes" | "no") => {
      setNetworkImpactChoice(choice);
      setStepSelections((prev) => ({ ...prev, ask_network_impact: choice === "yes" ? "Yes" : "No" }));
      addMessage("user", choice === "yes" ? "Yes, check network impact." : "No, end here.");
      if (choice === "no") {
        addMessage("assistant", "Understood. Parameter setup is complete. You can review exceptions on the Parameter Exceptions tab.");
        setFlowEndMessage("Parameter setup complete.");
        setCurrentStepId("flow_complete");
      } else {
        addMessage("assistant", "Opening the **Inventory Diagnostic Agent** to identify network issues (e.g. stockouts, replenishment) impacted by these parameter changes.");
        setFlowEndMessage("Opening Inventory Diagnostic Agent to check network impact.");
        setCurrentStepId("flow_complete");
        onOpenInventoryAgent?.();
      }
    },
    [addMessage, onOpenInventoryAgent],
  );

  const handleReset = useCallback(() => {
    setMessages([]);
    setCurrentStepId("idle");
    setCurrentQuestionType("generic");
    setExceptionRows(DEMO_MISSING_BAR);
    setSelectedExceptionRowIds([]);
    setParamsToSet([]);
    setNetworkImpactChoice(null);
    setFlowEndMessage(null);
    setStepSelections({});
  }, []);

  const exceptionColumns: GridColDef<ParamExceptionRow>[] = [
    { field: "sku", headerName: "SKU", minWidth: 100, flex: 0.8 },
    { field: "location", headerName: "Location", minWidth: 120, flex: 0.9 },
    { field: "parameter_code", headerName: "Parameter", minWidth: 140, flex: 1 },
    { field: "parameter_name", headerName: "Parameter Name", minWidth: 160, flex: 1.1 },
    { field: "current_value", headerName: "Current", minWidth: 90, flex: 0.7 },
    { field: "recommended_value", headerName: "Recommended", minWidth: 110, flex: 0.8 },
    { field: "issue_type", headerName: "Issue", minWidth: 100, flex: 0.7 },
  ];

  return (
    <Box
      sx={{
        display: "flex",
        gap: 1.5,
        width: "100%",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        p: 1,
        borderRadius: 3,
        border: "1px solid #dbe8ff",
        bgcolor: "#f6faff",
        boxShadow: "0 14px 34px rgba(71, 116, 221, 0.16)",
      }}
    >
      <Box sx={{ flex: "1 1 400px", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", gap: 1 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            px: 1.2,
            py: 1,
            borderRadius: 1.5,
            border: "1px solid #d8e8ff",
            bgcolor: "rgba(238, 246, 255, 0.9)",
            flexShrink: 0,
          }}
        >
          <Stack direction="row" spacing={0.8} alignItems="center">
            <AutoAwesomeOutlinedIcon fontSize="small" color="primary" />
            <Typography variant="subtitle2" color="#1f3f74" fontWeight={700}>
              Parameter Diagnostic Assistant
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Ask about missing, critical, misaligned, or new-CDC parameters.
          </Typography>
          <Tooltip title="Suggested prompts">
            <IconButton size="small" color="primary" onClick={(e) => setHelpAnchorEl(e.currentTarget)} aria-label="Help – suggested prompts">
              <HelpOutlineIcon />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(helpAnchorEl)}
            anchorEl={helpAnchorEl}
            onClose={() => setHelpAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { p: 1.5, maxWidth: 460, border: "1px solid #d8e8ff", bgcolor: "#ffffff" } } }}
          >
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              Suggested prompts
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Click a prompt to use it in the chat box, then press Submit.
            </Typography>
            <Stack spacing={0.75}>
              {HELP_PROMPTS.map((item) => (
                <Button
                  key={item.id}
                  fullWidth
                  size="small"
                  variant="outlined"
                  sx={{ justifyContent: "flex-start", textAlign: "left", textTransform: "none" }}
                  onClick={() => {
                    setPrompt(item.text);
                    setHelpAnchorEl(null);
                  }}
                >
                  {item.text}
                </Button>
              ))}
            </Stack>
          </Popover>
        </Stack>
        <Paper
          elevation={0}
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            p: 1.5,
            border: "1px solid #d8e8ff",
            bgcolor: "rgba(255,255,255,0.75)",
            borderRadius: 2,
          }}
        >
          <Stack spacing={1.2}>
            {messages.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                Use the **Help** button for suggested prompts, or ask about missing parameters for BAR, critical parameters, misaligned parameters, or parameters for new CDC-980.
              </Typography>
            ) : (
              messages.map((msg) => (
                <Stack
                  key={msg.id}
                  direction="row"
                  spacing={1.5}
                  justifyContent={msg.role === "user" ? "flex-end" : "flex-start"}
                  sx={{
                    "@keyframes bubbleIn": {
                      from: { opacity: 0, transform: "translateY(6px)" },
                      to: { opacity: 1, transform: "translateY(0)" },
                    },
                    animation: "bubbleIn 220ms ease",
                  }}
                >
                  {msg.role === "assistant" ? (
                    <Avatar sx={{ width: 30, height: 30, bgcolor: "#d9f2ff", color: "#0f5778" }}>
                      <SmartToyOutlinedIcon fontSize="small" />
                    </Avatar>
                  ) : null}
                  <Paper
                    elevation={0}
                    sx={{
                      px: 1.5,
                      py: 1,
                      maxWidth: "85%",
                      borderRadius: 2,
                      border: "1px solid",
                      borderColor: msg.role === "user" ? "#b8d5ff" : "#c6e8ff",
                      bgcolor: msg.role === "user" ? "#e8f2ff" : "#f1faff",
                      color: msg.role === "user" ? "#1f4f88" : "text.primary",
                    }}
                  >
                    <Typography variant="caption" sx={{ display: "block", mb: 0.35, fontWeight: 700, color: msg.role === "user" ? "#1f4f88" : "#1e4f86" }}>
                      {msg.role === "user" ? "You" : "Assistant"}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.45 }}>
                      {msg.content.replace(/\*\*(.*?)\*\*/g, "$1")}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        mt: 0.35,
                        display: "block",
                        textAlign: msg.role === "user" ? "right" : "left",
                        color: "text.secondary",
                        fontSize: 11,
                      }}
                    >
                      {formatMessageTime(msg.createdAt)}
                    </Typography>
                  </Paper>
                  {msg.role === "user" ? (
                    <Avatar sx={{ width: 30, height: 30, bgcolor: "#d6e7ff", color: "#204f8f" }}>
                      <PersonOutlineIcon fontSize="small" />
                    </Avatar>
                  ) : null}
                </Stack>
              ))
            )}
            {loading ? (
              <Stack
                direction="row"
                spacing={1.5}
                justifyContent="flex-start"
                sx={{
                  "@keyframes thinkingPulse": {
                    "0%": { opacity: 0.65 },
                    "50%": { opacity: 1 },
                    "100%": { opacity: 0.65 },
                  },
                  animation: "thinkingPulse 1.2s ease-in-out infinite",
                }}
              >
                <Avatar sx={{ width: 30, height: 30, bgcolor: "#d9f2ff", color: "#0f5778" }}>
                  <SmartToyOutlinedIcon fontSize="small" />
                </Avatar>
                <Box sx={{ px: 1.3, py: 0.9, borderRadius: 2, border: "1px solid #c6e8ff", bgcolor: "#f1faff", alignSelf: "center" }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ fontSize: 14 }}>Analyzing...</Typography>
                    <Stack direction="row" spacing={0.5} sx={{ ml: 0.3 }}>
                      {[0, 1, 2].map((idx) => (
                        <Box
                          key={idx}
                          sx={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            bgcolor: "#5f89c9",
                            "@keyframes dotBounce": {
                              "0%, 80%, 100%": { transform: "scale(0.7)", opacity: 0.45 },
                              "40%": { transform: "scale(1)", opacity: 1 },
                            },
                            animation: "dotBounce 1.1s infinite ease-in-out",
                            animationDelay: `${idx * 0.14}s`,
                          }}
                        />
                      ))}
                    </Stack>
                  </Stack>
                </Box>
              </Stack>
            ) : null}
            <div ref={chatEndRef} />
          </Stack>

          {currentStepId === "show_exceptions_grid" && !loading && (
            <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#d8e8ff", bgcolor: "#fbfdff", borderRadius: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
                <Chip size="small" label="Step 1" sx={{ bgcolor: "#edf4ff", color: "#1f4f88", fontWeight: 700 }} />
                <Typography variant="subtitle2">
                Parameter exceptions — select rows and click Proceed
                </Typography>
              </Stack>
              <div className="maintenance-grid-shell" style={{ height: 280 }}>
                <SmartDataGrid
                  rows={exceptionRows}
                  columns={exceptionColumns}
                  getRowId={(row) => row.id}
                  checkboxSelection
                  disableRowSelectionOnClick
                  rowSelectionModel={{ type: "include", ids: new Set(selectedExceptionRowIds) } satisfies GridRowSelectionModel}
                  onRowSelectionModelChange={(model) => setSelectedExceptionRowIds(Array.from(model.ids))}
                  pageSizeOptions={[5, 10]}
                  initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                  sx={{ border: 0 }}
                />
              </div>
              <Button variant="contained" size="small" sx={{ mt: 1, minWidth: 100 }} disabled={selectedExceptionRowIds.length === 0} onClick={handleProceedFromGrid}>
                Proceed
              </Button>
            </Paper>
          )}

          {currentStepId === "show_parameters_to_set" && (
            <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#d8e8ff", bgcolor: "#fbfdff", borderRadius: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
                <Chip size="small" label="Step 2" sx={{ bgcolor: "#edf4ff", color: "#1f4f88", fontWeight: 700 }} />
                <Typography variant="subtitle2">
                Set value or run optimizer
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                Fill-rate, Safety stock, and Service level are optimizer-based; you can set a value manually or run the optimizer. Other parameters: set the value manually.
              </Typography>
              <Stack spacing={1.5} sx={{ mb: 2 }}>
                {paramsToSet.map((param) => (
                  <Box key={param.id} sx={{ display: "flex", alignItems: "center", gap: 1.2, flexWrap: "wrap", p: 1, border: "1px solid #deebff", borderRadius: 1.2, bgcolor: "#ffffff" }}>
                    <Box sx={{ minWidth: 200 }}>
                      <Typography variant="body2" fontWeight={600}>{param.parameter_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Current: {param.current_value === "—" ? "Not set" : param.current_value} → Recommended: {param.recommended_value}
                        {param.is_optimizer_based && " (optimizer-based)"}
                      </Typography>
                    </Box>
                    <TextField
                      size="small"
                      label="New value"
                      value={param.userValue}
                      onChange={(e) => handleParamValueChange(param.id, e.target.value)}
                      sx={{ width: 120 }}
                    />
                    {param.is_optimizer_based && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ScienceOutlinedIcon />}
                        onClick={() => handleOptimizerRequest(param.id)}
                      >
                        Run optimizer
                      </Button>
                    )}
                  </Box>
                ))}
              </Stack>
              <Button variant="contained" size="small" onClick={handleSaveAndApply}>
                Save & apply
              </Button>
            </Paper>
          )}

          {currentStepId === "ask_network_impact" && (
            <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#d8e8ff", bgcolor: "#fbfdff", borderRadius: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
                <Chip size="small" label="Step 3" sx={{ bgcolor: "#edf4ff", color: "#1f4f88", fontWeight: 700 }} />
                <Typography variant="subtitle2">
                Look for network issues impacted by these parameter changes?
                </Typography>
              </Stack>
              <Stack direction="row" gap={1}>
                <Button variant={networkImpactChoice === "yes" ? "contained" : "outlined"} size="small" onClick={() => handleNetworkImpactChoice("yes")}>
                  Yes
                </Button>
                <Button variant={networkImpactChoice === "no" ? "contained" : "outlined"} size="small" onClick={() => handleNetworkImpactChoice("no")}>
                  No
                </Button>
              </Stack>
            </Paper>
          )}

          {flowEndMessage && (
            <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#9dd6bb", bgcolor: "#e8f7ef", color: "#0f5132", borderRadius: 1.5 }}>
              <Typography variant="subtitle2">{flowEndMessage}</Typography>
            </Paper>
          )}

        </Paper>

        <Paper
          elevation={0}
          sx={{
            p: 1.2,
            flexShrink: 0,
            border: "1px solid #d8e8ff",
            bgcolor: "rgba(255,255,255,0.94)",
            borderRadius: 1.5,
            borderTop: "1px solid #d8e8ff",
          }}
        >
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="stretch">
            <TextField
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Find all missing parameter for BAR? Show misaligned parameters..."
              fullWidth
              multiline
              minRows={1}
              maxRows={3}
              size="small"
              sx={{ "& .MuiInputBase-root": { bgcolor: "#ffffff", fontSize: 15 } }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitPrompt();
                }
              }}
              disabled={currentStepId !== "idle"}
            />
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Button
                variant="contained"
                disabled={!prompt.trim() || loading || currentStepId !== "idle"}
                onClick={handleSubmitPrompt}
                startIcon={<SmartToyOutlinedIcon />}
                sx={{ fontWeight: 600, fontSize: 14, minWidth: 110 }}
              >
                Submit
              </Button>
              <Tooltip title="Reset conversation">
                <IconButton color="primary" onClick={handleReset} disabled={loading}>
                  <RestartAltOutlinedIcon />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        </Paper>
      </Box>

      <Paper
        variant="outlined"
        sx={{
          width: 320,
          minWidth: 320,
          minHeight: 0,
          overflowY: "auto",
          p: 1.4,
          display: "flex",
          flexDirection: "column",
          gap: 1,
          borderColor: "#d8e8ff",
          bgcolor: "rgba(255,255,255,0.75)",
          borderRadius: 2,
        }}
      >
        <Typography variant="subtitle2" fontWeight={700} color="#1f3f74">
          Progress &amp; remaining steps
        </Typography>
        <Divider />
        {progressSteps.map((step) => (
          <Box
            key={step.id}
            sx={{
              py: 0.6,
              pl: 1,
              borderLeft: "3px solid",
              borderColor: step.status === "current" ? "primary.main" : step.status === "done" ? "success.main" : "divider",
              borderRadius: 1,
              bgcolor: step.status === "current" ? "rgba(37,99,235,0.06)" : "transparent",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  bgcolor: step.status === "current" ? "primary.main" : step.status === "done" ? "success.main" : "divider",
                  flexShrink: 0,
                }}
              />
              <Typography
                variant="caption"
                fontWeight={step.status === "current" ? 700 : 500}
                color={step.status === "current" ? "primary.main" : step.status === "done" ? "success.main" : "text.secondary"}
              >
                {step.label}
              </Typography>
              {step.status === "done" && <Chip label="Done" size="small" color="success" sx={{ height: 20 }} />}
            </Box>
            {"selection" in step && step.selection ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, pl: 0.5 }} noWrap>
                → {step.selection}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Paper>
    </Box>
  );
}
