import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
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
  Link,
  Paper,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { type GridColDef, type GridRowId, type GridRowSelectionModel } from "@mui/x-data-grid";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { createReplenishmentOrder } from "../services/api";

// ---------------------------------------------------------------------------
// Demo data: SKU–Location combinations for diagnostic flow
// ---------------------------------------------------------------------------

export interface SkuLocationRow {
  id: string;
  sku: string;
  location: string;
  alert_id?: string;
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
  { id: "s1", sku: "BAR-002", location: "STORE-001", alert_id: "ALERT-INV-STOCKOUT-001", node_type: "store", forecast_qty: 420, on_hand: 55, safety_stock: 180, weeks_of_cover: 0.7, stockout_risk: "Critical", demand_class: "A" },
  { id: "s2", sku: "BAR-002", location: "RDC-001", alert_id: "ALERT-INV-LOW-001", node_type: "rdc", forecast_qty: 1280, on_hand: 240, safety_stock: 520, weeks_of_cover: 1.0, stockout_risk: "Warning", demand_class: "A" },
  { id: "s3", sku: "SNACK-003", location: "STORE-010", alert_id: "ALERT-016", node_type: "store", forecast_qty: 360, on_hand: 65, safety_stock: 130, weeks_of_cover: 0.8, stockout_risk: "Critical", demand_class: "A" },
  { id: "s4", sku: "SNACK-003", location: "RDC-003", alert_id: "ALERT-SKUNODE-001", node_type: "rdc", forecast_qty: 940, on_hand: 220, safety_stock: 360, weeks_of_cover: 1.1, stockout_risk: "Warning", demand_class: "B" },
  { id: "s5", sku: "BAR-002", location: "CDC-001", alert_id: "ALERT-NODE-001", node_type: "cdc", forecast_qty: 1010, on_hand: 210, safety_stock: 320, weeks_of_cover: 1.0, stockout_risk: "Warning", demand_class: "A" },
];

// Demo data: WATER demand +20% (WATER SKU and demand-increase context)
const DEMO_WATER_DEMAND: SkuLocationRow[] = [
  { id: "w1", sku: "WATER", location: "STORE-001", alert_id: "ALERT-INV-STOCKOUT-001", node_type: "store", forecast_qty: 840, on_hand: 420, safety_stock: 200, weeks_of_cover: 2.5, stockout_risk: "Low", demand_class: "A" },
  { id: "w2", sku: "WATER", location: "STORE-002", alert_id: "ALERT-INV-STOCKOUT-002", node_type: "store", forecast_qty: 660, on_hand: 280, safety_stock: 180, weeks_of_cover: 2.0, stockout_risk: "Warning", demand_class: "A" },
  { id: "w3", sku: "WATER", location: "RDC-001", alert_id: "ALERT-INV-LOW-001", node_type: "rdc", forecast_qty: 2400, on_hand: 1100, safety_stock: 600, weeks_of_cover: 2.1, stockout_risk: "Low", demand_class: "A" },
  { id: "w4", sku: "WATER", location: "RDC-002", alert_id: "ALERT-NODE-001", node_type: "rdc", forecast_qty: 480, on_hand: 190, safety_stock: 120, weeks_of_cover: 1.8, stockout_risk: "Warning", demand_class: "B" },
  { id: "w5", sku: "WATER", location: "CDC-001", alert_id: "ALERT-SKU-001", node_type: "cdc", forecast_qty: 1600, on_hand: 720, safety_stock: 400, weeks_of_cover: 2.0, stockout_risk: "Low", demand_class: "A" },
];

