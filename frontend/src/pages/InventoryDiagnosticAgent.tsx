import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import RestartAltOutlinedIcon from "@mui/icons-material/RestartAltOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
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
// Demo data: SKU–Location combinations for diagnostic flow
// ---------------------------------------------------------------------------

export interface SkuLocationRow {
  id: string;
  sku: string;
  location: string;
  node_type: string;
  forecast_qty: number;
  on_hand: number;
  safety_stock: number;
  weeks_of_cover: number;
  stockout_risk: string;
  demand_class: string;
  excess_qty?: number;
  margin_impact_pct?: number;
}

// Help prompts shown in the Help popover
const HELP_PROMPTS = [
  {
    id: "stock_outs_6w",
    label: "Stock outs in next 6 weeks",
    text: "Show me all Stock outs in next 6 weeks.",
  },
  {
    id: "demand_water",
    label: "WATER demand +20%",
    text: "Demand for item WATER is going to increase by 20% in next 3 weeks what should I do?",
  },
  {
    id: "excess_margin",
    label: "Margin hit by excess inventory",
    text: "Find places where my margin is hit due to excess inventory?",
  },
] as const;

// Demo data: Stock outs in next 6 weeks (low weeks of cover, critical risk)
const DEMO_STOCKOUTS_6W: SkuLocationRow[] = [
  { id: "s1", sku: "SKU-101", location: "STORE-NYC-01", node_type: "store", forecast_qty: 520, on_hand: 72, safety_stock: 150, weeks_of_cover: 0.8, stockout_risk: "Critical", demand_class: "A" },
  { id: "s2", sku: "SKU-102", location: "RDC-NORTHEAST", node_type: "rdc", forecast_qty: 1400, on_hand: 210, safety_stock: 500, weeks_of_cover: 0.9, stockout_risk: "Critical", demand_class: "A" },
  { id: "s3", sku: "SKU-101", location: "STORE-PHL-01", node_type: "store", forecast_qty: 380, on_hand: 38, safety_stock: 110, weeks_of_cover: 0.6, stockout_risk: "Critical", demand_class: "A" },
  { id: "s4", sku: "SKU-203", location: "STORE-BOS-02", node_type: "store", forecast_qty: 290, on_hand: 55, safety_stock: 95, weeks_of_cover: 1.1, stockout_risk: "Warning", demand_class: "B" },
  { id: "s5", sku: "SKU-204", location: "CDC-MIDATL", node_type: "cdc", forecast_qty: 920, on_hand: 180, safety_stock: 300, weeks_of_cover: 1.0, stockout_risk: "Warning", demand_class: "A" },
];

// Demo data: WATER demand +20% (WATER SKU and demand-increase context)
const DEMO_WATER_DEMAND: SkuLocationRow[] = [
  { id: "w1", sku: "WATER", location: "STORE-NYC-01", node_type: "store", forecast_qty: 840, on_hand: 420, safety_stock: 200, weeks_of_cover: 2.5, stockout_risk: "Low", demand_class: "A" },
  { id: "w2", sku: "WATER", location: "STORE-PHL-01", node_type: "store", forecast_qty: 660, on_hand: 280, safety_stock: 180, weeks_of_cover: 2.0, stockout_risk: "Warning", demand_class: "A" },
  { id: "w3", sku: "WATER", location: "RDC-NORTHEAST", node_type: "rdc", forecast_qty: 2400, on_hand: 1100, safety_stock: 600, weeks_of_cover: 2.1, stockout_risk: "Low", demand_class: "A" },
  { id: "w4", sku: "WATER", location: "STORE-BOS-02", node_type: "store", forecast_qty: 480, on_hand: 190, safety_stock: 120, weeks_of_cover: 1.8, stockout_risk: "Warning", demand_class: "B" },
  { id: "w5", sku: "WATER", location: "CDC-MIDATL", node_type: "cdc", forecast_qty: 1600, on_hand: 720, safety_stock: 400, weeks_of_cover: 2.0, stockout_risk: "Low", demand_class: "A" },
];

