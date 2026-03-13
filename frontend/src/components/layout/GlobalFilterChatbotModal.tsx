import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ChevronLeftOutlinedIcon from "@mui/icons-material/ChevronLeftOutlined";
import ChevronRightOutlinedIcon from "@mui/icons-material/ChevronRightOutlined";
import DragIndicatorOutlinedIcon from "@mui/icons-material/DragIndicatorOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import ThumbDownOffAltOutlinedIcon from "@mui/icons-material/ThumbDownOffAltOutlined";
import ThumbDownAltIcon from "@mui/icons-material/ThumbDownAlt";
import ThumbUpOffAltOutlinedIcon from "@mui/icons-material/ThumbUpOffAltOutlined";
import ThumbUpAltIcon from "@mui/icons-material/ThumbUpAlt";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type GridColDef } from "@mui/x-data-grid";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { UiConfig, ChatbotResponse } from "../../types";
import { chatbotFeedback, chatbotFollowup, chatbotQuery } from "../../services/api";
import SmartDataGrid from "../shared/SmartDataGrid";
import type { GlobalFilters } from "../../types/filters";
import { normalizedFilterList } from "../../types/filters";

type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  conversationId?: string;
  generatedSql?: string | null;
  userMessage?: string;
  previewColumns?: string[];
  previewRows?: Record<string, unknown>[];
  totalRows?: number;
  followUpQuestions?: string[];
  historyCursor?: number;
};

type FeedbackStatus = {
  status: "saving" | "saved" | "error";
  message: string;
};

type PromptSection = {
  title: string;
  lines: string[];
};

type ChartType = "line" | "bar" | "stackedBar" | "lineBar" | "lineStackedBar" | "pie" | "heatmap";

