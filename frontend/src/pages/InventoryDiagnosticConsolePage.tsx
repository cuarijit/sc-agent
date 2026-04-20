import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { ShellContextValue } from "../components/layout/AppShellLayout";
import {
  Alert,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
  alpha,
} from "@mui/material";
import {
  AutoAwesomeOutlined as AutoIcon,
  BoltOutlined as BoltIcon,
  CheckCircle as CheckIcon,
  ChevronLeftOutlined as CollapseIcon,
  ChevronRightOutlined as ExpandIcon,
  CodeOutlined as CodeIcon,
  ContentCopy as CopyIcon,
  ErrorOutline as ErrorIcon,
  FlashOn as FlashIcon,
  Inventory2Outlined as InventoryIcon,
  InsightsOutlined as InsightsIcon,
  OfflineBolt as OfflineBoltIcon,
  PersonOutline as PersonIcon,
  PlayArrow as PlayIcon,
  PowerSettingsNewOutlined as PowerIcon,
  RestartAlt as ResetIcon,
  Send as SendIcon,
  SmartToyOutlined as BotIcon,
  Settings as SettingsIcon,
  Timeline as TimelineIcon,
  TrendingDownOutlined as TrendingDownIcon,
  WarningAmberOutlined as WarningIcon,
} from "@mui/icons-material";
import { useMutation, useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";

import {
  checkLlmHealth,
  fetchInstanceCapability,
  fetchRunSteps,
  queryDemandSensing,
  queryInventoryAllocation,
  queryInventoryDiagnostic,
  seedInventoryDiagnosticDemo,
  type CapabilitySnapshot,
  type InventoryDiagnosticResponse,
  type LlmHealthResponse,
  type RunStepArtifact,
} from "../services/api";
import { fetchAgentInstances } from "../services/agentConfigApi";
import PageHelpButton from "../components/help/PageHelpButton";
import {
  JsonPanelWithDivider,
  JsonToggleButton,
  StepDetailBody,
} from "../components/inventoryDiagnostic/PipelineStepDetail";
import InstancePickerButton from "../components/inventoryDiagnostic/InstancePickerButton";
import SolveActionSummaryCard from "../components/inventoryDiagnostic/SolveActionSummaryCard";

const INVENTORY_AGENT_TYPE = "inventory_diagnostic_agent";
const ALLOCATION_AGENT_TYPE = "inventory_allocation_agent";
const DEMAND_SENSING_AGENT_TYPE = "demand_sensing_agent";
const DEFAULT_AGENT_TYPES = [INVENTORY_AGENT_TYPE] as const;

// Dispatch by agent_type — each agent has its own /api/.../query endpoint
// wired on the backend, but all three return the same response envelope.
type QueryPayload = Parameters<typeof queryInventoryDiagnostic>[0];
function queryForAgentType(
  agentType: string | undefined,
): (payload: QueryPayload) => Promise<InventoryDiagnosticResponse> {
  if (agentType === ALLOCATION_AGENT_TYPE) return queryInventoryAllocation;
  if (agentType === DEMAND_SENSING_AGENT_TYPE) return queryDemandSensing;
  return queryInventoryDiagnostic;
}

const SAMPLE_PROMPTS = [
  "Stock out in next 6 weeks — what should I do?",
  "Show me all inventory risk next week, ranked by top contributor",
  "Demand will spike due to promotions for BAR-002. Where can I pull inventory from?",
  "What if we delay the promotion by 1 week?",
  "Diagnose the top breach: why is it happening?",
];

type Role = "user" | "agent";

type Message = {
  id: string;
  role: Role;
  content: string;
  at: string;
  response?: InventoryDiagnosticResponse;
  pending?: boolean;
  error?: string;
};

type ViewKey = "results" | "pipeline" | "audit";

/**
 * Translate the raw `detail` string returned by `ping_provider` (shapes like
 * `openai_http_401:{body}`, `openai_network_error:<python-exc>`) into a short
 * human-readable reason + remediation hint surfaced on the LLM badge.
 */
function _explainLlmError(detail: string | null | undefined): { reason: string; remediation: string } {
  const d = String(detail ?? "").toLowerCase();
  if (d.includes("http_401") || d.includes("invalid_api_key") || d.includes("incorrect api key")) {
    return {
      reason: "invalid key",
      remediation: "The API key in the app header was rejected. Open the gear icon in the top bar and paste a valid key (must start with sk-).",
    };
  }
  if (d.includes("http_403")) {
    return {
      reason: "forbidden",
      remediation: "The key is valid but your account doesn't have permission for this model. Check project access or billing.",
    };
  }
  if (d.includes("http_404") || d.includes("model_not_found") || d.includes("does not exist")) {
    return {
      reason: "model not found",
      remediation: "Your account doesn't have access to the health-check model (gpt-4.1-mini). Upgrade the plan or change the model in the template's llm_call_sites.",
    };
  }
  if (d.includes("http_429") || d.includes("rate_limit") || d.includes("insufficient_quota")) {
    return {
      reason: "rate limited / quota",
      remediation: "OpenAI returned 429. Either the request-per-minute limit or the monthly spending cap is exceeded. Wait, or increase the cap in the OpenAI billing console.",
    };
  }
  if (d.includes("http_5")) {
    return {
      reason: "provider 5xx",
      remediation: "OpenAI returned a 5xx. Their infrastructure hiccuped — retry in a minute.",
    };
  }
  if (d.includes("network_error") || d.includes("timeout") || d.includes("timed out")) {
    return {
      reason: "network / timeout",
      remediation: "The backend container couldn't reach api.openai.com. Check your firewall/proxy or egress rules. In Docker, confirm the container has DNS + outbound 443.",
    };
  }
  return {
    reason: "error",
    remediation: "Click for the raw error detail. Most common fix: verify the API key and that your account has access to gpt-4.1-mini.",
  };
}

function severityColor(sev: string | undefined): "error" | "warning" | "info" | "default" {
  if (sev === "critical") return "error";
  if (sev === "warning") return "warning";
  if (sev === "info") return "info";
  return "default";
}

function slotStatusColor(
  status: "available" | "degraded" | "missing",
): "success" | "warning" | "error" {
  return status === "available" ? "success" : status === "degraded" ? "warning" : "error";
}

function formatNumber(n: unknown): string {
  if (typeof n === "number") return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return String(n ?? "—");
}

function timeLabel(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function useShellContext(): ShellContextValue | undefined {
  // Outside an Outlet (e.g. inside a Dialog portal), useOutletContext returns
  // undefined because the OutletContext provider isn't in the tree. We
  // intentionally don't throw — callers fall back to props.
  return useOutletContext<ShellContextValue | undefined>();
}

export default function InventoryDiagnosticConsolePage({
  initialInstanceId,
  embedded = false,
  openAiApiKeyOverride,
  agentTypes,
  pageTitle,
  pageSubtitle,
}: {
  initialInstanceId?: string;
  embedded?: boolean;
  title?: string;
  /** When rendered inside a Dialog (outside the Outlet), callers pass the key explicitly. */
  openAiApiKeyOverride?: string;
  /** Which agent_type(s) this page should filter instances to. Defaults to inventory_diagnostic_agent. */
  agentTypes?: readonly string[];
  /** Optional overrides for the in-page header (above the chat). */
  pageTitle?: string;
  pageSubtitle?: string;
} = {}) {
  const effectiveAgentTypes = (agentTypes && agentTypes.length > 0 ? agentTypes : DEFAULT_AGENT_TYPES) as readonly string[];
  const theme = useTheme();
  // Shell header provides the global OpenAI key via outlet context. When we're
  // embedded inside a dialog (no outlet), the parent passes it as a prop.
  const shellContext = useShellContext();
  const shellApiKey = openAiApiKeyOverride ?? shellContext?.openAiApiKey ?? "";
  const envConfigured = Boolean((shellContext as { llmStatus?: { providers_configured?: string[] } } | undefined)?.llmStatus?.providers_configured?.length);
  const [instanceId, setInstanceId] = useState<string>(initialInstanceId ?? "");
  // Allow per-conversation override of the shell key (rare). Defaults to empty = use shell.
  const [apiKeyOverride, setApiKeyOverride] = useState<string>("");
  const openaiApiKey = apiKeyOverride || shellApiKey;
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [input, setInput] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [view, setView] = useState<ViewKey>("results");
  // When a summary line in the left chat bubble is clicked, we jump to the
  // Pipeline tab and auto-expand the matching step. The id is cleared on
  // next render via PipelineView's internal effect so repeat clicks work.
  const [pipelineFocusStepId, setPipelineFocusStepId] = useState<string | null>(null);
  // Right insights panel: collapsed by default (chat fills the page). User can
  // expand via the splitter button. When expanded, the splitter between the
  // two panes is draggable to rebalance widths.
  const [rightExpanded, setRightExpanded] = useState<boolean>(false);
  const [leftPct, setLeftPct] = useState<number>(48);
  const splitterDragRef = useRef<{ startX: number; startPct: number } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const instancesQuery = useQuery({
    queryKey: ["agent-instances"],
    queryFn: fetchAgentInstances,
    staleTime: 30_000,
  });
  const inventoryInstances = useMemo(
    () =>
      (instancesQuery.data ?? []).filter(
        (i) => effectiveAgentTypes.includes(i.agent_type) && i.is_active,
      ),
    [instancesQuery.data, effectiveAgentTypes],
  );
  const selectedInstance = useMemo(
    () => inventoryInstances.find((i) => i.instance_id === instanceId),
    [inventoryInstances, instanceId],
  );
  // Per-instance prompts drawn from `type_specific_config.ui_prompts`
  // ({show: [...], diagnose: [...], solve: [...], simulate: [...]}).
  // Flatten across intents so the chat surface shows them all; falls back to
  // the generic SAMPLE_PROMPTS when an instance hasn't declared any.
  const displayedPrompts = useMemo<string[]>(() => {
    const cfg = (selectedInstance?.type_specific_config ?? {}) as Record<string, unknown>;
    const uiPrompts = (cfg.ui_prompts ?? {}) as Record<string, unknown>;
    if (!uiPrompts || typeof uiPrompts !== "object") return SAMPLE_PROMPTS;
    const out: string[] = [];
    for (const intent of ["show", "diagnose", "solve", "simulate"]) {
      const list = (uiPrompts as Record<string, unknown>)[intent];
      if (!Array.isArray(list)) continue;
      for (const p of list as Array<Record<string, unknown>>) {
        const text = typeof p?.text === "string" ? (p.text as string) : "";
        if (text) out.push(text);
      }
    }
    return out.length > 0 ? out : SAMPLE_PROMPTS;
  }, [selectedInstance]);
  useEffect(() => {
    if (!instanceId && inventoryInstances.length > 0) {
      setInstanceId(inventoryInstances[0].instance_id);
    }
  }, [instanceId, inventoryInstances]);

  const capabilityQuery = useQuery({
    queryKey: ["inventory-diagnostic-capability", instanceId],
    queryFn: () => fetchInstanceCapability(instanceId, false),
    enabled: Boolean(instanceId),
    staleTime: 30_000,
  });

  // Health-check each provider so the top-strip chip shows the real status
  // (live / no-key / error with tooltip). The shell-level `openaiApiKey` (or
  // per-conversation override) is sent so the ping reflects what a real
  // query would use.
  const healthQuery = useQuery<LlmHealthResponse>({
    queryKey: ["inventory-diagnostic-llm-health", openaiApiKey ? "user" : "env"],
    queryFn: () => checkLlmHealth({ openai_api_key: openaiApiKey || undefined }),
    staleTime: 60_000,
    retry: false,
  });

  const runMutation = useMutation({
    mutationFn: (message: string) =>
      queryForAgentType(selectedInstance?.agent_type)({
        instance_id: instanceId,
        message,
        conversation_id: conversationId || undefined,
        openai_api_key: openaiApiKey || undefined,
        llm_provider: shellContext?.config?.llmProvider || undefined,
        llm_model: shellContext?.config?.llmModel || undefined,
      }),
  });

  const seedMutation = useMutation({
    mutationFn: () => seedInventoryDiagnosticDemo(),
    onSuccess: () => {
      instancesQuery.refetch();
      capabilityQuery.refetch();
      setInstanceId("inventory-diagnostic-demo");
    },
  });

  const selectedResponse = useMemo(() => {
    if (!selectedRunId) {
      const last = [...messages].reverse().find((m) => m.response);
      return last?.response;
    }
    return messages.find((m) => m.response?.run_id === selectedRunId)?.response;
  }, [messages, selectedRunId]);

  const capability = capabilityQuery.data;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, runMutation.isPending]);

  const sendMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !instanceId) return;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      at: new Date().toISOString(),
    };
    const placeholder: Message = {
      id: `a-${Date.now()}`,
      role: "agent",
      content: "",
      at: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, userMsg, placeholder]);
    setInput("");
    runMutation.mutate(trimmed, {
      onSuccess: (data) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholder.id
              ? {
                  ...m,
                  content: data.narrative || "(no narrative)",
                  response: data,
                  pending: false,
                  at: new Date().toISOString(),
                }
              : m,
          ),
        );
        if (data.conversation_id && !conversationId) {
          setConversationId(data.conversation_id);
        }
        setSelectedRunId(data.run_id);
        setView("results");
      },
      onError: (err) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholder.id
              ? { ...m, content: "", pending: false, error: (err as Error).message }
              : m,
          ),
        );
      },
    });
  };

  const resetConversation = () => {
    setMessages([]);
    setConversationId("");
    setSelectedRunId(null);
  };

  // LLM status for the top-bar badge. Reflects the latest run; falls back to
  // Priority: a real LLM call on the latest run > live health-check > static
  // key state. Tooltip always explains precisely why.
  const llmBadge = useMemo(() => {
    const latest = [...messages].reverse().find((m) => m.response);
    if (latest?.response?.llm_active) {
      return {
        label: `LLM · ${latest.response.llm_model ?? latest.response.llm_provider}`,
        color: "success" as const,
        icon: <FlashIcon sx={{ fontSize: 14 }} />,
        tooltip: `Last turn's narrative was produced by ${latest.response.llm_provider ?? "LLM"}${latest.response.llm_model ? " / " + latest.response.llm_model : ""}.`,
      };
    }
    const health = healthQuery.data;
    if (health) {
      const openai = health.providers.openai;
      const anthropic = health.providers.anthropic;
      if (openai.status === "ok" || anthropic.status === "ok") {
        const good = openai.status === "ok" ? openai : anthropic;
        return {
          label: `LLM · ${good.provider ?? "?"} · ${good.model ?? "?"} · ${good.latency_ms ?? "?"}ms`,
          color: "success" as const,
          icon: <FlashIcon sx={{ fontSize: 14 }} />,
          tooltip: `Live ping succeeded. ${good.provider} ${good.model} ${good.latency_ms}ms. On the next turn the agent will call this provider for intent_parse + explanation.`,
        };
      }
      if (openai.status === "error" || anthropic.status === "error") {
        const bad = openai.status === "error" ? openai : anthropic;
        const { reason, remediation } = _explainLlmError(bad.detail);
        return {
          label: `LLM · ${bad.provider} · ${reason}`,
          color: "error" as const,
          icon: <OfflineBoltIcon sx={{ fontSize: 14 }} />,
          tooltip: `Click for details. ${remediation}`,
          error: {
            provider: bad.provider ?? (openai.status === "error" ? "openai" : "anthropic"),
            model: bad.model ?? undefined,
            detail: bad.detail ?? "unknown error",
            reason,
            remediation,
          },
        };
      }
      return {
        label: latest?.response && !latest.response.llm_active ? "Deterministic only" : "No LLM key",
        color: "default" as const,
        icon: <OfflineBoltIcon sx={{ fontSize: 14 }} />,
        tooltip:
          "No API key detected (neither in the app header nor in backend env). The agent runs its deterministic fallback on every turn.",
      };
    }
    return {
      label: "Checking LLM…",
      color: "default" as const,
      icon: <OfflineBoltIcon sx={{ fontSize: 14 }} />,
      tooltip: "Probing the LLM provider…",
    };
  }, [messages, healthQuery.data]);

  // ── Resizable splitter logic ─────────────────────────────────────────
  // The mousedown on the grip records the starting position, then global
  // mousemove/up handlers translate pointer delta into a new leftPct.
  const onSplitterMouseDown = (e: React.MouseEvent) => {
    if (!rightExpanded) return;
    e.preventDefault();
    splitterDragRef.current = { startX: e.clientX, startPct: leftPct };
    const onMove = (ev: MouseEvent) => {
      const container = splitContainerRef.current;
      const drag = splitterDragRef.current;
      if (!container || !drag) return;
      const totalWidth = container.getBoundingClientRect().width;
      if (totalWidth <= 0) return;
      const deltaPct = ((ev.clientX - drag.startX) / totalWidth) * 100;
      const next = Math.min(75, Math.max(25, drag.startPct + deltaPct));
      setLeftPct(next);
    };
    const onUp = () => {
      splitterDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <Box
      ref={splitContainerRef}
      sx={{
        display: "flex",
        // Fill the height given by AppShellLayout.main-content-wrap / PageShell
        // so the composer is anchored to the bottom and only the message list
        // scrolls. Fallback for the embedded-dialog case keeps the original
        // viewport-based height.
        height: embedded ? "80vh" : "100%",
        minHeight: 0,
        flex: embedded ? undefined : 1,
        width: "100%",
        bgcolor: "background.default",
        borderRadius: embedded ? 0 : 2,
        overflow: "hidden",
      }}
    >
      {/* =============================================================== LEFT: chat */}
      <Box
        sx={{
          flex: rightExpanded ? `0 0 ${leftPct}%` : "1 1 100%",
          display: "flex",
          flexDirection: "column",
          borderRight: rightExpanded ? 1 : 0,
          borderColor: "divider",
          bgcolor: "background.paper",
          minWidth: rightExpanded ? 420 : 0,
          transition: splitterDragRef.current ? "none" : "flex-basis 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderBottom: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            background: `linear-gradient(120deg, ${alpha(theme.palette.primary.main, 0.12)}, transparent 60%)`,
          }}
        >
          <Avatar
            sx={{
              bgcolor: "primary.main",
              width: 36,
              height: 36,
              boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.15)}`,
            }}
          >
            <InventoryIcon fontSize="small" />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" fontWeight={700} noWrap>
                {pageTitle ?? "Inventory Diagnostic"}
              </Typography>
              <LlmBadge badge={llmBadge} />
              {llmBadge.error ? (
                <Tooltip title="Re-run the provider ping">
                  <IconButton
                    size="small"
                    onClick={() => healthQuery.refetch()}
                    sx={{ width: 20, height: 20 }}
                  >
                    <ResetIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary" noWrap>
              {instanceId || "Select an instance"}
              {conversationId ? `  ·  conv ${conversationId.slice(0, 6)}…` : ""}
            </Typography>
          </Box>
          <PageHelpButton helpId="page__inventory_diagnostic" />
          <Tooltip title="Settings">
            <IconButton size="small" onClick={() => setShowSettings((v) => !v)}>
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="New conversation">
            <span>
              <IconButton size="small" onClick={resetConversation} disabled={messages.length === 0}>
                <ResetIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        {showSettings ? (
          <Box
            sx={{
              p: 2,
              borderBottom: 1,
              borderColor: "divider",
              bgcolor: alpha(theme.palette.primary.main, 0.03),
              maxHeight: "40%",
              overflowY: "auto",
              flexShrink: 0,
            }}
          >
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Agent instance
                </Typography>
                <InstancePickerButton
                  instances={inventoryInstances}
                  selectedId={instanceId}
                  onSelect={setInstanceId}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, fontSize: 11 }}>
                  Tip: the same picker appears inside the chat composer for quick switching.
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  LLM API key
                </Typography>
                {envConfigured ? (
                  <Chip
                    size="small"
                    icon={<FlashIcon sx={{ fontSize: 14 }} />}
                    color="success"
                    label="Loaded from backend environment (durable)"
                    sx={{ height: 22, fontWeight: 600 }}
                  />
                ) : shellApiKey ? (
                  <Chip
                    size="small"
                    icon={<FlashIcon sx={{ fontSize: 14 }} />}
                    color="warning"
                    label={`Session fallback key · ${shellApiKey.slice(0, 6)}…${shellApiKey.slice(-4)}`}
                    sx={{ height: 22, fontWeight: 600 }}
                  />
                ) : (
                  <Chip
                    size="small"
                    icon={<OfflineBoltIcon sx={{ fontSize: 14 }} />}
                    color="default"
                    label="No backend key and no session key — set OPENAI_API_KEY and restart, or use the gear icon"
                    sx={{ height: 22 }}
                  />
                )}
              </Box>
              {!envConfigured ? (
                <TextField
                  size="small"
                  label="Per-conversation override (optional)"
                  placeholder="sk-… (only overrides while this tab is open)"
                  value={apiKeyOverride}
                  onChange={(e) => setApiKeyOverride(e.target.value)}
                  type="password"
                  helperText="Leave blank to use the header key. This override is in-memory only."
                />
              ) : null}
              <Button
                size="small"
                variant="outlined"
                color="primary"
                startIcon={seedMutation.isPending ? <CircularProgress size={14} /> : <PlayIcon />}
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
              >
                {seedMutation.isPending ? "Seeding…" : "Seed demo data + create instance"}
              </Button>
              {seedMutation.isSuccess ? (
                <Alert severity="success" sx={{ py: 0 }}>
                  Demo data ready. 5 SKUs × 4 nodes seeded. Instance "inventory-diagnostic-demo" is active.
                </Alert>
              ) : null}
              {seedMutation.isError ? (
                <Alert severity="error">{(seedMutation.error as Error).message}</Alert>
              ) : null}
            </Stack>
          </Box>
        ) : null}

        {/* Messages */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            px: 2,
            py: 2,
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          {messages.length === 0 ? (
            <EmptyState
              onPick={(s) => sendMessage(s)}
              onSeed={() => seedMutation.mutate()}
              seeding={seedMutation.isPending}
              hasInstance={Boolean(instanceId)}
              prompts={displayedPrompts}
            />
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                active={selectedRunId === m.response?.run_id}
                onSelect={() => m.response && setSelectedRunId(m.response.run_id)}
                onViewResults={(runId) => {
                  setSelectedRunId(runId);
                  setView("results");
                  setRightExpanded(true);
                }}
                onFocusStep={(runId, stepId) => {
                  setSelectedRunId(runId);
                  setView("pipeline");
                  setPipelineFocusStepId(stepId);
                  setRightExpanded(true);
                }}
              />
            ))
          )}
          {runMutation.isPending ? <TypingIndicator /> : null}
          <div ref={endRef} />
        </Box>

        {/* Follow-ups */}
        {selectedResponse?.follow_up_questions?.length ? (
          <Box sx={{ px: 2, pb: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              SUGGESTED FOLLOW-UPS
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              {selectedResponse.follow_up_questions.map((q) => (
                <Chip
                  key={q}
                  label={q}
                  size="small"
                  variant="outlined"
                  icon={<AutoIcon sx={{ fontSize: 14 }} />}
                  onClick={() => sendMessage(q)}
                  sx={{ borderRadius: 1.5, fontSize: 12 }}
                />
              ))}
            </Stack>
          </Box>
        ) : null}

        {/* Composer */}
        <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Paper
            variant="outlined"
            sx={{
              px: 1.25,
              pt: 1,
              pb: 0.75,
              borderRadius: 2.5,
              transition: "border-color 0.15s, box-shadow 0.15s",
              "&:focus-within": {
                borderColor: "primary.main",
                boxShadow: (t) => `0 0 0 3px ${alpha(t.palette.primary.main, 0.12)}`,
              },
            }}
          >
            <TextField
              fullWidth
              multiline
              maxRows={6}
              minRows={2}
              variant="standard"
              placeholder={
                instanceId ? "Ask about stockouts, risk, promotions…" : "Pick an agent instance below to get started"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              disabled={!instanceId}
              InputProps={{ disableUnderline: true, sx: { px: 0.5, fontSize: 14, lineHeight: 1.55 } }}
            />
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mt: 0.5, gap: 1 }}
            >
              <InstancePickerButton
                instances={inventoryInstances}
                selectedId={instanceId}
                onSelect={setInstanceId}
              />
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ display: { xs: "none", sm: "block" }, fontSize: 10.5 }}
                >
                  Enter to send · Shift+Enter for newline
                </Typography>
                <Tooltip title="Send (Enter)">
                  <span>
                    <IconButton
                      color="primary"
                      size="small"
                      onClick={() => sendMessage(input)}
                      disabled={!instanceId || !input.trim() || runMutation.isPending}
                      sx={{
                        bgcolor: "primary.main",
                        color: "primary.contrastText",
                        width: 34,
                        height: 34,
                        transition: "all 0.15s",
                        "&:hover": { bgcolor: "primary.dark", transform: "translateY(-1px)" },
                        "&.Mui-disabled": { bgcolor: "action.disabledBackground" },
                      }}
                    >
                      {runMutation.isPending ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <SendIcon sx={{ fontSize: 18 }} />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          </Paper>
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }} useFlexGap>
            {displayedPrompts.slice(0, 3).map((s) => (
              <Chip
                key={s}
                size="small"
                label={s.length > 44 ? `${s.slice(0, 42)}…` : s}
                onClick={() => setInput(s)}
                sx={{
                  fontSize: 11,
                  bgcolor: alpha(theme.palette.primary.main, 0.06),
                  "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.12) },
                }}
              />
            ))}
          </Stack>
        </Box>
      </Box>

      {/* =============================================================== SPLITTER */}
      <Splitter
        expanded={rightExpanded}
        hasResults={Boolean(selectedResponse)}
        onToggle={() => setRightExpanded((v) => !v)}
        onMouseDown={onSplitterMouseDown}
      />

      {/* =============================================================== RIGHT: data */}
      {rightExpanded ? (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, bgcolor: "grey.50" }}>
        <Box
          sx={{
            px: 2.5,
            py: 1.5,
            borderBottom: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 2,
            bgcolor: "background.paper",
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 600, letterSpacing: 0.8 }}
            >
              CAPABILITY
            </Typography>
            <CapabilityBar snapshot={capability} loading={capabilityQuery.isLoading} />
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v) => v && setView(v)}
          >
            <ToggleButton value="results">
              <InsightsIcon sx={{ fontSize: 16, mr: 0.5 }} />
              Results
            </ToggleButton>
            <ToggleButton value="pipeline">
              <TimelineIcon sx={{ fontSize: 16, mr: 0.5 }} />
              Pipeline
            </ToggleButton>
            <ToggleButton value="audit">
              <PowerIcon sx={{ fontSize: 16, mr: 0.5 }} />
              Audit
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2.5 }}>
          {!selectedResponse ? (
            <RightEmptyState />
          ) : view === "results" ? (
            <ResultsView response={selectedResponse} />
          ) : view === "pipeline" ? (
            <PipelineView
              response={selectedResponse}
              focusStepId={pipelineFocusStepId}
              onConsumeFocus={() => setPipelineFocusStepId(null)}
            />
          ) : (
            <AuditView response={selectedResponse} />
          )}
        </Box>
      </Box>
      ) : null}
    </Box>
  );
}

// =========================================================== sub-components

function Splitter({
  expanded,
  hasResults,
  onToggle,
  onMouseDown,
}: {
  expanded: boolean;
  hasResults: boolean;
  onToggle: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const theme = useTheme();
  // Collapsed: narrow rail with a single "expand" button + a data chip so
  // users know results are ready. Expanded: draggable grip + collapse button.
  if (!expanded) {
    return (
      <Box
        sx={{
          width: 32,
          flex: "0 0 32px",
          borderLeft: 1,
          borderColor: "divider",
          bgcolor: alpha(theme.palette.primary.main, 0.02),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.06) },
        }}
      >
        <Tooltip title={hasResults ? "Expand insights panel" : "Expand panel (empty — ask a question first)"} placement="left">
          <IconButton
            size="small"
            onClick={onToggle}
            sx={{
              bgcolor: hasResults ? "primary.main" : "background.paper",
              color: hasResults ? "primary.contrastText" : "primary.main",
              border: 1,
              borderColor: "primary.main",
              width: 28,
              height: 28,
              boxShadow: hasResults ? `0 2px 8px ${alpha(theme.palette.primary.main, 0.35)}` : "none",
              "&:hover": {
                bgcolor: hasResults ? "primary.dark" : alpha(theme.palette.primary.main, 0.08),
                transform: "translateX(-1px)",
              },
              transition: "all 0.15s",
            }}
          >
            <ExpandIcon sx={{ fontSize: 18, transform: "rotate(180deg)" }} />
          </IconButton>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            transform: "rotate(180deg)",
            mt: 1.5,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.8,
            color: hasResults ? "primary.main" : "text.secondary",
            textTransform: "uppercase",
            userSelect: "none",
          }}
        >
          {hasResults ? "• Insights ready" : "Insights"}
        </Typography>
      </Box>
    );
  }
  return (
    <Box
      sx={{
        width: 8,
        flex: "0 0 8px",
        position: "relative",
        cursor: "col-resize",
        bgcolor: "transparent",
        "&:hover .splitter-grip": { opacity: 1 },
        "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.08) },
      }}
      onMouseDown={onMouseDown}
    >
      {/* Invisible wider hit area for easier grabbing */}
      <Box
        sx={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: -4,
          right: -4,
          zIndex: 1,
        }}
      />
      {/* Visual grip — three vertical dots, center */}
      <Box
        className="splitter-grip"
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          gap: 0.4,
          opacity: 0.35,
          transition: "opacity 0.15s",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <Box
            key={i}
            sx={{
              width: 2.5,
              height: 2.5,
              borderRadius: "50%",
              bgcolor: "primary.main",
            }}
          />
        ))}
      </Box>
      {/* Collapse button — floats at the top */}
      <Tooltip title="Collapse panel" placement="left">
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          sx={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            width: 22,
            height: 22,
            bgcolor: "background.paper",
            border: 1,
            borderColor: "divider",
            zIndex: 3,
            "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.08), borderColor: "primary.main" },
          }}
        >
          <CollapseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function EmptyState({
  onPick,
  onSeed,
  seeding,
  hasInstance,
  prompts,
}: {
  onPick: (s: string) => void;
  onSeed: () => void;
  seeding: boolean;
  hasInstance: boolean;
  prompts?: string[];
}) {
  const renderPrompts = prompts && prompts.length > 0 ? prompts : SAMPLE_PROMPTS;
  return (
    <Box sx={{ m: "auto", textAlign: "center", py: 4, maxWidth: 480 }}>
      <Avatar
        sx={{
          bgcolor: "primary.main",
          width: 64,
          height: 64,
          mx: "auto",
          mb: 2,
          boxShadow: 3,
        }}
      >
        <InventoryIcon sx={{ fontSize: 32 }} />
      </Avatar>
      <Typography variant="h6" gutterBottom fontWeight={700}>
        Inventory Diagnostic Agent
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Ask about stockout risk, excess inventory, promo impact, or any SKU /
        node. The pipeline is deterministic at <b>sku_location_week</b> grain;
        the LLM only writes the narrative.
      </Typography>
      {!hasInstance ? (
        <Button
          variant="contained"
          startIcon={seeding ? <CircularProgress size={16} color="inherit" /> : <PlayIcon />}
          onClick={onSeed}
          disabled={seeding}
          sx={{ mb: 3 }}
        >
          {seeding ? "Seeding…" : "Seed demo data + create instance"}
        </Button>
      ) : null}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 1.5, fontWeight: 600, letterSpacing: 0.8 }}
      >
        TRY A PROMPT
      </Typography>
      <Stack spacing={1}>
        {renderPrompts.map((p) => (
          <Paper
            key={p}
            variant="outlined"
            sx={{
              px: 2,
              py: 1.25,
              cursor: "pointer",
              textAlign: "left",
              borderRadius: 2,
              transition: "all 0.15s",
              "&:hover": {
                bgcolor: "action.hover",
                borderColor: "primary.main",
                transform: "translateY(-1px)",
                boxShadow: 1,
              },
            }}
            onClick={() => onPick(p)}
          >
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <BoltIcon fontSize="small" color="primary" />
              <Typography variant="body2">{p}</Typography>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}

function RightEmptyState() {
  return (
    <Box sx={{ textAlign: "center", m: "auto", color: "text.secondary", pt: 8 }}>
      <InsightsIcon sx={{ fontSize: 64, opacity: 0.25, mb: 1 }} />
      <Typography variant="h6" color="text.secondary">
        Results appear here
      </Typography>
      <Typography variant="body2">Send a question from the chat to start.</Typography>
    </Box>
  );
}

function TypingIndicator() {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: 4, py: 1 }}>
      <CircularProgress size={12} />
      <Typography variant="caption" color="text.secondary">
        Running deterministic pipeline…
      </Typography>
    </Stack>
  );
}

type SummaryLineTone = "error" | "warning" | "primary" | "success" | "default";

type CategorySummary = {
  key: string;
  tone: SummaryLineTone;
  icon: React.ReactNode;
  label: string;
  meta: string;
  detail: string;
  focusStepId: string;
};

function buildCategorySummaries(response: InventoryDiagnosticResponse): CategorySummary[] {
  const structured = response.structured ?? {};
  const problems = (structured.problems ?? []) as any[];
  const rcs = (structured.root_causes ?? []) as any[];
  const resolutions = (structured.resolutions ?? []) as any[];
  const ap = structured.action_plan as any;
  const warnings = (response.warnings ?? []) as string[];

  const agentIsDemandSensing = response.agent_type === "demand_sensing_agent";
  const problemsLabel = agentIsDemandSensing ? "Signals" : "Problems";
  const problemsStepId = agentIsDemandSensing ? "detect_signals" : "detect_problems";

  const out: CategorySummary[] = [];

  if (problems.length > 0) {
    const critical = problems.filter((p) => p.severity === "critical").length;
    const top = problems[0] ?? {};
    const sku = typeof top.sku === "string" ? top.sku : null;
    const node = typeof top.node_id === "string" ? top.node_id : typeof top.location === "string" ? top.location : null;
    const shortage =
      typeof top.shortage_qty === "number" ? ` · short ${formatNumber(Math.round(top.shortage_qty))}` : "";
    const detail = [sku, node].filter(Boolean).join(" @ ") || (typeof top.title === "string" ? top.title : "");
    out.push({
      key: "problems",
      tone: critical > 0 ? "error" : "warning",
      icon: <ErrorIcon sx={{ fontSize: 16 }} />,
      label: problemsLabel,
      meta: `${problems.length} total${critical > 0 ? ` · ${critical} critical` : ""}`,
      detail: detail ? `${detail}${shortage}` : shortage.trim() || "—",
      focusStepId: problemsStepId,
    });
  }

  if (rcs.length > 0) {
    const top = rcs[0] ?? {};
    const detail =
      (typeof top.label === "string" && top.label) ||
      (typeof top.name === "string" && top.name) ||
      (typeof top.root_cause_id === "string" && top.root_cause_id) ||
      "—";
    out.push({
      key: "root_causes",
      tone: "warning",
      icon: <WarningIcon sx={{ fontSize: 16 }} />,
      label: "Root causes",
      meta: `${rcs.length} analyzed`,
      detail,
      focusStepId: "analyze_root_cause",
    });
  }

  if (resolutions.length > 0) {
    const clears = resolutions.filter((r) => r.resolves_breach === true).length;
    const top = resolutions[0] ?? {};
    const family =
      (typeof top.family === "string" && top.family) ||
      (typeof top.resolution_family === "string" && top.resolution_family) ||
      null;
    const label =
      (typeof top.title === "string" && top.title) ||
      (typeof top.label === "string" && top.label) ||
      family ||
      "Top recommendation";
    out.push({
      key: "resolutions",
      tone: "primary",
      icon: <AutoIcon sx={{ fontSize: 16 }} />,
      label: "Resolutions",
      meta: `${clears} of ${resolutions.length} clear breach`,
      detail: label,
      focusStepId: "enumerate_resolutions",
    });
  }

  if (ap && Array.isArray(ap.plans) && ap.plans.length > 0) {
    const top = ap.plans[0] ?? {};
    const detail =
      (typeof top.title === "string" && top.title) ||
      (typeof top.action === "string" && top.action) ||
      (typeof top.family_key === "string" && top.family_key) ||
      "Action";
    out.push({
      key: "action_plan",
      tone: "success",
      icon: <CheckIcon sx={{ fontSize: 16 }} />,
      label: "Action plan",
      meta: `${ap.plans.length} step${ap.plans.length === 1 ? "" : "s"}`,
      detail,
      focusStepId: "map_actions",
    });
  }

  if (warnings.length > 0) {
    out.push({
      key: "warnings",
      tone: "default",
      icon: <BoltIcon sx={{ fontSize: 16 }} />,
      label: "Warnings",
      meta: `${warnings.length} note${warnings.length === 1 ? "" : "s"}`,
      detail: warnings[0] ?? "",
      focusStepId: "audit",
    });
  }

  return out;
}

function SummaryLineRow({
  entry,
  onClick,
}: {
  entry: CategorySummary;
  onClick: () => void;
}) {
  const theme = useTheme();
  const palette =
    entry.tone === "default"
      ? { main: theme.palette.grey[600], light: theme.palette.grey[100] }
      : (theme.palette[entry.tone] as { main: string; light: string });
  return (
    <ButtonBase
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        width: "100%",
        textAlign: "left",
        px: 1,
        py: 0.75,
        borderRadius: 1.25,
        borderLeft: 3,
        borderLeftColor: palette.main,
        bgcolor: alpha(palette.main, 0.06),
        transition: "background-color 0.12s",
        "&:hover": { bgcolor: alpha(palette.main, 0.14) },
      }}
    >
      <Box sx={{ color: palette.main, display: "flex" }}>{entry.icon}</Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, color: palette.main, fontSize: 11, letterSpacing: 0.3 }}
          >
            {entry.label.toUpperCase()}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
            {entry.meta}
          </Typography>
        </Stack>
        <Typography
          variant="body2"
          sx={{
            fontSize: 12.5,
            lineHeight: 1.35,
            color: "text.primary",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {entry.detail}
        </Typography>
      </Box>
      <ExpandIcon sx={{ fontSize: 16, color: "text.disabled" }} />
    </ButtonBase>
  );
}

// Pre-process the LLM narrative into polished markdown:
//  - auto-bold SKU codes (BAR-002, COFFEE-088), node codes (CDC-NORTH, DC-01),
//    week references (week 3, wk+2) and quantities (4,340 units, $1.2M)
//  - turn plain "- " or "* " prefixed lines into markdown bullets (already
//    valid markdown, but we also accept "• ")
//  - tag "Next step" / "To resolve" / "I recommend" / "Recommendation" leads
//    so we can render them as a colored callout paragraph
const NARRATIVE_LEAD_PATTERNS: Array<{ re: RegExp; tone: "primary" | "success" | "warning" }> = [
  { re: /^(next step[s]?:)/i, tone: "success" },
  { re: /^(recommendation:)/i, tone: "primary" },
  { re: /^(to resolve[^:]*:)/i, tone: "primary" },
  { re: /^(i recommend)/i, tone: "primary" },
  { re: /^(warning:)/i, tone: "warning" },
  { re: /^(caveat:)/i, tone: "warning" },
];

function enrichNarrativeMarkdown(text: string): string {
  if (!text) return "";
  // Normalize bullets
  let s = text.replace(/^\s*•\s+/gm, "- ");
  // Auto-bold SKU / node codes: 2+ uppercase letters followed by "-" and digits
  // (e.g. BAR-002, CDC-NORTH, COFFEE-088, WATER-001, DC-01)
  s = s.replace(/\b([A-Z]{2,}-[A-Z0-9]{2,})\b/g, "**$1**");
  // Auto-bold "week N" / "wk+N" / "wk N"
  s = s.replace(/\b(week\s+\d+|wk\+?\s?\d+)\b/gi, "**$1**");
  // Auto-bold numeric quantities with units or currency (e.g., "4,340 units", "$1.2M", "22,940")
  s = s.replace(/(\$\s?[\d,]+(?:\.\d+)?[KMB]?)/g, "**$1**");
  s = s.replace(/(\b\d{1,3}(?:,\d{3})+\b)(?!\*)/g, "**$1**");
  return s;
}

function AgentNarrative({ text }: { text: string }) {
  const theme = useTheme();
  const paragraphs = useMemo(
    () => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    [text],
  );

  return (
    <Stack spacing={1.25}>
      {paragraphs.map((para, idx) => {
        const firstLine = para.split("\n")[0] ?? "";
        const tone = NARRATIVE_LEAD_PATTERNS.find((p) => p.re.test(firstLine))?.tone ?? null;
        const enriched = enrichNarrativeMarkdown(para);
        const palette = tone
          ? (theme.palette[tone] as { main: string; light: string; dark: string })
          : null;
        return (
          <Box
            key={idx}
            sx={
              palette
                ? {
                    p: 1.25,
                    pl: 1.5,
                    borderRadius: 1.25,
                    borderLeft: 3,
                    borderLeftColor: palette.main,
                    bgcolor: alpha(palette.main, 0.06),
                  }
                : undefined
            }
          >
            <Box
              sx={{
                fontSize: 13.5,
                lineHeight: 1.65,
                color: "text.primary",
                "& p": { m: 0, mb: 0.75, "&:last-child": { mb: 0 } },
                "& p + p": { mt: 0.75 },
                "& strong": {
                  fontWeight: 700,
                  color: palette ? palette.dark : theme.palette.primary.dark,
                },
                "& ul, & ol": { m: 0, pl: 2.5, mb: 0.5 },
                "& li": { mb: 0.25, lineHeight: 1.6 },
                "& li::marker": { color: palette ? palette.main : theme.palette.primary.main },
                "& code": {
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: "primary.dark",
                  px: 0.5,
                  py: 0.1,
                  borderRadius: 0.5,
                  fontSize: 12,
                  fontFamily: "ui-monospace, Menlo, monospace",
                },
                "& a": { color: "primary.main", textDecoration: "underline" },
              }}
            >
              <ReactMarkdown>{enriched}</ReactMarkdown>
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

function MessageBubble({
  message,
  active,
  onSelect,
  onViewResults,
  onFocusStep,
}: {
  message: Message;
  active: boolean;
  onSelect: () => void;
  onViewResults: (runId: string) => void;
  onFocusStep: (runId: string, stepId: string) => void;
}) {
  const theme = useTheme();
  const isUser = message.role === "user";
  const response = message.response;
  const summaries = !isUser && response ? buildCategorySummaries(response) : [];
  const narrative = !isUser && response ? (response.narrative || "").trim() : "";
  return (
    <Stack
      direction="row"
      spacing={1.25}
      sx={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "95%",
        flexDirection: isUser ? "row-reverse" : "row",
      }}
    >
      <Avatar sx={{ width: 30, height: 30, bgcolor: isUser ? "grey.600" : "primary.main" }}>
        {isUser ? <PersonIcon sx={{ fontSize: 16 }} /> : <BotIcon sx={{ fontSize: 16 }} />}
      </Avatar>
      <Paper
        onClick={!isUser && response ? onSelect : undefined}
        elevation={active ? 2 : 0}
        sx={{
          px: 1.75,
          py: 1.25,
          borderRadius: 2,
          bgcolor: isUser ? "primary.main" : "background.paper",
          color: isUser ? "primary.contrastText" : "text.primary",
          cursor: !isUser && response ? "pointer" : "default",
          border: 1,
          borderColor: active ? "primary.main" : "divider",
          transition: "all 0.15s",
          "&:hover": !isUser && response
            ? { borderColor: alpha(theme.palette.primary.main, 0.5), boxShadow: 1 }
            : {},
          maxWidth: 640,
        }}
      >
        {message.pending ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={12} />
            <Typography variant="body2" color="text.secondary">
              Thinking…
            </Typography>
          </Stack>
        ) : message.error ? (
          <Alert severity="error" sx={{ m: 0, py: 0 }}>
            {message.error}
          </Alert>
        ) : (
          <>
            {isUser ? (
              <Typography
                variant="body2"
                sx={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.55 }}
              >
                {message.content}
              </Typography>
            ) : narrative ? (
              <AgentNarrative text={narrative} />
            ) : (
              <Typography
                variant="body2"
                sx={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.55 }}
              >
                {message.content}
              </Typography>
            )}
            {!isUser && response && summaries.length > 0 ? (
              <>
                <Divider sx={{ my: 1.25 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontSize: 10, letterSpacing: 0.6, fontWeight: 700 }}
                  >
                    OUTCOME
                  </Typography>
                </Divider>
                <Stack spacing={0.5}>
                  {summaries.map((s) => (
                    <SummaryLineRow
                      key={s.key}
                      entry={s}
                      onClick={() => onFocusStep(response.run_id, s.focusStepId)}
                    />
                  ))}
                </Stack>
              </>
            ) : null}
            {!isUser && response ? (
              <SolveActionSummaryCard
                response={response}
                onViewResults={() => onViewResults(response.run_id)}
              />
            ) : null}
            {!isUser && response ? (
              <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={response.intent_mode}
                  color="primary"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 10 }}
                />
                <Chip
                  size="small"
                  icon={
                    response.llm_active ? (
                      <FlashIcon sx={{ fontSize: 12 }} />
                    ) : (
                      <OfflineBoltIcon sx={{ fontSize: 12 }} />
                    )
                  }
                  label={response.llm_active ? "LLM" : "deterministic"}
                  color={response.llm_active ? "success" : "default"}
                  variant="outlined"
                  sx={{ height: 20, fontSize: 10 }}
                />
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  endIcon={<ExpandIcon sx={{ fontSize: 16 }} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewResults(response.run_id);
                  }}
                  sx={{ fontSize: 11, py: 0.25, minWidth: 0 }}
                >
                  View results
                </Button>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontSize: 10, alignSelf: "center" }}
                >
                  {timeLabel(message.at)}
                </Typography>
              </Stack>
            ) : null}
          </>
        )}
      </Paper>
    </Stack>
  );
}

function CapabilityBar({
  snapshot,
  loading,
}: {
  snapshot: CapabilitySnapshot | undefined;
  loading: boolean;
}) {
  if (loading) {
    return <LinearProgress sx={{ width: 160, mt: 0.5 }} />;
  }
  if (!snapshot) {
    return <Typography variant="caption" color="text.secondary">Pick an instance</Typography>;
  }
  const slots = Object.entries(snapshot.slots);
  const green = slots.filter(([, v]) => v.status === "available").length;
  const amber = slots.filter(([, v]) => v.status === "degraded").length;
  const red = slots.filter(([, v]) => v.status === "missing").length;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
      <Chip
        size="small"
        color="success"
        icon={<CheckIcon sx={{ fontSize: 14 }} />}
        label={`${green} ok`}
        sx={{ height: 22, fontWeight: 600 }}
      />
      {amber > 0 ? (
        <Chip
          size="small"
          color="warning"
          icon={<WarningIcon sx={{ fontSize: 14 }} />}
          label={`${amber} degraded`}
          sx={{ height: 22 }}
        />
      ) : null}
      {red > 0 ? (
        <Chip
          size="small"
          color="error"
          icon={<ErrorIcon sx={{ fontSize: 14 }} />}
          label={`${red} missing`}
          sx={{ height: 22 }}
        />
      ) : null}
      <Box sx={{ flex: 1 }} />
      {slots.map(([key, v]) => (
        <Tooltip key={key} title={`${key}: ${v.status}${v.reason ? " — " + v.reason : ""}`}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              bgcolor: `${slotStatusColor(v.status)}.main`,
              opacity: 0.85,
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}

function ResultsView({ response }: { response: InventoryDiagnosticResponse }) {
  const theme = useTheme();
  const problems = (response.structured.problems ?? []) as any[];
  const rcs = (response.structured.root_causes ?? []) as any[];
  const resolutions = (response.structured.resolutions ?? []) as any[];
  const ap = response.structured.action_plan as any;

  const metrics = useMemo(() => {
    const critical = problems.filter((p) => p.severity === "critical").length;
    const warning = problems.filter((p) => p.severity === "warning").length;
    const totalShortage = problems.reduce(
      (s, p) => s + (typeof p.shortage_qty === "number" ? p.shortage_qty : 0),
      0,
    );
    const resolved = resolutions.filter((r) => r.resolves_breach === true).length;
    return { critical, warning, totalShortage, resolved, totalProblems: problems.length };
  }, [problems, resolutions]);

  return (
    <Stack spacing={2.5}>
      <AgentSummaryCard response={response} />

      {/* Hero metric strip */}
      {problems.length > 0 ? (
        <Stack direction="row" spacing={2}>
          <MetricCard
            icon={<ErrorIcon fontSize="small" />}
            label="Critical"
            value={metrics.critical}
            color="error"
          />
          <MetricCard
            icon={<WarningIcon fontSize="small" />}
            label="Warning"
            value={metrics.warning}
            color="warning"
          />
          <MetricCard
            icon={<TrendingDownIcon fontSize="small" />}
            label="Shortage units"
            value={formatNumber(Math.round(metrics.totalShortage))}
            color="default"
          />
          <MetricCard
            icon={<CheckIcon fontSize="small" />}
            label="Resolutions that clear"
            value={metrics.resolved}
            color="success"
            total={resolutions.length}
          />
        </Stack>
      ) : null}

      {problems.length > 0 ? (
        <>
          <SectionHeader
            title="Projected problems"
            count={problems.length}
            subtitle="sku_location_week breaches, severity-ranked"
          />
          <ProblemsGrid rows={problems} />
        </>
      ) : null}

      {rcs.length > 0 ? (
        <>
          <SectionHeader
            title="Root causes"
            count={rcs.length}
            subtitle="Evidence from the declarative catalog"
          />
          <RootCausesGrid rows={rcs} />
        </>
      ) : null}

      {resolutions.length > 0 ? (
        <>
          <SectionHeader
            title="Recommended resolutions"
            count={resolutions.length}
            subtitle="Simulation-ranked; green rows clear the breach"
          />
          <ResolutionsGrid rows={resolutions} />
        </>
      ) : null}

      {ap ? (
        <>
          <SectionHeader
            title="Action plan"
            count={(ap.plans ?? []).length}
            subtitle={`status: ${ap.status}  ·  dispatch: ${ap.dispatch_enabled ? "on" : "dry-run"}`}
          />
          <ActionPlanGrid plan={ap} />
        </>
      ) : null}
    </Stack>
  );
}

// Narrative hero as a collapsible card. Collapsed by default so the results
// lead with the data; user clicks the "Show" chip / chevron to read the
// agent's written summary. Preview shows the first line + "…" so planners
// get a teaser of what's inside before expanding.
function AgentSummaryCard({ response }: { response: InventoryDiagnosticResponse }) {
  const theme = useTheme();
  const narrative = response.narrative || "";
  const [expanded, setExpanded] = useState(() => narrative.trim().length > 0);
  const firstLine = narrative.split("\n").find((l) => l.trim().length > 0) ?? "";
  const preview = firstLine.length > 120 ? firstLine.slice(0, 117) + "…" : firstLine;
  return (
    <Paper
      elevation={0}
      sx={{
        p: expanded ? 2.5 : 1.75,
        borderRadius: 3,
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)}, ${alpha(
          theme.palette.primary.main,
          0.02,
        )})`,
        border: 1,
        borderColor: alpha(theme.palette.primary.main, 0.2),
        position: "relative",
        overflow: "hidden",
        transition: "padding 0.2s ease",
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Avatar sx={{ bgcolor: "primary.main", width: expanded ? 36 : 30, height: expanded ? 36 : 30, transition: "all 0.2s" }}>
          <AutoIcon sx={{ fontSize: expanded ? 20 : 16 }} />
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" fontWeight={700}>
              Agent summary
            </Typography>
            <Chip
              size="small"
              label={response.intent_mode.toUpperCase()}
              color="primary"
              sx={{ height: 18, fontSize: 10, fontWeight: 700 }}
            />
            <Chip
              size="small"
              icon={
                response.llm_active ? (
                  <FlashIcon sx={{ fontSize: 12 }} />
                ) : (
                  <OfflineBoltIcon sx={{ fontSize: 12 }} />
                )
              }
              label={
                response.llm_active
                  ? `${response.llm_provider}/${response.llm_model}`
                  : "deterministic"
              }
              color={response.llm_active ? "success" : "default"}
              variant="outlined"
              sx={{ height: 18, fontSize: 10 }}
            />
            <Box sx={{ flex: 1 }} />
            <Chip
              size="small"
              onClick={() => setExpanded((v) => !v)}
              label={expanded ? "Hide" : "Show"}
              icon={
                <ExpandIcon
                  sx={{
                    fontSize: 14,
                    transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.15s",
                  }}
                />
              }
              sx={{
                height: 22,
                fontSize: 10.5,
                fontWeight: 700,
                bgcolor: expanded ? "primary.main" : alpha(theme.palette.primary.main, 0.1),
                color: expanded ? "primary.contrastText" : "primary.main",
                "&:hover": {
                  bgcolor: expanded ? "primary.dark" : alpha(theme.palette.primary.main, 0.2),
                },
                cursor: "pointer",
                "& .MuiChip-icon": {
                  color: "inherit",
                },
              }}
            />
          </Stack>
          {!expanded && preview ? (
            <Typography
              variant="caption"
              sx={{ display: "block", mt: 0.5, color: "text.secondary", lineHeight: 1.5, fontStyle: "italic" }}
            >
              {preview}
            </Typography>
          ) : null}
          {expanded ? (
            <Box sx={{ mt: 1 }}>
              <AgentNarrative text={narrative} />
            </Box>
          ) : null}
        </Box>
      </Stack>
    </Paper>
  );
}

