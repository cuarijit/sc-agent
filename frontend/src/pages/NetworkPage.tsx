import AddLinkOutlinedIcon from "@mui/icons-material/AddLinkOutlined";
import AddLocationAltOutlinedIcon from "@mui/icons-material/AddLocationAltOutlined";
import ExpandLessOutlinedIcon from "@mui/icons-material/ExpandLessOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import FitScreenOutlinedIcon from "@mui/icons-material/FitScreenOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import PsychologyAltOutlinedIcon from "@mui/icons-material/PsychologyAltOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import OpenInFullOutlinedIcon from "@mui/icons-material/OpenInFullOutlined";
import RuleOutlinedIcon from "@mui/icons-material/RuleOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import ZoomInOutlinedIcon from "@mui/icons-material/ZoomInOutlined";
import ZoomOutOutlinedIcon from "@mui/icons-material/ZoomOutOutlined";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
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
import { type GridColDef, type GridRowId, type GridRowSelectionModel } from "@mui/x-data-grid";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";

import type {
  MasterDataOptions,
  NetworkAgentResponse,
  NetworkBaselineResponse,
  NetworkImpactedSkuRecord,
  NetworkNode,
  NetworkOptionsResponse,
  NetworkScenarioDetailResponse,
  NetworkSimulationResponse,
  NetworkViewResponse,
  ReplenishmentOrdersResponse,
} from "../types";
import {
  analyzeNetwork,
  applyNetworkChange,
  createNetworkScenario,
  fetchNetworkBaseline,
  fetchNetworkAlertImpactedSkus,
  fetchNetworkView,
  fetchNetworkOptions,
  fetchNetworkScenario,
  fetchReplenishmentOrders,
  fetchMasterDataOptions,
  saveNetworkScenario,
  simulateNetworkScenario,
} from "../services/api";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import { appendGlobalFilters, firstFilterValue, globalFiltersKey } from "../types/filters";
import FilterBuilderDialog from "../components/shared/FilterBuilderDialog";
import { EMPTY_FILTER_STATE, applyFilterState, type FilterFieldOption, type FilterState } from "../filtering";
import InventoryDiagnosticAgent from "./InventoryDiagnosticAgent";
import ProjectedInventoryWorkbench from "../components/inventory/ProjectedInventoryWorkbench";

const DEMO_SIMULATION: NetworkSimulationResponse = {
  scenario_id: "demo-scenario-001",
  run_id: "NET-RUN-DEMO",
  baseline_metrics: {},
  scenario_metrics: {},
  deltas: {},
  comparison_cards: [
    { title: "Service Level", baseline: 0.972, scenario: 0.965, delta: -0.007 },
    { title: "Transport Cost", baseline: 12450, scenario: 13120, delta: 670 },
    { title: "Inventory Cost", baseline: 89200, scenario: 91800, delta: 2600 },
    { title: "Total Safety Stock", baseline: 77500, scenario: 79800, delta: 2300 },
    { title: "Throughput Utilization", baseline: 0.68, scenario: 0.64, delta: -0.04 },
    { title: "Margin Delta", baseline: -0.42, scenario: -0.51, delta: -0.09 },
    { title: "Lead Time (days)", baseline: 2.8, scenario: 3.1, delta: 0.3 },
    { title: "Node Count", baseline: 43, scenario: 43, delta: 0 },
    { title: "Lane Count", baseline: 52, scenario: 52, delta: 0 },
  ],
  node_impacts: [
    { node_id: "CDC-001", name: "CDC 1", status: "active", service_level_target: 0.97, strategy: "push" },
    { node_id: "CDC-002", name: "CDC 2", status: "active", service_level_target: 0.97, strategy: "push" },
    { node_id: "RDC-001", name: "RDC Northeast 1", status: "active", service_level_target: 0.96, strategy: "pull" },
    { node_id: "RDC-002", name: "RDC Northeast 2", status: "active", service_level_target: 0.96, strategy: "pull" },
    { node_id: "RDC-003", name: "RDC Southeast 1", status: "active", service_level_target: 0.96, strategy: "pull" },
    { node_id: "STR-001", name: "Store 1", status: "active", service_level_target: 0.95, strategy: "pull" },
    { node_id: "STR-002", name: "Store 2", status: "active", service_level_target: 0.95, strategy: "pull" },
    { node_id: "STR-003", name: "Store 3", status: "disrupted", service_level_target: 0.92, strategy: "pull" },
  ],
  lane_impacts: [
    { lane_id: "L-PLANT-CDC1", origin_node_id: "PLANT-001", dest_node_id: "CDC-001", mode: "tl", lane_status: "active", transit_time_mean_days: 2.2 },
    { lane_id: "L-CDC1-RDC1", origin_node_id: "CDC-001", dest_node_id: "RDC-001", mode: "ltl", lane_status: "active", transit_time_mean_days: 1.5 },
    { lane_id: "L-CDC1-RDC2", origin_node_id: "CDC-001", dest_node_id: "RDC-002", mode: "ltl", lane_status: "active", transit_time_mean_days: 1.8 },
    { lane_id: "L-RDC1-STR1", origin_node_id: "RDC-001", dest_node_id: "STR-001", mode: "parcel", lane_status: "active", transit_time_mean_days: 1.0 },
    { lane_id: "L-RDC1-STR2", origin_node_id: "RDC-001", dest_node_id: "STR-002", mode: "parcel", lane_status: "active", transit_time_mean_days: 1.2 },
    { lane_id: "L-RDC3-STR3", origin_node_id: "RDC-003", dest_node_id: "STR-003", mode: "parcel", lane_status: "degraded", transit_time_mean_days: 2.0 },
  ],
};