// Demo data: Excess inventory / margin impact (excess_qty, margin_impact_pct)
const DEMO_EXCESS_MARGIN: SkuLocationRow[] = [
  { id: "e1", sku: "SNACK-003", location: "STORE-021", alert_id: "ALERT-021", node_type: "store", forecast_qty: 220, on_hand: 610, safety_stock: 85, weeks_of_cover: 11.8, stockout_risk: "None", demand_class: "C", excess_qty: 390, margin_impact_pct: -4.1 },
  { id: "e2", sku: "SNACK-003", location: "RDC-003", alert_id: "ALERT-SKUNODE-001", node_type: "rdc", forecast_qty: 780, on_hand: 2060, safety_stock: 410, weeks_of_cover: 9.2, stockout_risk: "None", demand_class: "B", excess_qty: 1280, margin_impact_pct: -3.7 },
  { id: "e3", sku: "BAR-002", location: "STORE-004", alert_id: "ALERT-009", node_type: "store", forecast_qty: 170, on_hand: 440, safety_stock: 65, weeks_of_cover: 9.8, stockout_risk: "None", demand_class: "C", excess_qty: 270, margin_impact_pct: -5.0 },
  { id: "e4", sku: "BAR-002", location: "CDC-001", alert_id: "ALERT-NODE-001", node_type: "cdc", forecast_qty: 610, on_hand: 1480, safety_stock: 260, weeks_of_cover: 8.0, stockout_risk: "None", demand_class: "B", excess_qty: 870, margin_impact_pct: -2.8 },
  { id: "e5", sku: "CEREAL-005", location: "STORE-015", alert_id: "ALERT-015", node_type: "store", forecast_qty: 190, on_hand: 520, safety_stock: 75, weeks_of_cover: 10.1, stockout_risk: "None", demand_class: "C", excess_qty: 330, margin_impact_pct: -4.5 },
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
  { id: "n1", name: "RDC-001", type: "RDC", available_qty: 450, transit_days: 2 },
  { id: "n2", name: "RDC-002", type: "RDC", available_qty: 320, transit_days: 2 },
  { id: "n3", name: "CDC-001", type: "CDC", available_qty: 600, transit_days: 3 },
  { id: "n4", name: "STORE-002", type: "Store", available_qty: 120, transit_days: 1 },
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

/** Demo outcome for autonomous "completed" preset (stock-outs-in-6-weeks path). */
const AUTONOMOUS_DEMO_ORDER_ID = "RO-01767";

export type InventoryAgentLaunchPreset = "autonomous_complete" | "autonomous_need_guidance" | null;

type InventoryDiagnosticAgentProps = {
  /**
   * When set from Information panel → Network navigation, hydrates the agent to match
   * autonomous run status (full completion vs paused for user guidance at source selection).
   */
  launchPreset?: InventoryAgentLaunchPreset;
};

function buildMessage(id: string, role: "user" | "assistant", content: string, offsetMs: number): ChatMessage {
  return { id, role, content, createdAt: Date.now() + offsetMs };
}

function extractSelectionIds(model: GridRowSelectionModel | GridRowId[] | unknown): GridRowId[] {
  if (Array.isArray(model)) return model;
  if (model && typeof model === "object" && "ids" in model) {
    const ids = (model as { ids?: Set<GridRowId> | GridRowId[] }).ids;
    if (ids instanceof Set || Array.isArray(ids)) return Array.from(ids);
  }
  return [];
}

function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function InventoryDiagnosticAgent({ launchPreset = null }: InventoryDiagnosticAgentProps) {
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
  /** Order IDs from the last successful stock-transfer creation (for deep links to Edit Order). */
  const [lastCreatedOrderIds, setLastCreatedOrderIds] = useState<string[]>([]);
  const [helpAnchorEl, setHelpAnchorEl] = useState<HTMLElement | null>(null);
  const [stepSelections, setStepSelections] = useState<Partial<Record<AgentStepId, string>>>({});
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioParams, setScenarioParams] = useState<Array<{ id: string; paramName: string; currentValue: string; recommendedValue: string }>>(
    () => DEMO_SCENARIO_PARAMS.map((p) => ({ ...p }))
  );
  const chatEndRef = useRef<HTMLDivElement>(null);
  const presetAppliedRef = useRef(false);

  /** Apply snapshot when opening from Information panel autonomous run (URL preset). Parent should remount with `key` when reopening. */
  useEffect(() => {
    if (!launchPreset) {
      presetAppliedRef.current = false;
      return;
    }
    if (presetAppliedRef.current) return;
    presetAppliedRef.current = true;

    const base = Date.now();
    let t = 0;
    const nextId = () => {
      t += 1;
      return `preset-${base}-${t}`;
    };

    if (launchPreset === "autonomous_complete") {
      const q: QuestionType = "stock_outs_6w";
      const stockPrompt = HELP_PROMPTS.find((p) => p.id === "stock_outs_6w")?.text ?? "Show me all Stock outs in next 6 weeks.";
      setCurrentQuestionType(q);
      setGridRows(DEMO_STOCKOUTS_6W);
      setSelectedRowIds(["s1"]);
      setSelectedOption("neighbours");
      setSelectedNeighbourIds(["n1"]);
      setVendorChoice("no");
      setPoConfirmChoice(null);
      setLoading(false);
      setMessages([
        buildMessage(nextId(), "user", stockPrompt, 0),
        buildMessage(nextId(), "assistant", getIntroMessageForQuestionType(q), 1),
        buildMessage(nextId(), "assistant", getResultsMessageForQuestionType(q), 2),
        buildMessage(nextId(), "user", "Proceed with 1 selected SKU/location(s).", 3),
        buildMessage(nextId(), "assistant", getChooseOptionMessageForQuestionType(q), 4),
        buildMessage(nextId(), "user", "Check nearest neighbours", 5),
        buildMessage(
          nextId(),
          "assistant",
          "Here are stores and RDCs that can transfer inventory. Select one or more, then click **Proceed**.",
          6,
        ),
        buildMessage(nextId(), "user", "Proceed with 1 selected source(s).", 7),
        buildMessage(
          nextId(),
          "assistant",
          "I will create the Stock Transfer Order. Do you want me to check if ordering from a vendor would be more cost-effective?",
          8,
        ),
        buildMessage(nextId(), "user", "No, create the Stock Transfer Order.", 9),
        buildMessage(nextId(), "assistant", "Creating Stock Transfer Order for the selected sources...", 10),
        buildMessage(
          nextId(),
          "assistant",
          `Done. Created 1 stock transfer order(s): ${AUTONOMOUS_DEMO_ORDER_ID}.`,
          11,
        ),
      ]);
      setStepSelections({
        show_sku_grid: "1 record selected",
        choose_option: "Check nearest neighbours",
        pick_neighbours: "1 source selected",
        vendor_question: "No",
      });
      setFlowEndMessage(`Created 1 stock transfer order(s): ${AUTONOMOUS_DEMO_ORDER_ID}.`);
      setLastCreatedOrderIds([AUTONOMOUS_DEMO_ORDER_ID]);
      setCurrentStepId("flow_complete");
      setPrompt("");
      return;
    }

    if (launchPreset === "autonomous_need_guidance") {
      const q: QuestionType = "demand_water";
      const waterPrompt =
        HELP_PROMPTS.find((p) => p.id === "demand_water")?.text
        ?? "Demand for item WATER is going to increase by 20% in next 3 weeks what should I do?";
      setCurrentQuestionType(q);
      setGridRows(DEMO_WATER_DEMAND);
      setSelectedRowIds(["w1"]);
      setSelectedOption("neighbours");
      setSelectedNeighbourIds([]);
      setVendorChoice(null);
      setPoConfirmChoice(null);
      setLoading(false);
      setFlowEndMessage(null);
      setLastCreatedOrderIds([]);
      setMessages([
        buildMessage(nextId(), "user", waterPrompt, 0),
        buildMessage(nextId(), "assistant", getIntroMessageForQuestionType(q), 1),
        buildMessage(nextId(), "assistant", getResultsMessageForQuestionType(q), 2),
        buildMessage(nextId(), "user", "Proceed with 1 selected SKU/location(s).", 3),
        buildMessage(nextId(), "assistant", getChooseOptionMessageForQuestionType(q), 4),
        buildMessage(nextId(), "user", "Check nearest neighbours", 5),
        buildMessage(
          nextId(),
          "assistant",
          "Here are stores and RDCs that can transfer inventory. Select one or more, then click **Proceed**.",
          6,
        ),
      ]);
      setStepSelections({
        show_sku_grid: "1 record selected",
        choose_option: "Check nearest neighbours",
      });
      setCurrentStepId("pick_neighbours");
      setPrompt("");
    }
  }, [launchPreset]);

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

  const createStockTransferOrdersFromSelection = useCallback(async (): Promise<string[]> => {
    const selectedRowIdSet = new Set(selectedRowIds.map((item) => String(item)));
    const selectedRows = gridRows.filter((row) => selectedRowIdSet.has(String(row.id)));
    if (selectedRows.length === 0) {
      throw new Error("Select at least one SKU/location before creating a stock transfer order.");
    }
    const selectedSourceIdSet = new Set(selectedNeighbourIds.map((item) => String(item)));
    const selectedSources = DEMO_NEIGHBOUR_OPTIONS.filter((row) => selectedSourceIdSet.has(String(row.id)));
    if (selectedSources.length === 0) {
      throw new Error("Select at least one source node before creating a stock transfer order.");
    }

    const primarySource = selectedSources[0];
    const createdOrderIds: string[] = [];

    for (const row of selectedRows) {
      const shortageQty = Math.max(
        50,
        Math.ceil(Math.max(row.safety_stock - row.on_hand, row.forecast_qty * 0.2)),
      );
      const eta = new Date();
      eta.setDate(eta.getDate() + Math.max(1, Number(primarySource.transit_days) || 2));

      const created = await createReplenishmentOrder({
        associate_alert: false,
        order_type: "Stock Transfer",
        status: "created",
        is_exception: false,
        order_created_by: "inventory_diagnostic_agent",
        alert_action_taken: "inventory_diagnostic_stock_transfer",
        ship_to_node_id: row.location,
        ship_from_node_id: primarySource.name,
        eta: eta.toISOString().slice(0, 10),
        order_cost: Number((shortageQty * 3.5).toFixed(2)),
        lead_time_days: Number(primarySource.transit_days) || 2,
        logistics_impact: "medium",
        update_possible: true,
        details: [
          {
            sku: row.sku,
            order_qty: shortageQty,
            ship_to_node_id: row.location,
            ship_from_node_id: primarySource.name,
          },
        ],
      });
      createdOrderIds.push(created.order_id);
    }
    return createdOrderIds;
  }, [gridRows, selectedNeighbourIds, selectedRowIds]);

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
        setLastCreatedOrderIds([]);
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
    async (choice: "yes" | "no") => {
      setVendorChoice(choice);
      setStepSelections((prev) => ({ ...prev, vendor_question: choice === "yes" ? "Yes" : "No" }));
      addMessage("user", choice === "yes" ? "Yes, check vendor." : "No, create the Stock Transfer Order.");

      if (choice === "no") {
        addMessage("assistant", "Creating Stock Transfer Order for the selected sources...");
        setLoading(true);
        setLastCreatedOrderIds([]);
        try {
          const createdOrderIds = await createStockTransferOrdersFromSelection();
          setLastCreatedOrderIds(createdOrderIds);
          addMessage(
            "assistant",
            `Done. Created ${createdOrderIds.length} stock transfer order(s): ${createdOrderIds.join(", ")}.`,
          );
          setFlowEndMessage(`Created ${createdOrderIds.length} stock transfer order(s): ${createdOrderIds.join(", ")}.`);
        } catch (error) {
          setLastCreatedOrderIds([]);
          const message = error instanceof Error ? error.message : "Failed to create stock transfer order.";
          addMessage("assistant", `Unable to create stock transfer order: ${message}`);
          setFlowEndMessage(`Unable to create stock transfer order: ${message}`);
        } finally {
          setLoading(false);
        }
        setCurrentStepId("flow_complete");
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
    [addMessage, createStockTransferOrdersFromSelection, runAfterDelay],
  );

  const handlePoConfirm = useCallback(
    async (choice: "yes" | "no") => {
      setPoConfirmChoice(choice);
      setStepSelections((prev) => ({ ...prev, po_confirm: choice === "yes" ? "Yes (PO)" : "No (STO)" }));
      addMessage("user", choice === "yes" ? "Yes, create PO." : "No, create Stock Transfer instead.");

      if (choice === "yes") {
        setLastCreatedOrderIds([]);
        addMessage("assistant", "Creating Purchase Order to Vendor V001... Done. Your PO has been created.");
        setFlowEndMessage("Purchase Order to Vendor V001 created successfully.");
      } else {
        addMessage("assistant", "Creating Stock Transfer Order instead...");
        setLoading(true);
        setLastCreatedOrderIds([]);
        try {
          const createdOrderIds = await createStockTransferOrdersFromSelection();
          setLastCreatedOrderIds(createdOrderIds);
          addMessage(
            "assistant",
            `Done. Created ${createdOrderIds.length} stock transfer order(s): ${createdOrderIds.join(", ")}.`,
          );
          setFlowEndMessage(`Created ${createdOrderIds.length} stock transfer order(s): ${createdOrderIds.join(", ")}.`);
        } catch (error) {
          setLastCreatedOrderIds([]);
          const message = error instanceof Error ? error.message : "Failed to create stock transfer order.";
          addMessage("assistant", `Unable to create stock transfer order: ${message}`);
          setFlowEndMessage(`Unable to create stock transfer order: ${message}`);
        } finally {
          setLoading(false);
        }
      }
      setCurrentStepId("flow_complete");
    },
    [addMessage, createStockTransferOrdersFromSelection],
  );

  const handleScenarioSubmit = useCallback(() => {
    const name = scenarioName.trim() || "My Scenario";
    setStepSelections((prev) => ({ ...prev, manual_scenario: name }));
    addMessage("user", `Create scenario: ${name}`);
    addMessage("assistant", `Scenario created with the name "${name}".`);
    setLastCreatedOrderIds([]);
    setFlowEndMessage(`Scenario created with the name "${name}".`);
    setCurrentStepId("flow_complete");
  }, [scenarioName, addMessage]);

  const handleReset = useCallback(() => {
    presetAppliedRef.current = false;
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
    setLastCreatedOrderIds([]);
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
      {/* Left: Chat + content; composer pinned at bottom */}
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
              Inventory Diagnostic Assistant
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
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
                Use the **Help** button above for suggested prompts, or type your own (e.g. stock outs in next 6 weeks, WATER demand +20%, or margin hit by excess inventory).
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
                      {msg.content.replace(/\*\*(.+?)\*\*/g, "$1")}
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
                    <Typography variant="body2" sx={{ fontSize: 14 }}>Thinking...</Typography>
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
        </Paper>

        {/* Step 1: SKU/Location grid */}
        {currentStepId === "show_sku_grid" && !loading && (
          <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#d8e8ff", bgcolor: "#fbfdff", borderRadius: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
              <Chip size="small" label="Step 1" sx={{ bgcolor: "#edf4ff", color: "#1f4f88", fontWeight: 700 }} />
              <Typography variant="subtitle2">
              SKU / Location results — select rows and click Proceed
              </Typography>
            </Stack>
            <div className="maintenance-grid-shell" style={{ height: 260 }}>
              <SmartDataGrid
                rows={gridRows}
                columns={skuColumns}
                checkboxSelection
                rowSelectionModel={{ type: "include", ids: new Set(selectedRowIds) } satisfies GridRowSelectionModel}
                onRowSelectionModelChange={(model) => setSelectedRowIds(extractSelectionIds(model))}
                pageSizeOptions={[5, 10]}
                initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                sx={{ border: 0 }}
              />
            </div>
            <Button
              variant="contained"
              size="small"
              sx={{ mt: 1, minWidth: 100 }}
              disabled={selectedRowIds.length === 0}
              onClick={handleProceedFromGrid}
            >
              Proceed
            </Button>
          </Paper>
        )}

        {/* Step 2: Options */}
        {currentStepId === "choose_option" && (
          <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#d8e8ff", bgcolor: "#fbfdff", borderRadius: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
              <Chip size="small" label="Step 2" sx={{ bgcolor: "#edf4ff", color: "#1f4f88", fontWeight: 700 }} />
              <Typography variant="subtitle2">
              Choose an option
              </Typography>
            </Stack>
            <Stack direction="row" flexWrap="wrap" gap={0.8}>
              {(["source", "neighbours", "optimize", "manual"] as const).map((opt) => (
                <Button
                  key={opt}
                  variant={selectedOption === opt ? "contained" : "outlined"}
                  size="small"
                  sx={{ fontWeight: selectedOption === opt ? 700 : 500 }}
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
          <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#d8e8ff", bgcolor: "#fbfdff", borderRadius: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
              <Chip size="small" label="Step 3" sx={{ bgcolor: "#edf4ff", color: "#1f4f88", fontWeight: 700 }} />
              <Typography variant="subtitle2">
              Select store(s) or RDC(s) to transfer from
              </Typography>
            </Stack>
            <div className="maintenance-grid-shell" style={{ height: 220 }}>
              <SmartDataGrid
                rows={neighbourRows}
                columns={neighbourColumns}
                checkboxSelection
                rowSelectionModel={{ type: "include", ids: new Set(selectedNeighbourIds) } satisfies GridRowSelectionModel}
                onRowSelectionModelChange={(model) => setSelectedNeighbourIds(extractSelectionIds(model))}
                hideFooter
                sx={{ border: 0 }}
              />
            </div>
            <Button
              variant="contained"
              size="small"
              sx={{ mt: 1, minWidth: 100 }}
              disabled={selectedNeighbourIds.length === 0}
              onClick={handleProceedFromNeighbours}
            >
              Proceed
            </Button>
          </Paper>
        )}

        {/* Step 3: Vendor question */}
        {currentStepId === "vendor_question" && (
          <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#d8e8ff", bgcolor: "#fbfdff", borderRadius: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
              <Chip size="small" label="Decision" sx={{ bgcolor: "#edf4ff", color: "#1f4f88", fontWeight: 700 }} />
              <Typography variant="subtitle2">
              Check vendor for cost effectiveness?
              </Typography>
            </Stack>
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
          <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#d8e8ff", bgcolor: "#fbfdff", borderRadius: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
              <Chip size="small" label="Confirm" sx={{ bgcolor: "#edf4ff", color: "#1f4f88", fontWeight: 700 }} />
              <Typography variant="subtitle2">
              Create PO to Vendor V001?
              </Typography>
            </Stack>
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
          <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#d8e8ff", bgcolor: "#fbfdff", borderRadius: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
              <Chip size="small" label="Scenario" sx={{ bgcolor: "#edf4ff", color: "#1f4f88", fontWeight: 700 }} />
              <Typography variant="subtitle2">
              Create scenario
              </Typography>
            </Stack>
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
          <Paper variant="outlined" sx={{ mt: 0.25, p: 1.2, borderColor: "#9dd6bb", bgcolor: "#e8f7ef", color: "#0f5132", borderRadius: 1.5 }}>
            {lastCreatedOrderIds.length > 0 && flowEndMessage.toLowerCase().includes("stock transfer") ? (
              <Typography variant="subtitle2" component="div">
                Created {lastCreatedOrderIds.length} stock transfer order(s):{" "}
                {lastCreatedOrderIds.map((orderId, index) => (
                  <span key={orderId}>
                    {index > 0 ? ", " : null}
                    <Link
                      component={RouterLink}
                      to={`/replenishment?tab=order-details&order_id=${encodeURIComponent(orderId)}&open_edit=1`}
                      underline="always"
                      sx={{
                        fontWeight: 700,
                        color: "inherit",
                        "&:hover": { color: "inherit", opacity: 0.92 },
                      }}
                    >
                      {orderId}
                    </Link>
                  </span>
                ))}
                .
              </Typography>
            ) : (
              <Typography variant="subtitle2">{flowEndMessage}</Typography>
            )}
          </Paper>
        )}

        {/* Composer */}
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
              placeholder="Ask about critical stock outs, demand changes, or excess inventory..."
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
                startIcon={<SendOutlinedIcon />}
                sx={{ minWidth: 110, fontWeight: 600, fontSize: 14 }}
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