export default function GlobalFilterChatbotModal({
  open,
  onClose,
  filters,
  setFilters,
  config,
  openAiApiKey,
  title = "MEIO Data Assistant",
  showApplyToGlobalFilter = true,
  embedded = false,
  enableCharts = false,
  assistantMode = "meio-data-assistant",
  defaultGridCollapsed = false,
}: {
  open: boolean;
  onClose: () => void;
  filters: GlobalFilters;
  setFilters: Dispatch<SetStateAction<GlobalFilters>>;
  config: UiConfig;
  openAiApiKey: string;
  title?: string;
  showApplyToGlobalFilter?: boolean;
  embedded?: boolean;
  enableCharts?: boolean;
  assistantMode?: string;
  defaultGridCollapsed?: boolean;
}) {
  const isVisible = embedded || open;
  const MAX_LIST_PREVIEW_ROWS = 10;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [latest, setLatest] = useState<ChatbotResponse | null>(null);
  const [applyMessage, setApplyMessage] = useState("");
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [feedbackByLine, setFeedbackByLine] = useState<Record<string, "up" | "down">>({});
  const [feedbackStatusByLine, setFeedbackStatusByLine] = useState<Record<string, FeedbackStatus>>({});
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [chatPaneWidthPct, setChatPaneWidthPct] = useState(42);
  const [isGridCollapsed, setIsGridCollapsed] = useState(defaultGridCollapsed);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [branchCursor, setBranchCursor] = useState<number | null>(null);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [chartDimensionX, setChartDimensionX] = useState("");
  const [chartDimensionY, setChartDimensionY] = useState("");
  const [chartMeasures, setChartMeasures] = useState<string[]>([]);
  const [showChartRequested, setShowChartRequested] = useState(false);
  const [showSqlText, setShowSqlText] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async (message: string) => {
      const payload = {
        message,
        conversation_id: conversationId,
        context_cursor: branchCursor,
        assistant_mode: assistantMode,
        llm_provider: config.llmProvider,
        llm_model: config.llmModel,
        openai_api_key: openAiApiKey,
      };
      return conversationId ? chatbotFollowup(payload) : chatbotQuery(payload);
    },
    onSuccess: (response, message) => {
      setLatest(response);
      const nextConversationId = response.diagnostics.conversation_id ?? conversationId;
      if (nextConversationId) {
        setConversationId(nextConversationId);
      }
      setLines((prev) => {
        const next = [
          ...prev,
          {
            id: `${Date.now()}_a`,
            role: "assistant" as const,
            text: response.answer_text,
            createdAt: new Date().toISOString(),
            conversationId: nextConversationId ?? undefined,
            generatedSql: response.diagnostics.generated_sql,
            userMessage: message,
            previewColumns: response.table?.columns ?? [],
            previewRows: (response.table?.rows ?? []).slice(0, MAX_LIST_PREVIEW_ROWS),
            totalRows: response.diagnostics.row_count ?? response.table?.rows?.length ?? 0,
            followUpQuestions: response.follow_up_questions?.slice(0, 4) ?? [],
            historyCursor: response.diagnostics.history_cursor ?? undefined,
          },
        ];
        if (response.diagnostics.warnings?.length) {
          next.push({ id: `${Date.now()}_w`, role: "system", text: `Warning: ${response.diagnostics.warnings[0]}`, createdAt: new Date().toISOString() });
        }
        return next;
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unknown chatbot request error.";
      setLines((prev) => [...prev, { id: `${Date.now()}_e`, role: "system", text: `Error: ${message}`, createdAt: new Date().toISOString() }]);
    },
  });

  const send = (message: string) => {
    const text = message.trim();
    if (!text || submitMutation.isPending) return;
    setApplyMessage("");
    setLines((prev) => [...prev, { id: `${Date.now()}_u`, role: "user", text, createdAt: new Date().toISOString() }]);
    submitMutation.mutate(text);
  };

  useEffect(() => {
    if (!isVisible) return;
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, submitMutation.isPending, isVisible]);
  useEffect(() => {
    if (embedded) return;
    if (!open) return;
    setIsGridCollapsed(defaultGridCollapsed);
  }, [embedded, open, defaultGridCollapsed]);
  useEffect(() => {
    if (!isResizingSplit) return;
    const onMove = (event: MouseEvent) => {
      const container = splitContainerRef.current;
      if (!container || isGridCollapsed) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const nextPct = ((event.clientX - rect.left) / rect.width) * 100;
      setChatPaneWidthPct(Math.max(28, Math.min(86, nextPct)));
    };
    const onUp = () => setIsResizingSplit(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizingSplit, isGridCollapsed]);

  const formatChatTime = (iso: string) => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const onApply = () => {
    if (!latest?.can_apply_filters || !latest.apply_filters) return;
    const incoming = latest.apply_filters;
    const hasEntries = Object.values(incoming).some((items) => (items ?? []).length > 0);
    if (!hasEntries) return;
    setFilters((prev) => {
      const next = { ...prev };
      const listKeys: Array<keyof GlobalFilters> = [
        "sku",
        "location",
        "recommendationId",
        "alertId",
        "alertType",
        "severity",
        "orderId",
        "orderType",
        "orderStatus",
        "exceptionReason",
        "shipFromNodeId",
        "shipToNodeId",
        "parameterCode",
        "parameterIssueType",
        "sourceMode",
        "nodeType",
      ];
      const scalarKeys: Array<keyof GlobalFilters> = ["runId", "region", "category", "supplier", "exceptionStatus"];
      for (const key of listKeys) {
        if (incoming[key]) {
          next[key] = normalizedFilterList(incoming[key]) as never;
        }
      }
      for (const key of scalarKeys) {
        if (incoming[key]?.length) {
          next[key] = String(incoming[key][0] ?? "") as never;
        }
      }
      return next;
    });
    const appliedCount = Object.keys(incoming).filter((key) => (incoming[key] ?? []).length > 0).length;
    setApplyMessage(`Applied ${appliedCount} filter field(s) from assistant result.`);
    onClose();
  };
  const resetChat = () => {
    setConversationId(null);
    setInput("");
    setLines([]);
    setLatest(null);
    setApplyMessage("");
    setPromptModalOpen(false);
    setFeedbackByLine({});
    setFeedbackStatusByLine({});
    setBranchCursor(null);
    setShowSqlText(false);
  };

  const startBranchFromLine = (lineId: string) => {
    const targetLine = lines.find((line) => line.id === lineId);
    if (!targetLine || targetLine.role !== "assistant" || !targetLine.conversationId || !targetLine.historyCursor) return;
    setConversationId(targetLine.conversationId);
    setBranchCursor(targetLine.historyCursor);
    setApplyMessage("Branch mode enabled from selected response. New prompts continue from that point.");
  };

  const setFeedback = (lineId: string, value: "up" | "down") => {
    setFeedbackByLine((prev) => ({ ...prev, [lineId]: value }));
    const targetLine = lines.find((line) => line.id === lineId);
    if (!targetLine || targetLine.role !== "assistant" || !targetLine.conversationId) {
      setFeedbackStatusByLine((prev) => ({
        ...prev,
        [lineId]: { status: "error", message: "Feedback could not be saved for this message." },
      }));
      return;
    }
    setFeedbackStatusByLine((prev) => ({
      ...prev,
      [lineId]: { status: "saving", message: "Saving feedback..." },
    }));
    feedbackMutation.mutate({
      lineId,
      payload: {
        conversation_id: targetLine.conversationId,
        vote: value,
        answer_text: targetLine.text,
        generated_sql: targetLine.generatedSql ?? null,
        user_message: targetLine.userMessage ?? null,
      },
    });
  };

  const feedbackMutation = useMutation({
    mutationFn: async (args: {
      lineId: string;
      payload: {
        conversation_id: string;
        vote: "up" | "down";
        answer_text: string;
        generated_sql?: string | null;
        user_message?: string | null;
      };
    }) => {
      await chatbotFeedback(args.payload);
      return args.lineId;
    },
    onSuccess: (lineId) => {
      setFeedbackStatusByLine((prev) => ({
        ...prev,
        [lineId]: { status: "saved", message: "Thanks for your feedback." },
      }));
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Failed to save feedback.";
      setFeedbackStatusByLine((prev) => ({
        ...prev,
        [variables.lineId]: { status: "error", message },
      }));
    },
  });

  const gridColumns = useMemo<GridColDef[]>(() => {
    const names = latest?.table?.columns ?? [];
    return names.map((name) => ({
      field: name,
      headerName: name,
      minWidth: 140,
      flex: 1,
      valueGetter: (_value, row) => row[name],
    }));
  }, [latest?.table?.columns]);

  const gridRows = useMemo(() => {
    const rows = latest?.table?.rows ?? [];
    return rows.slice(0, MAX_LIST_PREVIEW_ROWS).map((row, index) => ({ id: `${index}_${JSON.stringify(row)}`, ...row }));
  }, [latest?.table?.rows]);

  const allResultColumns = useMemo(() => latest?.table?.columns ?? [], [latest?.table?.columns]);
  const numericResultColumns = useMemo(() => {
    const rows = latest?.table?.rows ?? [];
    const columns = latest?.table?.columns ?? [];
    return columns.filter((col) => rows.some((row) => {
      const value = row[col];
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value === "string" && value.trim()) return Number.isFinite(Number(value));
      return false;
    }));
  }, [latest?.table?.rows, latest?.table?.columns]);

  useEffect(() => {
    if (!allResultColumns.length) {
      setChartDimensionX("");
      setChartDimensionY("");
      setChartMeasures([]);
      setShowChartRequested(false);
      return;
    }
    setChartDimensionX((prev) => prev || allResultColumns[0] || "");
    setChartDimensionY((prev) => prev || allResultColumns[1] || allResultColumns[0] || "");
    setChartMeasures((prev) => {
      const valid = prev.filter((item) => numericResultColumns.includes(item));
      if (valid.length) return valid;
      return numericResultColumns.slice(0, 2);
    });
    setShowChartRequested(false);
  }, [allResultColumns, numericResultColumns]);

  const aggregatedChartData = useMemo(() => {
    const rows = latest?.table?.rows ?? [];
    const measures = chartMeasures.filter((m) => numericResultColumns.includes(m));
    if (!rows.length || !chartDimensionX || !measures.length) return [] as Array<Record<string, number | string>>;
    const group = new Map<string, Record<string, number | string>>();
    rows.forEach((row) => {
      const rawKey = row[chartDimensionX];
      const label = String(rawKey ?? "Unknown");
      const key = label.trim() || "Unknown";
      let target = group.get(key);
      if (!target) {
        target = { dimension: key };
        measures.forEach((m) => { target![m] = 0; });
        group.set(key, target);
      }
      measures.forEach((m) => {
        const raw = row[m];
        const value = typeof raw === "number" ? raw : Number(raw ?? 0);
        target![m] = Number(target![m] ?? 0) + (Number.isFinite(value) ? value : 0);
      });
    });
    const items = Array.from(group.values());
    const primary = measures[0];
    items.sort((a, b) => Number(b[primary] ?? 0) - Number(a[primary] ?? 0));
    return items.slice(0, 50);
  }, [latest?.table?.rows, chartMeasures, chartDimensionX, numericResultColumns]);

  const pieChartData = useMemo(() => {
    if (!aggregatedChartData.length || !chartMeasures.length) return [] as Array<{ name: string; value: number }>;
    const primary = chartMeasures[0];
    const top = aggregatedChartData.slice(0, 10).map((item) => ({
      name: String(item.dimension ?? "Unknown"),
      value: Number(item[primary] ?? 0),
    }));
    const others = aggregatedChartData.slice(10).reduce((acc, item) => acc + Number(item[primary] ?? 0), 0);
    if (others > 0) {
      top.push({ name: "Others", value: others });
    }
    return top;
  }, [aggregatedChartData, chartMeasures]);

  const canRenderChart = useMemo(() => {
    if (!latest?.table?.rows?.length || !numericResultColumns.length) return false;
    if (!chartDimensionX || !chartMeasures.length) return false;
    if (chartType === "heatmap" && !chartDimensionY) return false;
    return true;
  }, [latest?.table?.rows, numericResultColumns.length, chartDimensionX, chartMeasures.length, chartType, chartDimensionY]);

  const heatmapModel = useMemo(() => {
    const rows = latest?.table?.rows ?? [];
    const measure = chartMeasures.find((m) => numericResultColumns.includes(m)) ?? "";
    const xField = chartDimensionX;
    const yField = chartDimensionY || chartDimensionX;
    if (!rows.length || !measure || !xField || !yField) {
      return { x: [] as string[], y: [] as string[], cells: [] as Array<{ x: string; y: string; value: number }>, max: 0 };
    }
    const matrix = new Map<string, number>();
    const xSet = new Set<string>();
    const ySet = new Set<string>();
    rows.forEach((row) => {
      const x = String(row[xField] ?? "Unknown").trim() || "Unknown";
      const y = String(row[yField] ?? "Unknown").trim() || "Unknown";
      const raw = row[measure];
      const value = typeof raw === "number" ? raw : Number(raw ?? 0);
      const safe = Number.isFinite(value) ? value : 0;
      xSet.add(x);
      ySet.add(y);
      const key = `${x}__${y}`;
      matrix.set(key, (matrix.get(key) ?? 0) + safe);
    });
    const x = Array.from(xSet).slice(0, 16);
    const y = Array.from(ySet).slice(0, 16);
    const cells = x.flatMap((xItem) => y.map((yItem) => ({
      x: xItem,
      y: yItem,
      value: matrix.get(`${xItem}__${yItem}`) ?? 0,
    })));
    const max = cells.reduce((acc, cell) => Math.max(acc, cell.value), 0);
    return { x, y, cells, max };
  }, [latest?.table?.rows, chartMeasures, chartDimensionX, chartDimensionY, numericResultColumns]);

  const chartCanvasMinWidth = useMemo(() => {
    if (chartType === "pie") return 560;
    if (chartType === "heatmap") {
      return Math.max(640, 110 + (heatmapModel.x.length * 72));
    }
    return Math.max(700, aggregatedChartData.length * 72);
  }, [chartType, heatmapModel.x.length, aggregatedChartData.length]);

  const showApply = Boolean(
    latest?.can_apply_filters
    && latest.apply_filters
    && Object.values(latest.apply_filters).some((values) => (values ?? []).length > 0),
  );
  const assistantOrderByLineId = useMemo(() => {
    const map: Record<string, number> = {};
    let order = 0;
    lines.forEach((line) => {
      if (line.role === "assistant") {
        order += 1;
        map[line.id] = order;
      }
    });
    return map;
  }, [lines]);
  const branchOriginLine = useMemo(
    () => lines.find((line) => line.role === "assistant" && line.historyCursor === branchCursor) ?? null,
    [lines, branchCursor],
  );
  const branchOriginLabel = useMemo(() => {
    if (!branchOriginLine) return "";
    const order = assistantOrderByLineId[branchOriginLine.id];
    return order ? `Branched from response #${order}` : "Branched from selected response";
  }, [assistantOrderByLineId, branchOriginLine]);
  const missingKey = !openAiApiKey.trim();
  const thinking = submitMutation.isPending;
  const promptPreview = latest?.diagnostics?.prompt_used
    ?? "Prompt preview will be available after you run the first MEIO Data Assistant query.";
  const structuredPrompt = useMemo<PromptSection[]>(() => {
    const raw = (promptPreview || "").trim();
    if (!raw) return [];
    const normalized = raw
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\. (?=[A-Z])/g, ".\n");
    const headerPattern = /(Scope:|LATENCY MODE \(MANDATORY\):|Date comparison guidance:|Arithmetic and function guidance:|For grouped "who has the most\/least\/lowest\/bottom" questions:)/gi;
    const matches = [...normalized.matchAll(headerPattern)];
    if (!matches.length) {
      const lines = normalized
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return [{ title: "Prompt", lines }];
    }
    const sections: PromptSection[] = [];
    for (let index = 0; index < matches.length; index += 1) {
      const current = matches[index];
      const next = matches[index + 1];
      const start = current.index ?? 0;
      const end = next?.index ?? normalized.length;
      const block = normalized.slice(start, end).trim();
      const firstBreak = block.indexOf("\n");
      const title = (firstBreak >= 0 ? block.slice(0, firstBreak) : block).trim();
      const body = (firstBreak >= 0 ? block.slice(firstBreak + 1) : "").trim();
      const lines = body
        .split("\n")
        .map((line) => line.replace(/^\s*-\s*/, "").trim())
        .filter(Boolean);
      sections.push({ title, lines: lines.length ? lines : ["(No details)"] });
    }
    return sections;
  }, [promptPreview]);
  const confidenceScore = latest?.diagnostics?.confidence_score;
  const reasoningSummary = latest?.diagnostics?.reasoning_summary;
  const chartPalette = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#7c3aed", "#0891b2"];
  const renderDynamicChart = () => {
    if (!latest?.table?.rows?.length) {
      return <Typography variant="body2" color="text.secondary">Run a query to generate chart data.</Typography>;
    }
    if (!numericResultColumns.length) {
      return <Typography variant="body2" color="text.secondary">No numeric fields found in current result to chart.</Typography>;
    }
    if (!chartDimensionX || !chartMeasures.length) {
      return <Typography variant="body2" color="text.secondary">Select at least one dimension and one measure field.</Typography>;
    }

    if (chartType === "pie") {
      return (
        <Box sx={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "hidden" }}>
          <Box sx={{ minWidth: chartCanvasMinWidth, height: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieChartData} dataKey="value" nameKey="name" outerRadius={110} label>
                  {pieChartData.map((entry, index) => (
                    <Cell key={`${entry.name}_${index}`} fill={chartPalette[index % chartPalette.length]} />
                  ))}
                </Pie>
                <Legend />
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      );
    }

    if (chartType === "heatmap") {
      const { x, y, cells, max } = heatmapModel;
      if (!x.length || !y.length) {
        return <Typography variant="body2" color="text.secondary">Heatmap needs two dimensions and one numeric measure.</Typography>;
      }
      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, overflowX: "auto", overflowY: "auto", height: "100%", maxWidth: "100%" }}>
          <Typography variant="caption" color="text.secondary">
            Heatmap intensity = {chartMeasures[0]} (higher is darker)
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: `110px repeat(${x.length}, 72px)`,
              gap: 0.5,
              width: "max-content",
              minWidth: "100%",
            }}
          >
            <Box />
            {x.map((xLabel) => (
              <Typography
                key={`hx_${xLabel}`}
                variant="caption"
                sx={{ fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                title={xLabel}
              >
                {xLabel}
              </Typography>
            ))}
            {y.map((yLabel) => (
              <Box key={`hy_${yLabel}`} sx={{ display: "contents" }}>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, alignSelf: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={yLabel}
                >
                  {yLabel}
                </Typography>
                {x.map((xLabel) => {
                  const cell = cells.find((item) => item.x === xLabel && item.y === yLabel);
                  const value = cell?.value ?? 0;
                  const alpha = max > 0 ? Math.max(0.08, value / max) : 0.08;
                  return (
                    <Box
                      key={`${xLabel}_${yLabel}`}
                      title={`${xLabel} | ${yLabel}: ${Math.round(value * 100) / 100}`}
                      sx={{
                        height: 28,
                        borderRadius: 0.8,
                        bgcolor: `rgba(37, 99, 235, ${alpha})`,
                        border: "1px solid rgba(148, 163, 184, 0.35)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10.5,
                        color: alpha > 0.5 ? "#ffffff" : "#0f172a",
                      }}
                    >
                      {Math.round(value * 10) / 10}
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Box>
      );
    }

    if (!aggregatedChartData.length) {
      return <Typography variant="body2" color="text.secondary">No aggregated chart data available.</Typography>;
    }

    const measures = chartMeasures.filter((m) => numericResultColumns.includes(m));
    if (chartType === "line") {
      return (
        <Box sx={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "hidden" }}>
          <Box sx={{ minWidth: chartCanvasMinWidth, height: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={aggregatedChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dimension" />
                <YAxis />
                <RechartsTooltip />
                <Legend />
                {measures.map((m, idx) => <Line key={m} type="monotone" dataKey={m} stroke={chartPalette[idx % chartPalette.length]} dot={false} />)}
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      );
    }
    if (chartType === "bar") {
      return (
        <Box sx={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "hidden" }}>
          <Box sx={{ minWidth: chartCanvasMinWidth, height: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aggregatedChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dimension" />
                <YAxis />
                <RechartsTooltip />
                <Legend />
                {measures.map((m, idx) => <Bar key={m} dataKey={m} fill={chartPalette[idx % chartPalette.length]} />)}
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      );
    }
    if (chartType === "stackedBar") {
      return (
        <Box sx={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "hidden" }}>
          <Box sx={{ minWidth: chartCanvasMinWidth, height: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aggregatedChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dimension" />
                <YAxis />
                <RechartsTooltip />
                <Legend />
                {measures.map((m, idx) => <Bar key={m} dataKey={m} stackId="stack" fill={chartPalette[idx % chartPalette.length]} />)}
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      );
    }
    if (chartType === "lineBar") {
      const lineField = measures[0];
      const barFields = measures.slice(1).length ? measures.slice(1) : [measures[0]];
      return (
        <Box sx={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "hidden" }}>
          <Box sx={{ minWidth: chartCanvasMinWidth, height: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={aggregatedChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dimension" />
                <YAxis />
                <RechartsTooltip />
                <Legend />
                {barFields.map((m, idx) => <Bar key={m} dataKey={m} fill={chartPalette[idx % chartPalette.length]} />)}
                <Line type="monotone" dataKey={lineField} stroke={chartPalette[4]} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      );
    }
    const lineField = measures[0];
    const stackFields = measures.slice(1).length ? measures.slice(1) : [measures[0]];
    return (
      <Box sx={{ width: "100%", height: "100%", overflowX: "auto", overflowY: "hidden" }}>
        <Box sx={{ minWidth: chartCanvasMinWidth, height: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={aggregatedChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dimension" />
              <YAxis />
              <RechartsTooltip />
              <Legend />
              {stackFields.map((m, idx) => <Bar key={m} dataKey={m} stackId="stack" fill={chartPalette[idx % chartPalette.length]} />)}
              <Line type="monotone" dataKey={lineField} stroke={chartPalette[5]} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      </Box>
    );
  };

  const header = (
    <DialogTitle sx={{ px: 2, py: 1.6, bgcolor: "rgba(238, 246, 255, 0.9)", borderBottom: "1px solid #d8e8ff" }}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center">
          <AutoAwesomeOutlinedIcon fontSize="small" color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 700, color: "#1f3f74" }}>{title}</Typography>
        </Stack>
        <Chip
          size="small"
          variant="outlined"
          label={`Model: ${config.llmModel}`}
          sx={{
            bgcolor: "rgba(255,255,255,0.84)",
            borderColor: "#c9dcff",
            color: "#1f3f74",
            fontWeight: 600,
          }}
        />
      </Stack>
    </DialogTitle>
  );

  const mainContent = (
    <DialogContent
      dividers
      sx={{
        p: 0,
        minHeight: 0,
        height: "100%",
        flex: 1,
        display: "flex",
        overflowX: embedded ? "hidden" : "hidden",
        overflowY: embedded ? "visible" : "hidden",
        bgcolor: "#f6faff",
      }}
    >
        <Box
          ref={splitContainerRef}
          sx={{
            display: "flex",
            width: "100%",
            minHeight: 0,
            height: "100%",
            flex: 1,
            overflowX: embedded ? "hidden" : "hidden",
            overflowY: embedded ? "visible" : "hidden",
            position: "relative",
          }}
        >
        <Box
          sx={{
            width: isGridCollapsed ? "100%" : { xs: "100%", md: `${chatPaneWidthPct}%` },
            borderRight: isGridCollapsed ? "none" : "1px solid #d8e8ff",
            p: 1.4,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            height: "100%",
            bgcolor: "rgba(255,255,255,0.75)",
          }}
        >
          {missingKey ? <Alert severity="warning">Bot is not available due to missing API key.</Alert> : null}
          <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", mt: 1, pb: 1 }}>
            {lines.map((line) => (
              <Stack
                key={line.id}
                direction={line.role === "user" ? "row-reverse" : "row"}
                spacing={0.9}
                alignItems="flex-end"
                sx={{
                  alignSelf: line.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "95%",
                  "@keyframes bubbleIn": {
                    from: { opacity: 0, transform: "translateY(6px)" },
                    to: { opacity: 1, transform: "translateY(0)" },
                  },
                  animation: "bubbleIn 220ms ease",
                }}
              >
                <Avatar
                  sx={{
                    width: 30,
                    height: 30,
                    bgcolor: line.role === "user" ? "#d6e7ff" : line.role === "system" ? "#ffe6c3" : "#d9f2ff",
                    color: line.role === "user" ? "#204f8f" : line.role === "system" ? "#9a5b00" : "#0f5778",
                  }}
                >
                  {line.role === "user" ? <PersonOutlineOutlinedIcon fontSize="small" /> : <SmartToyOutlinedIcon fontSize="small" />}
                </Avatar>
                <Box
                  sx={{
                    px: 1.3,
                    py: 1,
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: line.role === "user" ? "#b8d5ff" : line.role === "system" ? "#ffd49c" : "#c6e8ff",
                    bgcolor: line.role === "user" ? "#e8f2ff" : line.role === "system" ? "#fff2de" : "#f1faff",
                  }}
                >
                  {line.role === "assistant" ? (
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.45 }}>
                      <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 700, color: "#1e4f86" }}>
                        Assistant
                      </Typography>
                      {assistantOrderByLineId[line.id] ? (
                        <Chip
                          size="small"
                          label={`#${assistantOrderByLineId[line.id]}`}
                          sx={{ height: 18, "& .MuiChip-label": { px: 0.7, fontSize: 10.5, fontWeight: 700 } }}
                        />
                      ) : null}
                    </Stack>
                  ) : null}
                  <Typography variant="body2" sx={{ fontSize: 14.5, lineHeight: 1.45 }}>{line.text}</Typography>
                  {line.role === "assistant" && (line.previewRows?.length ?? 0) > 0 ? (
                    <Box
                      sx={{
                        mt: 0.8,
                        p: 0.8,
                        borderRadius: 1.5,
                        border: "1px solid #c8defd",
                        bgcolor: "#fbfdff",
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.6 }}>
                        <Typography variant="caption" sx={{ fontSize: 11.5, fontWeight: 700, color: "#28548f" }}>
                          Sample Output
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                          Showing {(line.previewRows ?? []).length} of {line.totalRows ?? (line.previewRows ?? []).length} rows
                        </Typography>
                      </Stack>
                      {(() => {
                        const rows = (line.previewRows ?? []).slice(0, 5);
                        const columns = line.previewColumns ?? [];
                        const isNumericColumn = (col: string) =>
                          rows.some((row) => {
                            const value = row[col];
                            return typeof value === "number" || (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)));
                          });
                        const idPriority = ["alert_id", "recommendation_id", "order_id", "sku", "location", "node_id", "severity"];
                        const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
                        const idCols = idPriority
                          .map((candidate) => columns.find((col) => normalized(col) === normalized(candidate)))
                          .filter((col): col is string => Boolean(col));
                        const numericCols = columns.filter((col) => isNumericColumn(col));
                        const selectedCols = Array.from(new Set([...idCols, ...numericCols, ...columns])).slice(0, 5);
                        const sumTargets = numericCols.filter((col) =>
                          ["cost", "qty", "quantity", "count", "total", "amount"].some((token) => col.toLowerCase().includes(token)),
                        ).slice(0, 3);
                        const sums = sumTargets.map((col) => {
                          const total = rows.reduce((acc, row) => {
                            const raw = row[col];
                            const num = typeof raw === "number" ? raw : Number(raw ?? 0);
                            return acc + (Number.isFinite(num) ? num : 0);
                          }, 0);
                          return { col, total };
                        });
                        return (
                          <Stack spacing={0.55}>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap">
                              <Chip size="small" label={`Rows: ${line.totalRows ?? rows.length}`} sx={{ bgcolor: "#edf4ff" }} />
                              {sums.map((item) => (
                                <Chip
                                  key={`${line.id}_sum_${item.col}`}
                                  size="small"
                                  label={`SUM(${item.col}) = ${Math.round(item.total * 100) / 100}`}
                                  sx={{ bgcolor: "#effaf2" }}
                                />
                              ))}
                            </Stack>
                            <Box sx={{ border: "1px solid #d8e6fb", borderRadius: 1, overflow: "hidden" }}>
                              <Box
                                sx={{
                                  display: "grid",
                                  gridTemplateColumns: `repeat(${Math.max(1, selectedCols.length)}, minmax(80px, 1fr))`,
                                  bgcolor: "#eaf3ff",
                                  px: 0.6,
                                  py: 0.45,
                                  gap: 0.5,
                                }}
                              >
                                {selectedCols.map((col) => (
                                  <Typography key={`${line.id}_head_${col}`} variant="caption" sx={{ fontWeight: 700, fontSize: 10.7 }}>
                                    {col}
                                  </Typography>
                                ))}
                              </Box>
                              {rows.map((row, rowIdx) => (
                                <Box
                                  key={`${line.id}_row_${rowIdx}`}
                                  sx={{
                                    display: "grid",
                                    gridTemplateColumns: `repeat(${Math.max(1, selectedCols.length)}, minmax(80px, 1fr))`,
                                    px: 0.6,
                                    py: 0.35,
                                    gap: 0.5,
                                    borderTop: rowIdx === 0 ? "none" : "1px solid #edf3ff",
                                    bgcolor: rowIdx % 2 ? "#ffffff" : "#f8fbff",
                                  }}
                                >
                                  {selectedCols.map((col) => (
                                    <Typography key={`${line.id}_${rowIdx}_${col}`} variant="caption" sx={{ fontSize: 10.5 }}>
                                      {String(row[col] ?? "—")}
                                    </Typography>
                                  ))}
                                </Box>
                              ))}
                            </Box>
                          </Stack>
                        );
                      })()}
                    </Box>
                  ) : null}
                  {line.role === "assistant" && (line.followUpQuestions?.length ?? 0) > 0 ? (
                    <Box
                      sx={{
                        mt: 0.7,
                        p: 0.7,
                        borderRadius: 1.2,
                        border: "1px dashed #c7dfff",
                        bgcolor: "rgba(255,255,255,0.72)",
                      }}
                    >
                      <Typography variant="caption" sx={{ display: "block", mb: 0.45, fontWeight: 700, color: "#275286", fontSize: 11.4 }}>
                        Suggested next questions
                      </Typography>
                      <Stack spacing={0.35}>
                        {(line.followUpQuestions ?? []).map((question, idx) => (
                          <Button
                            key={`${line.id}_fu_${question}`}
                            size="small"
                            variant="text"
                            sx={{ justifyContent: "flex-start", textAlign: "left", px: 0.4, py: 0.1, fontSize: 11.5 }}
                            onClick={() => send(question)}
                          >
                            {idx + 1}. {question}
                          </Button>
                        ))}
                      </Stack>
                    </Box>
                  ) : null}
                  {line.role === "assistant" ? (
                    <Stack direction="column" spacing={0.2} sx={{ mt: 0.4 }}>
                      <Stack direction="row" spacing={0.2} alignItems="center">
                        <Button
                          size="small"
                          variant={branchCursor === line.historyCursor ? "contained" : "text"}
                          onClick={() => startBranchFromLine(line.id)}
                          sx={{ textTransform: "none", minWidth: 0, px: 0.6, py: 0.1, fontSize: 11.2 }}
                        >
                          {branchCursor === line.historyCursor
                            ? `Branch origin #${assistantOrderByLineId[line.id] ?? ""}`.trim()
                            : `Start here${assistantOrderByLineId[line.id] ? ` (#${assistantOrderByLineId[line.id]})` : ""}`}
                        </Button>
                        <IconButton
                          size="small"
                          onClick={() => setFeedback(line.id, "up")}
                          sx={{ p: 0.5 }}
                          aria-label="Thumbs up feedback"
                        >
                          {feedbackByLine[line.id] === "up"
                            ? <ThumbUpAltIcon fontSize="inherit" color="primary" />
                            : <ThumbUpOffAltOutlinedIcon fontSize="inherit" />}
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setFeedback(line.id, "down")}
                          sx={{ p: 0.5 }}
                          aria-label="Thumbs down feedback"
                        >
                          {feedbackByLine[line.id] === "down"
                            ? <ThumbDownAltIcon fontSize="inherit" color="error" />
                            : <ThumbDownOffAltOutlinedIcon fontSize="inherit" />}
                        </IconButton>
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.3 }}>
                          Helpful?
                        </Typography>
                      </Stack>
                      {feedbackStatusByLine[line.id] ? (
                        <Typography
                          variant="caption"
                          sx={{
                            fontSize: 11.5,
                            color: feedbackStatusByLine[line.id].status === "error" ? "error.main" : "text.secondary",
                          }}
                        >
                          {feedbackStatusByLine[line.id].message}
                        </Typography>
                      ) : null}
                    </Stack>
                  ) : null}
                  <Typography
                    variant="caption"
                    sx={{
                      mt: 0.4,
                      display: "block",
                      color: "text.secondary",
                      textAlign: line.role === "user" ? "right" : "left",
                      fontSize: 11.5,
                    }}
                  >
                    {formatChatTime(line.createdAt)}
                  </Typography>
                </Box>
              </Stack>
            ))}
            {thinking ? (
              <Stack
                direction="row"
                spacing={0.9}
                alignItems="center"
                sx={{
                  alignSelf: "flex-start",
                  maxWidth: "80%",
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
                <Box sx={{ px: 1.3, py: 1, borderRadius: 2, border: "1px solid #c6e8ff", bgcolor: "#f1faff" }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ fontSize: 14.5 }}>Thinking...</Typography>
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
            <Box ref={endOfMessagesRef} />
          </Stack>
          <Box
            sx={{
              position: "sticky",
              bottom: 0,
              pt: 1,
              mt: 0.6,
              bgcolor: "rgba(255,255,255,0.94)",
              borderTop: "1px solid #d8e8ff",
            }}
          >
            <Stack direction="row" spacing={0.8}>
              <TextField
                fullWidth
                value={input}
                placeholder="Ask about orders, inventory, exceptions..."
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send(input);
                    setInput("");
                  }
                }}
                disabled={submitMutation.isPending || missingKey}
                sx={{
                  "& .MuiInputBase-root": {
                    bgcolor: "#ffffff",
                    fontSize: 15,
                  },
                }}
              />
              <Button
                variant="contained"
                startIcon={<SendOutlinedIcon />}
                onClick={() => {
                  send(input);
                  setInput("");
                }}
                disabled={submitMutation.isPending || !input.trim() || missingKey}
                sx={{ px: 2.2, fontWeight: 600, fontSize: 14 }}
              >
                Send
              </Button>
            </Stack>
          </Box>
        </Box>
        {!isGridCollapsed ? (
          <Box
            role="separator"
            aria-orientation="vertical"
            onMouseDown={() => setIsResizingSplit(true)}
            sx={{
              width: 10,
              cursor: "col-resize",
              display: { xs: "none", md: "flex" },
              alignItems: "center",
              justifyContent: "center",
              borderLeft: "1px solid #d8e8ff",
              borderRight: "1px solid #d8e8ff",
              bgcolor: isResizingSplit ? "rgba(208,228,255,0.7)" : "rgba(244,249,255,0.96)",
              color: "#5a7fb6",
              userSelect: "none",
              flexShrink: 0,
            }}
          >
            <DragIndicatorOutlinedIcon fontSize="small" />
          </Box>
        ) : null}
        {!isGridCollapsed ? (
        <Box sx={{ flex: 1, p: 1.4, minWidth: 0, display: "flex", flexDirection: "column", gap: 1, minHeight: 0, bgcolor: "rgba(255,255,255,0.58)", overflowX: "hidden" }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: "#1f3f74" }}>Result Grid</Typography>
            <Stack direction="row" spacing={0.8} alignItems="center" useFlexGap sx={{ flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={resetChat}
              >
                Reset Chat
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  setChatPaneWidthPct(42);
                  setIsGridCollapsed(false);
                }}
              >
                Reset Layout
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ChevronRightOutlinedIcon />}
                onClick={() => setIsGridCollapsed(true)}
              >
                Collapse
              </Button>
              <Button variant="outlined" onClick={() => setPromptModalOpen(true)}>Show Prompt</Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => setShowSqlText((prev) => !prev)}
              >
                {showSqlText ? "Hide SQL" : "Show SQL"}
              </Button>
              {branchCursor !== null ? (
                <Button variant="outlined" size="small" onClick={() => setBranchCursor(null)}>
                  Exit Branch
                </Button>
              ) : null}
              {showApplyToGlobalFilter && showApply ? <Button variant="contained" onClick={onApply}>Apply to Global Filter</Button> : null}
            </Stack>
          </Stack>
          {branchCursor !== null ? (
            <Stack direction="row" spacing={0.8} alignItems="center">
              <Chip size="small" color="primary" variant="outlined" label="Branch mode active" />
              {branchOriginLabel ? <Chip size="small" variant="outlined" label={branchOriginLabel} /> : null}
            </Stack>
          ) : null}
          {applyMessage ? <Alert severity="success">{applyMessage}</Alert> : null}
          {latest?.diagnostics?.warnings?.length ? (
            <Alert severity="info">{latest.diagnostics.warnings[0]}</Alert>
          ) : null}
          {reasoningSummary ? (
            <Alert
              severity="success"
              sx={{
                bgcolor: "#edf7ff",
                border: "1px solid #c9e2ff",
                "& .MuiAlert-message": { width: "100%" },
              }}
            >
              <Stack spacing={0.4}>
                <Typography variant="body2" sx={{ fontWeight: 700, color: "#184f86", fontSize: 13.5 }}>
                  Confidence: {confidenceScore != null ? `${Math.round(confidenceScore * 100)}%` : "N/A"}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: 13.5 }}>
                  Reasoning: {reasoningSummary}
                </Typography>
              </Stack>
            </Alert>
          ) : null}
          {showSqlText ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 14, overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {latest?.diagnostics?.generated_sql ? `SQL: ${latest.diagnostics.generated_sql}` : "Run a query to view tabular output."}
            </Typography>
          ) : null}
          {(latest?.diagnostics?.row_count ?? 0) > MAX_LIST_PREVIEW_ROWS ? (
            <Alert severity="info">
              Showing first {MAX_LIST_PREVIEW_ROWS} records in grid preview (total rows: {latest?.diagnostics?.row_count}).
            </Alert>
          ) : null}
          {enableCharts ? (
            <Box
              sx={{
                flex: 1,
                minHeight: 320,
                display: "grid",
                gridTemplateRows: { xs: "300px minmax(280px, 1fr)", md: "340px minmax(280px, 1fr)" },
                gap: 1,
                minWidth: 0,
                maxWidth: "100%",
                overflowX: "hidden",
              }}
            >
              <Box sx={{ border: "1px solid #d6e7ff", borderRadius: 1.5, p: 1, bgcolor: "#fbfdff", minHeight: 0, maxWidth: "100%", overflow: "hidden" }}>
                <Stack spacing={0.8} sx={{ height: "100%" }}>
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                      gap: 0.8,
                      width: "100%",
                      minWidth: 0,
                    }}
                  >
                    <FormControl size="small" sx={{ minWidth: 0, width: "100%" }}>
                      <InputLabel>Chart Type</InputLabel>
                      <Select
                        label="Chart Type"
                        value={chartType}
                        onChange={(event) => {
                          setChartType(event.target.value as ChartType);
                          setShowChartRequested(false);
                        }}
                      >
                        <MenuItem value="line">Line</MenuItem>
                        <MenuItem value="bar">Bar</MenuItem>
                        <MenuItem value="stackedBar">Stacked Bar</MenuItem>
                        <MenuItem value="lineBar">Line + Bar</MenuItem>
                        <MenuItem value="lineStackedBar">Line + Stacked Bar</MenuItem>
                        <MenuItem value="pie">Pie</MenuItem>
                        <MenuItem value="heatmap">Heatmap</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 0, width: "100%" }}>
                      <InputLabel>X Dimension</InputLabel>
                      <Select
                        label="X Dimension"
                        value={chartDimensionX}
                        onChange={(event) => {
                          setChartDimensionX(event.target.value);
                          setShowChartRequested(false);
                        }}
                      >
                        {allResultColumns.map((col) => <MenuItem key={`x_${col}`} value={col}>{col}</MenuItem>)}
                      </Select>
                    </FormControl>
                    {chartType === "heatmap" ? (
                      <FormControl size="small" sx={{ minWidth: 0, width: "100%" }}>
                        <InputLabel>Y Dimension</InputLabel>
                        <Select
                          label="Y Dimension"
                          value={chartDimensionY}
                          onChange={(event) => {
                            setChartDimensionY(event.target.value);
                            setShowChartRequested(false);
                          }}
                        >
                          {allResultColumns.map((col) => <MenuItem key={`y_${col}`} value={col}>{col}</MenuItem>)}
                        </Select>
                      </FormControl>
                    ) : null}
                    <FormControl size="small" sx={{ minWidth: 0, width: "100%" }}>
                      <InputLabel>Y Axis (Measures)</InputLabel>
                      <Select
                        multiple
                        label="Y Axis (Measures)"
                        value={chartMeasures}
                        onChange={(event) => {
                          const value = event.target.value;
                          setChartMeasures(typeof value === "string" ? value.split(",") : value);
                          setShowChartRequested(false);
                        }}
                        renderValue={(selected) => {
                          const items = selected as string[];
                          if (!items.length) return "";
                          if (items.length === 1) return items[0];
                          if (items.length === 2) return `${items[0]}, ${items[1]}`;
                          return `${items.length} measures selected`;
                        }}
                      >
                        {numericResultColumns.map((col) => <MenuItem key={`m_${col}`} value={col}>{col}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Box>
                  <Stack direction="row" spacing={0.8} alignItems="center">
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => setShowChartRequested(true)}
                      disabled={!canRenderChart}
                    >
                      Show Chart
                    </Button>
                    {!showChartRequested ? (
                      <Typography variant="caption" color="text.secondary">
                        Select chart type, X axis, Y axis (measures), then click Show Chart.
                      </Typography>
                    ) : null}
                  </Stack>
                  <Box sx={{ flex: 1, minHeight: 0, width: "100%", maxWidth: "100%", overflowX: "auto", overflowY: "hidden" }}>
                    {showChartRequested ? renderDynamicChart() : (
                      <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Typography variant="body2" color="text.secondary">
                          Chart preview will appear here after clicking Show Chart.
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Stack>
              </Box>
              <Box sx={{ minHeight: 0, width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "auto", overflowY: "hidden" }}>
                <SmartDataGrid
                  rows={gridRows}
                  columns={gridColumns}
                  disableRowSelectionOnClick
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                  sx={{
                    border: 0,
                    width: "100%",
                    maxWidth: "100%",
                    "& .MuiDataGrid-main": { overflow: "auto" },
                    "& .MuiDataGrid-virtualScroller": { overflowX: "auto" },
                  }}
                />
              </Box>
            </Box>
          ) : (
            <Box sx={{ flex: 1, minHeight: 260 }}>
              <SmartDataGrid
                rows={gridRows}
                columns={gridColumns}
                disableRowSelectionOnClick
                pageSizeOptions={[10, 25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                sx={{ border: 0 }}
              />
            </Box>
          )}
        </Box>
        ) : (
          <IconButton
            size="small"
            onClick={() => setIsGridCollapsed(false)}
            sx={{
              position: "absolute",
              right: 10,
              top: 10,
              border: "1px solid #cfe2ff",
              bgcolor: "rgba(255,255,255,0.95)",
              color: "#2f5c95",
              zIndex: 6,
            }}
          >
            <ChevronLeftOutlinedIcon fontSize="small" />
          </IconButton>
        )}
        </Box>
    </DialogContent>
  );

  const promptDialog = (
    <Dialog
      open={promptModalOpen}
      onClose={() => setPromptModalOpen(false)}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle>{title} Prompt</DialogTitle>
      <DialogContent dividers sx={{ bgcolor: "#f7fbff", maxHeight: "78vh" }}>
        <Stack spacing={1}>
          {structuredPrompt.map((section) => (
            <Box
              key={section.title}
              sx={{
                border: "1px solid #d9e8ff",
                borderRadius: 1.5,
                bgcolor: "#ffffff",
                px: 1.2,
                py: 1,
              }}
            >
              <Typography variant="subtitle2" sx={{ color: "#1f3f74", fontWeight: 700, mb: 0.5 }}>
                {section.title}
              </Typography>
              <Stack spacing={0.4}>
                {section.lines.map((line, idx) => (
                  <Typography key={`${section.title}_${idx}`} variant="body2" sx={{ fontSize: 13.5, lineHeight: 1.4 }}>
                    • {line}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ))}
          <Box sx={{ border: "1px dashed #bfd8ff", borderRadius: 1.2, p: 1, bgcolor: "#ffffff" }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.4 }}>
              Raw prompt (verbatim)
            </Typography>
            <Box
              sx={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                maxHeight: 180,
                overflow: "auto",
                color: "#334155",
              }}
            >
              {promptPreview}
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setPromptModalOpen(false)}>Close</Button>
      </DialogActions>
    </Dialog>
  );

  if (embedded) {
    return (
      <Box
        sx={{
          height: "78vh",
          minHeight: "78vh",
          maxHeight: "78vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 3,
          bgcolor: "#f6faff",
          border: "1px solid #dbe8ff",
          boxShadow: "0 14px 34px rgba(71, 116, 221, 0.16)",
          overflow: "hidden",
        }}
      >
        {header}
        {mainContent}
        {promptDialog}
      </Box>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      slotProps={{
        paper: {
          sx: {
            minHeight: "82vh",
            maxHeight: "94vh",
            height: "94vh",
            borderRadius: 3,
            bgcolor: "#f6faff",
            border: "1px solid #dbe8ff",
            boxShadow: "0 14px 34px rgba(71, 116, 221, 0.16)",
            display: "flex",
            flexDirection: "column",
          },
        },
      }}
    >
      {header}
      {mainContent}
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
      {promptDialog}
    </Dialog>
  );
}