function MetricCard({
  icon,
  label,
  value,
  color,
  total,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: "error" | "warning" | "success" | "default";
  total?: number;
}) {
  const theme = useTheme();
  const palette =
    color === "default"
      ? theme.palette.grey
      : (theme.palette[color] as typeof theme.palette.error);
  const tint = color === "default" ? theme.palette.grey[100] : alpha((palette as any).main, 0.1);
  const fg = color === "default" ? theme.palette.text.primary : (palette as any).main;
  return (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        p: 1.75,
        borderRadius: 2,
        border: 1,
        borderColor: color === "default" ? "divider" : alpha((palette as any).main, 0.25),
        background: `linear-gradient(140deg, ${tint}, transparent)`,
        minWidth: 120,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ color: fg, display: "flex" }}>{icon}</Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", fontSize: 10 }}
        >
          {label}
        </Typography>
      </Stack>
      <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5, color: fg, lineHeight: 1.2 }}>
        {value}
        {total !== undefined ? (
          <Typography variant="body2" component="span" color="text.secondary" sx={{ ml: 0.5, fontWeight: 400 }}>
            / {total}
          </Typography>
        ) : null}
      </Typography>
    </Paper>
  );
}

function SectionHeader({
  title,
  count,
  subtitle,
}: {
  title: string;
  count: number;
  subtitle?: string;
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline">
      <Typography variant="subtitle1" fontWeight={700}>
        {title}
      </Typography>
      <Chip size="small" label={count} color="primary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
      {subtitle ? (
        <Typography variant="caption" color="text.secondary">
          · {subtitle}
        </Typography>
      ) : null}
    </Stack>
  );
}

