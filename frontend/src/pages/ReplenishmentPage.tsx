import ExpandLessOutlinedIcon from "@mui/icons-material/ExpandLessOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import PsychologyAltOutlinedIcon from "@mui/icons-material/PsychologyAltOutlined";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { type GridColDef, type GridRowSelectionModel } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useOutletContext, useSearchParams } from "react-router-dom";

import type {
  ReplenishmentOrderCreateRequest,
  ReplenishmentOrderDetailRecord,
  ReplenishmentOrderDetailsResponse,
  ReplenishmentOrderRecord,
  ReplenishmentOrdersResponse,
} from "../types";
import {
  createReplenishmentOrder,
  fetchDemoAlerts,
  fetchReplenishmentOrderDetails,
  fetchReplenishmentOrders,
  updateReplenishmentOrder,
} from "../services/api";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import ProjectedInventoryWorkbench from "../components/inventory/ProjectedInventoryWorkbench";
import SmartDataGrid from "../components/shared/SmartDataGrid";
import { SectionCard } from "../components/shared/UiBits";
import KpiCard, { KpiCardRow } from "../components/shared/KpiCard";
import { appendGlobalFilters, globalFiltersKey } from "../types/filters";
import FilterBuilderDialog from "../components/shared/FilterBuilderDialog";
import { EMPTY_FILTER_STATE, applyFilterState, type FilterFieldOption, type FilterState } from "../filtering";

function baseOrderParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), { ...filters, runId: "", category: "", supplier: "", exceptionStatus: "" });
}

function orderDetailsBaseParams(filters: ShellContextValue["filters"]) {
  return appendGlobalFilters(new URLSearchParams(), {
    ...filters,
    runId: "",
    category: "",
    supplier: "",
    exceptionStatus: "",
    orderType: [],
    orderStatus: [],
  });
}

type OrderDetailsLevelRow = {
  id: string;
  order_id: string;
  sku: string;
  ship_from_node_id: string;
  ship_to_node_id: string;
  order_type: string;
  status: string;
  order_qty: number;
  is_exception: boolean;
  exception_reason: string;
  created_at: string;
  eta: string;
};

function sameStringArray(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, idx) => item === b[idx]);
}

function newEditableDetailRow(shipTo = "", shipFrom = ""): EditableDetailRow {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    selected: false,
    sku: "",
    order_qty: "",
    ship_to_node_id: shipTo,
    ship_from_node_id: shipFrom,
  };
}

function parseDetailText(input: string, defaultShipTo = "", defaultShipFrom = ""): EditableDetailRow[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: EditableDetailRow[] = [];
  for (const line of lines) {
    const parts = line.split(line.includes("\t") ? "\t" : ",").map((part) => part.trim());
    if (!parts.length || !parts[0]) continue;
    rows.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      selected: false,
      sku: parts[0] ?? "",
      order_qty: parts[1] ?? "",
      ship_to_node_id: parts[2] ?? defaultShipTo,
      ship_from_node_id: parts[3] ?? defaultShipFrom,
    });
  }
  return rows;
}

type CreateOrderFormState = {
  order_id: string;
  order_type: string;
  status: string;
  ship_to_node_id: string;
  ship_from_node_id: string;
  eta: string;
  is_exception: boolean;
  exception_reason: string;
};

type EditableDetailRow = {
  id: string;
  selected: boolean;
  sku: string;
  order_qty: string;
  ship_to_node_id: string;
  ship_from_node_id: string;
};