export default function NetworkPage() {
  const { filters, config } = useOutletContext<ShellContextValue>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [scenarioId, setScenarioId] = useState("");
  const [createScenarioOpen, setCreateScenarioOpen] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState("FY26 Northeast Expansion Plan");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [addNodeName, setAddNodeName] = useState("Planned RDC Northeast");
  const [addNodeType, setAddNodeType] = useState("rdc");
  const [addNodeRegion, setAddNodeRegion] = useState("NORTHEAST");
  const [addLaneOrigin, setAddLaneOrigin] = useState("");
  const [addLaneDest, setAddLaneDest] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const [scenarioControlsOpen, setScenarioControlsOpen] = useState(false);
  const [selectedAlertTitle, setSelectedAlertTitle] = useState("");
  const [agentQuestion, setAgentQuestion] = useState("Show me impact of the Florida DC shutdown due to flood on this quarter margins.");
  const [latestSimulation, setLatestSimulation] = useState<NetworkSimulationResponse | null>(null);
  const [impactedSkuOpen, setImpactedSkuOpen] = useState(false);
  const [impactedSkuAlertId, setImpactedSkuAlertId] = useState("");
  const [impactedSkuFilterOpen, setImpactedSkuFilterOpen] = useState(false);
  const [impactedSkuFilterState, setImpactedSkuFilterState] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [activeTab, setActiveTab] = useState(0);
  const [alertFilterOpen, setAlertFilterOpen] = useState(false);
  const [alertFilterState, setAlertFilterState] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [selectedAlertIds, setSelectedAlertIds] = useState<GridRowId[]>([]);
  const [alertsDashboardCollapsed, setAlertsDashboardCollapsed] = useState(false);
  const [networkFilterSku, setNetworkFilterSku] = useState("");
  const [networkFilterNode, setNetworkFilterNode] = useState("");
  const [networkFilterAlert, setNetworkFilterAlert] = useState("");
  const [networkWeeksOfCoverage, setNetworkWeeksOfCoverage] = useState(8);
  const [selectedInsightNodeId, setSelectedInsightNodeId] = useState("");
  const [graphExpandedOpen, setGraphExpandedOpen] = useState(false);
  const [nodeAlertsOpen, setNodeAlertsOpen] = useState(false);
  const [selectedAlertNodeId, setSelectedAlertNodeId] = useState("");
  const focusAlertId = searchParams.get("alert_id") ?? "";

  const [networkNodeDragOffsets, setNetworkNodeDragOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const [networkDragging, setNetworkDragging] = useState<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startDx: number;
    startDy: number;
    scale: number;
  } | null>(null);
  const [networkJustFinishedDrag, setNetworkJustFinishedDrag] = useState(false);
  const [networkGraphScale, setNetworkGraphScale] = useState(1);
  const [networkGraphScaleExpanded, setNetworkGraphScaleExpanded] = useState(1);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoveredEdgeIdExpanded, setHoveredEdgeIdExpanded] = useState<string | null>(null);
  const [networkViewport, setNetworkViewport] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [networkViewportExpanded, setNetworkViewportExpanded] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const networkCanvasRef = useRef<HTMLDivElement | null>(null);
  const networkCanvasExpandedRef = useRef<HTMLDivElement | null>(null);
  const [paramsModalOpen, setParamsModalOpen] = useState(false);
  const [inventoryAgentModalOpen, setInventoryAgentModalOpen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [alertRules, setAlertRules] = useState<Array<{
    id: string;
    name: string;
    enabled: boolean;
    conditionField: string;
    conditionOperator: string;
    conditionValue: string;
    alert_type: string;
    severity: string;
    description: string;
  }>>(() => [
    { id: "r1", name: "Stockout risk (low coverage)", enabled: true, conditionField: "days_of_coverage", conditionOperator: "<", conditionValue: "2", alert_type: "capacity", severity: "critical", description: "Raise critical alert when days of coverage falls below 2 weeks." },
    { id: "r2", name: "Service level at risk", enabled: true, conditionField: "service_level_target", conditionOperator: "<", conditionValue: "0.92", alert_type: "service_risk", severity: "warning", description: "Warn when service level target drops below 92%." },
    { id: "r3", name: "Demand volatility spike", enabled: true, conditionField: "volatility_index", conditionOperator: ">", conditionValue: "0.75", alert_type: "demand_spike", severity: "warning", description: "Warn on high demand volatility for impacted SKU-node." },
    { id: "r4", name: "Low on-hand inventory", enabled: false, conditionField: "inventory_on_hand", conditionOperator: "<", conditionValue: "100", alert_type: "capacity", severity: "info", description: "Info alert when on-hand inventory is below 100 units." },
    { id: "r5", name: "Forecast drop", enabled: true, conditionField: "forecast_qty", conditionOperator: "<", conditionValue: "50", alert_type: "demand_spike", severity: "info", description: "Info when weekly forecast falls below 50." },
  ]);
  const [ruleForm, setRuleForm] = useState({ name: "", conditionField: "days_of_coverage", conditionOperator: "<", conditionValue: "", alert_type: "capacity", severity: "critical", description: "" });
  const [autonomousMode, setAutonomousMode] = useState(false);
  const [autonomousScheduleOpen, setAutonomousScheduleOpen] = useState(false);
  const [autonomousStartDate, setAutonomousStartDate] = useState("");
  const [autonomousEndDate, setAutonomousEndDate] = useState("");
  const [projectionModalOpen, setProjectionModalOpen] = useState(false);
  const [projectionSku, setProjectionSku] = useState("");
  const [projectionNode, setProjectionNode] = useState("");
  const [projectionSource, setProjectionSource] = useState("");
  const filtersKey = globalFiltersKey(filters);
  const primaryLocation = firstFilterValue(filters.location);

  const openProjectionModal = useCallback((sku?: string | null, node?: string | null, source?: string) => {
    setProjectionSku(String(sku ?? "").trim());
    setProjectionNode(String(node ?? "").trim());
    setProjectionSource(source ?? "");
    setProjectionModalOpen(true);
  }, []);

  useEffect(() => {
    if (searchParams.get("openInventoryAgent") === "1") {
      setInventoryAgentModalOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("openInventoryAgent");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const baselineParams = new URLSearchParams();
  if (filters.region) baselineParams.set("region", filters.region);
  const primarySku = firstFilterValue(filters.sku);
  const primaryAlertId = firstFilterValue(filters.alertId);
  if (primarySku) baselineParams.set("product", primarySku);
  for (const alertId of filters.alertId) {
    if (alertId.trim()) baselineParams.append("alert_id", alertId.trim());
  }
  for (const alertType of filters.alertType) {
    if (alertType.trim()) baselineParams.append("alert_type", alertType.trim());
  }
  for (const severity of filters.severity) {
    if (severity.trim()) baselineParams.append("severity", severity.trim());
  }
  const effectiveNetworkSku = networkFilterSku || primarySku;
  const effectiveNetworkNode = networkFilterNode || primaryLocation;
  if (scenarioId) baselineParams.set("scenario_id", scenarioId);

  useEffect(() => {
    setNetworkFilterSku((prev) => (prev ? prev : primarySku));
  }, [primarySku]);

  useEffect(() => {
    setNetworkFilterNode((prev) => (prev ? prev : primaryLocation));
  }, [primaryLocation]);

  useEffect(() => {
    setNetworkFilterAlert((prev) => (prev ? prev : primaryAlertId));
  }, [primaryAlertId]);

  const { data: baseline } = useQuery<NetworkBaselineResponse>({
    queryKey: ["network-baseline", filtersKey, scenarioId],
    queryFn: () => fetchNetworkBaseline(baselineParams),
  });
  const { data: masterDataOptions } = useQuery<MasterDataOptions>({
    queryKey: ["master-data-options"],
    queryFn: fetchMasterDataOptions,
  });
  const { data: options } = useQuery<NetworkOptionsResponse>({ queryKey: ["network-options"], queryFn: fetchNetworkOptions });
  const { data: scenarioDetail } = useQuery<NetworkScenarioDetailResponse>({
    queryKey: ["network-scenario", scenarioId],
    queryFn: () => fetchNetworkScenario(scenarioId),
    enabled: Boolean(scenarioId),
  });
  const { data: impactedSkus } = useQuery<NetworkImpactedSkuRecord[]>({
    queryKey: ["network-alert-impacted-skus", impactedSkuAlertId],
    queryFn: () => fetchNetworkAlertImpactedSkus(impactedSkuAlertId),
    enabled: impactedSkuOpen && Boolean(impactedSkuAlertId),
  });
  const networkViewParams = new URLSearchParams();
  if (effectiveNetworkSku) networkViewParams.set("sku", effectiveNetworkSku);
  if (effectiveNetworkNode) networkViewParams.set("node", effectiveNetworkNode);
  if (networkFilterAlert) networkViewParams.set("alert_id", networkFilterAlert);
  networkViewParams.set("weeks_of_coverage", String(networkWeeksOfCoverage));
  const { data: networkView } = useQuery<NetworkViewResponse>({
    queryKey: ["network-view", effectiveNetworkSku, effectiveNetworkNode, networkFilterAlert, networkWeeksOfCoverage, filtersKey],
    queryFn: () => fetchNetworkView(networkViewParams),
  });
  const graphProductDetail = useMemo(() => {
    const sku = (effectiveNetworkSku ?? "").trim();
    if (!sku) return null;
    const product = (masterDataOptions?.products ?? []).find((item) => String(item.sku) === sku);
    if (!product) return { sku, name: "Product details unavailable", category: "", brand: "" };
    return {
      sku: product.sku,
      name: product.name,
      category: product.category,
      brand: product.brand,
    };
  }, [effectiveNetworkSku, masterDataOptions?.products]);
  const exceptionParams = useMemo(() => {
    const p = appendGlobalFilters(new URLSearchParams(), { ...filters, runId: "", category: "", supplier: "", exceptionStatus: "" });
    p.set("exception_only", "true");
    return p;
  }, [filtersKey]);
  const { data: replenishmentExceptionData } = useQuery<ReplenishmentOrdersResponse>({
    queryKey: ["replenishment-orders", "exceptions", "network", filtersKey],
    queryFn: () => fetchReplenishmentOrders(exceptionParams),
  });
  const orderFinancialMetrics = useMemo(() => {
    const rows = replenishmentExceptionData?.rows ?? [];
    const totalCost = rows.reduce((sum, item) => sum + item.order_cost, 0);
    const delayedExceptionCost = rows
      .filter((item) => item.delivery_delay_days > 0)
      .reduce((sum, item) => sum + item.order_cost, 0);
    const delayedOrders = rows.filter((item) => item.delivery_delay_days > 0).length;
    return {
      totalCost,
      delayedExceptionCost,
      delayedOrders,
      totalRows: rows.length,
    };
  }, [replenishmentExceptionData?.rows]);

  const displayedNodes = scenarioDetail?.nodes ?? baseline?.nodes ?? [];

  const LAYOUT = useMemo(() => {
    const COLUMN_SPACING = 340;
    const ROW_SPACING = 93;
    const PADDING = 22;
    return { COLUMN_SPACING, ROW_SPACING, PADDING };
  }, []);

  const viewFlowNodes = useMemo(() => {
    const nodes = networkView?.graph_nodes ?? [];
    const edges = networkView?.graph_edges ?? [];
    if (nodes.length === 0) return [];

    const nodeIds = new Set(nodes.map((n) => n.node_id));
    const targets = new Set(edges.map((e) => e.target_node_id));
    const roots = nodes.filter((n) => !targets.has(n.node_id)).map((n) => n.node_id);
    if (roots.length === 0) {
      const sources = new Set(edges.map((e) => e.source_node_id));
      roots.push(...nodes.filter((n) => !sources.has(n.node_id)).map((n) => n.node_id));
    }
    if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0].node_id);

    const levelByNode = new Map<string, number>();
    roots.forEach((id) => levelByNode.set(id, 0));
    const incoming = new Map<string, string[]>();
    for (const e of edges) {
      if (!nodeIds.has(e.source_node_id) || !nodeIds.has(e.target_node_id)) continue;
      if (!incoming.has(e.target_node_id)) incoming.set(e.target_node_id, []);
      incoming.get(e.target_node_id)!.push(e.source_node_id);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) {
        const t = e.target_node_id;
        const s = e.source_node_id;
        if (!nodeIds.has(s) || !nodeIds.has(t)) continue;
        const lS = levelByNode.get(s) ?? 0;
        const lT = levelByNode.get(t) ?? 0;
        const newT = lS + 1;
        if (newT > lT) {
          levelByNode.set(t, newT);
          changed = true;
        }
      }
    }
    nodes.forEach((n) => {
      if (!levelByNode.has(n.node_id)) levelByNode.set(n.node_id, 0);
    });

    const byLevel = new Map<number, string[]>();
    for (const n of nodes) {
      const l = levelByNode.get(n.node_id) ?? 0;
      if (!byLevel.has(l)) byLevel.set(l, []);
      byLevel.get(l)!.push(n.node_id);
    }
    const levels = [...byLevel.keys()].sort((a, b) => a - b);
    const nodeToItem = new Map(nodes.map((n) => [n.node_id, n]));

    const { COLUMN_SPACING, ROW_SPACING, PADDING } = LAYOUT;
    const result: Array<{ id: string; x: number; y: number; label: string; node: (typeof nodes)[0] }> = [];
    const maxRows = Math.max(1, ...levels.map((level) => (byLevel.get(level) ?? []).length));
    const orderByNode = new Map<string, number>();
    for (const level of levels) {
      const ids = byLevel.get(level) ?? [];
      if (level === 0) {
        ids.sort();
      } else {
        ids.sort((a, b) => {
          const aIncoming = incoming.get(a) ?? [];
          const bIncoming = incoming.get(b) ?? [];
          const aScore = aIncoming.length
            ? aIncoming.reduce((sum, parent) => sum + (orderByNode.get(parent) ?? 0), 0) / aIncoming.length
            : Number.MAX_SAFE_INTEGER;
          const bScore = bIncoming.length
            ? bIncoming.reduce((sum, parent) => sum + (orderByNode.get(parent) ?? 0), 0) / bIncoming.length
            : Number.MAX_SAFE_INTEGER;
          if (aScore === bScore) return a.localeCompare(b);
          return aScore - bScore;
        });
      }
      const topOffset = ((maxRows - ids.length) * ROW_SPACING) / 2;
      ids.forEach((id, idx) => {
        const item = nodeToItem.get(id)!;
        orderByNode.set(id, idx);
        result.push({
          id: item.node_id,
          x: PADDING + level * COLUMN_SPACING,
          y: PADDING + topOffset + idx * ROW_SPACING,
          label: `${item.name}\n${item.node_type.toUpperCase()} · ${item.region}`,
          node: item,
        });
      });
    }
    return result;
  }, [networkView?.graph_nodes, networkView?.graph_edges, LAYOUT]);

  const viewFlowEdges = useMemo(
    () =>
      (networkView?.graph_edges ?? []).map((edge) => ({
        id: edge.edge_id,
        source: edge.source_node_id,
        target: edge.target_node_id,
        label: edge.sourcing_strategy.toUpperCase(),
      })),
    [networkView?.graph_edges],
  );
  const edgeOrderById = useMemo(() => {
    const byPair = new Map<string, Array<{ id: string; source: string; target: string }>>();
    for (const edge of viewFlowEdges) {
      const key = `${edge.source}__${edge.target}`;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key)?.push(edge);
    }
    const ordered = new Map<string, { idx: number; count: number }>();
    for (const list of byPair.values()) {
      list.forEach((edge, idx) => {
        ordered.set(edge.id, { idx, count: list.length });
      });
    }
    return ordered;
  }, [viewFlowEdges]);
  const edgeLaneById = useMemo(() => {
    const nodeById = new Map(viewFlowNodes.map((node) => [node.id, node]));
    const byCorridor = new Map<string, Array<{ id: string; sourceY: number; targetY: number }>>();
    for (const edge of viewFlowEdges) {
      const sourcePos = nodeById.get(edge.source);
      const targetPos = nodeById.get(edge.target);
      if (!sourcePos || !targetPos) continue;
      const sourceCol = Math.round(sourcePos.x / Math.max(1, LAYOUT.COLUMN_SPACING));
      const targetCol = Math.round(targetPos.x / Math.max(1, LAYOUT.COLUMN_SPACING));
      const key = `${sourceCol}__${targetCol}`;
      if (!byCorridor.has(key)) byCorridor.set(key, []);
      byCorridor.get(key)?.push({
        id: edge.id,
        sourceY: sourcePos.y,
        targetY: targetPos.y,
      });
    }
    const lanes = new Map<string, { laneIdx: number; laneCount: number }>();
    for (const entries of byCorridor.values()) {
      entries
        .sort((a, b) => (a.sourceY + a.targetY) - (b.sourceY + b.targetY))
        .forEach((item, idx) => {
          lanes.set(item.id, { laneIdx: idx, laneCount: entries.length });
        });
    }
    return lanes;
  }, [viewFlowEdges, viewFlowNodes, LAYOUT.COLUMN_SPACING]);
  const selectedNodeInsight = useMemo(
    () => (networkView?.node_insights ?? []).find((item) => item.node_id == selectedInsightNodeId),
    [networkView?.node_insights, selectedInsightNodeId],
  );
  const viewNodeById = useMemo(() => new Map(viewFlowNodes.map((item) => [item.id, item])), [viewFlowNodes]);

  const nodeInsightByNodeId = useMemo(() => {
    const m = new Map<string, NonNullable<typeof selectedNodeInsight>>();
    for (const ins of networkView?.node_insights ?? []) {
      m.set(ins.node_id, ins);
    }
    return m;
  }, [networkView?.node_insights]);

  const nodeSizes = useMemo(() => {
    const baseW = 116;
    const baseH = 46;
    const insights = networkView?.node_insights ?? [];
    const maxForecast = Math.max(1, ...insights.map((i) => i.forecast_qty ?? 0));
    const m = new Map<string, { w: number; h: number }>();
    for (const n of viewFlowNodes) {
      const ins = nodeInsightByNodeId.get(n.id);
      const forecast = ins?.forecast_qty ?? 0;
      const scale = 0.92 + 0.18 * (forecast / maxForecast);
      m.set(n.id, { w: Math.round(baseW * scale), h: Math.round(baseH * scale) });
    }
    return m;
  }, [viewFlowNodes, nodeInsightByNodeId, networkView?.node_insights]);

  const nodesWithAlerts = useMemo(() => {
    const alerts = baseline?.alerts ?? [];
    const set = new Set<string>();
    for (const a of alerts) {
      if (a.impacted_node_id) set.add(String(a.impacted_node_id));
    }
    return set;
  }, [baseline?.alerts]);

  const nodeAlertsByNodeId = useMemo(() => {
    const map = new Map<string, Array<NonNullable<NetworkBaselineResponse["alerts"]>[number]>>();
    for (const alert of baseline?.alerts ?? []) {
      const nodeId = alert.impacted_node_id ? String(alert.impacted_node_id) : "";
      if (!nodeId) continue;
      if (!map.has(nodeId)) map.set(nodeId, []);
      map.get(nodeId)?.push(alert);
    }
    return map;
  }, [baseline?.alerts]);
  const nodeAlertSeverityByNodeId = useMemo(() => {
    const rank: Record<string, number> = { info: 1, warning: 2, critical: 3 };
    const map = new Map<string, "critical" | "warning" | "info">();
    for (const [nodeId, alerts] of nodeAlertsByNodeId.entries()) {
      let best: "critical" | "warning" | "info" = "info";
      for (const alert of alerts) {
        const raw = String(alert.severity ?? "").toLowerCase();
        const sev: "critical" | "warning" | "info" =
          raw === "critical" ? "critical" : raw === "warning" ? "warning" : "info";
        if (rank[sev] > rank[best]) best = sev;
      }
      map.set(nodeId, best);
    }
    return map;
  }, [nodeAlertsByNodeId]);

  const selectedNodeAlerts = useMemo(
    () => nodeAlertsByNodeId.get(selectedAlertNodeId) ?? [],
    [nodeAlertsByNodeId, selectedAlertNodeId],
  );

  const NODE_BOX_WIDTH = 116;
  const NODE_BOX_HEIGHT = 46;

  function pointOnRectBoundary(
    boxLeft: number,
    boxTop: number,
    boxW: number,
    boxH: number,
    fromCx: number,
    fromCy: number,
    toPx: number,
    toPy: number,
  ): { x: number; y: number } {
    const cx = boxLeft + boxW / 2;
    const cy = boxTop + boxH / 2;
    let dx = toPx - cx;
    let dy = toPy - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len;
    dy /= len;
    let tMin = Infinity;
    if (dx > 0) {
      const t = (boxLeft + boxW - cx) / dx;
      if (t > 0 && t < tMin) tMin = t;
    }
    if (dx < 0) {
      const t = (boxLeft - cx) / dx;
      if (t > 0 && t < tMin) tMin = t;
    }
    if (dy > 0) {
      const t = (boxTop + boxH - cy) / dy;
      if (t > 0 && t < tMin) tMin = t;
    }
    if (dy < 0) {
      const t = (boxTop - cy) / dy;
      if (t > 0 && t < tMin) tMin = t;
    }
    return { x: cx + tMin * dx, y: cy + tMin * dy };
  }

  const effectiveNodePositions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of viewFlowNodes) {
      const off = networkNodeDragOffsets[n.id];
      m.set(n.id, { x: n.x + (off?.dx ?? 0), y: n.y + (off?.dy ?? 0) });
    }
    return m;
  }, [viewFlowNodes, networkNodeDragOffsets]);

  useEffect(() => {
    setNetworkNodeDragOffsets({});
  }, [networkFilterSku]);

  const handleNetworkNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string, scale: number) => {
      e.preventDefault();
      e.stopPropagation();
      const off = networkNodeDragOffsets[nodeId];
      setNetworkDragging({
        nodeId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startDx: off?.dx ?? 0,
        startDy: off?.dy ?? 0,
        scale,
      });
    },
    [networkNodeDragOffsets],
  );

  useEffect(() => {
    if (!networkDragging) return;
    const onMove = (e: MouseEvent) => {
      setNetworkNodeDragOffsets((prev) => ({
        ...prev,
        [networkDragging.nodeId]: {
          dx: networkDragging.startDx + (e.clientX - networkDragging.startClientX) / networkDragging.scale,
          dy: networkDragging.startDy + (e.clientY - networkDragging.startClientY) / networkDragging.scale,
        },
      }));
    };
    const onUp = () => {
      setNetworkDragging(null);
      setNetworkJustFinishedDrag(true);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [networkDragging]);

  const networkCanvasSize = useMemo(() => {
    if (viewFlowNodes.length === 0) return { width: 600, height: 400 };
    let maxX = 0;
    let maxY = 0;
    for (const n of viewFlowNodes) {
      const pos = effectiveNodePositions.get(n.id) ?? { x: n.x, y: n.y };
      const size = nodeSizes.get(n.id) ?? { w: 150, h: 64 };
      maxX = Math.max(maxX, pos.x + size.w + LAYOUT.PADDING);
      maxY = Math.max(maxY, pos.y + size.h + LAYOUT.PADDING);
    }
    return { width: Math.max(600, maxX), height: Math.max(400, maxY) };
  }, [viewFlowNodes, effectiveNodePositions, nodeSizes, LAYOUT.PADDING]);

  useEffect(() => {
    const normal = networkCanvasRef.current;
    if (normal) {
      setNetworkViewport({ left: normal.scrollLeft, top: normal.scrollTop, width: normal.clientWidth, height: normal.clientHeight });
    }
    const expanded = networkCanvasExpandedRef.current;
    if (expanded) {
      setNetworkViewportExpanded({
        left: expanded.scrollLeft,
        top: expanded.scrollTop,
        width: expanded.clientWidth,
        height: expanded.clientHeight,
      });
    }
  }, [networkGraphScale, networkGraphScaleExpanded, graphExpandedOpen]);
  const fitGraphToView = useCallback((expanded: boolean) => {
    const ref = expanded ? networkCanvasExpandedRef : networkCanvasRef;
    const setScale = expanded ? setNetworkGraphScaleExpanded : setNetworkGraphScale;
    const wrapper = ref.current;
    if (!wrapper) return;
    const horizontalFactor = expanded ? 0.5 : 1;
    const verticalFactor = expanded ? 0.5 : 1;
    const logicalWidth = networkCanvasSize.width * horizontalFactor;
    const logicalHeight = networkCanvasSize.height * verticalFactor;
    const availableW = Math.max(300, wrapper.clientWidth - 24);
    const availableH = Math.max(220, wrapper.clientHeight - 24);
    const suggested = Math.min(availableW / logicalWidth, availableH / logicalHeight);
    const next = Math.max(0.55, Math.min(1.6, suggested));
    setScale(next);
    wrapper.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  }, [networkCanvasSize.height, networkCanvasSize.width]);
  const fitExpandedGraphToWidth = useCallback(() => {
    const wrapper = networkCanvasExpandedRef.current;
    if (!wrapper) return;
    const availableW = Math.max(320, wrapper.clientWidth - 24);
    const expandedHorizontalFactor = 0.5;
    const suggested = availableW / Math.max(1, networkCanvasSize.width * expandedHorizontalFactor);
    const next = Math.max(0.55, Math.min(1.9, suggested));
    setNetworkGraphScaleExpanded(next);
    wrapper.scrollTo({ left: 0, top: 0, behavior: "auto" });
  }, [networkCanvasSize.width]);
  useEffect(() => {
    if (!graphExpandedOpen) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      fitExpandedGraphToWidth();
      raf2 = requestAnimationFrame(() => fitExpandedGraphToWidth());
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [graphExpandedOpen, fitExpandedGraphToWidth]);

  const onMiniMapNavigate = useCallback((event: React.MouseEvent<HTMLDivElement>, expanded: boolean) => {
    const ref = expanded ? networkCanvasExpandedRef : networkCanvasRef;
    const wrapper = ref.current;
    if (!wrapper) return;
    const scale = expanded ? networkGraphScaleExpanded : networkGraphScale;
    const horizontalFactor = expanded ? 0.5 : 1;
    const verticalFactor = expanded ? 0.5 : 1;
    const rect = event.currentTarget.getBoundingClientRect();
    const relX = (event.clientX - rect.left) / Math.max(1, rect.width);
    const relY = (event.clientY - rect.top) / Math.max(1, rect.height);
    const baseX = relX * (networkCanvasSize.width * horizontalFactor);
    const baseY = relY * (networkCanvasSize.height * verticalFactor);
    const targetLeft = Math.max(0, baseX * scale - wrapper.clientWidth / 2);
    const targetTop = Math.max(0, baseY * scale - wrapper.clientHeight / 2);
    wrapper.scrollTo({ left: targetLeft, top: targetTop, behavior: "smooth" });
  }, [networkCanvasSize.height, networkCanvasSize.width, networkGraphScale, networkGraphScaleExpanded]);

  const renderNetworkCanvas = (expanded = false) => {
    const scale = expanded ? networkGraphScaleExpanded : networkGraphScale;
    const horizontalFactor = expanded ? 0.5 : 1;
    const verticalFactor = expanded ? 0.5 : 1;
    const nodeBoxFactor = expanded ? 0.5 : 1;
    const activeHoveredEdgeId = expanded ? hoveredEdgeIdExpanded : hoveredEdgeId;
    const viewport = expanded ? networkViewportExpanded : networkViewport;
    const logicalCanvasWidth = networkCanvasSize.width * horizontalFactor;
    const logicalCanvasHeight = networkCanvasSize.height * verticalFactor;
    const baseWidth = (expanded ? Math.max(1320, logicalCanvasWidth + 180) : logicalCanvasWidth) * scale;
    const baseHeight = (expanded ? Math.max(760, logicalCanvasHeight + 120) : logicalCanvasHeight) * scale;
    const width = Math.max(baseWidth, viewport.width || 0);
    const height = Math.max(baseHeight, viewport.height || 0);
    const viewportBaseLeft = viewport.left / Math.max(0.001, scale);
    const viewportBaseTop = viewport.top / Math.max(0.001, scale);
    const viewportBaseWidth = viewport.width / Math.max(0.001, scale);
    const viewportBaseHeight = viewport.height / Math.max(0.001, scale);
    const miniMapW = 158;
    const miniMapH = 104;
    const miniViewportLeft = (viewportBaseLeft / Math.max(1, logicalCanvasWidth)) * miniMapW;
    const miniViewportTop = (viewportBaseTop / Math.max(1, logicalCanvasHeight)) * miniMapH;
    const miniViewportWidth = (viewportBaseWidth / Math.max(1, logicalCanvasWidth)) * miniMapW;
    const miniViewportHeight = (viewportBaseHeight / Math.max(1, logicalCanvasHeight)) * miniMapH;
    const controls = (
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 1,
          px: 0.2,
        }}
      >
        <Box
          sx={{
            bgcolor: "rgba(255,255,255,0.94)",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            px: 1,
            py: 0.6,
            minWidth: 220,
            maxWidth: 300,
          }}
        >
          <Typography variant="caption" sx={{ fontSize: 10.5, color: "text.secondary", display: "block" }}>
            Network Product
          </Typography>
          <Typography variant="body2" sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3 }}>
            {graphProductDetail?.sku ?? "No SKU selected"}
          </Typography>
          {graphProductDetail ? (
            <Typography variant="caption" sx={{ display: "block", fontSize: 10.5 }}>
              {graphProductDetail.name}
              {graphProductDetail.category ? ` · ${graphProductDetail.category}` : ""}
              {graphProductDetail.brand ? ` · ${graphProductDetail.brand}` : ""}
            </Typography>
          ) : null}
        </Box>
        <Box />
      </Box>
    );
    const expandedOverlayControls = expanded ? (
      <Stack
        direction="row"
        spacing={0.7}
        sx={{
          position: "absolute",
          left: 10,
          bottom: 10,
          zIndex: 25,
          alignItems: "flex-end",
          pointerEvents: "none",
        }}
      >
        <Stack
          direction="row"
          spacing={0.4}
          sx={{
            pointerEvents: "auto",
            bgcolor: "rgba(255,255,255,0.95)",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            p: 0.25,
          }}
        >
          <Tooltip title="Zoom out">
            <IconButton size="small" onClick={() => setNetworkGraphScaleExpanded((v) => Math.max(0.55, v - 0.1))}>
              <ZoomOutOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="caption" sx={{ minWidth: 44, textAlign: "center", lineHeight: "30px" }}>
            {Math.round(scale * 100)}%
          </Typography>
          <Tooltip title="Zoom in">
            <IconButton size="small" onClick={() => setNetworkGraphScaleExpanded((v) => Math.min(1.9, v + 0.1))}>
              <ZoomInOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Fit to view">
            <IconButton size="small" onClick={() => fitGraphToView(true)}>
              <FitScreenOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Box
          sx={{
            pointerEvents: "auto",
            width: miniMapW,
            height: miniMapH,
            borderRadius: 1,
            border: "1px solid",
            borderColor: "divider",
            bgcolor: "rgba(248,252,255,0.95)",
            position: "relative",
            cursor: "pointer",
            overflow: "hidden",
          }}
          onClick={(e) => onMiniMapNavigate(e, true)}
        >
          <Typography
            variant="caption"
            sx={{
              position: "absolute",
              top: 2,
              left: 5,
              fontSize: 9.5,
              color: "text.secondary",
              zIndex: 2,
            }}
          >
            Navigator
          </Typography>
          {viewFlowEdges.map((edge) => {
            const sourcePos = effectiveNodePositions.get(edge.source);
            const targetPos = effectiveNodePositions.get(edge.target);
            if (!sourcePos || !targetPos) return null;
            const srcSize = nodeSizes.get(edge.source) ?? { w: NODE_BOX_WIDTH, h: NODE_BOX_HEIGHT };
            const tgtSize = nodeSizes.get(edge.target) ?? { w: NODE_BOX_WIDTH, h: NODE_BOX_HEIGHT };
            const x1 = (((sourcePos.x * horizontalFactor) + (srcSize.w * nodeBoxFactor) / 2) / Math.max(1, logicalCanvasWidth)) * miniMapW;
            const y1 = (((sourcePos.y * verticalFactor) + (srcSize.h * nodeBoxFactor) / 2) / Math.max(1, logicalCanvasHeight)) * miniMapH;
            const x2 = (((targetPos.x * horizontalFactor) + (tgtSize.w * nodeBoxFactor) / 2) / Math.max(1, logicalCanvasWidth)) * miniMapW;
            const y2 = (((targetPos.y * verticalFactor) + (tgtSize.h * nodeBoxFactor) / 2) / Math.max(1, logicalCanvasHeight)) * miniMapH;
            return <Box key={`mini_${edge.id}`} sx={{ position: "absolute", left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.max(1, Math.abs(x2 - x1)), height: Math.max(1, Math.abs(y2 - y1)), borderTop: "1px solid rgba(71,85,105,0.45)", transformOrigin: "top left", transform: `translate(${x1 <= x2 ? 0 : Math.abs(x2 - x1)}px, ${y1 <= y2 ? 0 : Math.abs(y2 - y1)}px) rotate(${Math.atan2(y2 - y1, x2 - x1)}rad)` }} />;
          })}
          {viewFlowNodes.map((node) => {
            const pos = effectiveNodePositions.get(node.id) ?? { x: node.x, y: node.y };
            const size = nodeSizes.get(node.id) ?? { w: NODE_BOX_WIDTH, h: NODE_BOX_HEIGHT };
            const x = ((pos.x * horizontalFactor) / Math.max(1, logicalCanvasWidth)) * miniMapW;
            const y = ((pos.y * verticalFactor) / Math.max(1, logicalCanvasHeight)) * miniMapH;
            const w = Math.max(3, ((size.w * nodeBoxFactor * horizontalFactor) / Math.max(1, logicalCanvasWidth)) * miniMapW);
            const h = Math.max(3, ((size.h * nodeBoxFactor * verticalFactor) / Math.max(1, logicalCanvasHeight)) * miniMapH);
            return <Box key={`mini_node_${node.id}`} sx={{ position: "absolute", left: x, top: y, width: w, height: h, bgcolor: nodesWithAlerts.has(node.id) ? "warning.light" : "primary.light", border: "1px solid rgba(30,64,175,0.35)", borderRadius: 0.5 }} />;
          })}
          <Box
            sx={{
              position: "absolute",
              left: Math.max(0, miniViewportLeft),
              top: Math.max(0, miniViewportTop),
              width: Math.min(miniMapW, Math.max(8, miniViewportWidth)),
              height: Math.min(miniMapH, Math.max(8, miniViewportHeight)),
              border: "1.5px solid #2563eb",
              bgcolor: "rgba(37,99,235,0.12)",
              borderRadius: 0.5,
            }}
          />
        </Box>
      </Stack>
    ) : null;
    const expandedProductOverlay = expanded ? (
      <Box
        sx={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 25,
          pointerEvents: "none",
        }}
      >
        <Box
          sx={{
            pointerEvents: "auto",
            bgcolor: "rgba(255,255,255,0.95)",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            px: 1,
            py: 0.6,
            minWidth: 230,
            maxWidth: 420,
          }}
        >
          <Typography variant="caption" sx={{ fontSize: 10.5, color: "text.secondary", display: "block" }}>
            Network Product
          </Typography>
          <Typography variant="body2" sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3 }}>
            {graphProductDetail?.sku ?? "No SKU selected"}
          </Typography>
          {graphProductDetail ? (
            <Typography variant="caption" sx={{ display: "block", fontSize: 10.5 }}>
              {graphProductDetail.name}
              {graphProductDetail.category ? ` · ${graphProductDetail.category}` : ""}
              {graphProductDetail.brand ? ` · ${graphProductDetail.brand}` : ""}
            </Typography>
          ) : null}
        </Box>
      </Box>
    ) : null;
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.8, height: "100%", minHeight: 0 }}>
        {expanded ? null : controls}
        <Box sx={{ position: "relative", height: "100%", minHeight: 0 }}>
          <div
            ref={expanded ? networkCanvasExpandedRef : networkCanvasRef}
            className="network-canvas-wrapper"
            style={expanded ? { height: "100%", maxHeight: "none", minHeight: 0 } : { height: "100%", maxHeight: "none", minHeight: 0 }}
            onScroll={(event) => {
              const el = event.currentTarget;
              const next = { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight };
              if (expanded) setNetworkViewportExpanded(next);
              else setNetworkViewport(next);
            }}
          >
        <div
          className={`network-canvas-shell ${expanded ? "network-canvas-shell-expanded" : ""}`}
          style={{ width, height, minWidth: width, minHeight: height }}
        >
          <svg className="network-edge-svg" width={width} height={height} style={{ pointerEvents: "auto" }}>
            <defs>
              <marker id="network-arrow-push" markerWidth={8} markerHeight={8} refX={7} refY={3} orient="auto">
                <path d="M0,0 L0,6 L7,3 Z" fill="#0f172a" />
              </marker>
              <marker id="network-arrow-pull" markerWidth={8} markerHeight={8} refX={7} refY={3} orient="auto">
                <path d="M0,0 L0,6 L7,3 Z" fill="#2563eb" />
              </marker>
            </defs>
            {viewFlowEdges.map((edge) => {
              const sourcePos = effectiveNodePositions.get(edge.source);
              const targetPos = effectiveNodePositions.get(edge.target);
              if (!sourcePos || !targetPos) return null;
              const srcSize = nodeSizes.get(edge.source) ?? { w: NODE_BOX_WIDTH, h: NODE_BOX_HEIGHT };
              const tgtSize = nodeSizes.get(edge.target) ?? { w: NODE_BOX_WIDTH, h: NODE_BOX_HEIGHT };
              const scaledSourcePos = { x: sourcePos.x * scale * horizontalFactor, y: sourcePos.y * scale * verticalFactor };
              const scaledTargetPos = { x: targetPos.x * scale * horizontalFactor, y: targetPos.y * scale * verticalFactor };
              const scaledSrcSize = { w: srcSize.w * scale * nodeBoxFactor, h: srcSize.h * scale * nodeBoxFactor };
              const scaledTgtSize = { w: tgtSize.w * scale * nodeBoxFactor, h: tgtSize.h * scale * nodeBoxFactor };
              const isPull = String(edge.label ?? "").toUpperCase() === "PULL";
              const stroke = isPull ? "#2563eb" : "#0f172a";
              const markerEnd = isPull ? "url(#network-arrow-pull)" : "url(#network-arrow-push)";
              const srcBox = { left: scaledSourcePos.x, top: scaledSourcePos.y, w: scaledSrcSize.w, h: scaledSrcSize.h };
              const tgtBox = { left: scaledTargetPos.x, top: scaledTargetPos.y, w: scaledTgtSize.w, h: scaledTgtSize.h };
              const srcCx = scaledSourcePos.x + scaledSrcSize.w / 2;
              const srcCy = scaledSourcePos.y + scaledSrcSize.h / 2;
              const tgtCx = scaledTargetPos.x + scaledTgtSize.w / 2;
              const tgtCy = scaledTargetPos.y + scaledTgtSize.h / 2;
              const start = pointOnRectBoundary(srcBox.left, srcBox.top, srcBox.w, srcBox.h, srcCx, srcCy, tgtCx, tgtCy);
              const end = pointOnRectBoundary(tgtBox.left, tgtBox.top, tgtBox.w, tgtBox.h, tgtCx, tgtCy, srcCx, srcCy);
              const edgeOrder = edgeOrderById.get(edge.id);
              const edgeLane = edgeLaneById.get(edge.id);
              const isHovered = activeHoveredEdgeId === edge.id;
              const laneOffset = edgeLane
                ? (edgeLane.laneIdx - (edgeLane.laneCount - 1) / 2) * 10 * Math.max(0.7, scale)
                : edgeOrder
                  ? (edgeOrder.idx - (edgeOrder.count - 1) / 2) * 8 * Math.max(0.7, scale)
                  : 0;
              const ctrlX = start.x + (end.x - start.x) * 0.52;
              const path = `M ${start.x} ${start.y} C ${ctrlX} ${start.y + laneOffset}, ${ctrlX} ${end.y + laneOffset}, ${end.x} ${end.y}`;
              const midX = (start.x + end.x) / 2 + 2;
              const midY = (start.y + end.y) / 2 - 5;
              const showLabel = scale >= 0.95 || isHovered;
              return (
                <g key={edge.id}>
                  <path
                    d={path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={(isPull ? 2.5 : 2.0) * Math.min(1.15, Math.max(0.82, scale)) + (isHovered ? 0.9 : 0)}
                    strokeDasharray={isPull ? "5 4" : "0"}
                    markerEnd={markerEnd}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="stroke"
                    onMouseEnter={() => {
                      if (expanded) setHoveredEdgeIdExpanded(edge.id);
                      else setHoveredEdgeId(edge.id);
                    }}
                    onMouseLeave={() => {
                      if (expanded) setHoveredEdgeIdExpanded((curr) => (curr === edge.id ? null : curr));
                      else setHoveredEdgeId((curr) => (curr === edge.id ? null : curr));
                    }}
                  />
                  {showLabel ? (
                    <text
                      x={midX}
                      y={midY}
                      className="network-edge-label"
                      textAnchor="middle"
                      style={{ opacity: isHovered ? 1 : 0.86 }}
                    >
                      {String(edge.label ?? "")}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {viewFlowNodes.map((node) => {
            const pos = effectiveNodePositions.get(node.id) ?? { x: node.x, y: node.y };
            const size = nodeSizes.get(node.id) ?? { w: NODE_BOX_WIDTH, h: NODE_BOX_HEIGHT };
            const scaledPos = { x: pos.x * scale * horizontalFactor, y: pos.y * scale * verticalFactor };
            const scaledSize = { w: size.w * scale * nodeBoxFactor, h: size.h * scale * nodeBoxFactor };
            const nodeType = (node.node?.node_type ?? "store").toLowerCase();
            const typeClass = `network-node-${nodeType}`;
            const typeBadge = nodeType.startsWith("plant")
              ? "PL"
              : nodeType.startsWith("cdc")
                ? "CDC"
                : nodeType.startsWith("rdc")
                  ? "RDC"
                  : nodeType.startsWith("store")
                    ? "ST"
                    : nodeType.startsWith("supplier")
                      ? "SUP"
                      : "N";
            const hasAlert = nodesWithAlerts.has(node.id);
            const isSelected = selectedInsightNodeId === node.id;
            const nodeInsight = nodeInsightByNodeId.get(node.id);
            const projectionSkuForNode = String(effectiveNetworkSku || nodeInsight?.sku || graphProductDetail?.sku || "").trim();
            const alertsForNode = nodeAlertsByNodeId.get(node.id) ?? [];
            const nodeSeverity = nodeAlertSeverityByNodeId.get(node.id) ?? "info";
            const alertIconColor = nodeSeverity === "critical"
              ? "error.main"
              : nodeSeverity === "warning"
                ? "warning.main"
                : "grey.600";
            const alertBorderColor = nodeSeverity === "critical"
              ? "error.light"
              : nodeSeverity === "warning"
                ? "warning.light"
                : "grey.400";
            return (
              <Fragment key={node.id}>
                <Box
                  className={`network-node-card ${typeClass} ${isSelected ? "network-node-selected" : ""} ${networkDragging?.nodeId === node.id ? "network-node-dragging" : ""}`}
                  style={{ left: scaledPos.x, top: scaledPos.y, width: scaledSize.w, minHeight: scaledSize.h }}
                  sx={expanded ? { p: 0.45 } : undefined}
                  onClick={() => {
                    if (networkJustFinishedDrag) {
                      setNetworkJustFinishedDrag(false);
                      return;
                    }
                    setSelectedInsightNodeId(node.id);
                  }}
                  onMouseDown={(e) => handleNetworkNodeMouseDown(e, node.id, scale)}
                >
                  <Typography variant="caption" className="network-node-title" sx={expanded ? { fontSize: "0.5rem", lineHeight: 1.1 } : undefined}>
                    {String(node.node?.name ?? node.id).slice(0, 22)}
                  </Typography>
                  <Typography variant="caption" className="network-node-subtitle" sx={expanded ? { fontSize: "0.44rem", lineHeight: 1.05 } : undefined}>
                    {(node.node?.node_type ?? "node").toUpperCase()} · {node.node?.region ?? "-"}
                  </Typography>
                  <Box className="network-node-type-badge" sx={expanded ? { fontSize: "0.45rem", px: 0.35, py: 0.05 } : undefined}>{typeBadge}</Box>
                  <Stack direction="row" spacing={expanded ? 0.2 : 0.35} sx={{ mt: expanded ? 0.25 : 0.65, alignItems: "center" }}>
                    <Tooltip title="Open projected inventory">
                      <IconButton
                        size={expanded ? "medium" : "small"}
                        color="primary"
                        sx={{ border: "1px solid", borderColor: "primary.light", bgcolor: "rgba(59,130,246,0.10)", p: expanded ? 0.3 : undefined }}
                        onClick={(event) => {
                          event.stopPropagation();
                          openProjectionModal(projectionSkuForNode, node.id, "Network graph node");
                        }}
                      >
                        <Inventory2OutlinedIcon sx={{ fontSize: expanded ? 11 : 14 }} />
                      </IconButton>
                    </Tooltip>
                    {hasAlert ? (
                      <Tooltip title="View node alerts">
                        <IconButton
                          size={expanded ? "medium" : "small"}
                          sx={{
                            border: "1px solid",
                            borderColor: alertBorderColor,
                            bgcolor: "rgba(255,255,255,0.72)",
                            position: "relative",
                            p: expanded ? 0.3 : undefined,
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedAlertNodeId(node.id);
                            setNodeAlertsOpen(true);
                          }}
                        >
                          <WarningAmberOutlinedIcon sx={{ fontSize: expanded ? 11 : 14, color: alertIconColor }} />
                          <Box
                            component="span"
                            sx={{
                              position: "absolute",
                              top: expanded ? -4 : -5,
                              right: expanded ? -3 : -4,
                              minWidth: expanded ? 11 : 13,
                              height: expanded ? 11 : 13,
                              px: expanded ? 0.2 : 0.3,
                              borderRadius: 6,
                              bgcolor: "rgba(15,23,42,0.9)",
                              color: "#fff",
                              fontSize: expanded ? 7 : 9,
                              lineHeight: expanded ? "11px" : "13px",
                              textAlign: "center",
                            }}
                          >
                            {alertsForNode.length || 1}
                          </Box>
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Stack>
                </Box>
              </Fragment>
            );
          })}
        </div>
          </div>
          {expandedProductOverlay}
          {expandedOverlayControls}
        </Box>
      </Box>
    );
  };
  const selectedNode = useMemo(() => displayedNodes.find((item) => item.node_id === selectedNodeId), [displayedNodes, selectedNodeId]);
  const impactedSkuFields = useMemo<FilterFieldOption[]>(
    () => [
      { key: "sku", label: "SKU", type: "text", suggestions: [...new Set((impactedSkus ?? []).map((item) => item.sku))] },
      { key: "product_name", label: "Product", type: "text", suggestions: [...new Set((impactedSkus ?? []).map((item) => item.product_name))] },
      { key: "brand", label: "Brand", type: "text", suggestions: [...new Set((impactedSkus ?? []).map((item) => item.brand))] },
      { key: "category", label: "Category", type: "text", suggestions: [...new Set((impactedSkus ?? []).map((item) => item.category))] },
      { key: "impacted_node_id", label: "Node", type: "text", suggestions: [...new Set((impactedSkus ?? []).map((item) => item.impacted_node_id))] },
      { key: "source_mode", label: "Source Mode", type: "text", suggestions: [...new Set((impactedSkus ?? []).map((item) => item.source_mode ?? ""))] },
      { key: "forecast_qty", label: "Forecast Qty", type: "number" },
      { key: "actual_qty", label: "Actual Qty", type: "number" },
      { key: "volatility_index", label: "Volatility", type: "number" },
      { key: "lead_time_days", label: "Lead Time Days", type: "number" },
      { key: "service_level_target", label: "Service Level", type: "number" },
      { key: "min_batch_size", label: "Min Batch Size", type: "number" },
    ],
    [impactedSkus],
  );
  const filteredImpactedSkus = useMemo(
    () => applyFilterState(impactedSkus ?? [], impactedSkuFields, impactedSkuFilterState),
    [impactedSkus, impactedSkuFields, impactedSkuFilterState],
  );
  const alertRows = useMemo(() => (baseline?.alerts ?? []).map((item) => ({ id: item.alert_id, ...item })), [baseline?.alerts]);
  const alertFields = useMemo<FilterFieldOption[]>(
    () => [
      { key: "alert_id", label: "Alert ID", type: "text", suggestions: [...new Set(alertRows.map((item) => String(item.alert_id ?? "")))] },
      { key: "alert_type", label: "Type", type: "text", suggestions: [...new Set(alertRows.map((item) => String(item.alert_type ?? "")))] },
      { key: "severity", label: "Severity", type: "text", suggestions: [...new Set(alertRows.map((item) => String(item.severity ?? "")))] },
      { key: "title", label: "Title", type: "text" },
      { key: "impacted_node_id", label: "Impacted Node", type: "text", suggestions: [...new Set(alertRows.map((item) => String(item.impacted_node_id ?? "")))] },
      { key: "impacted_sku", label: "Impacted SKU", type: "text", suggestions: [...new Set(alertRows.map((item) => String(item.impacted_sku ?? "")))] },
      { key: "effective_from", label: "From", type: "text" },
      { key: "effective_to", label: "To", type: "text" },
    ],
    [alertRows],
  );
  const filteredAlertRows = useMemo(
    () => applyFilterState(alertRows, alertFields, alertFilterState),
    [alertRows, alertFields, alertFilterState],
  );
  const alertIds = useMemo(
    () => alertRows.map((item) => String(item.alert_id)),
    [alertRows],
  );
  const alertImpactedQueries = useQueries({
    queries: alertIds.map((alertId) => ({
      queryKey: ["network-alert-impacted-skus", alertId, "alerts-dashboard"],
      queryFn: () => fetchNetworkAlertImpactedSkus(alertId),
      enabled: activeTab === 0 && Boolean(alertId),
      staleTime: 60_000,
    })),
  });
  const alertsImpactedRows = useMemo(
    () => alertImpactedQueries.flatMap((query) => query.data ?? []),
    [alertImpactedQueries],
  );
  const alertsDashboardKpis = useMemo(() => {
    const severityCounts = {
      critical: alertRows.filter((item) => String(item.severity).toLowerCase() === "critical").length,
      warning: alertRows.filter((item) => String(item.severity).toLowerCase() === "warning").length,
      info: alertRows.filter((item) => String(item.severity).toLowerCase() === "info").length,
    };
    const impactedNodes = new Set<string>();
    const impactedSkus = new Set<string>();
    for (const row of alertRows) {
      if (row.impacted_node_id) impactedNodes.add(String(row.impacted_node_id));
      if (row.impacted_sku) impactedSkus.add(String(row.impacted_sku));
    }
    for (const row of alertsImpactedRows) {
      if (row.impacted_node_id) impactedNodes.add(String(row.impacted_node_id));
      if (row.sku) impactedSkus.add(String(row.sku));
    }
    const totalForecast = alertsImpactedRows.reduce((sum, row) => sum + (Number(row.forecast_qty) || 0), 0);
    const totalActual = alertsImpactedRows.reduce((sum, row) => sum + (Number(row.actual_qty) || 0), 0);
    const forecastGapQty = Math.abs(totalForecast - totalActual);
    const forecastErrorPct = totalForecast > 0 ? Math.abs(totalForecast - totalActual) / totalForecast : 0;
    const avgVolatility =
      alertsImpactedRows.length > 0
        ? alertsImpactedRows.reduce((sum, row) => sum + (Number(row.volatility_index) || 0), 0) / alertsImpactedRows.length
        : 0;
    return {
      critical: severityCounts.critical,
      warning: severityCounts.warning,
      info: severityCounts.info,
      impactedNodeCount: impactedNodes.size,
      impactedSkuCount: impactedSkus.size,
      totalForecast,
      totalActual,
      forecastGapQty,
      forecastErrorPct,
      avgVolatility,
    };
  }, [alertRows, alertsImpactedRows]);
  const alertsDashboardGroups = useMemo(
    () => [
      {
        key: "severity",
        label: "Alert Severity",
        tone: "critical",
        icon: <WarningAmberOutlinedIcon fontSize="small" />,
        items: [
          { label: "Critical", value: String(alertsDashboardKpis.critical) },
          { label: "Warning", value: String(alertsDashboardKpis.warning) },
          { label: "Info", value: String(alertsDashboardKpis.info) },
        ],
      },
      {
        key: "network_impact",
        label: "Network Impact",
        tone: "network",
        icon: <LanOutlinedIcon fontSize="small" />,
        items: [
          { label: "Impacted Nodes", value: String(alertsDashboardKpis.impactedNodeCount) },
          { label: "Impacted SKUs", value: String(alertsDashboardKpis.impactedSkuCount) },
          { label: "Network Nodes", value: String(Math.round(baseline?.summary_metrics.node_count ?? 0)) },
          { label: "Network Lanes", value: String(Math.round(baseline?.summary_metrics.lane_count ?? 0)) },
        ],
      },
      {
        key: "financial",
        label: "Financial Impact",
        tone: "money",
        icon: <PaidOutlinedIcon fontSize="small" />,
        items: [
          { label: "Margin Impact", value: `-$${Math.round(orderFinancialMetrics.delayedExceptionCost).toLocaleString()}` },
          { label: "Exception Order Cost", value: `$${Math.round(orderFinancialMetrics.totalCost).toLocaleString()}` },
          {
            label: "Avg Cost / Exception",
            value: `$${Math.round(orderFinancialMetrics.totalRows ? orderFinancialMetrics.totalCost / orderFinancialMetrics.totalRows : 0).toLocaleString()}`,
          },
          { label: "Delayed Exceptions", value: String(orderFinancialMetrics.delayedOrders) },
        ],
      },
      {
        key: "demand_accuracy",
        label: "Demand & Accuracy",
        tone: "demand",
        icon: <Inventory2OutlinedIcon fontSize="small" />,
        items: [
          { label: "Forecast Qty", value: Math.round(alertsDashboardKpis.totalForecast).toLocaleString() },
          { label: "Actual Qty", value: Math.round(alertsDashboardKpis.totalActual).toLocaleString() },
          { label: "Forecast Error", value: "48%" },
          { label: "Avg Volatility", value: "0.76" },
        ],
      },
    ],
    [alertsDashboardKpis, baseline?.summary_metrics.lane_count, baseline?.summary_metrics.node_count, orderFinancialMetrics.delayedExceptionCost, orderFinancialMetrics.delayedOrders, orderFinancialMetrics.totalCost, orderFinancialMetrics.totalRows],
  );
  const getSeverityBadgeTone = (severityValue: string) => {
    const severity = severityValue.toLowerCase();
    if (severity === "critical") {
      return "error";
    }
    if (severity === "warning") {
      return "warning";
    }
    if (severity === "info") {
      return "info";
    }
    return "default";
  };
  const alertColumns = useMemo<GridColDef[]>(
    () => [
      { field: "alert_id", headerName: "Alert ID", minWidth: 110, flex: 0.8 },
      { field: "alert_type", headerName: "Type", minWidth: 120, flex: 0.8 },
      {
        field: "severity",
        headerName: "Severity",
        minWidth: 115,
        flex: 0.75,
        renderCell: (params) => {
          const severityLabel = String(params.row.severity ?? "");
          const tone = getSeverityBadgeTone(severityLabel);
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
              {severityLabel}
            </Box>
          );
        },
      },
      { field: "title", headerName: "Title", minWidth: 260, flex: 1.6 },
      {
        field: "impacted_node_id",
        headerName: "Impacted Node",
        minWidth: 150,
        flex: 1,
        renderCell: (params) => {
          const value = params.row.impacted_node_id ? String(params.row.impacted_node_id) : "";
          if (value) return value;
          return (
            <Button
              variant="text"
              size="small"
              sx={{ p: 0, minWidth: 0, textTransform: "none", fontSize: "0.78rem" }}
              onClick={() => {
                setImpactedSkuAlertId(String(params.row.alert_id ?? ""));
                setImpactedSkuOpen(true);
              }}
            >
              Multiple ..
            </Button>
          );
        },
      },
      {
        field: "impacted_sku",
        headerName: "Impacted SKU",
        minWidth: 130,
        flex: 0.9,
        renderCell: (params) => {
          const value = params.row.impacted_sku ? String(params.row.impacted_sku) : "";
          if (value) return value;
          return (
            <Button
              variant="text"
              size="small"
              sx={{ p: 0, minWidth: 0, textTransform: "none", fontSize: "0.78rem" }}
              onClick={() => {
                setImpactedSkuAlertId(String(params.row.alert_id ?? ""));
                setImpactedSkuOpen(true);
              }}
            >
              Multiple ..
            </Button>
          );
        },
      },
      { field: "effective_from", headerName: "From", minWidth: 110, flex: 0.7 },
      { field: "effective_to", headerName: "To", minWidth: 110, flex: 0.7 },
      {
        field: "action",
        headerName: "Action",
        minWidth: 150,
        flex: 0.9,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="View impacted SKUs">
              <IconButton
                size="small"
                color="primary"
                onClick={() => {
                  setImpactedSkuAlertId(String(params.row.alert_id ?? ""));
                  setImpactedSkuOpen(true);
                }}
              >
                <VisibilityOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Open Projected Inventory Workbench">
              <IconButton
                size="small"
                color="primary"
                onClick={() => {
                  openProjectionModal(
                    params.row.impacted_sku ? String(params.row.impacted_sku) : null,
                    params.row.impacted_node_id ? String(params.row.impacted_node_id) : null,
                    "Network Alert Workbench",
                  );
                }}
              >
                <Inventory2OutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    [openProjectionModal],
  );
  const activeSeverityFilter = useMemo(() => {
    const severityCondition = alertFilterState.conditions.find((item) => item.column === "severity" && item.operator === "equals");
    return severityCondition?.value?.toLowerCase() ?? "";
  }, [alertFilterState.conditions]);
  const applySeverityFilter = (severity: string) => {
    const normalized = severity.toLowerCase();
    const nextConditions = alertFilterState.conditions.filter((item) => item.column !== "severity");
    if (activeSeverityFilter === normalized) {
      setAlertFilterState({ ...alertFilterState, conditions: nextConditions });
      setSelectedAlertIds([]);
      return;
    }
    setAlertFilterState({
      ...alertFilterState,
      joinMode: "and",
      conditions: [
        ...nextConditions,
        {
          id: `severity_${Date.now()}`,
          column: "severity",
          operator: "equals",
          value: normalized,
          secondaryValue: "",
        },
      ],
    });
    setSelectedAlertIds([]);
  };

  useEffect(() => {
    if (!focusAlertId) return;
    setActiveTab(0);
    setAlertFilterState((prev) => {
      const nextConditions = prev.conditions.filter((item) => item.column !== "alert_id");
      return {
        ...prev,
        joinMode: "and",
        conditions: [
          ...nextConditions,
          {
            id: `alert_focus_${Date.now()}`,
            column: "alert_id",
            operator: "equals",
            value: focusAlertId,
            secondaryValue: "",
          },
        ],
      };
    });
    setSelectedAlertIds([]);
  }, [focusAlertId]);

  const createScenarioMutation = useMutation({
    mutationFn: () => createNetworkScenario({ scenario_name: newScenarioName, origin_context: "manual" }),
    onSuccess: (payload) => {
      setScenarioId(payload.scenario_id);
      setCreateScenarioOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["network-baseline"] });
    },
  });
  const addNodeMutation = useMutation({
    mutationFn: () =>
      applyNetworkChange(scenarioId, {
        change_type: "add_node",
        entity_type: "node",
        payload: {
          node_id: `PLANNED-${Date.now()}`,
          name: addNodeName,
          node_type: addNodeType,
          region: addNodeRegion,
          lat: 36.5,
          lon: -76.2,
          status: "planned",
          storage_capacity: 22000,
          throughput_limit: 18000,
          crossdock_capable: true,
          holding_cost_per_unit: 1.35,
          handling_cost_per_unit: 1.7,
          service_level_target: 0.98,
          production_batch_size: 0,
          production_freeze_days: 0,
          cycle_time_days: 0,
          shelf_space_limit: 0,
          default_strategy: "pull",
          metadata_json: JSON.stringify({ source: "network_ui" }),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["network-scenario", scenarioId] });
    },
  });
  const addLaneMutation = useMutation({
    mutationFn: () =>
      applyNetworkChange(scenarioId, {
        change_type: "add_lane",
        entity_type: "lane",
        payload: {
          lane_id: `PLANNED-LANE-${Date.now()}`,
          origin_node_id: addLaneOrigin,
          dest_node_id: addLaneDest,
          mode: "ltl",
          lane_status: "active",
          cost_function_type: "linear",
          cost_per_unit: 2.2,
          cost_per_mile: 0.62,
          fixed_cost: 350,
          transit_time_mean_days: 2.1,
          transit_time_std_days: 0.4,
          capacity_limit: 15000,
          is_default_route: false,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["network-scenario", scenarioId] });
    },
  });
  const simulateMutation = useMutation({
    mutationFn: () => simulateNetworkScenario(scenarioId),
    onSuccess: (payload) => {
      setLatestSimulation(payload);
      void queryClient.invalidateQueries({ queryKey: ["network-scenario", scenarioId] });
    },
  });
  const saveScenarioMutation = useMutation({
    mutationFn: () => saveNetworkScenario(scenarioId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["network-baseline"] });
      void queryClient.invalidateQueries({ queryKey: ["network-scenario", scenarioId] });
    },
  });
  const agentMutation = useMutation<NetworkAgentResponse>({
    mutationFn: () =>
      analyzeNetwork({
        question: agentQuestion,
        scenario_id: scenarioId || undefined,
        llm_provider: config.llmProvider,
        llm_model: config.llmModel,
      }),
    onSuccess: () => {
      if (scenarioId) {
        void queryClient.invalidateQueries({ queryKey: ["network-scenario", scenarioId] });
      }
    },
  });

  return (
    <div className="page-scroll">
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
      <SectionCard title="Supply Chain Network Digital Twin" subtitle="Alert, network graph, and scenario analysis workbench">
        <Tabs value={activeTab} onChange={(_event, value) => setActiveTab(value)} sx={{ mb: 1 }}>
          <Tab label="Alert" />
          <Tab label="Network" />
          <Tab label="Scenarios" />
        </Tabs>

        {activeTab === 0 ? (
          <div>
            <SectionCard title="Alerts dashboard" subtitle="Severity, impacted scope, and network-risk KPIs">
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Click severity values to filter Alerts workbench.
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PsychologyAltOutlinedIcon />}
                    onClick={() => setInventoryAgentModalOpen(true)}
                  >
                    Inventory Diagnostic Agent
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={alertsDashboardCollapsed ? <ExpandMoreOutlinedIcon /> : <ExpandLessOutlinedIcon />}
                    onClick={() => setAlertsDashboardCollapsed((prev) => !prev)}
                  >
                    {alertsDashboardCollapsed ? "Expand" : "Collapse"}
                  </Button>
                </Stack>
              </Stack>
              {!alertsDashboardCollapsed ? (
                <div className="alerts-kpi-group-row">
                  {alertsDashboardGroups.map((group) => (
                    <Box key={group.key} className={`alerts-kpi-group-card alerts-kpi-${group.tone}`}>
                      <Box className="alerts-kpi-group-head">
                        <Box className="alerts-kpi-group-icon">{group.icon}</Box>
                        <Typography className="alerts-kpi-group-title">{group.label}</Typography>
                      </Box>
                      <Stack spacing={0.5}>
                        {group.items.map((item) => {
                          const severityKey = item.label.toLowerCase();
                          const isSeverityItem = group.key === "severity" && ["critical", "warning", "info"].includes(severityKey);
                          const isActive = isSeverityItem && activeSeverityFilter === severityKey;
                          return isSeverityItem ? (
                            <button
                              key={`${group.key}-${item.label}`}
                              type="button"
                              className={`alerts-kpi-line alerts-kpi-line-clickable ${isActive ? "alerts-kpi-line-active" : ""}`}
                              onClick={() => applySeverityFilter(severityKey)}
                            >
                              <Typography className="alerts-kpi-line-label">{item.label}</Typography>
                              <Typography className="alerts-kpi-line-value">{item.value}</Typography>
                            </button>
                          ) : (
                            <Box key={`${group.key}-${item.label}`} className="alerts-kpi-line">
                              <Typography className="alerts-kpi-line-label">{item.label}</Typography>
                              <Typography className="alerts-kpi-line-value">{item.value}</Typography>
                            </Box>
                          );
                        })}
                      </Stack>
                    </Box>
                  ))}
                </div>
              ) : null}
            </SectionCard>
            <SectionCard title="Alerts workbench" subtitle="Filter, select, and run simulation from selected alerts">
              <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", flexWrap: "wrap" }}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<RuleOutlinedIcon />}
                  onClick={() => setRulesModalOpen(true)}
                >
                  Rules
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ScienceOutlinedIcon />}
                  disabled={selectedAlertIds.length < 1}
                  onClick={() => {
                    const selectedRows = filteredAlertRows.filter((item) => selectedAlertIds.includes(item.id));
                    setSelectedAlertTitle(selectedRows.map((item) => String(item.title ?? item.alert_id ?? "")).join(" | "));
                    setScenarioControlsOpen(true);
                  }}
                >
                  Simulation
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {selectedAlertIds.length > 0 ? `${selectedAlertIds.length} alert(s) selected` : "Select one or more alerts to enable simulation"}
                </Typography>
              </Stack>
              <div className="maintenance-grid-shell">
                <SmartDataGrid
                  rows={filteredAlertRows}
                  columns={alertColumns}
                  checkboxSelection
                  disableRowSelectionOnClick
                  rowSelectionModel={{ type: "include", ids: new Set(selectedAlertIds) } satisfies GridRowSelectionModel}
                  onRowSelectionModelChange={(model) => setSelectedAlertIds(Array.from(model.ids))}
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                  sx={{ border: 0 }}
                />
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 1 ? (
          <div>
            <SectionCard title="Network Filters" subtitle="Filter by SKU, node, alert, and weeks of coverage">
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                <TextField
                  select
                  size="small"
                  label="Product (SKU)"
                  value={networkFilterSku}
                  onChange={(event) => setNetworkFilterSku(event.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="">All</MenuItem>
                  {(networkView?.filters.skus ?? []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Node"
                  value={networkFilterNode}
                  onChange={(event) => setNetworkFilterNode(event.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="">All</MenuItem>
                  {(networkView?.filters.nodes ?? []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Alert"
                  value={networkFilterAlert}
                  onChange={(event) => setNetworkFilterAlert(event.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="">All</MenuItem>
                  {(networkView?.filters.alert_ids ?? []).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Weeks of Coverage"
                  value={networkWeeksOfCoverage}
                  onChange={(event) => setNetworkWeeksOfCoverage(Number(event.target.value))}
                  sx={{ minWidth: 180 }}
                >
                  {(networkView?.filters.weeks_of_coverage_options ?? [4, 8, 12]).map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}
                </TextField>
              </Stack>
            </SectionCard>
            <SectionCard title="Network Data Grid" subtitle="SKU-node sourcing nerve center with forecast, actual, inventory, POS, and orders">
              <div className="maintenance-grid-shell">
                <SmartDataGrid
                  rows={networkView?.rows ?? []}
                  columns={[
                    { field: "sku", headerName: "SKU", minWidth: 110, flex: 0.8 },
                    { field: "node_id", headerName: "Node", minWidth: 130, flex: 0.9 },
                    { field: "source_node_id", headerName: "Source Node", minWidth: 130, flex: 0.9 },
                    { field: "sourcing_strategy", headerName: "Push/Pull", minWidth: 100, flex: 0.8 },
                    { field: "forecast_qty", headerName: "Forecast", minWidth: 100, flex: 0.8, type: "number" },
                    { field: "actual_qty", headerName: "Actual", minWidth: 100, flex: 0.8, type: "number" },
                    { field: "inventory_on_hand", headerName: "On Hand", minWidth: 100, flex: 0.8, type: "number" },
                    { field: "pos_qty", headerName: "POS", minWidth: 90, flex: 0.7, type: "number" },
                    { field: "orders_on_way_qty", headerName: "Orders On Way", minWidth: 120, flex: 0.9, type: "number" },
                    { field: "parameter_count", headerName: "Param Count", minWidth: 100, flex: 0.8, type: "number" },
                    {
                      field: "param_action",
                      headerName: "Action",
                      minWidth: 180,
                      flex: 1,
                      sortable: false,
                      filterable: false,
                      renderCell: (params) => (
                        <Stack direction="row" spacing={0.25}>
                          <Tooltip title="View Params">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => {
                                setNetworkFilterSku(String(params.row.sku ?? ""));
                                setSelectedInsightNodeId(String(params.row.node_id ?? ""));
                                setParamsModalOpen(true);
                              }}
                            >
                              <RuleOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Open Projected Inventory Workbench">
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => {
                                openProjectionModal(
                                  params.row.sku ? String(params.row.sku) : null,
                                  params.row.node_id ? String(params.row.node_id) : null,
                                  "Supply Chain Network Digital Twin - Network Tab",
                                );
                              }}
                            >
                              <Inventory2OutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      ),
                    },
                  ] satisfies GridColDef[]}
                  disableRowSelectionOnClick
                  pageSizeOptions={[10, 25, 50, 100]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0 }}
                />
              </div>
            </SectionCard>
            {networkFilterSku ? (
              <SectionCard title="Network Graph" subtitle="Interactive flow map with node actions, alerts, and parameter drilldown.">
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Drag nodes to fine-tune layout. Use the inventory icon for projected inventory and the alert icon for node alerts.
                  </Typography>
                  <Tooltip title="Expand graph">
                    <IconButton
                      size="small"
                      onClick={() => setGraphExpandedOpen(true)}
                      sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}
                    >
                      <OpenInFullOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Box sx={{ height: "72vh", minHeight: 480 }}>
                  {renderNetworkCanvas(false)}
                </Box>
              </SectionCard>
            ) : (
              <SectionCard title="Network Graph" subtitle="Select a SKU in Network Filters to render the sourcing graph.">
                <Typography variant="caption" color="text.secondary">Graph is hidden until SKU is selected.</Typography>
              </SectionCard>
            )}
          </div>
        ) : null}

        {activeTab === 2 ? (
          <div>
            <SectionCard title="Saved Scenario Summary" subtitle="Backend-saved drafts for executive review">
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<HubOutlinedIcon />}
                  onClick={() => setCreateScenarioOpen(true)}
                >
                  Create Scenario
                </Button>
              </Stack>
              <div className="maintenance-grid-shell">
                <SmartDataGrid
                  rows={(baseline?.saved_scenarios ?? []).map((item) => ({ id: item.scenario_id, ...item }))}
                  columns={[
                    { field: "scenario_id", headerName: "ID", minWidth: 140, flex: 1 },
                    { field: "scenario_name", headerName: "Scenario", minWidth: 220, flex: 1.6 },
                    { field: "status", headerName: "Status", minWidth: 120, flex: 1 },
                    { field: "origin_context", headerName: "Origin", minWidth: 120, flex: 1 },
                    { field: "created_at", headerName: "Created", minWidth: 180, flex: 1.2 },
                  ] satisfies GridColDef[]}
                  disableRowSelectionOnClick
                  hideFooterSelectedRowCount
                  pageSizeOptions={[5, 10]}
                  initialState={{ pagination: { paginationModel: { pageSize: 5, page: 0 } } }}
                  sx={{ border: 0 }}
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Impacted Nodes and Lanes"
              subtitle={latestSimulation ? "Simulation impact rows from backend run output" : "Demo node and lane impacts"}
            >
              <div className="page-grid page-grid-two">
                <div className="maintenance-grid-shell">
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Node Impacts</Typography>
                  <SmartDataGrid
                    rows={(latestSimulation ?? DEMO_SIMULATION).node_impacts.map((item, idx) => ({ id: idx, ...item }))}
                    columns={[
                      { field: "node_id", headerName: "Node", minWidth: 130, flex: 1 },
                      { field: "name", headerName: "Name", minWidth: 160, flex: 1.2 },
                      { field: "status", headerName: "Status", minWidth: 110, flex: 1 },
                      { field: "service_level_target", headerName: "SL Target", minWidth: 110, flex: 1 },
                      { field: "strategy", headerName: "Strategy", minWidth: 110, flex: 1 },
                    ] satisfies GridColDef[]}
                    disableRowSelectionOnClick
                    hideFooter
                    sx={{ border: 0 }}
                  />
                </div>
                <div className="maintenance-grid-shell">
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Lane Impacts</Typography>
                  <SmartDataGrid
                    rows={(latestSimulation ?? DEMO_SIMULATION).lane_impacts.map((item, idx) => ({ id: idx, ...item }))}
                    columns={[
                      { field: "lane_id", headerName: "Lane", minWidth: 130, flex: 1 },
                      { field: "origin_node_id", headerName: "Origin", minWidth: 130, flex: 1 },
                      { field: "dest_node_id", headerName: "Destination", minWidth: 130, flex: 1 },
                      { field: "mode", headerName: "Mode", minWidth: 90, flex: 0.8 },
                      { field: "lane_status", headerName: "Status", minWidth: 100, flex: 0.8 },
                      { field: "transit_time_mean_days", headerName: "LT (d)", minWidth: 90, flex: 0.8 },
                    ] satisfies GridColDef[]}
                    disableRowSelectionOnClick
                    hideFooter
                    sx={{ border: 0 }}
                  />
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}
      </SectionCard>
      </Box>

      <Dialog open={createScenarioOpen} onClose={() => setCreateScenarioOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create Network Scenario</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth
            size="small"
            label="Scenario Name"
            value={newScenarioName}
            onChange={(event) => setNewScenarioName(event.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateScenarioOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => createScenarioMutation.mutate()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={paramsModalOpen} onClose={() => setParamsModalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Node parameters</DialogTitle>
        <DialogContent dividers>
          {selectedNodeInsight ? (
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">{selectedNodeInsight.node_id} · {selectedNodeInsight.sku}</Typography>
              <Typography variant="body2" color="text.secondary">
                Forecast: {selectedNodeInsight.forecast_qty} | Actual: {selectedNodeInsight.actual_qty} | On Hand: {selectedNodeInsight.inventory_on_hand}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                POS: {selectedNodeInsight.pos_qty} | Orders On Way: {selectedNodeInsight.orders_on_way_qty}
              </Typography>
              <Divider />
              <Typography variant="subtitle2">Parameters</Typography>
              {selectedNodeInsight.parameters.length > 0 ? (
                <Stack component="ul" sx={{ pl: 2, m: 0 }} spacing={0.5}>
                  {selectedNodeInsight.parameters.map((item) => (
                    <Typography key={item.parameter_code} component="li" variant="body2">
                      {item.parameter_code} = {item.parameter_value}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">None</Typography>
              )}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">Loading…</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setParamsModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={scenarioControlsOpen} onClose={() => setScenarioControlsOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Scenario Controls</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              {selectedAlertTitle ? `Alert context: ${selectedAlertTitle}` : "Alert context not selected"}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" startIcon={<HubOutlinedIcon />} onClick={() => setCreateScenarioOpen(true)}>
                Create Scenario
              </Button>
              <Button variant="outlined" startIcon={<PsychologyAltOutlinedIcon />} onClick={() => setAgentOpen(true)}>
                Network Agent
              </Button>
            </Stack>
            <TextField select size="small" label="Scenario" value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
              <MenuItem value="">Baseline</MenuItem>
              {(baseline?.saved_scenarios ?? []).map((item) => (
                <MenuItem key={item.scenario_id} value={item.scenario_id}>
                  {item.scenario_name} ({item.status})
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<ScienceOutlinedIcon />} disabled={!scenarioId} onClick={() => simulateMutation.mutate()}>
                Run Network Simulation
              </Button>
              <Button variant="outlined" startIcon={<SaveOutlinedIcon />} disabled={!scenarioId} onClick={() => saveScenarioMutation.mutate()}>
                Save Scenario
              </Button>
              <Button variant="outlined" onClick={() => setInspectorOpen(true)}>
                Open Inspector
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {scenarioId ? `Active scenario: ${scenarioId}` : "Baseline mode active"}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScenarioControlsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={agentOpen} onClose={() => setAgentOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Network Agent</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            <TextField multiline minRows={3} value={agentQuestion} onChange={(event) => setAgentQuestion(event.target.value)} />
            <Button variant="contained" onClick={() => agentMutation.mutate()}>
              Analyze and Stage Draft
            </Button>
            {agentMutation.data ? (
              <Box className="evidence-card">
                <Typography variant="subtitle2">{agentMutation.data.summary}</Typography>
                <Typography variant="caption" sx={{ display: "block" }}>
                  Recommended option: {agentMutation.data.recommended_option}
                </Typography>
                <Typography variant="caption" sx={{ display: "block" }}>
                  Staged changes: {agentMutation.data.staged_changes.length}
                </Typography>
              </Box>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAgentOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={impactedSkuOpen} onClose={() => setImpactedSkuOpen(false)} fullWidth maxWidth="xl">
        <DialogTitle>Impacted SKUs for {impactedSkuAlertId || "Alert"}</DialogTitle>
        <DialogContent dividers>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
            <Tooltip title="Complex Filter">
              <IconButton color="primary" onClick={() => setImpactedSkuFilterOpen(true)}>
                <FilterAltOutlinedIcon />
              </IconButton>
            </Tooltip>
            <Typography variant="caption" color="text.secondary">
              {impactedSkuFilterState.conditions.length
                ? `${impactedSkuFilterState.conditions.length} filters active`
                : "No advanced filters"}
            </Typography>
          </Stack>
          <div className="maintenance-grid-shell">
            <SmartDataGrid
              rows={filteredImpactedSkus}
              columns={[
                { field: "sku", headerName: "SKU", minWidth: 120, flex: 0.8 },
                { field: "product_name", headerName: "Product", minWidth: 200, flex: 1.3 },
                { field: "brand", headerName: "Brand", minWidth: 120, flex: 0.8 },
                { field: "category", headerName: "Category", minWidth: 120, flex: 0.8 },
                { field: "impacted_node_id", headerName: "Node", minWidth: 130, flex: 0.9 },
                { field: "parent_location_node_id", headerName: "Parent Node", minWidth: 140, flex: 0.9 },
                { field: "source_mode", headerName: "Source Mode", minWidth: 120, flex: 0.8 },
                { field: "service_level_target", headerName: "SL Target", minWidth: 110, flex: 0.8, type: "number" },
                { field: "lead_time_days", headerName: "LT Days", minWidth: 100, flex: 0.7, type: "number" },
                { field: "min_batch_size", headerName: "Min Batch", minWidth: 100, flex: 0.7, type: "number" },
                { field: "forecast_qty", headerName: "Forecast", minWidth: 110, flex: 0.8, type: "number" },
                { field: "actual_qty", headerName: "Actual", minWidth: 110, flex: 0.8, type: "number" },
                { field: "volatility_index", headerName: "Volatility", minWidth: 100, flex: 0.8, type: "number" },
                { field: "demand_class", headerName: "Demand Class", minWidth: 120, flex: 0.8 },
              ] satisfies GridColDef[]}
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50, 100]}
              initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
              sx={{ border: 0 }}
            />
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImpactedSkuOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={projectionModalOpen}
        onClose={() => setProjectionModalOpen(false)}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { minHeight: "82vh", maxHeight: "92vh" } } }}
      >
        <DialogTitle>
          <Stack spacing={0.25}>
            <Typography variant="h6">Projected Inventory Workbench</Typography>
            <Typography variant="caption" color="text.secondary">
              Source: {projectionSource || "Network"} | SKU: {projectionSku || "All SKUs (consolidated)"} | Location: {projectionNode || "All Nodes (consolidated)"}
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 1, overflowY: "auto", overflowX: "hidden" }}>
          <Box sx={{ minHeight: 0, overflowY: "auto", overflowX: "hidden", pr: 0.5 }}>
            <ProjectedInventoryWorkbench
              key={`${projectionSku || "__all_sku__"}::${projectionNode || "__all_node__"}`}
              initialSku={projectionSku || undefined}
              initialLocation={projectionNode || undefined}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProjectionModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={inventoryAgentModalOpen}
        onClose={() => setInventoryAgentModalOpen(false)}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { minHeight: "80vh", maxHeight: "90vh" } } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="h6" component="span">Inventory Diagnostic Agent</Typography>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="body2" color="text.secondary">Autonomous mode</Typography>
            <Switch
              checked={autonomousMode}
              onChange={(_, checked) => {
                if (checked) {
                  setAutonomousScheduleOpen(true);
                } else {
                  setAutonomousMode(false);
                  setAutonomousStartDate("");
                  setAutonomousEndDate("");
                }
              }}
              color="primary"
              size="small"
            />
          </Stack>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", p: 2 }}>
            <InventoryDiagnosticAgent />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInventoryAgentModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={autonomousScheduleOpen} onClose={() => setAutonomousScheduleOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Autonomous run schedule</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Set the start and end date when the agent will run autonomously to identify inventory issues and resolve them without user interaction.
          </Typography>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Start date"
              type="date"
              value={autonomousStartDate}
              onChange={(e) => setAutonomousStartDate(e.target.value)}
              inputProps={{ min: new Date().toISOString().slice(0, 10) }}
              fullWidth
              size="small"
            />
            <TextField
              label="End date"
              type="date"
              value={autonomousEndDate}
              onChange={(e) => setAutonomousEndDate(e.target.value)}
              inputProps={{ min: autonomousStartDate || new Date().toISOString().slice(0, 10) }}
              fullWidth
              size="small"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAutonomousScheduleOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (autonomousStartDate && autonomousEndDate) {
                setAutonomousMode(true);
                setAutonomousScheduleOpen(false);
              }
            }}
            disabled={!autonomousStartDate || !autonomousEndDate}
          >
            Enable autonomous run
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rulesModalOpen} onClose={() => setRulesModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="h6">Alert rules</Typography>
          <Button variant="contained" size="small" startIcon={<RuleOutlinedIcon />} onClick={() => { setEditingRuleId(null); setRuleForm({ name: "", conditionField: "days_of_coverage", conditionOperator: "<", conditionValue: "", alert_type: "capacity", severity: "critical", description: "" }); setRuleFormOpen(true); }}>
            Create rule
          </Button>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Deterministic rules that create alerts by type and severity. Enable or disable rules, or create and edit them below.
          </Typography>
          <Stack spacing={1.5}>
            {alertRules.map((rule) => (
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
                  onChange={(_, checked) => setAlertRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: checked } : r)))}
                  color="primary"
                  size="small"
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">{rule.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {rule.conditionField} {rule.conditionOperator} {rule.conditionValue} → {rule.alert_type} · {rule.severity}
                  </Typography>
                </Box>
                <Chip size="small" label={rule.severity} color={rule.severity === "critical" ? "error" : rule.severity === "warning" ? "warning" : "default"} />
                <Tooltip title="Edit rule">
                  <IconButton size="small" onClick={() => { setEditingRuleId(rule.id); setRuleForm({ name: rule.name, conditionField: rule.conditionField, conditionOperator: rule.conditionOperator, conditionValue: rule.conditionValue, alert_type: rule.alert_type, severity: rule.severity, description: rule.description }); setRuleFormOpen(true); }}>
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRulesModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={ruleFormOpen}
        onClose={() => setRuleFormOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editingRuleId ? "Edit rule" : "Create rule"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField size="small" label="Rule name" value={ruleForm.name} onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))} fullWidth placeholder="e.g. Stockout risk" />
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <TextField
                select
                size="small"
                label="Condition field"
                value={ruleForm.conditionField}
                onChange={(e) => setRuleForm((f) => ({ ...f, conditionField: e.target.value }))}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="days_of_coverage">Days of coverage</MenuItem>
                <MenuItem value="service_level_target">Service level target</MenuItem>
                <MenuItem value="volatility_index">Volatility index</MenuItem>
                <MenuItem value="inventory_on_hand">Inventory on hand</MenuItem>
                <MenuItem value="forecast_qty">Forecast qty</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                label="Operator"
                value={ruleForm.conditionOperator}
                onChange={(e) => setRuleForm((f) => ({ ...f, conditionOperator: e.target.value }))}
                sx={{ minWidth: 100 }}
              >
                <MenuItem value="<">&lt;</MenuItem>
                <MenuItem value=">">&gt;</MenuItem>
                <MenuItem value="<=">≤</MenuItem>
                <MenuItem value=">=">≥</MenuItem>
                <MenuItem value="==">Equals</MenuItem>
              </TextField>
              <TextField size="small" label="Value" value={ruleForm.conditionValue} onChange={(e) => setRuleForm((f) => ({ ...f, conditionValue: e.target.value }))} placeholder="e.g. 2" sx={{ minWidth: 100 }} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                select
                size="small"
                label="Alert type"
                value={ruleForm.alert_type}
                onChange={(e) => setRuleForm((f) => ({ ...f, alert_type: e.target.value }))}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="capacity">Capacity</MenuItem>
                <MenuItem value="service_risk">Service risk</MenuItem>
                <MenuItem value="demand_spike">Demand spike</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                label="Severity"
                value={ruleForm.severity}
                onChange={(e) => setRuleForm((f) => ({ ...f, severity: e.target.value }))}
                sx={{ minWidth: 120 }}
              >
                <MenuItem value="critical">Critical</MenuItem>
                <MenuItem value="warning">Warning</MenuItem>
                <MenuItem value="info">Info</MenuItem>
              </TextField>
            </Stack>
            <TextField size="small" label="Description" value={ruleForm.description} onChange={(e) => setRuleForm((f) => ({ ...f, description: e.target.value }))} fullWidth multiline minRows={2} placeholder="Optional description" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleFormOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!ruleForm.name.trim()) return;
              if (editingRuleId) {
                setAlertRules((prev) => prev.map((r) => (r.id === editingRuleId ? { ...r, ...ruleForm } : r)));
              } else {
                setAlertRules((prev) => [...prev, { ...ruleForm, id: `r${Date.now()}`, enabled: true }]);
              }
              setRuleFormOpen(false);
            }}
            disabled={!ruleForm.name.trim()}
          >
            {editingRuleId ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={graphExpandedOpen}
        onClose={() => setGraphExpandedOpen(false)}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { width: "96vw", maxWidth: "96vw", height: "92vh", display: "flex", flexDirection: "column" } } }}
      >
        <DialogTitle>Supply Chain Network Graph</DialogTitle>
        <DialogContent dividers sx={{ p: 1.5, flex: 1, minHeight: 0, display: "flex" }}>
          {renderNetworkCanvas(true)}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGraphExpandedOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={nodeAlertsOpen} onClose={() => setNodeAlertsOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Node Alerts {selectedAlertNodeId ? `- ${selectedAlertNodeId}` : ""}</DialogTitle>
        <DialogContent dividers>
          {selectedNodeAlerts.length ? (
            <Stack spacing={1}>
              {selectedNodeAlerts.map((alert) => (
                <Box
                  key={alert.alert_id}
                  sx={{
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1.5,
                    p: 1.1,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 1,
                    alignItems: "flex-start",
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2">{alert.alert_id} - {alert.title}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {alert.alert_type} · {alert.severity} · {alert.effective_from}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.4 }}>{alert.description}</Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setImpactedSkuAlertId(String(alert.alert_id));
                      setImpactedSkuOpen(true);
                      setNodeAlertsOpen(false);
                    }}
                  >
                    View Alert
                  </Button>
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">No alerts found for this node.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNodeAlertsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <FilterBuilderDialog
        open={impactedSkuFilterOpen}
        title="Impacted SKU Filters"
        fields={impactedSkuFields}
        initialState={impactedSkuFilterState}
        onClose={() => {
          setImpactedSkuFilterOpen(false);
        }}
        onApply={setImpactedSkuFilterState}
        onClear={() => {
          setImpactedSkuFilterState(EMPTY_FILTER_STATE);
        }}
      />
      <FilterBuilderDialog
        open={alertFilterOpen}
        title="Alert Workbench Filters"
        fields={alertFields}
        initialState={alertFilterState}
        onClose={() => {
          setAlertFilterOpen(false);
        }}
        onApply={setAlertFilterState}
        onClear={() => {
          setAlertFilterState(EMPTY_FILTER_STATE);
        }}
      />

      <Drawer anchor="right" open={inspectorOpen} onClose={() => setInspectorOpen(false)}>
        <Box sx={{ width: 380, p: 2 }}>
          <Typography variant="h6">Network Inspector</Typography>
          <Typography variant="caption" color="text.secondary">
            Single source of truth: all structural changes write to backend scenario changes.
          </Typography>
          <Divider sx={{ my: 1.2 }} />
          {selectedNode ? (
            <Box className="evidence-card" sx={{ mb: 1.2 }}>
              <Typography variant="subtitle2">{selectedNode.name}</Typography>
              <Typography variant="caption" sx={{ display: "block" }}>{selectedNode.node_id}</Typography>
              <Typography variant="caption" sx={{ display: "block" }}>
                {selectedNode.node_type} · {selectedNode.region} · {selectedNode.default_strategy}
              </Typography>
            </Box>
          ) : null}
          <Stack spacing={1.1}>
            <Typography variant="subtitle2">Add Node</Typography>
            <TextField size="small" label="Name" value={addNodeName} onChange={(event) => setAddNodeName(event.target.value)} />
            <TextField select size="small" label="Type" value={addNodeType} onChange={(event) => setAddNodeType(event.target.value)}>
              {(options?.node_types ?? []).map((item) => (
                <MenuItem key={item} value={item}>{item}</MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Region" value={addNodeRegion} onChange={(event) => setAddNodeRegion(event.target.value)}>
              {(options?.regions ?? []).map((item) => (
                <MenuItem key={item} value={item}>{item}</MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              startIcon={<AddLocationAltOutlinedIcon />}
              disabled={!scenarioId}
              onClick={() => addNodeMutation.mutate()}
            >
              Add Node to Scenario
            </Button>
            <Divider />
            <Typography variant="subtitle2">Add Lane</Typography>
            <TextField select size="small" label="Origin" value={addLaneOrigin} onChange={(event) => setAddLaneOrigin(event.target.value)}>
              {displayedNodes.map((item) => (
                <MenuItem key={item.node_id} value={item.node_id}>{item.node_id}</MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Destination" value={addLaneDest} onChange={(event) => setAddLaneDest(event.target.value)}>
              {displayedNodes.map((item) => (
                <MenuItem key={item.node_id} value={item.node_id}>{item.node_id}</MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              startIcon={<AddLinkOutlinedIcon />}
              disabled={!scenarioId || !addLaneOrigin || !addLaneDest}
              onClick={() => addLaneMutation.mutate()}
            >
              Add Lane to Scenario
            </Button>
          </Stack>
        </Box>
      </Drawer>
    </div>
  );
}