// Demo data: Excess inventory / margin impact (excess_qty, margin_impact_pct)
const DEMO_EXCESS_MARGIN: SkuLocationRow[] = [
  { id: "e1", sku: "SKU-301", location: "STORE-NYC-01", node_type: "store", forecast_qty: 200, on_hand: 580, safety_stock: 80, weeks_of_cover: 12.0, stockout_risk: "None", demand_class: "C", excess_qty: 380, margin_impact_pct: -4.2 },
  { id: "e2", sku: "SKU-302", location: "RDC-NORTHEAST", node_type: "rdc", forecast_qty: 800, on_hand: 2100, safety_stock: 400, weeks_of_cover: 9.5, stockout_risk: "None", demand_class: "B", excess_qty: 1300, margin_impact_pct: -3.8 },
  { id: "e3", sku: "SKU-303", location: "STORE-PHL-01", node_type: "store", forecast_qty: 150, on_hand: 420, safety_stock: 60, weeks_of_cover: 10.2, stockout_risk: "None", demand_class: "C", excess_qty: 270, margin_impact_pct: -5.1 },
  { id: "e4", sku: "SKU-301", location: "CDC-MIDATL", node_type: "cdc", forecast_qty: 600, on_hand: 1450, safety_stock: 250, weeks_of_cover: 8.1, stockout_risk: "None", demand_class: "B", excess_qty: 850, margin_impact_pct: -2.9 },
  { id: "e5", sku: "SKU-304", location: "STORE-BOS-02", node_type: "store", forecast_qty: 180, on_hand: 510, safety_stock: 70, weeks_of_cover: 10.5, stockout_risk: "None", demand_class: "C", excess_qty: 330, margin_impact_pct: -4.6 },
];

const DEMO_SKU_LOCATION_ROWS: SkuLocationRow[] = DEMO_STOCKOUTS_6W;

type QuestionType = "stock_outs_6w" | "demand_water" | "excess_margin" | "generic";

function detectQuestionType(q: string): QuestionType {
  const lower = q.toLowerCase().trim();
  if (/\b(stock\s*out|stockout|stock\s*outs)\b.*\b(6\s*weeks?|next\s*6\s*w)/i.test(lower) || /\b(6\s*weeks?|next\s*6\s*w).*stock\s*out/i.test(lower)) return "stock_outs_6w";
  if (/\bwater\b.*\b(increase|going\s*up|demand).*20\s*%|demand.*water.*20\s*%|20\s*%.*water/i.test(lower) || /\bwater\b.*\b3\s*weeks?\b/i.test(lower)) return "demand_water";
  if (/\b(margin|excess\s*inventory|excess\s*inv)\b.*\b(hit|impact|affected)\b/i.test(lower) || /\bexcess\s*inventory\b.*\bmargin\b/i.test(lower)) return "excess_margin";
  return "generic";
}

function getDemoRowsForQuestionType(type: QuestionType): SkuLocationRow[] {
  switch (type) {
    case "stock_outs_6w":
      return DEMO_STOCKOUTS_6W;
    case "demand_water":
      return DEMO_WATER_DEMAND;
    case "excess_margin":
      return DEMO_EXCESS_MARGIN;
    default:
      return DEMO_STOCKOUTS_6W;
  }
}

function getIntroMessageForQuestionType(type: QuestionType): string {
  switch (type) {
    case "stock_outs_6w":
      return "Identifying locations with projected stock outs in the next 6 weeks based on forecast and current inventory...";
    case "demand_water":
      return "Evaluating WATER demand increase (+20% over next 3 weeks) and impact by location...";
    case "excess_margin":
      return "Scanning network for nodes where excess inventory is impacting margin...";
    default:
      return "Analyzing your question and fetching SKU/location data...";
  }
}