function ProblemsGrid({ rows }: { rows: any[] }) {
  if (rows.length === 0) return <EmptyCard text="No problems detected in scope." />;
  const hasPerishable = rows.some((p) => {
    const ev = p?.evidence ?? {};
    return (
      ev.earliest_batch_rsl_days != null ||
      ev.earliest_batch_expiry_date != null ||
      ev.total_expired_qty_in_horizon != null
    );
  });
  const headers = [
    "Rank", "SKU", "Node", "Problem", "Severity", "Wk", "Shortage", "Projected",
    ...(hasPerishable ? ["RSL d", "Expires"] : []),
    "ROP", "Score",
  ];
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2 }}>
      <Box component="table" sx={tableSx}>
        <thead>
          <tr>
            {headers.map((h) => (
              <Box component="th" key={h} sx={thSx}>
                {h}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, idx) => {
            const tint =
              p.severity === "critical"
                ? "error.main"
                : p.severity === "warning"
                ? "warning.main"
                : "grey.300";
            return (
              <Box
                component="tr"
                key={idx}
                sx={{
                  "&:hover": { bgcolor: "action.hover" },
                  borderLeft: 3,
                  borderColor: tint,
                }}
              >
                <Box component="td" sx={tdSx}>
                  <Typography variant="caption" fontWeight={700}>
                    #{p.rank ?? idx + 1}
                  </Typography>
                </Box>
                <Box component="td" sx={{ ...tdSx, fontWeight: 600 }}>{p.sku}</Box>
                <Box component="td" sx={tdSx}>{p.node_id}</Box>
                <Box component="td" sx={tdSx}>
                  <Typography variant="caption">{p.problem_key}</Typography>
                </Box>
                <Box component="td" sx={tdSx}>
                  <Chip
                    size="small"
                    color={severityColor(p.severity)}
                    label={p.severity}
                    sx={{ height: 20, textTransform: "capitalize", fontWeight: 600 }}
                  />
                </Box>
                <Box component="td" sx={tdSx}>
                  <Chip size="small" variant="outlined" label={p.breach_week} sx={{ height: 20, fontSize: 11 }} />
                </Box>
                <Box component="td" sx={{ ...tdSx, fontWeight: 700, color: "error.main" }}>
                  {formatNumber(p.shortage_qty)}
                </Box>
                <Box component="td" sx={tdSx}>{formatNumber(p.projected_on_hand_actual_qty)}</Box>
                {hasPerishable ? (
                  <>
                    <Box component="td" sx={tdSx}>
                      {p?.evidence?.earliest_batch_rsl_days != null ? (
                        <Chip
                          size="small"
                          color={
                            Number(p.evidence.earliest_batch_rsl_days) <= 1
                              ? "error"
                              : Number(p.evidence.earliest_batch_rsl_days) <= 2
                              ? "warning"
                              : "default"
                          }
                          label={p.evidence.earliest_batch_rsl_days}
                          sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                        />
                      ) : (
                        "—"
                      )}
                    </Box>
                    <Box component="td" sx={tdSx}>
                      <Typography variant="caption">
                        {p?.evidence?.earliest_batch_expiry_date ?? "—"}
                      </Typography>
                    </Box>
                  </>
                ) : null}
                <Box component="td" sx={tdSx}>{formatNumber(p.reorder_point_qty)}</Box>
                <Box component="td" sx={tdSx}>
                  {typeof p.score === "number" ? p.score.toFixed(3) : "—"}
                </Box>
              </Box>
            );
          })}
        </tbody>
      </Box>
    </Paper>
  );
}

