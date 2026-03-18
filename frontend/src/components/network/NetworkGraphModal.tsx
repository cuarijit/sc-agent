import FitScreenOutlinedIcon from "@mui/icons-material/FitScreenOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import ZoomInOutlinedIcon from "@mui/icons-material/ZoomInOutlined";
import ZoomOutOutlinedIcon from "@mui/icons-material/ZoomOutOutlined";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchMasterDataOptions, fetchNetworkView, fetchProjectedInventoryAlerts } from "../../services/api";
import type { MasterDataOptions, NetworkViewResponse } from "../../types";

type ViewFlowNode = { id: string; x: number; y: number; label: string; node: NetworkViewResponse["graph_nodes"][number] };
type ViewFlowEdge = { id: string; source: string; target: string; label: string };

export default function NetworkGraphModal({
  open,
  onClose,
  sku,
  onOpenProjectedInventory,
}: {
  open: boolean;
  onClose: () => void;
  sku: string | null;
  onOpenProjectedInventory?: (sku: string, nodeId: string) => void;
}) {
  const normalizedSku = String(sku ?? "").trim();
  const isReady = open && Boolean(normalizedSku);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (normalizedSku) p.set("sku", normalizedSku);
    p.set("weeks_of_coverage", "8");
    return p;
  }, [normalizedSku]);

  const { data: networkView } = useQuery<NetworkViewResponse>({
    queryKey: ["network-graph-modal-view", normalizedSku],
    queryFn: () => fetchNetworkView(params),
    enabled: isReady,
  });
  const { data: masterDataOptions } = useQuery<MasterDataOptions>({
    queryKey: ["network-graph-modal-master-options"],
    queryFn: fetchMasterDataOptions,
    enabled: isReady,
  });

  const graphProductDetail = useMemo(() => {
    const product = (masterDataOptions?.products ?? []).find((item) => String(item.sku) === normalizedSku);
    if (!product) return null;
    return {
      sku: product.sku,
      name: product.name,
      category: product.category,
      brand: product.brand,
    };
  }, [masterDataOptions?.products, normalizedSku]);

  const LAYOUT = useMemo(() => ({ COLUMN_SPACING: 340, ROW_SPACING: 93, PADDING: 22 }), []);
  const viewFlowNodes = useMemo<ViewFlowNode[]>(() => {
    const nodes = networkView?.graph_nodes ?? [];
    const edges = networkView?.graph_edges ?? [];
    if (nodes.length === 0) return [];
    const nodeIds = new Set(nodes.map((n) => n.node_id));
    const targets = new Set(edges.map((e) => e.target_node_id));
    const roots = nodes.filter((n) => !targets.has(n.node_id)).map((n) => n.node_id);
    if (roots.length === 0) roots.push(nodes[0].node_id);

    const levelByNode = new Map<string, number>();
    roots.forEach((id) => levelByNode.set(id, 0));
    const incoming = new Map<string, string[]>();
    for (const e of edges) {
      if (!nodeIds.has(e.source_node_id) || !nodeIds.has(e.target_node_id)) continue;
      if (!incoming.has(e.target_node_id)) incoming.set(e.target_node_id, []);
      incoming.get(e.target_node_id)?.push(e.source_node_id);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) {
        const sourceLevel = levelByNode.get(e.source_node_id) ?? 0;
        const targetLevel = levelByNode.get(e.target_node_id) ?? 0;
        const nextTarget = sourceLevel + 1;
        if (nextTarget > targetLevel) {
          levelByNode.set(e.target_node_id, nextTarget);
          changed = true;
        }
      }
    }
    nodes.forEach((n) => {
      if (!levelByNode.has(n.node_id)) levelByNode.set(n.node_id, 0);
    });
    const byLevel = new Map<number, string[]>();
    for (const node of nodes) {
      const level = levelByNode.get(node.node_id) ?? 0;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level)?.push(node.node_id);
    }
    const levels = [...byLevel.keys()].sort((a, b) => a - b);
    const nodeToItem = new Map(nodes.map((n) => [n.node_id, n]));
    const maxRows = Math.max(1, ...levels.map((level) => (byLevel.get(level) ?? []).length));
    const result: ViewFlowNode[] = [];

    for (const level of levels) {
      const ids = byLevel.get(level) ?? [];
      ids.sort((a, b) => {
        const aIncoming = incoming.get(a) ?? [];
        const bIncoming = incoming.get(b) ?? [];
        const aScore = aIncoming.length ? aIncoming.join("|") : "zzzz";
        const bScore = bIncoming.length ? bIncoming.join("|") : "zzzz";
        return aScore === bScore ? a.localeCompare(b) : aScore.localeCompare(bScore);
      });
      const topOffset = ((maxRows - ids.length) * LAYOUT.ROW_SPACING) / 2;
      ids.forEach((id, idx) => {
        const item = nodeToItem.get(id);
        if (!item) return;
        result.push({
          id: item.node_id,
          x: LAYOUT.PADDING + level * LAYOUT.COLUMN_SPACING,
          y: LAYOUT.PADDING + topOffset + idx * LAYOUT.ROW_SPACING,
          label: `${item.name}\n${item.node_type.toUpperCase()} · ${item.region}`,
          node: item,
        });
      });
    }
    return result;
  }, [networkView?.graph_edges, networkView?.graph_nodes, LAYOUT]);
  const viewFlowEdges = useMemo<ViewFlowEdge[]>(
    () => (networkView?.graph_edges ?? []).map((edge) => ({ id: edge.edge_id, source: edge.source_node_id, target: edge.target_node_id, label: edge.sourcing_strategy.toUpperCase() })),
    [networkView?.graph_edges],
  );
  const graphNodeIds = useMemo(() => [...new Set(viewFlowNodes.map((node) => node.id))], [viewFlowNodes]);
  const { data: graphNodeAlertSummary } = useQuery<
    Record<string, { count: number; severity: "critical" | "warning" | "info" }>
  >({
    queryKey: ["network-graph-modal-node-alert-summary", normalizedSku, graphNodeIds.join("|")],
    enabled: isReady && graphNodeIds.length > 0,
    queryFn: async () => {
      const severityRank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
      const entries = await Promise.all(
        graphNodeIds.map(async (nodeId) => {
          const directAlerts = await fetchProjectedInventoryAlerts(normalizedSku, nodeId, { matchScope: "direct" });
          const activeAlerts = directAlerts.filter((alert) => alert.status === "active");
          let severity: "critical" | "warning" | "info" = "info";
          let best = 0;
          for (const alert of activeAlerts) {
            const sev = String(alert.severity ?? "info").toLowerCase();
            const rank = severityRank[sev] ?? 0;
            if (rank > best) {
              best = rank;
              severity = sev === "critical" ? "critical" : sev === "warning" ? "warning" : "info";
            }
          }
          return [nodeId, { count: activeAlerts.length, severity }] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });
  const nodeSizes = useMemo(() => {
    const m = new Map<string, { w: number; h: number }>();
    for (const node of viewFlowNodes) {
      m.set(node.id, { w: 116, h: 46 });
    }
    return m;
  }, [viewFlowNodes]);
  const effectivePositions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const node of viewFlowNodes) m.set(node.id, { x: node.x, y: node.y });
    return m;
  }, [viewFlowNodes]);
  const canvasSize = useMemo(() => {
    if (!viewFlowNodes.length) return { width: 700, height: 420 };
    let maxX = 0;
    let maxY = 0;
    for (const node of viewFlowNodes) {
      const pos = effectivePositions.get(node.id) ?? { x: node.x, y: node.y };
      const size = nodeSizes.get(node.id) ?? { w: 116, h: 46 };
      maxX = Math.max(maxX, pos.x + size.w + 24);
      maxY = Math.max(maxY, pos.y + size.h + 24);
    }
    return { width: Math.max(900, maxX), height: Math.max(560, maxY) };
  }, [effectivePositions, nodeSizes, viewFlowNodes]);

  const fitToView = useCallback(() => {
    const wrapper = canvasRef.current;
    if (!wrapper) return;
    const availableW = Math.max(320, wrapper.clientWidth - 20);
    // Width-fit first so lanes/connectors span the entire modal width.
    const suggested = availableW / Math.max(1, canvasSize.width);
    setScale(Math.max(0.55, Math.min(4, suggested)));
    wrapper.scrollTo({ left: 0, top: 0, behavior: "auto" });
  }, [canvasSize.height, canvasSize.width]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    raf = requestAnimationFrame(() => fitToView());
    return () => cancelAnimationFrame(raf);
  }, [open, fitToView, normalizedSku]);

  function pointOnRectBoundary(
    left: number,
    top: number,
    width: number,
    height: number,
    toX: number,
    toY: number,
  ): { x: number; y: number } {
    const cx = left + width / 2;
    const cy = top + height / 2;
    let dx = toX - cx;
    let dy = toY - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len;
    dy /= len;
    let tMin = Infinity;
    if (dx > 0) tMin = Math.min(tMin, (left + width - cx) / dx);
    if (dx < 0) tMin = Math.min(tMin, (left - cx) / dx);
    if (dy > 0) tMin = Math.min(tMin, (top + height - cy) / dy);
    if (dy < 0) tMin = Math.min(tMin, (top - cy) / dy);
    return { x: cx + tMin * dx, y: cy + tMin * dy };
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      slotProps={{ paper: { sx: { width: "96vw", maxWidth: "96vw", height: "92vh", display: "flex", flexDirection: "column" } } }}
    >
      <DialogTitle>Supply Chain Network Graph</DialogTitle>
      <DialogContent dividers sx={{ p: 1.25, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 0.8 }}>
        {!normalizedSku ? (
          <Typography variant="body2" color="text.secondary">No SKU provided for graph rendering.</Typography>
        ) : (
          <>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ flexShrink: 0 }}>
              <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1, py: 0.6, bgcolor: "background.paper" }}>
                <Typography variant="caption" color="text.secondary">Network Product</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{graphProductDetail?.sku ?? normalizedSku}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {graphProductDetail?.name ?? "Product details unavailable"}
                  {graphProductDetail?.category ? ` · ${graphProductDetail.category}` : ""}
                  {graphProductDetail?.brand ? ` · ${graphProductDetail.brand}` : ""}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.4}>
                <Tooltip title="Zoom out"><IconButton size="small" onClick={() => setScale((v) => Math.max(0.55, v - 0.1))}><ZoomOutOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                <Typography variant="caption" sx={{ minWidth: 42, textAlign: "center", lineHeight: "30px" }}>{Math.round(scale * 100)}%</Typography>
                <Tooltip title="Zoom in"><IconButton size="small" onClick={() => setScale((v) => Math.min(1.9, v + 0.1))}><ZoomInOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Fit to view"><IconButton size="small" onClick={fitToView}><FitScreenOutlinedIcon fontSize="small" /></IconButton></Tooltip>
              </Stack>
            </Stack>
            <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
              <div
                ref={canvasRef}
                className="network-canvas-wrapper"
                style={{ height: "100%", minHeight: 0 }}
                onScroll={(event) => {
                  const el = event.currentTarget;
                  setViewport({ left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight });
                }}
              >
                <div
                  className="network-canvas-shell network-canvas-shell-expanded"
                  style={{ width: Math.max(canvasSize.width * scale, viewport.width || 0), height: Math.max(canvasSize.height * scale, viewport.height || 0) }}
                >
                  <svg className="network-edge-svg" width={Math.max(canvasSize.width * scale, viewport.width || 0)} height={Math.max(canvasSize.height * scale, viewport.height || 0)} style={{ pointerEvents: "auto" }}>
                    <defs>
                      <marker id="network-modal-arrow-push" markerWidth={8} markerHeight={8} refX={7} refY={3} orient="auto">
                        <path d="M0,0 L0,6 L7,3 Z" fill="#0f172a" />
                      </marker>
                      <marker id="network-modal-arrow-pull" markerWidth={8} markerHeight={8} refX={7} refY={3} orient="auto">
                        <path d="M0,0 L0,6 L7,3 Z" fill="#2563eb" />
                      </marker>
                    </defs>
                    {viewFlowEdges.map((edge) => {
                      const sourcePos = effectivePositions.get(edge.source);
                      const targetPos = effectivePositions.get(edge.target);
                      if (!sourcePos || !targetPos) return null;
                      const srcSize = nodeSizes.get(edge.source) ?? { w: 116, h: 46 };
                      const tgtSize = nodeSizes.get(edge.target) ?? { w: 116, h: 46 };
                      const src = { x: sourcePos.x * scale, y: sourcePos.y * scale, w: srcSize.w * scale, h: srcSize.h * scale };
                      const tgt = { x: targetPos.x * scale, y: targetPos.y * scale, w: tgtSize.w * scale, h: tgtSize.h * scale };
                      const start = pointOnRectBoundary(src.x, src.y, src.w, src.h, tgt.x + tgt.w / 2, tgt.y + tgt.h / 2);
                      const end = pointOnRectBoundary(tgt.x, tgt.y, tgt.w, tgt.h, src.x + src.w / 2, src.y + src.h / 2);
                      const isPull = edge.label === "PULL";
                      const stroke = isPull ? "#2563eb" : "#0f172a";
                      const markerEnd = isPull ? "url(#network-modal-arrow-pull)" : "url(#network-modal-arrow-push)";
                      const path = `M ${start.x} ${start.y} C ${(start.x + end.x) / 2} ${start.y}, ${(start.x + end.x) / 2} ${end.y}, ${end.x} ${end.y}`;
                      const midX = (start.x + end.x) / 2;
                      const midY = (start.y + end.y) / 2 - 5;
                      const isHovered = hoveredEdgeId === edge.id;
                      return (
                        <g key={edge.id}>
                          <path
                            d={path}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={(isPull ? 2.5 : 2.0) + (isHovered ? 0.9 : 0)}
                            strokeDasharray={isPull ? "5 4" : "0"}
                            markerEnd={markerEnd}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            pointerEvents="stroke"
                            onMouseEnter={() => setHoveredEdgeId(edge.id)}
                            onMouseLeave={() => setHoveredEdgeId((curr) => (curr === edge.id ? null : curr))}
                          />
                          {(scale >= 0.95 || isHovered) ? (
                            <text x={midX} y={midY} className="network-edge-label" textAnchor="middle" style={{ opacity: isHovered ? 1 : 0.86 }}>
                              {edge.label}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
                  </svg>
                  {viewFlowNodes.map((node) => {
                    const size = nodeSizes.get(node.id) ?? { w: 116, h: 46 };
                    const left = node.x * scale;
                    const top = node.y * scale;
                    const w = size.w * scale;
                    const h = size.h * scale;
                    const nodeType = (node.node.node_type ?? "store").toLowerCase();
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
                    const nodeAlertMeta = graphNodeAlertSummary?.[node.id] ?? { count: 0, severity: "info" as const };
                    const hasAlert = nodeAlertMeta.count > 0;
                    const nodeSeverity = nodeAlertMeta.severity;
                    return (
                      <Box key={node.id} className={`network-node-card ${typeClass}`} style={{ left, top, width: w, minHeight: h }}>
                        <Typography variant="caption" className="network-node-title">{String(node.node.name ?? node.id).slice(0, 22)}</Typography>
                        <Typography variant="caption" className="network-node-subtitle">
                          {(node.node.node_type ?? "node").toUpperCase()} · {node.node.region ?? "-"}
                        </Typography>
                        <Box className="network-node-type-badge">{typeBadge}</Box>
                        <Stack direction="row" spacing={0.3} sx={{ mt: 0.55, alignItems: "center" }}>
                          <HubOutlinedIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                          <Tooltip title={`Open projected inventory (direct alerts only: ${nodeAlertMeta.count})`}>
                            <IconButton
                              size="small"
                              color="primary"
                              sx={{
                                border: "1px solid",
                                borderColor: "primary.light",
                                bgcolor: "rgba(59,130,246,0.10)",
                                p: 0.3,
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!onOpenProjectedInventory || !normalizedSku) return;
                                onOpenProjectedInventory(normalizedSku, node.id);
                              }}
                            >
                              <Inventory2OutlinedIcon sx={{ fontSize: 11 }} />
                              {hasAlert ? (
                                <Box
                                  component="span"
                                  sx={{
                                    position: "absolute",
                                    top: -5,
                                    right: -4,
                                    minWidth: 13,
                                    height: 13,
                                    px: 0.3,
                                    borderRadius: 6,
                                    bgcolor: nodeSeverity === "critical" ? "error.main" : nodeSeverity === "warning" ? "warning.main" : "grey.600",
                                    color: "#fff",
                                    fontSize: 9,
                                    lineHeight: "13px",
                                    textAlign: "center",
                                  }}
                                >
                                  {nodeAlertMeta.count}
                                </Box>
                              ) : null}
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Box>
                    );
                  })}
                </div>
              </div>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