function getResultsMessageForQuestionType(type: QuestionType): string {
  switch (type) {
    case "stock_outs_6w":
      return "Here are the SKU–Location combinations with projected stock outs in the next 6 weeks. Select one or more rows and click **Proceed** to choose how to resolve the shortage (e.g. transfer from neighbours or reorder from vendor).";
    case "demand_water":
      return "Here are WATER locations and their current position vs the +20% demand increase over the next 3 weeks. Select the locations you want to address and click **Proceed** to see options (increase supply, transfer, or optimize).";
    case "excess_margin":
      return "Here are nodes where excess inventory is hurting margin (excess qty and margin impact %). Select one or more rows and click **Proceed** to choose actions (redeploy, markdown, or optimize).";
    default:
      return "Here are the SKU–Location combinations that match your query. Select one or more rows and click **Proceed** to choose how to resolve the shortage.";
  }
}

function getChooseOptionMessageForQuestionType(type: QuestionType): string {
  if (type === "excess_margin") {
    return "Choose how you want to address the excess inventory and margin impact:\n\n• **Check Source** – See if other nodes can absorb or redeploy this inventory\n• **Check nearest neighbours** – Find stores or RDCs that need this stock\n• **Optimize** – Run optimization to suggest redeploy or markdown\n• **Manually find a solution** – Create a scenario and explore options";
  }
  return "Choose how you want to address the shortage:\n\n• **Check Source** – Verify if the current source has enough inventory\n• **Check nearest neighbours** – Find stores or RDCs that can transfer inventory\n• **Optimize** – Run optimization to suggest best action\n• **Manually find a solution** – Create a scenario and explore options";
}

const DEMO_NEIGHBOUR_OPTIONS = [
  { id: "n1", name: "RDC-NORTHEAST", type: "RDC", available_qty: 450, transit_days: 2 },
  { id: "n2", name: "STORE-NYC-02", type: "Store", available_qty: 120, transit_days: 1 },
  { id: "n3", name: "CDC-MIDATL", type: "CDC", available_qty: 600, transit_days: 3 },
  { id: "n4", name: "STORE-BOS-01", type: "Store", available_qty: 80, transit_days: 1 },
];

type AgentStepId =
  | "idle"
  | "show_sku_grid"
  | "choose_option"
  | "check_source_done"
  | "pick_neighbours"
  | "vendor_question"
  | "po_confirm"
  | "manual_scenario"
  | "flow_complete";

// Demo inventory parameter recommendations for manual scenario
const DEMO_SCENARIO_PARAMS = [
  { id: "p1", paramName: "Safety stock (units)", currentValue: "120", recommendedValue: "150" },
  { id: "p2", paramName: "Lead time (days)", currentValue: "5", recommendedValue: "4" },
  { id: "p3", paramName: "Service level target", currentValue: "0.95", recommendedValue: "0.98" },
  { id: "p4", paramName: "Min order qty", currentValue: "50", recommendedValue: "75" },
];

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

interface ProgressStep {
  id: AgentStepId;
  label: string;
  status: "pending" | "current" | "done";
}

const ALL_STEPS: ProgressStep[] = [
  { id: "idle", label: "Enter your question", status: "pending" },
  { id: "show_sku_grid", label: "Review SKU/Location results", status: "pending" },
  { id: "choose_option", label: "Choose resolution option", status: "pending" },
  { id: "pick_neighbours", label: "Select source (neighbours/vendor)", status: "pending" },
  { id: "vendor_question", label: "Vendor vs transfer decision", status: "pending" },
  { id: "po_confirm", label: "Confirm PO or Stock Transfer", status: "pending" },
  { id: "manual_scenario", label: "Create scenario (name + parameters)", status: "pending" },
  { id: "flow_complete", label: "Order created", status: "pending" },
];