function RootCausesGrid({ rows }: { rows: any[] }) {
  return (
    <Stack spacing={1.25}>
      {rows.map((rc, idx) => (
        <RootCauseCard key={idx} rc={rc} />
      ))}
    </Stack>
  );
}

// Humanise the RC key → "late supply" style title (first letter capitalised).
function _humaniseRcKey(key: string): string {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map each RC key to a short plain-English "what fired" line so planners
// don't need to read the evidence blob to understand the diagnosis.
const RC_HEADLINE: Record<string, string> = {
  late_supply:
    "One or more inbound orders are forecast to arrive after the breach week.",
  network_imbalance:
    "A sibling node has excess inventory while this node is running below reorder point.",
  promo_uplift:
    "An upcoming promotion will spike demand during the breach window.",
  blocked_inventory:
    "On-hand inventory is sitting on quality hold or near-expiry, so it's unusable.",
  inventory_policy_issue:
    "Safety stock or reorder point are below the minimum advisable threshold for this SKU.",
  forecast_overstated:
    "Actual demand is consistently below forecast — the forecast appears overstated.",
  substitution_cannibalization:
    "A sibling SKU in the same category is spiking in demand while this SKU is dropping.",
};

function RootCauseCard({ rc }: { rc: any }) {
  const theme = useTheme();
  const [showJson, setShowJson] = useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const key = String(rc.rc_key ?? "");
  const title = _humaniseRcKey(key);
  const headline = RC_HEADLINE[key] ?? "Evidence found for this root cause.";
  const score = Number(rc.score ?? 0);
  const weight = Number(rc.weight ?? 0);
  const problem = rc.problem_ref || {};
  const evidence = (rc.evidence && typeof rc.evidence === "object" ? rc.evidence : {}) as Record<string, unknown>;
  // Score is effectively a 0..1 confidence (weight × fire), so render a subtle bar.
  const scorePct = Math.min(100, Math.max(0, Math.round(score * 100)));
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        borderLeft: 3,
        borderLeftColor: "warning.main",
        background: `linear-gradient(130deg, ${alpha(theme.palette.warning.main, 0.05)}, transparent 70%)`,
        transition: "box-shadow 0.15s",
        "&:hover": { boxShadow: 1 },
      }}
    >
      {/* Header row: title + problem chip + score pill + Show JSON */}
      <Stack direction="row" alignItems="flex-start" spacing={1.25} sx={{ mb: 1 }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: 1.5,
            bgcolor: "warning.main",
            color: "warning.contrastText",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <WarningIcon sx={{ fontSize: 16 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            <Chip
              size="small"
              label={key}
              variant="outlined"
              sx={{ height: 18, fontSize: 10, fontFamily: "ui-monospace, monospace" }}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            For{" "}
            <Box component="span" sx={{ fontFamily: "ui-monospace, monospace", color: "text.primary", fontWeight: 600 }}>
              {problem.sku ?? "—"}
            </Box>
            {" @ "}
            <Box component="span" sx={{ fontFamily: "ui-monospace, monospace", color: "text.primary", fontWeight: 600 }}>
              {problem.node_id ?? "—"}
            </Box>
            {problem.breach_week != null ? `  ·  breach wk+${problem.breach_week}` : ""}
          </Typography>
        </Box>
        <Stack spacing={0.25} alignItems="flex-end">
          <Chip
            size="small"
            color="warning"
            label={`score ${score.toFixed(2)}`}
            sx={{ height: 22, fontWeight: 700, fontSize: 10.5 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
            weight {weight.toFixed(2)}
          </Typography>
        </Stack>
        <Tooltip title={showJson ? "Hide raw JSON" : "Show raw JSON"}>
          <IconButton size="small" onClick={() => setShowJson((v) => !v)}>
            <CodeIcon fontSize="small" sx={{ color: showJson ? "primary.main" : "text.secondary" }} />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Plain-English headline */}
      <Typography variant="body2" sx={{ mb: 1, color: "text.primary", lineHeight: 1.55 }}>
        {headline}
      </Typography>

      {/* Score bar */}
      <Box sx={{ mb: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.5, fontSize: 10 }}>
            CONFIDENCE
          </Typography>
          <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: "grey.200", overflow: "hidden" }}>
            <Box sx={{ height: "100%", width: `${scorePct}%`, bgcolor: "warning.main" }} />
          </Box>
          <Typography variant="caption" sx={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, minWidth: 36, textAlign: "right" }}>
            {scorePct}%
          </Typography>
        </Stack>
      </Box>

      {/* Evidence: presentable */}
      {Object.keys(evidence).length > 0 ? (
        <Box>
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.5}
            sx={{ cursor: "pointer", mb: 0.75 }}
            onClick={() => setEvidenceExpanded((v) => !v)}
          >
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", fontSize: 10, color: "text.secondary" }}>
              Evidence
            </Typography>
            <ExpandIcon
              sx={{
                fontSize: 14,
                color: "text.secondary",
                transform: evidenceExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s",
              }}
            />
          </Stack>
          <EvidenceView evidence={evidence} expanded={evidenceExpanded} />
        </Box>
      ) : null}

      {showJson ? (
        <>
          <Divider sx={{ my: 1.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, letterSpacing: 0.6 }}>
              RAW JSON
            </Typography>
          </Divider>
          <Box component="pre" sx={{ ...preSx, maxHeight: 260 }}>
            {JSON.stringify(rc, null, 2)}
          </Box>
        </>
      ) : null}
    </Paper>
  );
}