export default function ReplenishmentPage() {
  const queryClient = useQueryClient();
  const { filters } = useOutletContext<ShellContextValue>();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(0);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [dashboardCollapsed, setDashboardCollapsed] = useState(false);
  const [projectionModalOpen, setProjectionModalOpen] = useState(false);
  const [projectionSku, setProjectionSku] = useState("");
  const [projectionLocation, setProjectionLocation] = useState("");
  const [orderDetailsFilterDialogOpen, setOrderDetailsFilterDialogOpen] = useState(false);
  const [orderDetailsFilterState, setOrderDetailsFilterState] = useState<FilterState>(EMPTY_FILTER_STATE);
  const [orderDetailsSelectedOrderIds, setOrderDetailsSelectedOrderIds] = useState<string[]>([]);
  const [orderDetailsLeftPaneWidthPct, setOrderDetailsLeftPaneWidthPct] = useState(58);
  const [orderDetailsResizing, setOrderDetailsResizing] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [editError, setEditError] = useState("");
  const [createPasteText, setCreatePasteText] = useState("");
  const [editPasteText, setEditPasteText] = useState("");
  const [createBulkQty, setCreateBulkQty] = useState("");
  const [editBulkQty, setEditBulkQty] = useState("");
  const [createDetails, setCreateDetails] = useState<EditableDetailRow[]>([]);
  const [editDetails, setEditDetails] = useState<EditableDetailRow[]>([]);
  const createImportRef = useRef<HTMLInputElement | null>(null);
  const editImportRef = useRef<HTMLInputElement | null>(null);
  const [createForm, setCreateForm] = useState<CreateOrderFormState>({
    order_id: "",
    order_type: "Stock Transfer",
    status: "created",
    ship_to_node_id: "",
    ship_from_node_id: "",
    eta: "",
    is_exception: false,
    exception_reason: "",
  });
  const [editOrderQty, setEditOrderQty] = useState("");
  const [editEta, setEditEta] = useState("");
  const [editMarkAlertFixed, setEditMarkAlertFixed] = useState(false);
  const [editFixedAlertId, setEditFixedAlertId] = useState("");
  const [editCreateNewAlert, setEditCreateNewAlert] = useState(false);
  const [editLinkAlertId, setEditLinkAlertId] = useState("");
  const [editNewAlertId, setEditNewAlertId] = useState("");
  const [editNewAlertType, setEditNewAlertType] = useState("manual");
  const [editNewAlertSeverity, setEditNewAlertSeverity] = useState("warning");
  const [editNewAlertTitle, setEditNewAlertTitle] = useState("");
  const [editNewAlertDescription, setEditNewAlertDescription] = useState("");
  const [editNewAlertImpactedNodeId, setEditNewAlertImpactedNodeId] = useState("");
  const [editNewAlertIssueType, setEditNewAlertIssueType] = useState("");
  const filtersKey = globalFiltersKey(filters);
  const deepLinkedOrderId = (searchParams.get("order_id") ?? "").trim();
  const deepLinkedTab = (searchParams.get("tab") ?? "").trim().toLowerCase();

  const exceptionParams = baseOrderParams(filters);
  exceptionParams.set("exception_only", "true");
  const allOrderParams = orderDetailsBaseParams(filters);
  const deepLinkOnlyOrderParams = useMemo(() => {
    const params = new URLSearchParams();
    if (deepLinkedOrderId) params.set("order_id", deepLinkedOrderId);
    return params;
  }, [deepLinkedOrderId]);

  const { data: exceptionData } = useQuery<ReplenishmentOrdersResponse>({
    queryKey: ["replenishment-orders", "exceptions", filtersKey],
    queryFn: () => fetchReplenishmentOrders(exceptionParams),
  });
  const { data: allOrderData } = useQuery<ReplenishmentOrdersResponse>({
    queryKey: ["replenishment-orders", "all", filtersKey],
    queryFn: () => fetchReplenishmentOrders(allOrderParams),
  });
  const { data: allOrderDetailData } = useQuery<ReplenishmentOrderDetailsResponse>({
    queryKey: ["replenishment-order-details", "all", filtersKey],
    queryFn: () => fetchReplenishmentOrderDetails(allOrderParams),
  });
  const { data: deepLinkedOrderData } = useQuery<ReplenishmentOrdersResponse>({
    queryKey: ["replenishment-orders", "deep-link", deepLinkedOrderId],
    queryFn: () => fetchReplenishmentOrders(deepLinkOnlyOrderParams),
    enabled: Boolean(deepLinkedOrderId),
  });
  const { data: deepLinkedOrderDetailData } = useQuery<ReplenishmentOrderDetailsResponse>({
    queryKey: ["replenishment-order-details", "deep-link", deepLinkedOrderId],
    queryFn: () => fetchReplenishmentOrderDetails(deepLinkOnlyOrderParams),
    enabled: Boolean(deepLinkedOrderId),
  });
  const { data: demoAlertsData } = useQuery({
    queryKey: ["demo-alerts"],
    queryFn: fetchDemoAlerts,
  });

  const exceptionRows = exceptionData?.rows ?? [];
  const baseOrderRows = allOrderData?.rows ?? [];
  const baseOrderDetailRows = allOrderDetailData?.rows ?? [];
  const deepLinkedRows = deepLinkedOrderData?.rows ?? [];
  const deepLinkedDetailRows = deepLinkedOrderDetailData?.rows ?? [];
  const orderRows = useMemo(() => {
    const byId = new Map<string, ReplenishmentOrderRecord>();
    for (const row of baseOrderRows) byId.set(row.order_id, row);
    for (const row of deepLinkedRows) byId.set(row.order_id, row);
    return Array.from(byId.values());
  }, [baseOrderRows, deepLinkedRows]);
  const orderDetailRows = useMemo(() => {
    const byId = new Map<number, ReplenishmentOrderDetailRecord>();
    for (const row of baseOrderDetailRows) byId.set(row.id, row);
    for (const row of deepLinkedDetailRows) byId.set(row.id, row);
    return Array.from(byId.values());
  }, [baseOrderDetailRows, deepLinkedDetailRows]);
  const orderPrimarySkuById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of orderDetailRows) {
      if (!map.has(row.order_id)) {
        map.set(row.order_id, row.sku);
      }
    }
    return map;
  }, [orderDetailRows]);
  const wantsOpenEdit = useMemo(() => {
    const v = (searchParams.get("open_edit") ?? searchParams.get("edit_order") ?? "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  }, [searchParams]);
  const openedEditFromDeepLinkRef = useRef(false);
  const orderDetailsHref = (orderId: string, sku?: string, location?: string, source?: string) => {
    const params = new URLSearchParams();
    params.set("tab", "order-details");
    params.set("order_id", orderId);
    if (sku) params.set("sku", sku);
    if (location) params.set("location", location);
    if (source) params.set("source", source);
    return `/replenishment?${params.toString()}`;
  };
  useEffect(() => {
    if (!orderDetailsResizing) return;
    const handleMove = (event: MouseEvent) => {
      const viewportWidth = window.innerWidth || 1;
      const nextPct = (event.clientX / viewportWidth) * 100;
      setOrderDetailsLeftPaneWidthPct(Math.max(30, Math.min(75, Math.round(nextPct))));
    };
    const stopResize = () => {
      setOrderDetailsResizing(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", stopResize);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", stopResize);
    };
  }, [orderDetailsResizing]);

  const orderDetailsFilterFields = useMemo<FilterFieldOption[]>(
    () => [
      { key: "alert_id", label: "Alert ID", type: "text", suggestions: [...new Set(orderRows.map((row) => row.alert_id))] },
      { key: "order_id", label: "Order ID", type: "text", suggestions: [...new Set(orderRows.map((row) => row.order_id))] },
      { key: "order_type", label: "Order Type", type: "text", suggestions: [...new Set(orderRows.map((row) => row.order_type))] },
      { key: "ship_to_node_id", label: "Ship To", type: "text", suggestions: [...new Set(orderRows.map((row) => row.ship_to_node_id))] },
      { key: "ship_from_node_id", label: "Ship From", type: "text", suggestions: [...new Set(orderRows.map((row) => row.ship_from_node_id ?? ""))] },
      { key: "status", label: "Status", type: "text", suggestions: [...new Set(orderRows.map((row) => row.status))] },
      { key: "is_exception", label: "Has Exception", type: "text", suggestions: ["true", "false"] },
      { key: "exception_reason", label: "Exception Reason", type: "text", suggestions: [...new Set(orderRows.map((row) => row.exception_reason ?? ""))] },
      { key: "alert_action_taken", label: "Alert Action", type: "text", suggestions: [...new Set(orderRows.map((row) => row.alert_action_taken))] },
      { key: "order_created_by", label: "Created By", type: "text", suggestions: [...new Set(orderRows.map((row) => row.order_created_by))] },
      { key: "order_cost", label: "Order Cost", type: "number" },
      { key: "lead_time_days", label: "Lead Time", type: "number" },
      { key: "delivery_delay_days", label: "Delivery Delay", type: "number" },
      { key: "product_count", label: "Number of Products", type: "number" },
      { key: "created_at", label: "Created Date", type: "date" },
      { key: "eta", label: "ETA", type: "date" },
    ],
    [orderRows],
  );
  const orderDetailsFilteredRows = useMemo(
    () => applyFilterState(orderRows, orderDetailsFilterFields, orderDetailsFilterState),
    [orderRows, orderDetailsFilterFields, orderDetailsFilterState],
  );
  useEffect(() => {
    if (!deepLinkedOrderId) return;
    setActiveTab(1);
    setOrderDetailsFilterState({
      joinMode: "and",
      conditions: [
        {
          id: "deep-link-order-id",
          column: "order_id",
          operator: "equals",
          value: deepLinkedOrderId,
          secondaryValue: "",
        },
      ],
    });
  }, [deepLinkedOrderId]);
  useEffect(() => {
    if (deepLinkedTab === "order-details" && !deepLinkedOrderId) {
      setActiveTab(1);
    }
  }, [deepLinkedOrderId, deepLinkedTab]);
  useEffect(() => {
    setOrderDetailsSelectedOrderIds((prev) => {
      const next = prev.filter((id) => orderDetailsFilteredRows.some((row) => row.order_id === id));
      return sameStringArray(prev, next) ? prev : next;
    });
  }, [orderDetailsFilteredRows]);
  useEffect(() => {
    if (!deepLinkedOrderId) return;
    const nextIds = [...new Set(orderDetailsFilteredRows.filter((row) => row.order_id === deepLinkedOrderId).map((row) => row.order_id))];
    setOrderDetailsSelectedOrderIds((prev) => (sameStringArray(prev, nextIds) ? prev : nextIds));
  }, [deepLinkedOrderId, orderDetailsFilteredRows]);
  useEffect(() => {
    openedEditFromDeepLinkRef.current = false;
  }, [deepLinkedOrderId, wantsOpenEdit]);
  const orderHeaderById = useMemo(() => {
    const map = new Map<string, ReplenishmentOrderRecord>();
    for (const row of orderRows) {
      map.set(row.order_id, row);
    }
    return map;
  }, [orderRows]);
  const selectedSingleOrder = useMemo(
    () => (orderDetailsSelectedOrderIds.length === 1 ? orderHeaderById.get(orderDetailsSelectedOrderIds[0]) ?? null : null),
    [orderDetailsSelectedOrderIds, orderHeaderById],
  );
  const isSelectedOrderLockedForEdit = useMemo(() => {
    const status = String(selectedSingleOrder?.status ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    return status === "delivered" || status === "in_progress";
  }, [selectedSingleOrder?.status]);
  const selectedSingleOrderRawDetails = useMemo(() => {
    if (!selectedSingleOrder) return [];
    const grouped = new Map<string, EditableDetailRow>();
    for (const row of orderDetailRows.filter((item) => item.order_id === selectedSingleOrder.order_id)) {
      const shipFrom = row.ship_from_node_id ?? "";
      const key = `${row.sku}||${row.ship_to_node_id}||${shipFrom}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          id: key,
          selected: false,
          sku: row.sku,
          order_qty: String(row.order_qty),
          ship_to_node_id: row.ship_to_node_id,
          ship_from_node_id: shipFrom,
        });
      } else {
        existing.order_qty = String(Number(existing.order_qty || 0) + Number(row.order_qty || 0));
      }
    }
    return Array.from(grouped.values());
  }, [orderDetailRows, selectedSingleOrder]);
  const allKnownAlerts = useMemo(
    () => [...(demoAlertsData?.active ?? []), ...(demoAlertsData?.archived ?? [])],
    [demoAlertsData?.active, demoAlertsData?.archived],
  );
  const currentOrderAlert = useMemo(
    () => {
      const target = String(selectedSingleOrder?.alert_id ?? "").trim().toLowerCase();
      if (!target) return null;
      return allKnownAlerts.find((item) => String(item.alert_id ?? "").trim().toLowerCase() === target) ?? null;
    },
    [allKnownAlerts, selectedSingleOrder?.alert_id],
  );
  const selectedOrderAlertIds = useMemo(() => {
    const fromOrder = selectedSingleOrder?.alert_ids ?? [];
    if (fromOrder.length > 0) return fromOrder;
    // If fixed alerts exist but active list is empty, do not fallback to the
    // legacy single alert_id field (that would make fixed alerts appear active).
    if ((selectedSingleOrder?.fixed_alert_ids ?? []).length > 0) return [];
    const single = String(selectedSingleOrder?.alert_id ?? "").trim();
    return single ? [single] : [];
  }, [selectedSingleOrder?.alert_id, selectedSingleOrder?.alert_ids, selectedSingleOrder?.fixed_alert_ids]);
  const selectedOrderFixedAlertIds = useMemo(
    () => selectedSingleOrder?.fixed_alert_ids ?? [],
    [selectedSingleOrder?.fixed_alert_ids],
  );

  const toPayloadDetails = (rows: EditableDetailRow[]) =>
    rows
      .map((row) => ({
        sku: row.sku.trim(),
        order_qty: Number(row.order_qty),
        ship_to_node_id: row.ship_to_node_id.trim() || undefined,
        ship_from_node_id: row.ship_from_node_id.trim() || undefined,
      }))
      .filter((row) => row.sku && Number.isFinite(row.order_qty) && row.order_qty >= 0);
  const createDetailsSummary = useMemo(() => {
    const valid = toPayloadDetails(createDetails);
    return {
      validRows: valid.length,
      totalQty: valid.reduce((sum, row) => sum + row.order_qty, 0),
      selectedRows: createDetails.filter((row) => row.selected).length,
    };
  }, [createDetails]);
  const editDetailsSummary = useMemo(() => {
    const valid = toPayloadDetails(editDetails);
    return {
      validRows: valid.length,
      totalQty: valid.reduce((sum, row) => sum + row.order_qty, 0),
      selectedRows: editDetails.filter((row) => row.selected).length,
    };
  }, [editDetails]);
  const createOrderMutation = useMutation({
    mutationFn: (payload: ReplenishmentOrderCreateRequest) => createReplenishmentOrder(payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["replenishment-orders"] });
      queryClient.invalidateQueries({ queryKey: ["replenishment-order-details"] });
      setCreateDialogOpen(false);
      setCreateError("");
      setActiveTab(1);
      setOrderDetailsFilterState({
        joinMode: "and",
        conditions: [{ id: "created-order-id", column: "order_id", operator: "equals", value: result.order_id, secondaryValue: "" }],
      });
      setOrderDetailsSelectedOrderIds([result.order_id]);
    },
    onError: (error) => {
      setCreateError(error instanceof Error ? error.message : "Failed to create order.");
    },
  });
  const editOrderMutation = useMutation({
    mutationFn: (payload: {
      order_id: string;
      order_qty?: number;
      eta?: string;
      details?: ReplenishmentOrderCreateRequest["details"];
      alert_id?: string;
      mark_alert_fixed?: boolean;
      fixed_alert_id?: string;
      create_new_alert?: boolean;
      new_alert_id?: string;
      new_alert_type?: string;
      new_alert_severity?: string;
      new_alert_title?: string;
      new_alert_description?: string;
      new_alert_impacted_node_id?: string;
      new_alert_issue_type?: string;
    }) =>
      updateReplenishmentOrder(payload.order_id, {
        order_qty: payload.order_qty,
        eta: payload.eta,
        details: payload.details,
        alert_id: payload.alert_id,
        mark_alert_fixed: payload.mark_alert_fixed,
        fixed_alert_id: payload.fixed_alert_id,
        create_new_alert: payload.create_new_alert,
        new_alert_id: payload.new_alert_id,
        new_alert_type: payload.new_alert_type,
        new_alert_severity: payload.new_alert_severity,
        new_alert_title: payload.new_alert_title,
        new_alert_description: payload.new_alert_description,
        new_alert_impacted_node_id: payload.new_alert_impacted_node_id,
        new_alert_issue_type: payload.new_alert_issue_type,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["replenishment-orders"] });
      queryClient.invalidateQueries({ queryKey: ["replenishment-order-details"] });
      queryClient.invalidateQueries({ queryKey: ["demo-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["network-baseline"] });
      queryClient.invalidateQueries({ queryKey: ["network-view"] });
      setEditDialogOpen(false);
      setEditError("");
      setOrderDetailsSelectedOrderIds([result.order_id]);
    },
    onError: (error) => {
      setEditError(error instanceof Error ? error.message : "Failed to update order.");
    },
  });
  const selectedOrderDetailRows = useMemo(
    () =>
      orderDetailRows.filter(
        (row) => orderDetailsSelectedOrderIds.includes(row.order_id),
      ),
    [orderDetailRows, orderDetailsSelectedOrderIds],
  );
  const orderDetailsLevelRows = useMemo<OrderDetailsLevelRow[]>(() => {
    const grouped = new Map<string, OrderDetailsLevelRow>();
    for (const row of selectedOrderDetailRows) {
      const header = orderHeaderById.get(row.order_id);
      const shipFrom = row.ship_from_node_id ?? "-";
      const key = `${row.order_id}||${row.sku}||${shipFrom}||${row.ship_to_node_id}`;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          id: key,
          order_id: row.order_id,
          sku: row.sku,
          ship_from_node_id: shipFrom,
          ship_to_node_id: row.ship_to_node_id,
          order_type: header?.order_type ?? row.order_type,
          status: header?.status ?? row.status,
          order_qty: row.order_qty,
          is_exception: header?.is_exception ?? row.is_exception,
          exception_reason: header?.exception_reason ?? row.exception_reason ?? "-",
          created_at: header?.created_at ?? row.created_at,
          eta: header?.eta ?? row.eta,
        });
        continue;
      }
      existing.order_qty += row.order_qty;
      existing.is_exception = existing.is_exception || Boolean(header?.is_exception ?? row.is_exception);
      const nextStatus = header?.status ?? row.status;
      const nextType = header?.order_type ?? row.order_type;
      if (existing.status !== nextStatus) existing.status = "mixed";
      if (existing.order_type !== nextType) existing.order_type = "mixed";
      const nextReason = header?.exception_reason ?? row.exception_reason;
      if (nextReason && !existing.exception_reason.includes(nextReason)) {
        existing.exception_reason = existing.exception_reason === "-" ? nextReason : `${existing.exception_reason}; ${nextReason}`;
      }
    }
    return Array.from(grouped.values());
  }, [orderHeaderById, selectedOrderDetailRows]);
  const handleOrderDetailsSelectionChange = (selectionModel: GridRowSelectionModel) => {
    const rawIds = Array.isArray(selectionModel)
      ? selectionModel.map((id) => String(id))
      : Array.from(selectionModel.ids ?? []).map((id) => String(id));
    const orderIds = [...new Set(rawIds.map((id) => id.split("||")[0]))];
    setOrderDetailsSelectedOrderIds(orderIds);
  };
  const filterFields = useMemo<FilterFieldOption[]>(
    () => [
      { key: "alert_id", label: "Alert ID", type: "text", suggestions: [...new Set(exceptionRows.map((row) => row.alert_id))] },
      { key: "order_id", label: "Order ID", type: "text" },
      { key: "order_type", label: "Order Type", type: "text", suggestions: [...new Set(exceptionRows.map((row) => row.order_type))] },
      { key: "ship_to_node_id", label: "Ship To", type: "text", suggestions: [...new Set(exceptionRows.map((row) => row.ship_to_node_id))] },
      { key: "ship_from_node_id", label: "Ship From", type: "text", suggestions: [...new Set(exceptionRows.map((row) => row.ship_from_node_id ?? ""))] },
      { key: "status", label: "Status", type: "text", suggestions: [...new Set(exceptionRows.map((row) => row.status))] },
      { key: "exception_reason", label: "Exception Reason", type: "text", suggestions: [...new Set(exceptionRows.map((row) => row.exception_reason ?? ""))] },
      { key: "alert_action_taken", label: "Alert Action", type: "text", suggestions: [...new Set(exceptionRows.map((row) => row.alert_action_taken))] },
      { key: "order_created_by", label: "Created By", type: "text", suggestions: [...new Set(exceptionRows.map((row) => row.order_created_by))] },
      { key: "order_cost", label: "Order Cost", type: "number" },
      { key: "lead_time_days", label: "Lead Time", type: "number" },
      { key: "delivery_delay_days", label: "Delivery Delay", type: "number" },
      { key: "product_count", label: "Number of Products", type: "number" },
      { key: "eta", label: "ETA", type: "date" },
    ],
    [exceptionRows],
  );
  const filteredExceptionRows = useMemo(
    () => applyFilterState(exceptionRows, filterFields, filterState),
    [exceptionRows, filterFields, filterState],
  );
  const dashboardMetrics = useMemo(() => {
    const statusCounts = {
      open: filteredExceptionRows.filter((item) => item.status === "open").length,
      in_progress: filteredExceptionRows.filter((item) => item.status === "in_progress").length,
      blocked: filteredExceptionRows.filter((item) => item.status === "blocked").length,
      escalated: filteredExceptionRows.filter((item) => item.status === "escalated").length,
    };
    const actionCounts = new Map<string, number>();
    for (const row of filteredExceptionRows) {
      actionCounts.set(row.alert_action_taken, (actionCounts.get(row.alert_action_taken) ?? 0) + 1);
    }
    const topActions = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const totalCost = filteredExceptionRows.reduce((sum, item) => sum + item.order_cost, 0);
    const avgLeadTime = filteredExceptionRows.length
      ? filteredExceptionRows.reduce((sum, item) => sum + item.lead_time_days, 0) / filteredExceptionRows.length
      : 0;
    const delayedOrders = filteredExceptionRows.filter((item) => item.delivery_delay_days > 0).length;
    const updateNotPossible = filteredExceptionRows.filter((item) => !item.update_possible).length;
    const impactedProductLines = filteredExceptionRows.reduce((sum, item) => sum + item.product_count, 0);
    const linkedAlerts = new Set(filteredExceptionRows.map((item) => item.alert_id)).size;
    return {
      statusCounts,
      topActions,
      totalCost,
      avgLeadTime,
      delayedOrders,
      updateNotPossible,
      impactedProductLines,
      linkedAlerts,
      totalRows: filteredExceptionRows.length,
    };
  }, [filteredExceptionRows]);

  const getExceptionStatusBadgeTone = (statusValue: string) => {
    const status = statusValue.toLowerCase();
    if (status === "escalated" || status === "critical") {
      return "error";
    }
    if (status === "blocked" || status === "open" || status === "warning") {
      return "warning";
    }
    if (status === "in_progress" || status === "in progress" || status === "info") {
      return "info";
    }
    if (status === "resolved" || status === "closed" || status === "completed") {
      return "success";
    }
    return "default";
  };
  const renderStatusBadge = (statusValue?: string) => {
    const statusLabel = String(statusValue ?? "").replace(/_/g, " ");
    const tone = getExceptionStatusBadgeTone(statusLabel);
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
                  : tone === "success"
                    ? theme.palette.success.main
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
        {statusLabel || "n/a"}
      </Box>
    );
  };

  const exceptionColumns = useMemo<GridColDef<ReplenishmentOrderRecord>[]>(
    () => [
      {
        field: "alert_id",
        headerName: "Alert",
        minWidth: 130,
        flex: 0.9,
        renderCell: (params) => <RouterLink to={`/network?alert_id=${encodeURIComponent(String(params.row.alert_id))}`}>{params.row.alert_id}</RouterLink>,
      },
      {
        field: "order_id",
        headerName: "Order ID",
        minWidth: 140,
        flex: 1,
        renderCell: (params) => <RouterLink to={orderDetailsHref(String(params.row.order_id))}>{params.row.order_id}</RouterLink>,
      },
      { field: "order_type", headerName: "Order Type", minWidth: 160, flex: 1.2 },
      { field: "product_count", headerName: "# Products", minWidth: 100, flex: 0.8, type: "number" },
      { field: "order_qty", headerName: "Order Qty", minWidth: 100, flex: 0.8, type: "number" },
      {
        field: "status",
        headerName: "Status",
        minWidth: 120,
        flex: 0.85,
        renderCell: (params) => renderStatusBadge(String(params.row.status ?? "")),
      },
      { field: "exception_reason", headerName: "Exception Reason", minWidth: 170, flex: 1.2 },
      { field: "alert_action_taken", headerName: "Alert Action Taken", minWidth: 180, flex: 1.3 },
      { field: "order_created_by", headerName: "Created By", minWidth: 120, flex: 0.9 },
      { field: "ship_from_node_id", headerName: "Ship From", minWidth: 120, flex: 0.9 },
      { field: "ship_to_node_id", headerName: "Ship To", minWidth: 120, flex: 0.9 },
      { field: "order_cost", headerName: "Order Cost", minWidth: 120, flex: 0.8, type: "number" },
      { field: "lead_time_days", headerName: "Lead Time (d)", minWidth: 110, flex: 0.8, type: "number" },
      { field: "delivery_delay_days", headerName: "Delay (d)", minWidth: 90, flex: 0.7, type: "number" },
      { field: "logistics_impact", headerName: "Logistics", minWidth: 110, flex: 0.8 },
      { field: "production_impact", headerName: "Production", minWidth: 110, flex: 0.8 },
      { field: "transit_impact", headerName: "Transit", minWidth: 100, flex: 0.8 },
      { field: "eta", headerName: "ETA", minWidth: 110, flex: 0.8 },
      {
        field: "action",
        headerName: "Action",
        minWidth: 90,
        flex: 0.6,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Tooltip title="Open Projected Inventory Workbench">
            <IconButton
              size="small"
              color="primary"
              onClick={() => {
                setProjectionSku(orderPrimarySkuById.get(String(params.row.order_id)) ?? "");
                setProjectionLocation(String(params.row.ship_to_node_id ?? ""));
                setProjectionModalOpen(true);
              }}
            >
              <Inventory2OutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [orderPrimarySkuById],
  );
  const selectedOrderDetailsColumns = useMemo<GridColDef<OrderDetailsLevelRow>[]>(
    () => [
      {
        field: "order_id",
        headerName: "Order #",
        minWidth: 140,
        flex: 1,
        renderCell: (params) => <RouterLink to={orderDetailsHref(String(params.row.order_id))}>{params.row.order_id}</RouterLink>,
      },
      { field: "sku", headerName: "Product", minWidth: 120, flex: 0.9 },
      { field: "order_type", headerName: "Order Type", minWidth: 130, flex: 0.9 },
      { field: "ship_from_node_id", headerName: "Ship From", minWidth: 120, flex: 0.9 },
      { field: "ship_to_node_id", headerName: "Ship To", minWidth: 120, flex: 0.9 },
      { field: "order_qty", headerName: "Order Qty", minWidth: 100, flex: 0.8, type: "number" },
      {
        field: "status",
        headerName: "Status",
        minWidth: 120,
        flex: 0.8,
        renderCell: (params) => renderStatusBadge(String(params.row.status ?? "")),
      },
      { field: "is_exception", headerName: "Has Exception", minWidth: 120, flex: 0.8, type: "boolean" },
      {
        field: "exception_reason",
        headerName: "Exception Reason",
        minWidth: 180,
        flex: 1.3,
        valueGetter: (value) => value ?? "-",
      },
      { field: "created_at", headerName: "Created Date", minWidth: 160, flex: 1.1 },
      { field: "eta", headerName: "ETA", minWidth: 120, flex: 0.9 },
    ],
    [],
  );
  const openCreateDialog = () => {
    const defaultShipTo = selectedSingleOrder?.ship_to_node_id ?? orderRows[0]?.ship_to_node_id ?? "";
    const defaultShipFrom = selectedSingleOrder?.ship_from_node_id ?? orderRows[0]?.ship_from_node_id ?? "";
    setCreateForm({
      order_id: "",
      order_type: selectedSingleOrder?.order_type ?? "Stock Transfer",
      status: selectedSingleOrder?.status ?? "created",
      ship_to_node_id: defaultShipTo,
      ship_from_node_id: defaultShipFrom ?? "",
      eta: selectedSingleOrder?.eta ?? "",
      is_exception: false,
      exception_reason: "",
    });
    setCreateDetails([newEditableDetailRow(defaultShipTo, defaultShipFrom ?? "")]);
    setCreatePasteText("");
    setCreateBulkQty("");
    setCreateError("");
    setCreateDialogOpen(true);
  };
  const openEditDialog = useCallback(() => {
    if (!selectedSingleOrder || isSelectedOrderLockedForEdit) return;
    setEditOrderQty(String(selectedSingleOrder.order_qty));
    setEditEta(selectedSingleOrder.eta);
    setEditMarkAlertFixed(false);
    setEditFixedAlertId(selectedSingleOrder.alert_id ?? "");
    setEditCreateNewAlert(false);
    setEditLinkAlertId("");
    setEditNewAlertId("");
    setEditNewAlertType("manual");
    setEditNewAlertSeverity("warning");
    setEditNewAlertTitle("");
    setEditNewAlertDescription("");
    setEditNewAlertImpactedNodeId(selectedSingleOrder.ship_to_node_id ?? "");
    setEditNewAlertIssueType("");
    setEditDetails(selectedSingleOrderRawDetails.length ? selectedSingleOrderRawDetails : [newEditableDetailRow(selectedSingleOrder.ship_to_node_id, selectedSingleOrder.ship_from_node_id ?? "")]);
    setEditPasteText("");
    setEditBulkQty("");
    setEditError("");
    setEditDialogOpen(true);
  }, [selectedSingleOrder, isSelectedOrderLockedForEdit, selectedSingleOrderRawDetails]);

  useEffect(() => {
    if (!wantsOpenEdit || !deepLinkedOrderId) return;
    if (openedEditFromDeepLinkRef.current) return;
    if (!selectedSingleOrder || selectedSingleOrder.order_id !== deepLinkedOrderId) return;
    if (isSelectedOrderLockedForEdit) return;
    openedEditFromDeepLinkRef.current = true;
    openEditDialog();
  }, [wantsOpenEdit, deepLinkedOrderId, selectedSingleOrder, isSelectedOrderLockedForEdit, openEditDialog]);
  const submitCreateOrder = () => {
    const payloadDetails = toPayloadDetails(createDetails);
    if (!createForm.ship_to_node_id || !createForm.eta || !payloadDetails.length) {
      setCreateError("Provide Ship To, ETA, and at least one valid detail row (SKU + non-negative Qty).");
      return;
    }
    createOrderMutation.mutate({
      order_id: createForm.order_id || undefined,
      order_type: createForm.order_type,
      status: createForm.status,
      ship_to_node_id: createForm.ship_to_node_id,
      ship_from_node_id: createForm.ship_from_node_id || undefined,
      eta: createForm.eta,
      is_exception: createForm.is_exception,
      exception_reason: createForm.exception_reason || undefined,
      details: payloadDetails,
    });
  };
  const submitEditOrder = () => {
    if (!selectedSingleOrder) return;
    if (isSelectedOrderLockedForEdit) {
      setEditError("Delivered and in-progress orders cannot be modified.");
      return;
    }
    const payloadDetails = toPayloadDetails(editDetails);
    const qtyValue = editOrderQty.trim() ? Number(editOrderQty) : undefined;
    const linkAlertId = editLinkAlertId.trim();
    const fixedAlertId = editFixedAlertId.trim();
    const createAlert = editCreateNewAlert || Boolean(editNewAlertTitle.trim()) || Boolean(editNewAlertDescription.trim());
    if (qtyValue !== undefined && (!Number.isFinite(qtyValue) || qtyValue < 0)) {
      setEditError("Order Qty must be a valid non-negative number.");
      return;
    }
    if (createAlert && linkAlertId) {
      setEditError("Choose either an existing alert ID or create a new alert.");
      return;
    }
    if (editMarkAlertFixed && !fixedAlertId) {
      setEditError("Select an alert ID to mark as fixed.");
      return;
    }
    if (!payloadDetails.length && qtyValue === undefined && !editEta.trim() && !editMarkAlertFixed && !linkAlertId && !createAlert) {
      setEditError("Provide details, order quantity, delivery date, or alert updates.");
      return;
    }
    editOrderMutation.mutate({
      order_id: selectedSingleOrder.order_id,
      order_qty: qtyValue,
      eta: editEta.trim() || undefined,
      details: payloadDetails.length ? payloadDetails : undefined,
      mark_alert_fixed: editMarkAlertFixed || undefined,
      fixed_alert_id: editMarkAlertFixed ? fixedAlertId : undefined,
      alert_id: linkAlertId || undefined,
      create_new_alert: createAlert || undefined,
      new_alert_id: editNewAlertId.trim() || undefined,
      new_alert_type: createAlert ? editNewAlertType.trim() || "manual" : undefined,
      new_alert_severity: createAlert ? editNewAlertSeverity.trim() || "warning" : undefined,
      new_alert_title: createAlert ? editNewAlertTitle.trim() || undefined : undefined,
      new_alert_description: createAlert ? editNewAlertDescription.trim() || undefined : undefined,
      new_alert_impacted_node_id: createAlert ? editNewAlertImpactedNodeId.trim() || undefined : undefined,
      new_alert_issue_type: createAlert ? editNewAlertIssueType.trim() || undefined : undefined,
    });
  };
  const applyBulkQty = (target: "create" | "edit") => {
    const bulkValue = target === "create" ? createBulkQty : editBulkQty;
    const qty = Number(bulkValue);
    if (!Number.isFinite(qty) || qty < 0) return;
    if (target === "create") {
      setCreateDetails((prev) => prev.map((row) => (row.selected ? { ...row, order_qty: String(qty) } : row)));
    } else {
      setEditDetails((prev) => prev.map((row) => (row.selected ? { ...row, order_qty: String(qty) } : row)));
    }
  };
  const deleteSelectedDetails = (target: "create" | "edit") => {
    if (target === "create") {
      setCreateDetails((prev) => {
        const next = prev.filter((row) => !row.selected);
        return next.length ? next : [newEditableDetailRow(createForm.ship_to_node_id, createForm.ship_from_node_id)];
      });
      return;
    }
    setEditDetails((prev) => {
      const next = prev.filter((row) => !row.selected);
      return next.length ? next : [newEditableDetailRow(selectedSingleOrder?.ship_to_node_id ?? "", selectedSingleOrder?.ship_from_node_id ?? "")];
    });
  };
  const appendPasteRows = (target: "create" | "edit") => {
    const text = target === "create" ? createPasteText : editPasteText;
    const parsed = parseDetailText(
      text,
      target === "create" ? createForm.ship_to_node_id : (selectedSingleOrder?.ship_to_node_id ?? ""),
      target === "create" ? createForm.ship_from_node_id : (selectedSingleOrder?.ship_from_node_id ?? ""),
    );
    if (!parsed.length) return;
    if (target === "create") {
      setCreateDetails((prev) => [...prev, ...parsed]);
      setCreatePasteText("");
    } else {
      setEditDetails((prev) => [...prev, ...parsed]);
      setEditPasteText("");
    }
  };
  const importDetailsFromFile = (target: "create" | "edit", file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseDetailText(
        text,
        target === "create" ? createForm.ship_to_node_id : (selectedSingleOrder?.ship_to_node_id ?? ""),
        target === "create" ? createForm.ship_from_node_id : (selectedSingleOrder?.ship_from_node_id ?? ""),
      );
      if (!parsed.length) return;
      if (target === "create") {
        setCreateDetails((prev) => [...prev, ...parsed]);
      } else {
        setEditDetails((prev) => [...prev, ...parsed]);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="page-scroll">
      <SectionCard title="Replenishment Workbench" subtitle="Resolve network alerts into replenishment orders and order exceptions">
        <Tabs value={activeTab} onChange={(_event, value) => setActiveTab(value)} sx={{ mb: 1 }}>
          <Tab label="Order Exceptions" />
          <Tab label="Order Details" />
        </Tabs>

        {activeTab === 0 ? (
          <div>
            <SectionCard title="Exception dashboard" subtitle="Status, actions, and order-exception KPIs from backend single source">
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Dashboard aligns with Order Exceptions filters.
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PsychologyAltOutlinedIcon />}
                    onClick={() => {}}
                  >
                    Order Diagnostic Agent
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={dashboardCollapsed ? <ExpandMoreOutlinedIcon /> : <ExpandLessOutlinedIcon />}
                    onClick={() => setDashboardCollapsed((prev) => !prev)}
                  >
                    {dashboardCollapsed ? "Expand" : "Collapse"}
                  </Button>
                </Stack>
              </Stack>
              {!dashboardCollapsed ? (
                <KpiCardRow>
                  <KpiCard title="By Status" tone="critical" items={[
                    { label: "Open", value: String(dashboardMetrics.statusCounts.open) },
                    { label: "In Progress", value: String(dashboardMetrics.statusCounts.in_progress) },
                    { label: "Blocked", value: String(dashboardMetrics.statusCounts.blocked) },
                    { label: "Escalated", value: String(dashboardMetrics.statusCounts.escalated) },
                  ]} />
                  <KpiCard title="By Actions" tone="network" items={
                    dashboardMetrics.topActions.length
                      ? dashboardMetrics.topActions.map(([action, count]) => ({ label: action, value: String(count) }))
                      : [{ label: "No actions", value: "—" }]
                  } />
                  <KpiCard title="Statistics" tone="demand" items={[
                    { label: "Delayed Orders", value: String(dashboardMetrics.delayedOrders) },
                    { label: "Update Not Possible", value: String(dashboardMetrics.updateNotPossible) },
                    { label: "Product Lines Impacted", value: String(dashboardMetrics.impactedProductLines) },
                    { label: "Avg Lead Time", value: `${dashboardMetrics.avgLeadTime.toFixed(2)} d` },
                  ]} />
                  <KpiCard title="Financial & Linkage" tone="money" items={[
                    { label: "Exception Orders", value: String(dashboardMetrics.totalRows) },
                    { label: "Linked Alerts", value: String(dashboardMetrics.linkedAlerts) },
                    { label: "Total Order Cost", value: `$${Math.round(dashboardMetrics.totalCost).toLocaleString()}` },
                    { label: "Outcome", value: "Orders + Exceptions" },
                  ]} />
                </KpiCardRow>
              ) : null}
            </SectionCard>

            <SectionCard title="Order Exceptions" subtitle="Only orders with issues after alert mitigation actions">
              <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
                <Tooltip title="Complex Filter">
                  <IconButton color="primary" onClick={() => setFilterDialogOpen(true)}>
                    <FilterAltOutlinedIcon />
                  </IconButton>
                </Tooltip>
                <Typography variant="caption" color="text.secondary">
                  {filterState.conditions.length
                    ? `${filterState.conditions.length} filters active`
                    : "No advanced filters"}
                </Typography>
              </Stack>
              <div className="maintenance-grid-shell">
                <SmartDataGrid
                  rows={filteredExceptionRows}
                  getRowId={(row) => `${row.order_id}||${row.ship_from_node_id ?? ""}||${row.ship_to_node_id}||${row.alert_id}||${row.order_type}`}
                  columns={exceptionColumns}
                  disableRowSelectionOnClick
                  pageSizeOptions={[10, 25, 50, 100]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{ border: 0 }}
                />
              </div>
            </SectionCard>
          </div>
        ) : (
          <SectionCard title="Order Details" subtitle="Filter and inspect operational order detail records from the backend source of truth">
            <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
              <Tooltip title="Complex Filter">
                <IconButton color="primary" onClick={() => setOrderDetailsFilterDialogOpen(true)}>
                  <FilterAltOutlinedIcon />
                </IconButton>
              </Tooltip>
              <Typography variant="caption" color="text.secondary">
                {orderDetailsFilterState.conditions.length
                  ? `${orderDetailsFilterState.conditions.length} filters active`
                  : "No advanced filters"}
              </Typography>
              <Button size="small" variant="outlined" onClick={openCreateDialog}>
                Create New Order
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={!selectedSingleOrder || isSelectedOrderLockedForEdit}
                onClick={openEditDialog}
              >
                Edit Existing Order
              </Button>
              {selectedSingleOrder && isSelectedOrderLockedForEdit ? (
                <Typography variant="caption" color="warning.main">
                  Edit disabled: delivered and in-progress orders are locked.
                </Typography>
              ) : null}
            </Stack>

            <Box
              sx={{
                display: "flex",
                minHeight: 420,
                height: { xs: "auto", md: 540 },
                flexDirection: { xs: "column", md: "row" },
                border: (theme) => `1px solid ${theme.palette.divider}`,
                borderRadius: "6px",
                overflow: "hidden",
              }}
            >
              <Box sx={{ width: { xs: "100%", md: `${orderDetailsLeftPaneWidthPct}%` }, minWidth: 0, p: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Orders ({orderDetailsFilteredRows.length})</Typography>
                <div className="maintenance-grid-shell" style={{ height: "100%" }}>
                  <SmartDataGrid
                    rows={orderDetailsFilteredRows}
                    getRowId={(row) => `${row.order_id}||${row.ship_from_node_id ?? ""}||${row.ship_to_node_id}||${row.alert_id}||${row.order_type}`}
                    columns={exceptionColumns}
                    checkboxSelection
                    onRowSelectionModelChange={handleOrderDetailsSelectionChange}
                    pageSizeOptions={[10, 25, 50]}
                    initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                    sx={{ border: 0 }}
                  />
                </div>
              </Box>

              <Box
                sx={{
                  width: { xs: "100%", md: "10px" },
                  cursor: { xs: "default", md: "col-resize" },
                  borderLeft: { xs: "0", md: (theme) => `1px solid ${theme.palette.divider}` },
                  borderRight: { xs: "0", md: (theme) => `1px solid ${theme.palette.divider}` },
                  backgroundColor: (theme) => alpha(theme.palette.primary.main, orderDetailsResizing ? 0.22 : 0.08),
                  transition: "background-color 120ms ease",
                }}
                onMouseDown={() => {
                  if (window.innerWidth >= 900) {
                    setOrderDetailsResizing(true);
                  }
                }}
              />

              <Box sx={{ flex: 1, minWidth: 0, p: 1.25 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Selected Order Details ({orderDetailsLevelRows.length})</Typography>
                {orderDetailsLevelRows.length ? (
                  <div className="maintenance-grid-shell" style={{ height: "100%" }}>
                    <SmartDataGrid
                      rows={orderDetailsLevelRows}
                      getRowId={(row) => row.id}
                      columns={selectedOrderDetailsColumns}
                      disableRowSelectionOnClick
                      pageSizeOptions={[10, 25, 50]}
                      initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                      sx={{ border: 0 }}
                    />
                  </div>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Select one or more orders on the left grid to view detailed rows.
                  </Typography>
                )}
              </Box>
            </Box>
          </SectionCard>
        )}
      </SectionCard>

      <FilterBuilderDialog
        open={filterDialogOpen}
        title="Order Exceptions Filters"
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
      <FilterBuilderDialog
        open={orderDetailsFilterDialogOpen}
        title="Order Details Filters"
        fields={orderDetailsFilterFields}
        initialState={orderDetailsFilterState}
        onClose={() => {
          setOrderDetailsFilterDialogOpen(false);
        }}
        onApply={setOrderDetailsFilterState}
        onClear={() => {
          setOrderDetailsFilterState(EMPTY_FILTER_STATE);
        }}
      />

      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { width: "92vw", minHeight: "82vh", maxHeight: "92vh" } } }}
      >
        <DialogTitle>Create New Order</DialogTitle>
        <DialogContent dividers sx={{ p: 1.5, overflow: "hidden" }}>
          <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} sx={{ height: "100%", minHeight: 0 }}>
            <Box sx={{ flex: 0.9, minWidth: 280 }}>
              <SectionCard title="Order Header" subtitle="Core order information and schedule">
                <Stack spacing={1}>
                  <TextField
                    label="Order ID (optional)"
                    value={createForm.order_id}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, order_id: event.target.value }))}
                  />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <TextField
                      label="Order Type"
                      value={createForm.order_type}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, order_type: event.target.value }))}
                      fullWidth
                    />
                    <TextField
                      label="Status"
                      value={createForm.status}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, status: event.target.value }))}
                      fullWidth
                    />
                  </Stack>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <TextField
                      label="Ship To Node"
                      value={createForm.ship_to_node_id}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, ship_to_node_id: event.target.value }))}
                      fullWidth
                    />
                    <TextField
                      label="Ship From Node"
                      value={createForm.ship_from_node_id}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, ship_from_node_id: event.target.value }))}
                      fullWidth
                    />
                  </Stack>
                  <TextField
                    label="Delivery Date (ETA)"
                    type="date"
                    value={createForm.eta}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, eta: event.target.value }))}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={createForm.is_exception}
                        onChange={(event) => setCreateForm((prev) => ({ ...prev, is_exception: event.target.checked }))}
                      />
                    }
                    label="Mark as Exception Order"
                  />
                  <TextField
                    label="Exception Reason (optional)"
                    value={createForm.exception_reason}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, exception_reason: event.target.value }))}
                  />
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                    <Chip label={`Valid lines: ${createDetailsSummary.validRows}`} size="small" />
                    <Chip label={`Line qty total: ${createDetailsSummary.totalQty.toFixed(2)}`} size="small" />
                    <Chip label={`Selected lines: ${createDetailsSummary.selectedRows}`} size="small" />
                  </Stack>
                </Stack>
              </SectionCard>
            </Box>
            <Box sx={{ flex: 1.4, minWidth: 0 }}>
              <SectionCard title="Order Line Items" subtitle="Add, bulk edit, paste/import, and inline edit item-level details">
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setCreateDetails((prev) => [...prev, newEditableDetailRow(createForm.ship_to_node_id, createForm.ship_from_node_id)])}
                    >
                      Add Line
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => deleteSelectedDetails("create")}>
                      Delete Selected
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => appendPasteRows("create")}>
                      Paste Apply
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => createImportRef.current?.click()}>
                      Import CSV
                    </Button>
                    <input
                      ref={createImportRef}
                      type="file"
                      accept=".csv,.txt"
                      style={{ display: "none" }}
                      onChange={(event) => importDetailsFromFile("create", event.target.files?.[0] ?? null)}
                    />
                  </Stack>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                    <TextField
                      label="Bulk Qty for Selected"
                      type="number"
                      value={createBulkQty}
                      onChange={(event) => setCreateBulkQty(event.target.value)}
                      fullWidth
                    />
                    <Button size="small" variant="outlined" onClick={() => applyBulkQty("create")}>
                      Apply Bulk Qty
                    </Button>
                  </Stack>
                  <TextField
                    multiline
                    minRows={3}
                    label="Paste Rows (SKU,Qty,ShipTo,ShipFrom)"
                    value={createPasteText}
                    onChange={(event) => setCreatePasteText(event.target.value)}
                    fullWidth
                  />
                  <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: 1, p: 1, maxHeight: "48vh", overflow: "auto" }}>
                    <Stack spacing={0.75}>
                      {createDetails.map((row) => (
                        <Stack
                          key={row.id}
                          direction={{ xs: "column", md: "row" }}
                          spacing={0.75}
                          alignItems={{ xs: "stretch", md: "center" }}
                          sx={{ p: 0.75, borderRadius: 1, bgcolor: "action.hover" }}
                        >
                          <Checkbox
                            size="small"
                            checked={row.selected}
                            onChange={(event) =>
                              setCreateDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, selected: event.target.checked } : item)))
                            }
                          />
                          <TextField
                            label="SKU"
                            value={row.sku}
                            onChange={(event) =>
                              setCreateDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, sku: event.target.value } : item)))
                            }
                            fullWidth
                          />
                          <TextField
                            label="Qty"
                            type="number"
                            value={row.order_qty}
                            onChange={(event) =>
                              setCreateDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, order_qty: event.target.value } : item)))
                            }
                            sx={{ minWidth: 120 }}
                          />
                          <TextField
                            label="Ship To"
                            value={row.ship_to_node_id}
                            onChange={(event) =>
                              setCreateDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, ship_to_node_id: event.target.value } : item)))
                            }
                            sx={{ minWidth: 150 }}
                          />
                          <TextField
                            label="Ship From"
                            value={row.ship_from_node_id}
                            onChange={(event) =>
                              setCreateDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, ship_from_node_id: event.target.value } : item)))
                            }
                            sx={{ minWidth: 150 }}
                          />
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                  {createError ? <Typography variant="caption" color="error.main">{createError}</Typography> : null}
                </Stack>
              </SectionCard>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={submitCreateOrder} disabled={createOrderMutation.isPending} variant="contained">
            {createOrderMutation.isPending ? "Creating..." : "Create Order"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { width: "92vw", minHeight: "82vh", maxHeight: "92vh" } } }}
      >
        <DialogTitle>Edit Existing Order</DialogTitle>
        <DialogContent dividers sx={{ p: 1.5, overflow: "hidden" }}>
          <Stack direction={{ xs: "column", lg: "row" }} spacing={1.5} sx={{ height: "100%", minHeight: 0 }}>
            <Box sx={{ flex: 0.9, minWidth: 280 }}>
              <SectionCard title="Order Header" subtitle="Update overall quantity and ETA while preserving item details">
                <Stack spacing={1}>
                  <Typography variant="caption" color="text.secondary">
                    Order: {selectedSingleOrder?.order_id ?? "-"}
                  </Typography>
                  <TextField
                    label="Order Qty"
                    type="number"
                    value={editOrderQty}
                    onChange={(event) => setEditOrderQty(event.target.value)}
                  />
                  <TextField
                    label="Delivery Date (ETA)"
                    type="date"
                    value={editEta}
                    onChange={(event) => setEditEta(event.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                    <Chip label={`Valid lines: ${editDetailsSummary.validRows}`} size="small" />
                    <Chip label={`Line qty total: ${editDetailsSummary.totalQty.toFixed(2)}`} size="small" />
                    <Chip label={`Selected lines: ${editDetailsSummary.selectedRows}`} size="small" />
                  </Stack>
                  <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: 1, p: 1 }}>
                    <Typography variant="subtitle2">Alert Management</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Current alert: {selectedSingleOrder?.alert_id || "-"}
                    </Typography>
                    {selectedOrderAlertIds.length > 0 ? (
                      <Stack direction="row" spacing={0.6} sx={{ mt: 0.75, flexWrap: "wrap" }}>
                        {selectedOrderAlertIds.map((alertId) => (
                          <Chip
                            key={alertId}
                            size="small"
                            variant={alertId === selectedSingleOrder?.alert_id ? "filled" : "outlined"}
                            label={alertId}
                          />
                        ))}
                      </Stack>
                    ) : null}
                    {selectedOrderFixedAlertIds.length > 0 ? (
                      <Stack direction="row" spacing={0.6} sx={{ mt: 0.5, flexWrap: "wrap" }}>
                        {selectedOrderFixedAlertIds.map((alertId) => (
                          <Chip key={`fixed-${alertId}`} size="small" variant="outlined" color="default" label={`Archived: ${alertId}`} />
                        ))}
                      </Stack>
                    ) : null}
                    {selectedSingleOrder?.alert_id ? (
                      <Box
                        sx={(theme) => ({
                          mt: 0.75,
                          p: 1,
                          borderRadius: 1,
                          border: `1px solid ${alpha(
                            String(currentOrderAlert?.severity ?? "").toLowerCase() === "critical"
                              ? theme.palette.error.main
                              : theme.palette.warning.main,
                            0.55,
                          )}`,
                          backgroundColor: alpha(
                            String(currentOrderAlert?.severity ?? "").toLowerCase() === "critical"
                              ? theme.palette.error.main
                              : theme.palette.warning.main,
                            0.12,
                          ),
                        })}
                      >
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1}
                          alignItems={{ xs: "flex-start", sm: "center" }}
                          justifyContent="space-between"
                        >
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            Alert linked to this order
                          </Typography>
                          <Chip
                            size="small"
                            color={String(currentOrderAlert?.severity ?? "").toLowerCase() === "critical" ? "error" : "warning"}
                            label={`${selectedSingleOrder.alert_id}${currentOrderAlert?.severity ? ` (${currentOrderAlert.severity})` : ""}`}
                          />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {currentOrderAlert?.title || "Alert details are not currently available in the loaded alert set."}
                        </Typography>
                      </Box>
                    ) : null}
                    {currentOrderAlert ? (
                      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", mt: 0.75 }}>
                        <Chip label={`Severity: ${currentOrderAlert.severity}`} size="small" />
                        <Chip label={currentOrderAlert.alert_type} size="small" />
                      </Stack>
                    ) : null}
                    <FormControlLabel
                      sx={{ mt: 0.75 }}
                      control={
                        <Switch
                          checked={editMarkAlertFixed}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setEditMarkAlertFixed(checked);
                            if (checked && !editFixedAlertId) {
                              setEditFixedAlertId(selectedOrderAlertIds[0] ?? selectedSingleOrder?.alert_id ?? "");
                            }
                          }}
                        />
                      }
                      label="Mark current alert as fixed"
                    />
                    {editMarkAlertFixed ? (
                      <TextField
                        label="Alert ID to mark fixed"
                        value={editFixedAlertId}
                        onChange={(event) => setEditFixedAlertId(event.target.value)}
                        placeholder="ALERT-..."
                        fullWidth
                        sx={{ mt: 0.5 }}
                      />
                    ) : null}
                    <TextField
                      label="Link Existing Alert ID (optional)"
                      value={editLinkAlertId}
                      onChange={(event) => setEditLinkAlertId(event.target.value)}
                      placeholder="ALERT-..."
                      fullWidth
                      disabled={editCreateNewAlert || isSelectedOrderLockedForEdit}
                    />
                    <FormControlLabel
                      sx={{ mt: 0.5 }}
                      control={<Switch checked={editCreateNewAlert} onChange={(event) => setEditCreateNewAlert(event.target.checked)} />}
                      label="Add and link a new alert"
                    />
                    {editCreateNewAlert ? (
                      <Stack spacing={1}>
                        <TextField
                          label="New Alert ID (optional)"
                          value={editNewAlertId}
                          onChange={(event) => setEditNewAlertId(event.target.value)}
                          placeholder="Auto-generated when empty"
                          fullWidth
                        />
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                          <TextField
                            label="Alert Type"
                            value={editNewAlertType}
                            onChange={(event) => setEditNewAlertType(event.target.value)}
                            fullWidth
                          />
                          <TextField
                            label="Severity"
                            value={editNewAlertSeverity}
                            onChange={(event) => setEditNewAlertSeverity(event.target.value)}
                            placeholder="critical | warning | info"
                            fullWidth
                          />
                        </Stack>
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                          <TextField
                            label="Impacted Node (supply node)"
                            value={editNewAlertImpactedNodeId}
                            onChange={(event) => setEditNewAlertImpactedNodeId(event.target.value)}
                            fullWidth
                          />
                          <TextField
                            label="Issue Type (e.g. parameter_issue)"
                            value={editNewAlertIssueType}
                            onChange={(event) => setEditNewAlertIssueType(event.target.value)}
                            fullWidth
                          />
                        </Stack>
                        <TextField
                          label="New Alert Title"
                          value={editNewAlertTitle}
                          onChange={(event) => setEditNewAlertTitle(event.target.value)}
                          fullWidth
                        />
                        <TextField
                          multiline
                          minRows={2}
                          label="New Alert Description"
                          value={editNewAlertDescription}
                          onChange={(event) => setEditNewAlertDescription(event.target.value)}
                          fullWidth
                        />
                      </Stack>
                    ) : null}
                  </Box>
                </Stack>
              </SectionCard>
            </Box>
            <Box sx={{ flex: 1.4, minWidth: 0 }}>
              <SectionCard title="Order Line Items" subtitle="Modify item-level quantities and routing with bulk/paste tools">
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        setEditDetails((prev) => [
                          ...prev,
                          newEditableDetailRow(selectedSingleOrder?.ship_to_node_id ?? "", selectedSingleOrder?.ship_from_node_id ?? ""),
                        ])
                      }
                    >
                      Add Line
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => deleteSelectedDetails("edit")}>
                      Delete Selected
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => appendPasteRows("edit")}>
                      Paste Apply
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => editImportRef.current?.click()}>
                      Import CSV
                    </Button>
                    <input
                      ref={editImportRef}
                      type="file"
                      accept=".csv,.txt"
                      style={{ display: "none" }}
                      onChange={(event) => importDetailsFromFile("edit", event.target.files?.[0] ?? null)}
                    />
                  </Stack>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                    <TextField
                      label="Bulk Qty for Selected"
                      type="number"
                      value={editBulkQty}
                      onChange={(event) => setEditBulkQty(event.target.value)}
                      fullWidth
                    />
                    <Button size="small" variant="outlined" onClick={() => applyBulkQty("edit")}>
                      Apply Bulk Qty
                    </Button>
                  </Stack>
                  <TextField
                    multiline
                    minRows={3}
                    label="Paste Rows (SKU,Qty,ShipTo,ShipFrom)"
                    value={editPasteText}
                    onChange={(event) => setEditPasteText(event.target.value)}
                    fullWidth
                  />
                  <Box sx={{ border: (theme) => `1px solid ${theme.palette.divider}`, borderRadius: 1, p: 1, maxHeight: "48vh", overflow: "auto" }}>
                    <Stack spacing={0.75}>
                      {editDetails.map((row) => (
                        <Stack
                          key={row.id}
                          direction={{ xs: "column", md: "row" }}
                          spacing={0.75}
                          alignItems={{ xs: "stretch", md: "center" }}
                          sx={{ p: 0.75, borderRadius: 1, bgcolor: "action.hover" }}
                        >
                          <Checkbox
                            size="small"
                            checked={row.selected}
                            onChange={(event) =>
                              setEditDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, selected: event.target.checked } : item)))
                            }
                          />
                          <TextField
                            label="SKU"
                            value={row.sku}
                            onChange={(event) =>
                              setEditDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, sku: event.target.value } : item)))
                            }
                            fullWidth
                          />
                          <TextField
                            label="Qty"
                            type="number"
                            value={row.order_qty}
                            onChange={(event) =>
                              setEditDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, order_qty: event.target.value } : item)))
                            }
                            sx={{ minWidth: 120 }}
                          />
                          <TextField
                            label="Ship To"
                            value={row.ship_to_node_id}
                            onChange={(event) =>
                              setEditDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, ship_to_node_id: event.target.value } : item)))
                            }
                            sx={{ minWidth: 150 }}
                          />
                          <TextField
                            label="Ship From"
                            value={row.ship_from_node_id}
                            onChange={(event) =>
                              setEditDetails((prev) => prev.map((item) => (item.id === row.id ? { ...item, ship_from_node_id: event.target.value } : item)))
                            }
                            sx={{ minWidth: 150 }}
                          />
                        </Stack>
                      ))}
                    </Stack>
                  </Box>
                  {editError ? <Typography variant="caption" color="error.main">{editError}</Typography> : null}
                </Stack>
              </SectionCard>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={submitEditOrder}
            disabled={editOrderMutation.isPending || !selectedSingleOrder || isSelectedOrderLockedForEdit}
            variant="contained"
          >
            {editOrderMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={projectionModalOpen}
        onClose={() => setProjectionModalOpen(false)}
        fullWidth
        maxWidth="xl"
        slotProps={{ paper: { sx: { minHeight: "82vh", maxHeight: "92vh" } } }}
      >
        <DialogTitle>Projected Inventory Workbench</DialogTitle>
        <DialogContent dividers sx={{ p: 1, overflowY: "auto", overflowX: "hidden" }}>
          <Box sx={{ minHeight: 0, overflowY: "auto", overflowX: "hidden", pr: 0.5 }}>
            <ProjectedInventoryWorkbench
              key={`${projectionSku || "__all_sku__"}::${projectionLocation || "__all_node__"}`}
              initialSku={projectionSku || undefined}
              initialLocation={projectionLocation || undefined}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProjectionModalOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