export default function InventoryDiagnosticAgent() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStepId, setCurrentStepId] = useState<AgentStepId>("idle");
  const [currentQuestionType, setCurrentQuestionType] = useState<QuestionType>("generic");
  const [gridRows, setGridRows] = useState<SkuLocationRow[]>(DEMO_SKU_LOCATION_ROWS);
  const [selectedRowIds, setSelectedRowIds] = useState<GridRowId[]>([]);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [selectedNeighbourIds, setSelectedNeighbourIds] = useState<GridRowId[]>([]);
  const [vendorChoice, setVendorChoice] = useState<"yes" | "no" | null>(null);
  const [poConfirmChoice, setPoConfirmChoice] = useState<"yes" | "no" | null>(null);
  const [loading, setLoading] = useState(false);
  const [flowEndMessage, setFlowEndMessage] = useState<string | null>(null);
  const [helpAnchorEl, setHelpAnchorEl] = useState<HTMLElement | null>(null);
  const [stepSelections, setStepSelections] = useState<Partial<Record<AgentStepId, string>>>({});
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioParams, setScenarioParams] = useState<Array<{ id: string; paramName: string; currentValue: string; recommendedValue: string }>>(
    () => DEMO_SCENARIO_PARAMS.map((p) => ({ ...p }))
  );
  const chatEndRef = useRef<HTMLDivElement>(null);

  const progressSteps = ALL_STEPS.map((s) => {
    const idx = ALL_STEPS.findIndex((x) => x.id === s.id);
    const currentIdx = ALL_STEPS.findIndex((x) => x.id === currentStepId);
    let status: "pending" | "current" | "done" = "pending";
    if (currentStepId === "flow_complete" && idx < ALL_STEPS.length - 1) status = "done";
    else if (currentStepId === "manual_scenario" && s.id === "flow_complete") status = "pending";
    else if (idx < currentIdx) status = "done";
    else if (idx === currentIdx) status = "current";
    const selection = stepSelections[s.id];
    return { ...s, status, selection };
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const addMessage = useCallback((role: "user" | "assistant", content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `msg-${Date.now()}`, role, content, createdAt: Date.now() },
    ]);
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
    const questionType = detectQuestionType(q);
    setCurrentQuestionType(questionType);
    setGridRows(getDemoRowsForQuestionType(questionType));
    addMessage("assistant", getIntroMessageForQuestionType(questionType));

    runAfterDelay(1200, () => {
      setLoading(false);
      addMessage("assistant", getResultsMessageForQuestionType(questionType));
      setCurrentStepId("show_sku_grid");
    });
  }, [prompt, addMessage, runAfterDelay]);

  const handleProceedFromGrid = useCallback(() => {
    if (selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    const selectionText = count === 1 ? "1 record selected" : `${count} records selected`;
    setStepSelections((prev) => ({ ...prev, show_sku_grid: selectionText }));
    addMessage("user", `Proceed with ${count} selected SKU/location(s).`);
    addMessage("assistant", getChooseOptionMessageForQuestionType(currentQuestionType));
    setCurrentStepId("choose_option");
    setSelectedOption(null);
  }, [selectedRowIds.length, currentQuestionType, addMessage]);

  const selectOption = useCallback(
    (option: "source" | "neighbours" | "optimize" | "manual") => {
      if (currentStepId !== "choose_option") return;
      setSelectedOption(option);
      const labels: Record<string, string> = {
        source: "Check Source",
        neighbours: "Check nearest neighbours",
        optimize: "Optimize",
        manual: "Manually find a solution (create scenario)",
      };
      setStepSelections((prev) => ({ ...prev, choose_option: labels[option] }));
      addMessage("user", labels[option]);

      if (option === "source") {
        addMessage("assistant", "Checking source availability...");
        setLoading(true);
        runAfterDelay(3000, () => {
          setLoading(false);
          addMessage(
            "assistant",
            "Source doesn't have enough inventory. Here are the nearest neighbours (stores and RDCs) that can transfer inventory. Select one or more, then we can create a Stock Transfer Order.",
          );
          setCurrentStepId("pick_neighbours");
        });
      } else if (option === "neighbours") {
        addMessage("assistant", "Fetching nearest neighbours that can transfer inventory...");
        setLoading(true);
        runAfterDelay(1500, () => {
          setLoading(false);
          addMessage(
            "assistant",
            "Here are stores and RDCs that can transfer inventory. Select one or more, then click **Proceed**.",
          );
          setCurrentStepId("pick_neighbours");
        });
      } else if (option === "optimize") {
        addMessage("assistant", "Optimizer has started, check the results on the Alert tab.");
        setCurrentStepId("flow_complete");
        setFlowEndMessage("Optimizer has started. Check the Alert tab for results.");
      } else if (option === "manual") {
        addMessage("assistant", "Create a scenario to explore options manually. Enter a scenario name and adjust the inventory parameter recommendations below, then submit.");
        setCurrentStepId("manual_scenario");
        setScenarioName("");
        setScenarioParams(DEMO_SCENARIO_PARAMS.map((p) => ({ ...p })));
      } else {
        addMessage("assistant", `"${labels[option]}" is not fully implemented in this demo. Try **Check Source** or **Check nearest neighbours** to see the full flow.`);
      }
    },
    [currentStepId, addMessage, runAfterDelay],
  );

  const handleProceedFromNeighbours = useCallback(() => {
    if (selectedNeighbourIds.length === 0) return;
    const count = selectedNeighbourIds.length;
    const selectionText = count === 1 ? "1 source selected" : `${count} sources selected`;
    setStepSelections((prev) => ({ ...prev, pick_neighbours: selectionText }));
    addMessage("user", `Proceed with ${count} selected source(s).`);
    addMessage(
      "assistant",
      "I will create the Stock Transfer Order. Do you want me to check if ordering from a vendor would be more cost-effective?",
    );
    setCurrentStepId("vendor_question");
    setVendorChoice(null);
  }, [selectedNeighbourIds.length, addMessage]);

  const handleVendorChoice = useCallback(
    (choice: "yes" | "no") => {
      setVendorChoice(choice);
      setStepSelections((prev) => ({ ...prev, vendor_question: choice === "yes" ? "Yes" : "No" }));
      addMessage("user", choice === "yes" ? "Yes, check vendor." : "No, create the Stock Transfer Order.");

      if (choice === "no") {
        addMessage("assistant", "Creating Stock Transfer Order for the selected sources... Done. Created a Stock transfer order from a RDC.");
        setCurrentStepId("flow_complete");
        setFlowEndMessage("Created a Stock transfer order from a RDC.");
      } else {
        addMessage("assistant", "Checking vendor options for cost comparison...");
        setLoading(true);
        runAfterDelay(5000, () => {
          setLoading(false);
          addMessage(
            "assistant",
            "I will create a Purchase Order to Vendor V001 — that is more cost-effective than a Stock Transfer Order. Do you want to proceed?",
          );
          setCurrentStepId("po_confirm");
          setPoConfirmChoice(null);
        });
      }
    },
    [addMessage, runAfterDelay],
  );

  const handlePoConfirm = useCallback(
    (choice: "yes" | "no") => {
      setPoConfirmChoice(choice);
      setStepSelections((prev) => ({ ...prev, po_confirm: choice === "yes" ? "Yes (PO)" : "No (STO)" }));
      addMessage("user", choice === "yes" ? "Yes, create PO." : "No, create Stock Transfer instead.");

      if (choice === "yes") {
        addMessage("assistant", "Creating Purchase Order to Vendor V001... Done. Your PO has been created.");
        setFlowEndMessage("Purchase Order to Vendor V001 created successfully.");
      } else {
        addMessage("assistant", "Creating Stock Transfer Order instead... Done. Created a Stock transfer order from a RDC.");
        setFlowEndMessage("Created a Stock transfer order from a RDC.");
      }
      setCurrentStepId("flow_complete");
    },
    [addMessage],
  );

  const handleScenarioSubmit = useCallback(() => {
    const name = scenarioName.trim() || "My Scenario";
    setStepSelections((prev) => ({ ...prev, manual_scenario: name }));
    addMessage("user", `Create scenario: ${name}`);
    addMessage("assistant", `Scenario created with the name "${name}".`);
    setFlowEndMessage(`Scenario created with the name "${name}".`);
    setCurrentStepId("flow_complete");
  }, [scenarioName, addMessage]);

  const handleReset = useCallback(() => {
    setMessages([]);
    setCurrentStepId("idle");
    setCurrentQuestionType("generic");
    setGridRows(DEMO_SKU_LOCATION_ROWS);
    setSelectedRowIds([]);
    setSelectedOption(null);
    setSelectedNeighbourIds([]);
    setVendorChoice(null);
    setPoConfirmChoice(null);
    setFlowEndMessage(null);
    setStepSelections({});
    setScenarioName("");
    setScenarioParams(DEMO_SCENARIO_PARAMS.map((p) => ({ ...p })));
  }, []);

  const skuColumns: GridColDef[] = [
    { field: "sku", headerName: "SKU", minWidth: 100, flex: 0.8 },
    { field: "location", headerName: "Location (Node)", minWidth: 140, flex: 1 },
    { field: "node_type", headerName: "Type", minWidth: 90, flex: 0.6 },
    { field: "forecast_qty", headerName: "Forecast", minWidth: 90, flex: 0.7, type: "number" },
    { field: "on_hand", headerName: "On Hand", minWidth: 90, flex: 0.7, type: "number" },
    { field: "safety_stock", headerName: "Safety Stock", minWidth: 110, flex: 0.8, type: "number" },
    { field: "weeks_of_cover", headerName: "WoC", minWidth: 70, flex: 0.5, type: "number" },
    { field: "stockout_risk", headerName: "Risk", minWidth: 90, flex: 0.7 },
    { field: "demand_class", headerName: "Demand Class", minWidth: 110, flex: 0.7 },
    ...(currentQuestionType === "excess_margin"
      ? [
          { field: "excess_qty", headerName: "Excess Qty", minWidth: 100, flex: 0.7, type: "number" as const },
          { field: "margin_impact_pct", headerName: "Margin Impact %", minWidth: 120, flex: 0.8, type: "number" as const },
        ]
      : []),
  ];

  const neighbourColumns: GridColDef[] = [
    { field: "name", headerName: "Name", minWidth: 160, flex: 1 },
    { field: "type", headerName: "Type", minWidth: 90, flex: 0.6 },
    { field: "available_qty", headerName: "Available Qty", minWidth: 110, flex: 0.7, type: "number" },
    { field: "transit_days", headerName: "Transit (days)", minWidth: 100, flex: 0.6, type: "number" },
  ];

  const neighbourRows = DEMO_NEIGHBOUR_OPTIONS.map((n) => ({ ...n, id: n.id }));

  return (
    <Box sx={{ display: "flex", gap: 2, width: "100%", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Left: Chat + content; composer pinned at bottom */}
      <Box sx={{ flex: "1 1 400px", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5, flexShrink: 0 }}>
          <Typography variant="subtitle2" color="text.secondary">
            Ask a question or pick a suggested prompt below.
          </Typography>
          <Tooltip title="Suggested prompts">
            <IconButton
              size="small"
              color="primary"
              onClick={(e) => setHelpAnchorEl(e.currentTarget)}
              aria-label="Help – suggested prompts"
            >
              <HelpOutlineIcon />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(helpAnchorEl)}
            anchorEl={helpAnchorEl}
            onClose={() => setHelpAnchorEl(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { p: 1.5, maxWidth: 420 } } }}
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
        <Paper elevation={0} sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto", p: 1.5 }}>
          <Stack spacing={1.2}>
            {messages.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                Use the **Help** button above for suggested prompts, or type your own (e.g. stock outs in next 6 weeks, WATER demand +20%, or margin hit by excess inventory).
              </Typography>
            ) : (
              messages.map((msg) => (
                <Stack
                  key={msg.id}
                  direction="row"
                  spacing={1.5}
                  justifyContent={msg.role === "user" ? "flex-end" : "flex-start"}
                >
                  {msg.role === "assistant" ? (
                    <Avatar sx={{ bgcolor: "primary.main", width: 32, height: 32 }}>
                      <SmartToyOutlinedIcon fontSize="small" />
                    </Avatar>
                  ) : null}
                  <Paper
                    elevation={0}
                    sx={{
                      px: 1.5,
                      py: 1,
                      maxWidth: "85%",
                      bgcolor: msg.role === "user" ? "primary.main" : "action.hover",
                      color: msg.role === "user" ? "primary.contrastText" : "text.primary",
                      borderRadius: 2,
                    }}
                  >
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {msg.content.replace(/\*\*(.+?)\*\*/g, "$1")}
                    </Typography>
                  </Paper>
                  {msg.role === "user" ? (
                    <Avatar sx={{ bgcolor: "secondary.main", width: 32, height: 32 }}>
                      <PersonOutlineIcon fontSize="small" />
                    </Avatar>
                  ) : null}
                </Stack>
              ))
            )}
            {loading ? (
              <Stack direction="row" spacing={1.5} justifyContent="flex-start">
                <Avatar sx={{ bgcolor: "primary.main", width: 32, height: 32 }}>
                  <SmartToyOutlinedIcon fontSize="small" />
                </Avatar>
                <Chip label="Thinking..." size="small" sx={{ alignSelf: "center" }} />
              </Stack>
            ) : null}
            <div ref={chatEndRef} />
          </Stack>
        </Paper>

        {/* Step 1: SKU/Location grid */}
        {currentStepId === "show_sku_grid" && !loading && (
          <Paper variant="outlined" sx={{ mt: 1, p: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              SKU / Location results — select rows and click Proceed
            </Typography>
            <div className="maintenance-grid-shell" style={{ height: 260 }}>
              <SmartDataGrid
                rows={gridRows}
                columns={skuColumns}
                checkboxSelection
                disableRowSelectionOnClick
                rowSelectionModel={{ type: "include", ids: new Set(selectedRowIds) } satisfies GridRowSelectionModel}
                onRowSelectionModelChange={(model) => setSelectedRowIds(Array.from(model.ids))}
                pageSizeOptions={[5, 10]}
                initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                sx={{ border: 0 }}
              />
            </div>
            <Button
              variant="contained"
              size="small"
              sx={{ mt: 1 }}
              disabled={selectedRowIds.length === 0}
              onClick={handleProceedFromGrid}
            >
              Proceed
            </Button>
          </Paper>
        )}

        {/* Step 2: Options */}
        {currentStepId === "choose_option" && (
          <Paper variant="outlined" sx={{ mt: 1, p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Choose an option
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {(["source", "neighbours", "optimize", "manual"] as const).map((opt) => (
                <Button
                  key={opt}
                  variant={selectedOption === opt ? "contained" : "outlined"}
                  size="small"
                  onClick={() => selectOption(opt)}
                >
                  {opt === "source" && "Check Source"}
                  {opt === "neighbours" && "Check nearest neighbours"}
                  {opt === "optimize" && "Optimize"}
                  {opt === "manual" && "Manually find a solution"}
                </Button>
              ))}
            </Stack>
          </Paper>
        )}

        {/* Step 2b: Neighbours grid */}
        {currentStepId === "pick_neighbours" && !loading && (
          <Paper variant="outlined" sx={{ mt: 1, p: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Select store(s) or RDC(s) to transfer from
            </Typography>
            <div className="maintenance-grid-shell" style={{ height: 220 }}>
              <SmartDataGrid
                rows={neighbourRows}
                columns={neighbourColumns}
                checkboxSelection
                disableRowSelectionOnClick
                rowSelectionModel={{ type: "include", ids: new Set(selectedNeighbourIds) } satisfies GridRowSelectionModel}
                onRowSelectionModelChange={(model) => setSelectedNeighbourIds(Array.from(model.ids))}
                hideFooter
                sx={{ border: 0 }}
              />
            </div>
            <Button
              variant="contained"
              size="small"
              sx={{ mt: 1 }}
              disabled={selectedNeighbourIds.length === 0}
              onClick={handleProceedFromNeighbours}
            >
              Proceed
            </Button>
          </Paper>
        )}

        {/* Step 3: Vendor question */}
        {currentStepId === "vendor_question" && (
          <Paper variant="outlined" sx={{ mt: 1, p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Check vendor for cost effectiveness?
            </Typography>
            <Stack direction="row" gap={1}>
              <Button
                variant={vendorChoice === "yes" ? "contained" : "outlined"}
                size="small"
                onClick={() => handleVendorChoice("yes")}
              >
                Yes
              </Button>
              <Button
                variant={vendorChoice === "no" ? "contained" : "outlined"}
                size="small"
                onClick={() => handleVendorChoice("no")}
              >
                No
              </Button>
            </Stack>
          </Paper>
        )}

        {/* Step 4: PO confirm */}
        {currentStepId === "po_confirm" && (
          <Paper variant="outlined" sx={{ mt: 1, p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Create PO to Vendor V001?
            </Typography>
            <Stack direction="row" gap={1}>
              <Button
                variant={poConfirmChoice === "yes" ? "contained" : "outlined"}
                size="small"
                onClick={() => handlePoConfirm("yes")}
              >
                Yes
              </Button>
              <Button
                variant={poConfirmChoice === "no" ? "contained" : "outlined"}
                size="small"
                onClick={() => handlePoConfirm("no")}
              >
                No (create Stock Transfer instead)
              </Button>
            </Stack>
          </Paper>
        )}

        {/* Manual scenario: name + inventory parameter recommendations */}
        {currentStepId === "manual_scenario" && (
          <Paper variant="outlined" sx={{ mt: 1, p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Create scenario
            </Typography>
            <TextField
              size="small"
              fullWidth
              label="Scenario name"
              placeholder="e.g. FY26 Northeast buffer increase"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              sx={{ mb: 2 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Inventory parameter recommendations — change values for the scenario
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {scenarioParams.map((param) => (
                <Box key={param.id} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Typography variant="caption" sx={{ minWidth: 140 }}>{param.paramName}</Typography>
                  <Typography variant="caption" color="text.secondary">Current: {param.currentValue}</Typography>
                  <TextField
                    size="small"
                    label="New value"
                    value={param.recommendedValue}
                    onChange={(e) =>
                      setScenarioParams((prev) =>
                        prev.map((p) => (p.id === param.id ? { ...p, recommendedValue: e.target.value } : p))
                      )
                    }
                    sx={{ width: 120 }}
                  />
                </Box>
              ))}
            </Stack>
            <Button variant="contained" size="small" onClick={handleScenarioSubmit}>
              Create scenario
            </Button>
          </Paper>
        )}

        {flowEndMessage && (
          <Paper variant="outlined" sx={{ mt: 1, p: 2, bgcolor: "success.light", color: "success.contrastText" }}>
            <Typography variant="subtitle2">{flowEndMessage}</Typography>
          </Paper>
        )}

        {/* Composer */}
        <Paper elevation={0} sx={{ p: 1.5, flexShrink: 0 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="stretch">
            <TextField
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask about critical stock outs, demand changes, or excess inventory..."
              fullWidth
              multiline
              minRows={1}
              maxRows={3}
              size="small"
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
                startIcon={<SendOutlinedIcon />}
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

      {/* Right: Progress & remaining steps */}
      <Paper
        variant="outlined"
        sx={{
          width: 320,
          minWidth: 320,
          minHeight: 0,
          overflowY: "auto",
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
        }}
      >
        <Typography variant="subtitle2" fontWeight={600}>
          Progress &amp; remaining steps
        </Typography>
        <Divider />
        {progressSteps.map((step) => (
          <Box
            key={step.id}
            sx={{
              py: 0.5,
              pl: 1,
              borderLeft: "3px solid",
              borderColor: step.status === "current" ? "primary.main" : step.status === "done" ? "success.main" : "divider",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
              <Typography
                variant="caption"
                fontWeight={step.status === "current" ? 700 : 400}
                color={step.status === "current" ? "primary.main" : step.status === "done" ? "success.main" : "text.secondary"}
                noWrap
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