// Renders the `evidence` object in a friendly way: scalar fields as chips,
// array fields (like `orders:[...]`) as compact row tables, nested objects as
// inline KV.
function EvidenceView({ evidence, expanded }: { evidence: Record<string, unknown>; expanded: boolean }) {
  const scalarEntries: Array<[string, unknown]> = [];
  const arrayEntries: Array<[string, unknown[]]> = [];
  const objectEntries: Array<[string, Record<string, unknown>]> = [];
  for (const [k, v] of Object.entries(evidence)) {
    if (Array.isArray(v)) arrayEntries.push([k, v]);
    else if (v && typeof v === "object") objectEntries.push([k, v as Record<string, unknown>]);
    else scalarEntries.push([k, v]);
  }
  const visibleScalars = expanded ? scalarEntries : scalarEntries.slice(0, 6);
  return (
    <Stack spacing={1}>
      {/* Scalars as chip grid */}
      {scalarEntries.length > 0 ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 0.75 }}>
          {visibleScalars.map(([k, v]) => (
            <Paper
              key={k}
              variant="outlined"
              sx={{ px: 1, py: 0.75, borderRadius: 1.25, bgcolor: "grey.50" }}
            >
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, fontSize: 9.5, letterSpacing: 0.5, textTransform: "uppercase", color: "text.secondary", display: "block" }}
              >
                {k.replace(/_/g, " ")}
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 600, wordBreak: "break-word" }}
              >
                {_formatScalar(v)}
              </Typography>
            </Paper>
          ))}
          {!expanded && scalarEntries.length > 6 ? (
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center", pl: 0.5 }}>
              +{scalarEntries.length - 6} more — click to expand
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {/* Arrays as mini tables (auto-detect common shapes) */}
      {expanded
        ? arrayEntries.map(([k, arr]) => (
            <Box key={k}>
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, letterSpacing: 0.5, fontSize: 10, color: "text.secondary", display: "block", mb: 0.5 }}
              >
                {k.replace(/_/g, " ").toUpperCase()} ({arr.length})
              </Typography>
              <EvidenceArray rows={arr} />
            </Box>
          ))
        : arrayEntries.length > 0 ? (
            <Typography variant="caption" color="text.secondary">
              +{arrayEntries.reduce((s, [, a]) => s + a.length, 0)} detail rows in {arrayEntries.length} group
              {arrayEntries.length === 1 ? "" : "s"} — click to expand
            </Typography>
          ) : null}

      {/* Nested objects as tiny KV strips (always visible — usually small) */}
      {objectEntries.map(([k, obj]) => (
        <Box key={k}>
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, letterSpacing: 0.5, fontSize: 10, color: "text.secondary", display: "block", mb: 0.5 }}
          >
            {k.replace(/_/g, " ").toUpperCase()}
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {Object.entries(obj).map(([ik, iv]) => (
              <Chip
                key={ik}
                size="small"
                label={`${ik}: ${_formatScalar(iv)}`}
                variant="outlined"
                sx={{ height: 20, fontSize: 10.5, fontFamily: "ui-monospace, monospace" }}
              />
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

function EvidenceArray({ rows }: { rows: unknown[] }) {
  if (rows.length === 0) return null;
  const first = rows[0];
  // If each row is a flat object, render a compact table; otherwise fall back
  // to a chip list so nothing ever crashes.
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const cols = Array.from(
      new Set(
        rows.flatMap((r) =>
          typeof r === "object" && r !== null ? Object.keys(r as Record<string, unknown>) : [],
        ),
      ),
    ).slice(0, 5);
    return (
      <Paper variant="outlined" sx={{ borderRadius: 1, overflow: "hidden" }}>
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <Box
                  component="th"
                  key={c}
                  sx={{
                    textAlign: "left",
                    px: 1,
                    py: 0.5,
                    bgcolor: "grey.50",
                    fontSize: 9.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "text.secondary",
                  }}
                >
                  {c.replace(/_/g, " ")}
                </Box>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r, idx) => {
              const row = (r as Record<string, unknown>) || {};
              return (
                <Box
                  component="tr"
                  key={idx}
                  sx={{ borderTop: "1px solid", borderColor: "divider", "&:hover": { bgcolor: "action.hover" } }}
                >
                  {cols.map((c) => (
                    <Box
                      component="td"
                      key={c}
                      sx={{ px: 1, py: 0.5, fontFamily: "ui-monospace, monospace", fontSize: 11, verticalAlign: "top" }}
                    >
                      {_formatScalar(row[c])}
                    </Box>
                  ))}
                </Box>
              );
            })}
          </tbody>
        </Box>
        {rows.length > 10 ? (
          <Box sx={{ px: 1, py: 0.5, bgcolor: "grey.50", fontSize: 10.5, color: "text.secondary" }}>
            Showing 10 of {rows.length}
          </Box>
        ) : null}
      </Paper>
    );
  }
  // Scalar array → chip list
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {rows.slice(0, 12).map((r, idx) => (
        <Chip
          key={idx}
          size="small"
          label={_formatScalar(r)}
          variant="outlined"
          sx={{ height: 20, fontSize: 10.5, fontFamily: "ui-monospace, monospace" }}
        />
      ))}
    </Stack>
  );
}

function _formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString();
    return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(3);
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 57) + "…" : v;
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? "" : "s"}]`;
  if (typeof v === "object") return "{…}";
  return String(v);
}

function ResolutionsGrid({ rows }: { rows: any[] }) {
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2 }}>
      <Box component="table" sx={tableSx}>
        <thead>
          <tr>
            {["Rank", "Family", "SKU", "From → To", "Qty", "Lead (d)", "Feasible", "Resolves?", "Sim"].map(
              (h) => (
                <Box component="th" key={h} sx={thSx}>
                  {h}
                </Box>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <Box
              component="tr"
              key={idx}
              sx={{
                "&:hover": { bgcolor: "action.hover" },
                borderLeft: 3,
                borderColor: r.resolves_breach
                  ? "success.main"
                  : r.feasible
                  ? "warning.main"
                  : "grey.300",
              }}
            >
              <Box component="td" sx={tdSx}>
                <Typography variant="caption" fontWeight={700}>#{r.rank ?? "—"}</Typography>
              </Box>
              <Box component="td" sx={{ ...tdSx, fontWeight: 600 }}>{r.family_key}</Box>
              <Box component="td" sx={tdSx}>{r.sku}</Box>
              <Box component="td" sx={tdSx}>
                <Typography variant="caption">
                  {r.from_node ?? "—"} <Typography component="span" color="text.secondary">→</Typography>{" "}
                  <b>{r.to_node}</b>
                </Typography>
              </Box>
              <Box component="td" sx={{ ...tdSx, fontWeight: 700 }}>{formatNumber(r.qty)}</Box>
              <Box component="td" sx={tdSx}>{r.lead_time_days ?? "—"}</Box>
              <Box component="td" sx={tdSx}>
                <Chip
                  size="small"
                  label={r.feasible ? "yes" : "no"}
                  color={r.feasible ? "success" : "default"}
                  sx={{ height: 20 }}
                />
              </Box>
              <Box component="td" sx={tdSx}>
                <Chip
                  size="small"
                  label={r.resolves_breach === true ? "✓ yes" : r.resolves_breach === false ? "no" : "—"}
                  color={
                    r.resolves_breach === true
                      ? "success"
                      : r.resolves_breach === false
                      ? "warning"
                      : "default"
                  }
                  sx={{ height: 20, fontWeight: 600 }}
                />
              </Box>
              <Box component="td" sx={tdSx}>
                {typeof r.simulation_score === "number" ? r.simulation_score.toFixed(3) : "—"}
              </Box>
            </Box>
          ))}
        </tbody>
      </Box>
    </Paper>
  );
}

function ActionPlanGrid({ plan }: { plan: any }) {
  const plans = (plan.plans ?? []) as any[];
  if (plans.length === 0) {
    return <EmptyCard text="No action plan rows — no resolutions or no permitted action templates for this intent." />;
  }
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2 }}>
      <Box component="table" sx={tableSx}>
        <thead>
          <tr>
            {["Status", "Template", "Delivery", "Target", "SKU", "From → To", "Qty", "Plan id"].map((h) => (
              <Box component="th" key={h} sx={thSx}>
                {h}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {plans.map((p, idx) => {
            const pl = p.payload || {};
            return (
              <Box component="tr" key={idx} sx={{ "&:hover": { bgcolor: "action.hover" } }}>
                <Box component="td" sx={tdSx}>
                  <Chip
                    size="small"
                    label={p.plan_status}
                    color={
                      p.plan_status === "sent"
                        ? "success"
                        : p.plan_status === "queued"
                        ? "info"
                        : p.plan_status === "failed"
                        ? "error"
                        : "default"
                    }
                    sx={{ height: 20, fontWeight: 600 }}
                  />
                </Box>
                <Box component="td" sx={tdSx}>{p.action_template_key}</Box>
                <Box component="td" sx={tdSx}>{p.delivery_mode}</Box>
                <Box component="td" sx={tdSx}>{p.target_system ?? "—"}</Box>
                <Box component="td" sx={tdSx}>{pl.sku ?? "—"}</Box>
                <Box component="td" sx={tdSx}>
                  {(pl.from_node ?? "—") + " → " + (pl.to_node ?? "—")}
                </Box>
                <Box component="td" sx={tdSx}>{formatNumber(pl.qty)}</Box>
                <Box component="td" sx={tdSx}>
                  <Tooltip title={p.plan_id}>
                    <Chip
                      size="small"
                      label={`${String(p.plan_id).slice(0, 8)}…`}
                      variant="outlined"
                      icon={<CopyIcon sx={{ fontSize: 12 }} />}
                      sx={{ height: 20, fontSize: 10, cursor: "pointer" }}
                      onClick={() => navigator.clipboard.writeText(p.plan_id)}
                    />
                  </Tooltip>
                </Box>
              </Box>
            );
          })}
        </tbody>
      </Box>
    </Paper>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 3, textAlign: "center", borderRadius: 2, bgcolor: "background.paper" }}
    >
      <Typography color="text.secondary" variant="body2">
        {text}
      </Typography>
    </Paper>
  );
}

const STEP_LABELS: Record<string, string> = {
  followup_interpret: "Follow-up interpreter",
  intent_parse: "Intent parser",
  scope_resolve: "Scope resolver",
  scope: "Scope resolver",
  capability_check: "Capability check",
  capability: "Capability check",
  detect_problems: "Problem detection",
  detect_signals: "Signal detection",
  prioritize: "Prioritization",
  analyze_root_cause: "Root-cause analyzer",
  enumerate_resolutions: "Resolution generator",
  simulate_rank: "Simulation ranker",
  map_actions: "Action mapper",
  compose_response: "Response composer",
  audit: "Audit logger",
};


function PipelineView({
  response,
  focusStepId,
  onConsumeFocus,
}: {
  response: InventoryDiagnosticResponse;
  focusStepId?: string | null;
  onConsumeFocus?: () => void;
}) {
  const stepsQuery = useQuery({
    queryKey: ["inventory-diagnostic-run-steps", response.run_id, response.agent_type],
    queryFn: () => fetchRunSteps(response.run_id, response.agent_type),
    enabled: Boolean(response.run_id),
    staleTime: 30_000,
  });

  if (stepsQuery.isLoading) {
    return <LinearProgress />;
  }
  const steps = (stepsQuery.data ?? []).slice().sort((a, b) => a.sequence - b.sequence);
  if (steps.length === 0) {
    return <EmptyCard text="No step artifacts recorded for this run." />;
  }
  // Map the logical focus id to the actual step_id emitted by this agent.
  // Inventory Diagnostic uses "detect_problems"; Demand Sensing uses
  // "detect_signals". Both `scope_resolve`/`scope` and `capability_check`/
  // `capability` are aliased. We match either the exact id or one of the
  // known aliases so deep-links work across agents.
  const focusAliases: Record<string, string[]> = {
    detect_problems: ["detect_problems", "detect_signals"],
    detect_signals: ["detect_signals", "detect_problems"],
    scope_resolve: ["scope_resolve", "scope"],
    scope: ["scope", "scope_resolve"],
    capability_check: ["capability_check", "capability"],
    capability: ["capability", "capability_check"],
  };
  const resolvedFocusAliases = focusStepId ? focusAliases[focusStepId] ?? [focusStepId] : [];
  return (
    <Stack spacing={1}>
      {steps.map((step) => (
        <PipelineStepCard
          key={step.id}
          step={step}
          autoExpand={resolvedFocusAliases.includes(step.step_id)}
          onAutoExpandConsumed={onConsumeFocus}
        />
      ))}
    </Stack>
  );
}

function PipelineStepCard({
  step,
  autoExpand = false,
  onAutoExpandConsumed,
}: {
  step: RunStepArtifact;
  autoExpand?: boolean;
  onAutoExpandConsumed?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (autoExpand) {
      setExpanded(true);
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      onAutoExpandConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpand]);
  const label = STEP_LABELS[step.step_id] ?? step.step_id;
  const ran = step.status === "ok";
  const err = step.status === "error";
  const llmCall = step.llm_call && typeof step.llm_call === "object" ? step.llm_call : {};
  const hasLlm = Boolean((llmCall as any).provider && !(llmCall as any).error);
  return (
    <Paper
      ref={cardRef}
      variant="outlined"
      sx={{
        borderRadius: 2,
        bgcolor: ran ? "background.paper" : "action.disabledBackground",
        opacity: ran ? 1 : 0.75,
        borderLeft: 3,
        borderLeftColor: err ? "error.main" : hasLlm ? "success.main" : ran ? "primary.main" : "grey.400",
        overflow: "hidden",
      }}
    >
      <Box
        onClick={() => setExpanded((v) => !v)}
        sx={{
          p: 1.25,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Avatar
          sx={{
            width: 28,
            height: 28,
            bgcolor: err ? "error.main" : hasLlm ? "success.main" : ran ? "primary.main" : "action.disabled",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {step.sequence + 1}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" fontWeight={600}>
              {label}
            </Typography>
            {hasLlm ? (
              <Chip
                size="small"
                icon={<FlashIcon sx={{ fontSize: 12 }} />}
                label={`LLM · ${(llmCall as any).latency_ms ?? 0}ms`}
                color="success"
                sx={{ height: 18, fontSize: 10 }}
              />
            ) : null}
            <Chip
              size="small"
              label={`${step.row_count} row${step.row_count === 1 ? "" : "s"}`}
              variant="outlined"
              sx={{ height: 18, fontSize: 10 }}
            />
            <Chip
              size="small"
              label={`${step.duration_ms}ms`}
              variant="outlined"
              sx={{ height: 18, fontSize: 10 }}
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {_summariseStep(step)}
          </Typography>
        </Box>
        {expanded ? (
          <JsonToggleButton showJson={showJson} onToggle={() => setShowJson((v) => !v)} />
        ) : null}
        <Chip
          size="small"
          label={step.status}
          color={err ? "error" : ran ? "success" : "default"}
          variant="outlined"
          sx={{ height: 20 }}
        />
      </Box>
      {expanded ? (
        <Box sx={{ borderTop: 1, borderColor: "divider", p: 1.5, bgcolor: "grey.50" }}>
          <Stack spacing={1.5}>
            {step.warnings?.length ? (
              <Alert severity={err ? "error" : "warning"} sx={{ py: 0 }}>
                {step.warnings.join(" · ")}
              </Alert>
            ) : null}
            <StepDetailBody step={step} />
            {showJson ? <JsonPanelWithDivider step={step} /> : null}
          </Stack>
        </Box>
      ) : null}
    </Paper>
  );
}

function _summariseStep(step: RunStepArtifact): string {
  const outputs = step.outputs || {};
  const parts: string[] = [];
  if (step.status === "skipped") parts.push("skipped");
  if ("narrative_length" in outputs) parts.push(`${outputs.narrative_length} chars`);
  if ("root_cause_count" in outputs) parts.push(`${outputs.root_cause_count} RCs`);
  if ("total_count" in outputs && "resolves_breach_count" in outputs) {
    parts.push(`${outputs.resolves_breach_count}/${outputs.total_count} resolve breach`);
  } else if ("candidate_count_pre_simulation" in outputs) {
    parts.push(`${outputs.candidate_count_pre_simulation} candidates`);
  }
  if ("problem_count" in outputs) parts.push(`${outputs.problem_count} problems`);
  if ("ranked_count" in outputs) parts.push(`${outputs.ranked_count} ranked`);
  if ("sku_node_pairs_count" in outputs) parts.push(`${outputs.sku_node_pairs_count} sku×node`);
  if ("available" in outputs) parts.push(`${(outputs.available as unknown[]).length} slots ok`);
  if ("plan_count" in outputs) parts.push(`${outputs.plan_count} plans`);
  if ("run_id" in outputs) parts.push(`run_id ${String(outputs.run_id).slice(0, 8)}…`);
  return parts.join(" · ") || "(no output summary)";
}

function AuditView({ response }: { response: InventoryDiagnosticResponse }) {
  const llmCalls = (response.llm_calls ?? []) as any[];
  return (
    <Stack spacing={2}>
      <SectionHeader title="Run summary" count={0} subtitle={response.run_id} />
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
          <KV label="intent" value={response.intent_mode} />
          <KV label="agent_type_version" value={String(response.agent_type_version)} />
          <KV label="conversation_id" value={response.conversation_id ?? "—"} />
          <KV
            label="llm_active"
            value={response.llm_active ? `yes · ${response.llm_model}` : "no (deterministic)"}
          />
          <KV label="warnings" value={String(response.warnings.length)} />
        </Stack>
      </Paper>

      <SectionHeader title="LLM calls" count={llmCalls.length} />
      <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2 }}>
        <Box component="table" sx={tableSx}>
          <thead>
            <tr>
              {["Call site", "Provider", "Model", "Tokens in", "Tokens out", "Latency", "Status"].map(
                (h) => (
                  <Box component="th" key={h} sx={thSx}>
                    {h}
                  </Box>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {llmCalls.length === 0 ? (
              <tr>
                <Box component="td" colSpan={7} sx={{ ...tdSx, color: "text.secondary", py: 2, textAlign: "center" }}>
                  No LLM calls recorded.
                </Box>
              </tr>
            ) : (
              llmCalls.map((c: any, idx: number) => (
                <Box component="tr" key={idx} sx={{ "&:hover": { bgcolor: "action.hover" } }}>
                  <Box component="td" sx={{ ...tdSx, fontWeight: 600 }}>{c.call_site}</Box>
                  <Box component="td" sx={tdSx}>{c.provider ?? "—"}</Box>
                  <Box component="td" sx={tdSx}>{c.model ?? "—"}</Box>
                  <Box component="td" sx={tdSx}>{c.tokens_in ?? "—"}</Box>
                  <Box component="td" sx={tdSx}>{c.tokens_out ?? "—"}</Box>
                  <Box component="td" sx={tdSx}>{c.latency_ms ?? 0} ms</Box>
                  <Box component="td" sx={tdSx}>
                    {c.error ? (
                      <Tooltip title={c.error}>
                        <Chip size="small" color="warning" label="fallback" sx={{ height: 20 }} />
                      </Tooltip>
                    ) : (
                      <Chip size="small" color="success" label="ok" sx={{ height: 20 }} />
                    )}
                  </Box>
                </Box>
              ))
            )}
          </tbody>
        </Box>
      </Paper>

      <StructuredOutputPanel structured={response.structured} />
    </Stack>
  );
}

// Polished human-friendly view of the final structured output. Same visual
// language as the rest of the chat (cards + chips + stat strips) with a
// "Show JSON" toggle for power users who want the raw payload.
function StructuredOutputPanel({ structured }: { structured: Record<string, unknown> }) {
  const theme = useTheme();
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);

  const scope = (structured.scope as Record<string, unknown>) ?? {};
  const problems = ((structured.problems as any[]) ?? []);
  const rootCauses = ((structured.root_causes as any[]) ?? []);
  const resolutions = ((structured.resolutions as any[]) ?? []);
  const actionPlan = structured.action_plan as Record<string, unknown> | null;
  const capabilities = (structured.capabilities_applied as Record<string, unknown>) ?? {};
  const warnings = ((structured.warnings as string[]) ?? []);

  const slotsAvailable = ((capabilities.slots_available as string[]) ?? []);
  const slotsMissing = ((capabilities.slots_missing as string[]) ?? []);
  const slotsDegraded = ((capabilities.slots_degraded as string[]) ?? []);
  const disabledProblems = ((capabilities.disabled_problems as string[]) ?? []);
  const plans = ((actionPlan?.plans as any[]) ?? []);
  const planStatus = String(actionPlan?.status ?? "—");

  const scopeSkus = ((scope.skus as string[]) ?? []);
  const scopeNodes = ((scope.nodes as string[]) ?? []);
  const scopeWeeks = ((scope.week_offsets as number[]) ?? (scope.weeks as number[]) ?? []);

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(structured, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Stack spacing={1.25}>
      {/* Header row with Show JSON / Copy controls */}
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "text.secondary" }}>
          Structured Output
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={copied ? "Copied!" : "Copy full JSON"}>
          <IconButton size="small" onClick={copyJson}>
            <CopyIcon fontSize="small" sx={{ color: copied ? "success.main" : "text.secondary" }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={showJson ? "Hide raw JSON" : "Show raw JSON"}>
          <IconButton size="small" onClick={() => setShowJson((v) => !v)}>
            <CodeIcon fontSize="small" sx={{ color: showJson ? "primary.main" : "text.secondary" }} />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Stat summary strip */}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <OutputStat icon={<ErrorIcon fontSize="small" />} value={problems.length} label="Problems" color="error" />
        <OutputStat icon={<WarningIcon fontSize="small" />} value={rootCauses.length} label="Root causes" color="warning" />
        <OutputStat icon={<AutoIcon fontSize="small" />} value={resolutions.length} label="Resolutions" color="primary" />
        <OutputStat icon={<CheckIcon fontSize="small" />} value={plans.length} label="Action plans" color="success" />
      </Stack>

      {/* Scope card */}
      <Paper
        variant="outlined"
        sx={{ p: 1.5, borderRadius: 2, borderLeft: 3, borderLeftColor: "primary.main" }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "text.secondary", display: "block", mb: 0.75 }}>
          Scope
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 1 }}>
          <OutputKV label="SKUs in scope" value={scopeSkus.length} chips={scopeSkus.slice(0, 8)} />
          <OutputKV label="Nodes in scope" value={scopeNodes.length} chips={scopeNodes.slice(0, 8)} />
          <OutputKV label="Weeks" value={scopeWeeks.length > 0 ? `wk+${Math.min(...scopeWeeks)} → wk+${Math.max(...scopeWeeks)}` : "—"} />
          {scope.focus ? <OutputKV label="Focus" value={String(scope.focus)} /> : null}
        </Box>
      </Paper>

      {/* Action plan card */}
      {actionPlan ? (
        <Paper
          variant="outlined"
          sx={{ p: 1.5, borderRadius: 2, borderLeft: 3, borderLeftColor: planStatus === "queued" ? "success.main" : planStatus === "draft" ? "primary.main" : "grey.400" }}
        >
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "text.secondary" }}>
              Action plan
            </Typography>
            <Chip
              size="small"
              label={planStatus}
              color={planStatus === "queued" ? "success" : planStatus === "draft" ? "primary" : "default"}
              sx={{ height: 18, fontSize: 10, textTransform: "uppercase", fontWeight: 700 }}
            />
            <Chip
              size="small"
              label={actionPlan.dispatch_enabled ? "dispatch ON" : "dry-run"}
              color={actionPlan.dispatch_enabled ? "success" : "default"}
              variant="outlined"
              sx={{ height: 18, fontSize: 10 }}
            />
          </Stack>
          {plans.length > 0 ? (
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 0.75 }}>
              {plans.slice(0, 6).map((p: any, idx: number) => (
                <Paper key={idx} variant="outlined" sx={{ px: 1, py: 0.75, borderRadius: 1.25, bgcolor: "grey.50" }}>
                  <Typography variant="caption" sx={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, fontWeight: 700, color: "primary.main" }}>
                    {p.action_template_key}
                  </Typography>
                  <Typography variant="body2" sx={{ fontSize: 11.5 }}>
                    {p.payload?.sku ?? "—"}{" "}
                    <Box component="span" sx={{ color: "text.secondary" }}>
                      · {p.payload?.family_key ?? "—"}
                    </Box>
                  </Typography>
                </Paper>
              ))}
              {plans.length > 6 ? (
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                  +{plans.length - 6} more
                </Typography>
              ) : null}
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              No planned actions.
            </Typography>
          )}
        </Paper>
      ) : null}

      {/* Capability card */}
      {(slotsAvailable.length || slotsMissing.length || slotsDegraded.length || disabledProblems.length) ? (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "text.secondary", display: "block", mb: 0.75 }}>
            Capabilities applied
          </Typography>
          <Stack spacing={0.75}>
            {slotsAvailable.length > 0 ? (
              <CapRow color="success" label="Available slots" items={slotsAvailable} />
            ) : null}
            {slotsDegraded.length > 0 ? (
              <CapRow color="warning" label="Degraded slots" items={slotsDegraded} />
            ) : null}
            {slotsMissing.length > 0 ? (
              <CapRow color="error" label="Missing slots" items={slotsMissing} />
            ) : null}
            {disabledProblems.length > 0 ? (
              <CapRow color="default" label="Disabled problems" items={disabledProblems} />
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      {/* Warnings */}
      {warnings.length > 0 ? (
        <Alert severity="warning" sx={{ py: 0.75 }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}:
          </Typography>
          <Stack spacing={0.25} sx={{ mt: 0.5 }}>
            {warnings.map((w, i) => (
              <Typography key={i} variant="caption" sx={{ lineHeight: 1.5 }}>
                · {w}
              </Typography>
            ))}
          </Stack>
        </Alert>
      ) : null}

      {/* Raw JSON — toggleable */}
      {showJson ? (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.02) }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
            <CodeIcon fontSize="small" color="primary" />
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "text.secondary" }}>
              Raw JSON
            </Typography>
          </Stack>
          <Box component="pre" sx={{ ...preSx, maxHeight: 420, bgcolor: "background.paper" }}>
            {JSON.stringify(structured, null, 2)}
          </Box>
        </Paper>
      ) : null}
    </Stack>
  );
}

function OutputStat({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  color: "error" | "warning" | "primary" | "success" | "default";
}) {
  const theme = useTheme();
  const palette =
    color === "default" ? theme.palette.grey : (theme.palette[color] as typeof theme.palette.error);
  const mainColor = color === "default" ? theme.palette.text.primary : (palette as any).main;
  const tint = color === "default" ? theme.palette.grey[100] : alpha((palette as any).main, 0.08);
  return (
    <Paper
      variant="outlined"
      sx={{
        flex: 1,
        minWidth: 110,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        background: `linear-gradient(135deg, ${tint}, transparent)`,
        borderColor: color === "default" ? "divider" : alpha((palette as any).main, 0.25),
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Box sx={{ color: mainColor }}>{icon}</Box>
        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1, color: mainColor }}>
          {value}
        </Typography>
      </Stack>
      <Typography
        variant="caption"
        sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10, color: "text.secondary" }}
      >
        {label}
      </Typography>
    </Paper>
  );
}

function OutputKV({
  label,
  value,
  chips,
}: {
  label: string;
  value: React.ReactNode;
  chips?: string[];
}) {
  return (
    <Box>
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, fontSize: 9.5, letterSpacing: 0.5, textTransform: "uppercase", color: "text.secondary", display: "block" }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: chips && chips.length > 0 ? 0.5 : 0 }}>
        {value}
      </Typography>
      {chips && chips.length > 0 ? (
        <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap>
          {chips.map((c) => (
            <Chip
              key={c}
              size="small"
              label={c}
              variant="outlined"
              sx={{ height: 18, fontSize: 10, fontFamily: "ui-monospace, monospace" }}
            />
          ))}
        </Stack>
      ) : null}
    </Box>
  );
}

function CapRow({
  color,
  label,
  items,
}: {
  color: "success" | "warning" | "error" | "default";
  label: string;
  items: string[];
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, fontSize: 10, minWidth: 130, pt: 0.3, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5 }}
      >
        {label} ({items.length})
      </Typography>
      <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap sx={{ flex: 1 }}>
        {items.map((s) => (
          <Chip
            key={s}
            size="small"
            label={s}
            color={color === "default" ? undefined : color}
            variant="outlined"
            sx={{ height: 18, fontSize: 10, fontFamily: "ui-monospace, monospace" }}
          />
        ))}
      </Stack>
    </Stack>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", fontSize: 10 }}
      >
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        {value}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------- LLM badge (with error popover)

type LlmBadgeInfo = {
  label: string;
  color: "success" | "error" | "default";
  icon: React.ReactElement;
  tooltip: string;
  error?: {
    provider: string;
    model?: string;
    detail: string;
    reason: string;
    remediation: string;
  };
};

function LlmBadge({ badge }: { badge: LlmBadgeInfo }) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [popOpen, setPopOpen] = useState(false);
  const clickable = Boolean(badge.error);
  return (
    <>
      <Box ref={anchorRef} sx={{ display: "inline-flex" }}>
        <Tooltip title={badge.tooltip} placement="bottom-start">
          <Chip
            size="small"
            icon={badge.icon}
            color={badge.color}
            label={badge.label}
            onClick={clickable ? () => setPopOpen((v) => !v) : undefined}
            sx={{
              height: 22,
              fontSize: 10.5,
              fontWeight: 600,
              maxWidth: 360,
              cursor: clickable ? "pointer" : "default",
            }}
          />
        </Tooltip>
      </Box>
      <Popover
        open={popOpen}
        anchorEl={anchorRef.current}
        onClose={() => setPopOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.5,
              maxWidth: 460,
              borderRadius: 2,
              boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
            },
          },
        }}
      >
        {badge.error ? (
          <Box sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <ErrorIcon color="error" fontSize="small" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {badge.error.provider} health check failed
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
              <strong>Reason:</strong> {badge.error.reason}
            </Typography>
            {badge.error.model ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
                <strong>Model attempted:</strong> {badge.error.model}
              </Typography>
            ) : null}
            <Typography variant="body2" sx={{ mt: 1, mb: 1 }}>
              {badge.error.remediation}
            </Typography>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10 }}>
                Raw error detail
              </Typography>
              <Box
                component="pre"
                sx={{
                  bgcolor: "grey.50",
                  p: 1,
                  mt: 0.5,
                  borderRadius: 1,
                  fontSize: 10.5,
                  fontFamily: "ui-monospace, monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 160,
                  overflow: "auto",
                  border: 1,
                  borderColor: "divider",
                  margin: 0,
                }}
              >
                {badge.error.detail}
              </Box>
            </Box>
          </Box>
        ) : null}
      </Popover>
    </>
  );
}

// ---------------------------------------------------- styled constants

const tableSx = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12.5,
  "& th, & td": { padding: "8px 12px", textAlign: "left" as const },
  "& tbody tr": { borderTop: "1px solid", borderColor: "divider" },
};
const thSx = {
  fontWeight: 700,
  fontSize: 10.5,
  color: "text.secondary",
  textTransform: "uppercase" as const,
  letterSpacing: 0.8,
  bgcolor: "grey.50",
  borderBottom: "2px solid",
  borderColor: "divider",
};
const tdSx = {
  verticalAlign: "top" as const,
};
const preSx = {
  bgcolor: "grey.50",
  p: 1.5,
  borderRadius: 1,
  fontSize: 11,
  fontFamily: "ui-monospace, Menlo, monospace",
  maxHeight: 220,
  overflow: "auto" as const,
  whiteSpace: "pre-wrap" as const,
  margin: 0,
};
