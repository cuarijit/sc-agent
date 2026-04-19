import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import PreviewOutlinedIcon from "@mui/icons-material/PreviewOutlined";
import PublishOutlinedIcon from "@mui/icons-material/PublishOutlined";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton } from "@mui/material";

import { resolveIcon, getAvailableIconNames } from "../../../app/navigation/iconRegistry";
import type { AgentTemplate } from "../../../services/agentConfigApi";
import TagInput from "./TagInput";
import PromptSectionEditor from "./PromptSectionEditor";
import SliderWithLabel from "./SliderWithLabel";
import MetricFormulaEditor from "./MetricFormulaEditor";
import KeyValuePairEditor from "./KeyValuePairEditor";
import PromptPreviewDialog from "./PromptPreviewDialog";

// ── Type helpers for behavior sub-objects ───────────────────────────────

interface ScopeDetection {
  out_of_scope_keywords?: string[];
  db_signal_keywords?: string[];
  out_of_scope_response?: string;
  enabled?: boolean;
}

interface AmbiguityDetection {
  weak_keywords?: string[];
  empty_question_message?: string;
  too_broad_message?: string;
  ambiguity_follow_ups?: string[];
  min_question_tokens?: number;
  enabled?: boolean;
}

interface KpiDetection {
  keywords?: string[];
  playbook?: Record<string, string>;
}

interface LlmTemperatures {
  sql_generation?: number;
  reasoning?: number;
  explanation?: number;
}

interface RowLimits {
  max_rows_default?: number;
  row_limit_default?: number;
}

interface ConfidenceWeights {
  base_score?: number;
  llm_invoked_bonus?: number;
  has_rows_bonus?: number;
  large_result_bonus?: number;
  large_result_threshold?: number;
  warning_penalty?: number;
  max_warning_penalty?: number;
  min_confidence?: number;
  max_confidence?: number;
}

interface ColumnClassification {
  dimension_keywords?: string[];
  percentage_keywords?: string[];
  date_keywords?: string[];
  text_keywords?: string[];
}

interface UiBehavior {
  action_labels?: Record<string, string>;
  enable_charts?: boolean;
  grid_collapsed_default?: boolean;
  row_limit_default?: number;
}

interface FlowConfig {
  nodes?: string[];
  skip_nodes?: string[];
}

// ── Props ───────────────────────────────────────────────────────────────

interface AgentTemplateEditorProps {
  open: boolean;
  template: AgentTemplate | null;
  onClose: () => void;
  onSave: (typeKey: string, payload: {
    display_name?: string;
    description?: string;
    default_config?: Record<string, unknown>;
    default_instance?: Record<string, unknown>;
    ui_hints?: Record<string, unknown>;
    behavior?: Record<string, unknown>;
  }) => void;
  onSync: (typeKey: string) => void;
  onPublish?: (typeKey: string) => void | Promise<void>;
}

// ── Tab panel helper ────────────────────────────────────────────────────

function TabPanel({ value, index, children }: { value: number; index: number; children: React.ReactNode }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

// ── Status color mapping ────────────────────────────────────────────────

const STATUS_COLOR: Record<string, "success" | "warning" | "default"> = {
  active: "success",
  draft: "warning",
  deprecated: "default",
};

// ── Available LLM models ────────────────────────────────────────────────

const LLM_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-3.5-turbo",
  "claude-3-haiku",
  "claude-3-sonnet",
  "claude-3-opus",
];

// ── Default flow nodes ──────────────────────────────────────────────────

const ALL_FLOW_NODES = [
  "resolve_context",
  "guard_api_key",
  "guard_scope",
  "guard_ambiguity",
  "build_response",
  "append_history",
];

// ── Main component ──────────────────────────────────────────────────────

export default function AgentTemplateEditor({
  open,
  template,
  onClose,
  onSave,
  onSync,
  onPublish,
}: AgentTemplateEditorProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Identity state ──────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");

  // ── Behavior state ──────────────────────────────────────────────────
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemPromptSections, setSystemPromptSections] = useState<Record<string, string>>({});
  const [systemMessage, setSystemMessage] = useState("");
  const [reasoningPrompt, setReasoningPrompt] = useState("");
  const [explanationPrompt, setExplanationPrompt] = useState("");
  const [metricFormulas, setMetricFormulas] = useState<Record<string, string>>({});

  // Scope detection
  const [scopeEnabled, setScopeEnabled] = useState(true);
  const [outOfScopeKeywords, setOutOfScopeKeywords] = useState<string[]>([]);
  const [inScopeKeywords, setInScopeKeywords] = useState<string[]>([]);
  const [outOfScopeResponse, setOutOfScopeResponse] = useState("");

  // Ambiguity detection
  const [ambiguityEnabled, setAmbiguityEnabled] = useState(true);
  const [weakKeywords, setWeakKeywords] = useState<string[]>([]);
  const [minQuestionTokens, setMinQuestionTokens] = useState(2);

  // KPI detection
  const [kpiKeywords, setKpiKeywords] = useState<string[]>([]);
  const [kpiPlaybooks, setKpiPlaybooks] = useState<Record<string, string>>({});

  // LLM
  const [defaultModel, setDefaultModel] = useState("gpt-4o-mini");
  const [temperatures, setTemperatures] = useState<LlmTemperatures>({
    sql_generation: 0,
    reasoning: 0.2,
    explanation: 0.3,
  });
  const [rowLimits, setRowLimits] = useState<RowLimits>({
    max_rows_default: 200,
    row_limit_default: 2000,
  });
  const [confidenceWeights, setConfidenceWeights] = useState<ConfidenceWeights>({
    base_score: 0.45,
    llm_invoked_bonus: 0.2,
    has_rows_bonus: 0.2,
    large_result_bonus: 0.05,
    warning_penalty: 0.06,
  });

  // Data mapping
  const [columnClassification, setColumnClassification] = useState<ColumnClassification>({});

  // UI & Presentation
  const [icon, setIcon] = useState("SmartToyOutlined");
  const [buttonText, setButtonText] = useState("");
  const [buttonStyle, setButtonStyle] = useState("icon_and_text");
  const [tooltipText, setTooltipText] = useState("");
  const [configRef, setConfigRef] = useState("");
  const [uiBehavior, setUiBehavior] = useState<UiBehavior>({
    enable_charts: true,
    grid_collapsed_default: false,
    row_limit_default: 2000,
  });

  // Flow
  const [flowConfig, setFlowConfig] = useState<FlowConfig>({
    nodes: ALL_FLOW_NODES,
    skip_nodes: [],
  });

  // Agentic library (inventory_diagnostic_agent only). Passthrough of the
  // template behavior subsections that the deterministic runtime reads.
  // Editing happens via the Agentic Library tab.
  const [agenticExtras, setAgenticExtras] = useState<Record<string, unknown>>({});

  // ── Reset all state from template ─────────────────────────────────────

  useEffect(() => {
    if (!open || !template) return;
    setActiveTab(0);

    // Identity
    setDisplayName(template.display_name);
    setDescription(template.description);

    const b = (template.behavior ?? {}) as Record<string, unknown>;

    // Prompt engineering
    setSystemPrompt((b.system_prompt as string) ?? "");
    setSystemPromptSections(
      (b.system_prompt_sections as Record<string, string>) ?? {},
    );
    setSystemMessage((b.system_message as string) ?? "");
    setReasoningPrompt((b.reasoning_system_prompt as string) ?? "");
    setExplanationPrompt((b.explanation_system_prompt as string) ?? "");

    // Metric formulas
    const mfRaw = b.metric_formulas as Record<string, string> | undefined;
    setMetricFormulas(mfRaw ?? {});

    // Scope detection
    const scope = (b.scope_detection ?? {}) as ScopeDetection;
    setScopeEnabled(scope.enabled !== false);
    setOutOfScopeKeywords(scope.out_of_scope_keywords ?? []);
    setInScopeKeywords(scope.db_signal_keywords ?? []);
    setOutOfScopeResponse(scope.out_of_scope_response ?? "");

    // Ambiguity detection
    const ambiguity = (b.ambiguity_detection ?? {}) as AmbiguityDetection;
    setAmbiguityEnabled(ambiguity.enabled !== false);
    setWeakKeywords(ambiguity.weak_keywords ?? []);
    setMinQuestionTokens(ambiguity.min_question_tokens ?? 2);

    // KPI detection
    const kpi = (b.kpi_detection ?? {}) as KpiDetection;
    setKpiKeywords(kpi.keywords ?? []);
    setKpiPlaybooks(kpi.playbook ?? {});

    // LLM settings
    const llmTemps = (b.llm_temperatures ?? {}) as LlmTemperatures;
    setDefaultModel((b.default_model as string) ?? "gpt-4o-mini");
    setTemperatures({
      sql_generation: llmTemps.sql_generation ?? 0,
      reasoning: llmTemps.reasoning ?? 0.2,
      explanation: llmTemps.explanation ?? 0.3,
    });
    const rl = (b.row_limits ?? {}) as RowLimits;
    setRowLimits({
      max_rows_default: rl.max_rows_default ?? 200,
      row_limit_default: rl.row_limit_default ?? 2000,
    });
    const cw = (b.confidence_weights ?? {}) as ConfidenceWeights;
    setConfidenceWeights({
      base_score: cw.base_score ?? 0.45,
      llm_invoked_bonus: cw.llm_invoked_bonus ?? 0.2,
      has_rows_bonus: cw.has_rows_bonus ?? 0.2,
      large_result_bonus: cw.large_result_bonus ?? 0.05,
      warning_penalty: cw.warning_penalty ?? 0.06,
    });

    // Data mapping
    const cc = (b.column_classification ?? {}) as ColumnClassification;
    setColumnClassification(cc);

    // UI
    setIcon(template.default_instance?.icon ?? "SmartToyOutlined");
    setButtonText(template.default_instance?.button_text ?? "");
    setButtonStyle(template.default_instance?.button_style ?? "icon_and_text");
    setTooltipText(template.default_instance?.tooltip_text ?? "");
    setConfigRef(template.default_instance?.config_ref ?? "");
    const uiB = (b.ui_behavior ?? {}) as UiBehavior;
    setUiBehavior({
      enable_charts: uiB.enable_charts !== false,
      grid_collapsed_default: uiB.grid_collapsed_default === true,
      row_limit_default: uiB.row_limit_default ?? 2000,
      action_labels: uiB.action_labels ?? {},
    });

    // Flow
    const fl = (b.flow ?? {}) as FlowConfig;
    setFlowConfig({
      nodes: fl.nodes ?? ALL_FLOW_NODES,
      skip_nodes: fl.skip_nodes ?? [],
    });

    // Agentic library passthrough for inventory_diagnostic_agent. Preserve
    // the template's library / decision_graph / slot_catalog / llm_call_sites
    // / resolution_to_actions / intents so they round-trip on save.
    setAgenticExtras({
      library: b.library,
      decision_graph: b.decision_graph,
      slot_catalog: b.slot_catalog,
      llm_call_sites: b.llm_call_sites,
      resolution_to_actions: b.resolution_to_actions,
      intents: b.intents,
      calculation_profile: b.calculation_profile,
      prioritization: b.prioritization,
      response_schema: b.response_schema,
      semantic_slots: b.semantic_slots,
      llm_policy: b.llm_policy,
    });
  }, [open, template]);

  // ── Assembled prompt for preview ──────────────────────────────────────

  const assembledPrompt = useMemo(() => {
    const parts: string[] = [];
    if (systemPrompt) parts.push(systemPrompt);
    parts.push("TODAY'S DATE IS {today}.");
    if (systemMessage) {
      parts.push("");
      parts.push(systemMessage);
    }
    for (const [key, section] of Object.entries(systemPromptSections)) {
      if (section) {
        parts.push("");
        parts.push(`--- Section: ${key} ---`);
        parts.push(section);
      }
    }
    if (Object.keys(metricFormulas).length > 0) {
      parts.push("");
      parts.push("=== CONFIGURED METRICS ===");
      for (const [name, formula] of Object.entries(metricFormulas)) {
        parts.push(`  ${name} = ${formula}`);
      }
    }
    parts.push("");
    parts.push("=== AVAILABLE VIEWS ===");
    parts.push("{view_list}");
    parts.push("");
    parts.push("=== SCHEMA ===");
    parts.push("{schema_context}");
    return parts.join("\n");
  }, [systemPrompt, systemMessage, systemPromptSections, metricFormulas]);

  if (!template) return null;

  // ── Build save payload ────────────────────────────────────────────────

  const handleSave = () => {
    const behavior: Record<string, unknown> = {
      system_prompt: systemPrompt,
      system_prompt_sections: systemPromptSections,
      system_message: systemMessage,
      reasoning_system_prompt: reasoningPrompt,
      explanation_system_prompt: explanationPrompt,
      metric_formulas: metricFormulas,
      scope_detection: {
        enabled: scopeEnabled,
        out_of_scope_keywords: outOfScopeKeywords,
        db_signal_keywords: inScopeKeywords,
        out_of_scope_response: outOfScopeResponse,
      },
      ambiguity_detection: {
        enabled: ambiguityEnabled,
        weak_keywords: weakKeywords,
        min_question_tokens: minQuestionTokens,
      },
      kpi_detection: {
        keywords: kpiKeywords,
        playbook: kpiPlaybooks,
      },
      default_model: defaultModel,
      llm_temperatures: temperatures,
      row_limits: rowLimits,
      confidence_weights: confidenceWeights,
      column_classification: columnClassification,
      ui_behavior: uiBehavior,
      flow: flowConfig,
    };

    // Preserve agentic-library keys for inventory_diagnostic_agent so edits
    // made in the Agentic Library tab round-trip.
    if (template.type_key === "inventory_diagnostic_agent") {
      for (const [k, v] of Object.entries(agenticExtras)) {
        if (v !== undefined) behavior[k] = v;
      }
    }

    onSave(template.type_key, {
      display_name: displayName,
      description,
      default_instance: {
        icon,
        button_text: buttonText,
        button_style: buttonStyle,
        tooltip_text: tooltipText,
        config_ref: configRef || undefined,
      },
      behavior,
    });
    onClose();
  };

  // ── Section color accents ─────────────────────────────────────────────

  const sectionColor = (tab: number) => {
    switch (tab) {
      case 3: return "primary.main";     // LLM Settings — blue
      case 2: return "success.main";     // Intelligence — green
      case 1: return "warning.main";     // Prompt Engineering — amber
      default: return "text.primary";
    }
  };

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: { width: { xs: "100%", md: 720, lg: 840 } },
        }}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: "divider" }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <MemoryOutlinedIcon color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
              Edit Template: {displayName || template.type_key}
            </Typography>
            <Chip
              size="small"
              label={`${template.status} · v${template.template_version}`}
              color={STATUS_COLOR[template.status] ?? "default"}
              variant={template.status === "active" ? "filled" : "outlined"}
            />
            {template.status === "draft" && onPublish ? (
              <Tooltip title="Promote this draft to active. Bumps the version and makes instances creatable.">
                <Button
                  startIcon={<PublishOutlinedIcon />}
                  size="small"
                  variant="contained"
                  color="success"
                  onClick={() => { void onPublish(template.type_key); }}
                >
                  Promote to Active
                </Button>
              </Tooltip>
            ) : null}
            <Button
              startIcon={<SyncOutlinedIcon />}
              size="small"
              onClick={() => onSync(template.type_key)}
              disabled={template.status === "draft"}
            >
              Sync Instances
            </Button>
          </Stack>
        </Box>

        {/* ── Tabs ───────────────────────────────────────── */}
        <Box sx={{ borderBottom: 1, borderColor: "divider", px: 2 }}>
          <Tabs
            value={activeTab}
            onChange={(_e, v) => setActiveTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ minHeight: 40 }}
          >
            <Tab label="Identity" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Prompt Engineering" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Intelligence" sx={{ minHeight: 40, fontSize: 13, color: sectionColor(2) }} />
            <Tab label="LLM Settings" sx={{ minHeight: 40, fontSize: 13, color: sectionColor(3) }} />
            <Tab label="Data Mapping" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="UI & Presentation" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Flow" sx={{ minHeight: 40, fontSize: 13 }} />
            {template.type_key === "inventory_diagnostic_agent" ? (
              <Tab label="Agentic Library" sx={{ minHeight: 40, fontSize: 13, color: "success.main" }} />
            ) : null}
          </Tabs>
        </Box>

        {/* ── Content ────────────────────────────────────── */}
        <Box sx={{ flex: 1, overflow: "auto", px: 3, pb: 3 }}>

          {/* ════════════════ Tab 0: Identity ════════════════ */}
          <TabPanel value={activeTab} index={0}>
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Template Metadata
                </Typography>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip label={`Type: ${template.type_key}`} size="small" variant="outlined" />
                    <Chip
                      label={`Status: ${template.status}`}
                      size="small"
                      color={STATUS_COLOR[template.status] ?? "default"}
                    />
                    <Chip label={`Handler: ${template.handler_hint}`} size="small" variant="outlined" />
                    <Chip label={`Version: ${template.template_version}`} size="small" variant="outlined" />
                    {template.assistant_mode && (
                      <Chip label={`Mode: ${template.assistant_mode}`} size="small" variant="outlined" />
                    )}
                  </Stack>
                  <TextField
                    label="Display Name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    size="small"
                    fullWidth
                  />
                  <TextField
                    label="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    size="small"
                    fullWidth
                    multiline
                    rows={2}
                  />
                </Stack>
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Available Actions
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {template.available_actions.map((action) => (
                    <Chip key={action} label={action} size="small" variant="outlined" color="primary" />
                  ))}
                  {template.available_actions.length === 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                      No actions defined.
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Stack>
          </TabPanel>

          {/* ════════════════ Tab 1: Prompt Engineering ════════════════ */}
          <TabPanel value={activeTab} index={1}>
            <Stack spacing={3}>
              {/* System Prompt Base */}
              <PromptSectionEditor
                label="System Prompt Base"
                value={systemPrompt}
                onChange={setSystemPrompt}
                helperText="The foundational system prompt sent to the LLM."
                minRows={4}
              />

              {/* System Message */}
              <PromptSectionEditor
                label="System Message (Instruction)"
                value={systemMessage}
                onChange={setSystemMessage}
                helperText="Concise instruction message appended after the system prompt."
                minRows={3}
              />

              {/* Reasoning Prompt */}
              <PromptSectionEditor
                label="Reasoning System Prompt"
                value={reasoningPrompt}
                onChange={setReasoningPrompt}
                helperText="System prompt used for the reasoning/analysis LLM call."
                minRows={4}
              />

              {/* Explanation Prompt */}
              <PromptSectionEditor
                label="Explanation System Prompt"
                value={explanationPrompt}
                onChange={setExplanationPrompt}
                helperText="System prompt used for the explanation LLM call."
                minRows={4}
              />

              {/* Prompt Sections — Accordion per section */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Prompt Sections
                </Typography>
                <Stack spacing={1}>
                  {Object.entries(systemPromptSections).map(([key, val]) => (
                    <Accordion
                      key={key}
                      variant="outlined"
                      disableGutters
                      sx={{ "&:before": { display: "none" }, borderRadius: 1 }}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <PromptSectionEditor
                          label=""
                          value={val}
                          onChange={(v) =>
                            setSystemPromptSections((prev) => ({ ...prev, [key]: v }))
                          }
                          minRows={8}
                        />
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Stack>
              </Box>

              {/* Metric Formulas */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Metric Formulas
                </Typography>
                <MetricFormulaEditor
                  value={metricFormulas}
                  onChange={setMetricFormulas}
                />
              </Box>

              {/* Preview Assembled Prompt */}
              <Box>
                <Button
                  startIcon={<PreviewOutlinedIcon />}
                  variant="outlined"
                  onClick={() => setPreviewOpen(true)}
                >
                  Preview Assembled Prompt
                </Button>
              </Box>
            </Stack>
          </TabPanel>

          {/* ════════════════ Tab 2: Intelligence ════════════════ */}
          <TabPanel value={activeTab} index={2}>
            <Stack spacing={3}>
              {/* Scope Detection */}
              <Box
                sx={{
                  p: 2,
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "success.light",
                  bgcolor: "success.50",
                }}
              >
                <Stack spacing={2}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "success.main" }}>
                      Scope Detection
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={scopeEnabled}
                          onChange={(e) => setScopeEnabled(e.target.checked)}
                          size="small"
                          color="success"
                        />
                      }
                      label={<Typography variant="caption">{scopeEnabled ? "Enabled" : "Disabled"}</Typography>}
                    />
                  </Stack>
                  {scopeEnabled && (
                    <>
                      <TagInput
                        label="Out-of-scope Keywords"
                        value={outOfScopeKeywords}
                        onChange={setOutOfScopeKeywords}
                        helperText="Questions containing these are rejected."
                      />
                      <TagInput
                        label="In-scope (DB Signal) Keywords"
                        value={inScopeKeywords}
                        onChange={setInScopeKeywords}
                        helperText="Keywords that signal a database-related query."
                      />
                      <TextField
                        label="Out-of-scope Response"
                        value={outOfScopeResponse}
                        onChange={(e) => setOutOfScopeResponse(e.target.value)}
                        size="small"
                        fullWidth
                        multiline
                        rows={2}
                        helperText="Shown when a question is out of scope."
                      />
                    </>
                  )}
                </Stack>
              </Box>

              {/* Ambiguity Detection */}
              <Box
                sx={{
                  p: 2,
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "success.light",
                }}
              >
                <Stack spacing={2}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "success.main" }}>
                      Ambiguity Detection
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <FormControlLabel
                      control={
                        <Switch
                          checked={ambiguityEnabled}
                          onChange={(e) => setAmbiguityEnabled(e.target.checked)}
                          size="small"
                          color="success"
                        />
                      }
                      label={<Typography variant="caption">{ambiguityEnabled ? "Enabled" : "Disabled"}</Typography>}
                    />
                  </Stack>
                  {ambiguityEnabled && (
                    <>
                      <TagInput
                        label="Weak Keywords"
                        value={weakKeywords}
                        onChange={setWeakKeywords}
                        helperText="Keywords that trigger ambiguity clarification."
                      />
                      <SliderWithLabel
                        label="Min Question Tokens"
                        value={minQuestionTokens}
                        onChange={setMinQuestionTokens}
                        min={1}
                        max={10}
                        step={1}
                        helperText="Minimum word count before a question is considered specific enough."
                      />
                    </>
                  )}
                </Stack>
              </Box>

              {/* KPI Detection */}
              <Box
                sx={{
                  p: 2,
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "secondary.light",
                  bgcolor: "secondary.50",
                }}
              >
                <Stack spacing={2}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "secondary.main" }}>
                    KPI Detection
                  </Typography>
                  <TagInput
                    label="KPI Keywords"
                    value={kpiKeywords}
                    onChange={setKpiKeywords}
                    helperText="Keywords that trigger KPI-specific guidance."
                  />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                      KPI Playbooks
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                      Guidance text for each KPI. The name should match a KPI keyword above.
                    </Typography>
                    <MetricFormulaEditor
                      value={kpiPlaybooks}
                      onChange={setKpiPlaybooks}
                    />
                  </Box>
                </Stack>
              </Box>
            </Stack>
          </TabPanel>

          {/* ════════════════ Tab 3: LLM Settings ════════════════ */}
          <TabPanel value={activeTab} index={3}>
            <Stack spacing={3}>
              {/* Default Model */}
              <Box
                sx={{
                  p: 2,
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "primary.light",
                  bgcolor: "primary.50",
                }}
              >
                <Stack spacing={2.5}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "primary.main" }}>
                    Model & Temperatures
                  </Typography>

                  <TextField
                    label="Default Model"
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    size="small"
                    select
                    slotProps={{ select: { native: true } }}
                    sx={{ maxWidth: 300 }}
                  >
                    {LLM_MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </TextField>

                  <SliderWithLabel
                    label="SQL Generation Temperature"
                    value={temperatures.sql_generation ?? 0}
                    onChange={(v) => setTemperatures((p) => ({ ...p, sql_generation: v }))}
                    min={0}
                    max={1}
                    step={0.05}
                    helperText="Lower = more deterministic SQL generation."
                  />
                  <SliderWithLabel
                    label="Reasoning Temperature"
                    value={temperatures.reasoning ?? 0.2}
                    onChange={(v) => setTemperatures((p) => ({ ...p, reasoning: v }))}
                    min={0}
                    max={1}
                    step={0.05}
                    helperText="Controls creativity in reasoning/analysis."
                  />
                  <SliderWithLabel
                    label="Explanation Temperature"
                    value={temperatures.explanation ?? 0.3}
                    onChange={(v) => setTemperatures((p) => ({ ...p, explanation: v }))}
                    min={0}
                    max={1}
                    step={0.05}
                    helperText="Controls creativity in user-facing explanations."
                  />
                </Stack>
              </Box>

              {/* Row Limits */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Row Limits
                </Typography>
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Default Max Rows"
                    type="number"
                    value={rowLimits.max_rows_default ?? 200}
                    onChange={(e) =>
                      setRowLimits((p) => ({ ...p, max_rows_default: Number(e.target.value) }))
                    }
                    size="small"
                    sx={{ width: 180 }}
                  />
                  <TextField
                    label="Row Limit Default"
                    type="number"
                    value={rowLimits.row_limit_default ?? 2000}
                    onChange={(e) =>
                      setRowLimits((p) => ({ ...p, row_limit_default: Number(e.target.value) }))
                    }
                    size="small"
                    sx={{ width: 180 }}
                  />
                </Stack>
              </Box>

              {/* Confidence Weights */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
                  Confidence Weights
                </Typography>
                <Stack spacing={2}>
                  <SliderWithLabel
                    label="Base Score"
                    value={confidenceWeights.base_score ?? 0.45}
                    onChange={(v) => setConfidenceWeights((p) => ({ ...p, base_score: v }))}
                    min={0}
                    max={1}
                    step={0.05}
                  />
                  <SliderWithLabel
                    label="LLM Invoked Bonus"
                    value={confidenceWeights.llm_invoked_bonus ?? 0.2}
                    onChange={(v) => setConfidenceWeights((p) => ({ ...p, llm_invoked_bonus: v }))}
                    min={0}
                    max={1}
                    step={0.05}
                  />
                  <SliderWithLabel
                    label="Has Rows Bonus"
                    value={confidenceWeights.has_rows_bonus ?? 0.2}
                    onChange={(v) => setConfidenceWeights((p) => ({ ...p, has_rows_bonus: v }))}
                    min={0}
                    max={1}
                    step={0.05}
                  />
                  <SliderWithLabel
                    label="Large Result Bonus"
                    value={confidenceWeights.large_result_bonus ?? 0.05}
                    onChange={(v) => setConfidenceWeights((p) => ({ ...p, large_result_bonus: v }))}
                    min={0}
                    max={0.5}
                    step={0.01}
                  />
                  <SliderWithLabel
                    label="Warning Penalty"
                    value={confidenceWeights.warning_penalty ?? 0.06}
                    onChange={(v) => setConfidenceWeights((p) => ({ ...p, warning_penalty: v }))}
                    min={0}
                    max={0.5}
                    step={0.01}
                    helperText="Subtracted from score per warning."
                  />
                </Stack>
              </Box>
            </Stack>
          </TabPanel>

          {/* ════════════════ Tab 4: Data Mapping ════════════════ */}
          <TabPanel value={activeTab} index={4}>
            <Stack spacing={3}>
              {/* Column Classification */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
                  Column Classification Keywords
                </Typography>
                <Stack spacing={2}>
                  <TagInput
                    label="Dimension Keywords"
                    value={columnClassification.dimension_keywords ?? []}
                    onChange={(v) =>
                      setColumnClassification((p) => ({ ...p, dimension_keywords: v }))
                    }
                    helperText="Column name patterns classified as dimensions."
                  />
                  <TagInput
                    label="Percentage Keywords"
                    value={columnClassification.percentage_keywords ?? []}
                    onChange={(v) =>
                      setColumnClassification((p) => ({ ...p, percentage_keywords: v }))
                    }
                    helperText="Column name patterns classified as percentage values."
                  />
                  <TagInput
                    label="Date Keywords"
                    value={columnClassification.date_keywords ?? []}
                    onChange={(v) =>
                      setColumnClassification((p) => ({ ...p, date_keywords: v }))
                    }
                    helperText="Column name patterns classified as date fields."
                  />
                  <TagInput
                    label="Text Keywords"
                    value={columnClassification.text_keywords ?? []}
                    onChange={(v) =>
                      setColumnClassification((p) => ({ ...p, text_keywords: v }))
                    }
                    helperText="Column name patterns classified as text fields."
                  />
                </Stack>
              </Box>

            </Stack>
          </TabPanel>

          {/* ════════════════ Tab 5: UI & Presentation ════════════════ */}
          <TabPanel value={activeTab} index={5}>
            <Stack spacing={3}>
              {/* Default Instance Appearance */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Default Instance Appearance
                </Typography>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                    <FormControl size="small" sx={{ minWidth: 260 }}>
                      <InputLabel>Icon</InputLabel>
                      <Select
                        value={icon}
                        label="Icon"
                        onChange={(e) => setIcon(e.target.value)}
                        renderValue={(selected) => {
                          const IconComp = resolveIcon(selected);
                          return (
                            <Stack direction="row" spacing={1} alignItems="center">
                              <IconComp sx={{ fontSize: 18 }} />
                              <span>{selected}</span>
                            </Stack>
                          );
                        }}
                        MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}
                      >
                        {getAvailableIconNames().map((n) => {
                          const IconComp = resolveIcon(n);
                          return (
                            <MenuItem key={n} value={n} dense>
                              <ListItemIcon sx={{ minWidth: 32 }}>
                                <IconComp fontSize="small" />
                              </ListItemIcon>
                              <ListItemText
                                primary={n.replace("Outlined", "")}
                                primaryTypographyProps={{ variant: "body2" }}
                              />
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                    <TextField
                      label="Button Text"
                      value={buttonText}
                      onChange={(e) => setButtonText(e.target.value)}
                      size="small"
                      sx={{ flex: 1, minWidth: 160 }}
                    />
                  </Stack>
                  <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                    <TextField
                      label="Button Style"
                      value={buttonStyle}
                      onChange={(e) => setButtonStyle(e.target.value)}
                      size="small"
                      select
                      slotProps={{ select: { native: true } }}
                      sx={{ minWidth: 200 }}
                    >
                      <option value="icon_only">Icon only</option>
                      <option value="text_only">Text only</option>
                      <option value="icon_and_text">Icon + Text</option>
                    </TextField>
                    <TextField
                      label="Tooltip Text"
                      value={tooltipText}
                      onChange={(e) => setTooltipText(e.target.value)}
                      size="small"
                      sx={{ flex: 1, minWidth: 160 }}
                    />
                    <TextField
                      label="Config Ref"
                      value={configRef}
                      onChange={(e) => setConfigRef(e.target.value)}
                      size="small"
                      sx={{ flex: 1, minWidth: 160 }}
                    />
                  </Stack>
                </Stack>
              </Box>

              {/* Runtime UI Toggles */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Runtime UI Settings
                </Typography>
                <Stack spacing={1.5}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={uiBehavior.enable_charts !== false}
                        onChange={(e) =>
                          setUiBehavior((p) => ({ ...p, enable_charts: e.target.checked }))
                        }
                        size="small"
                      />
                    }
                    label="Enable Charts"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={uiBehavior.grid_collapsed_default === true}
                        onChange={(e) =>
                          setUiBehavior((p) => ({ ...p, grid_collapsed_default: e.target.checked }))
                        }
                        size="small"
                      />
                    }
                    label="Grid Collapsed by Default"
                  />
                  <TextField
                    label="Row Limit Default"
                    type="number"
                    value={uiBehavior.row_limit_default ?? 2000}
                    onChange={(e) =>
                      setUiBehavior((p) => ({ ...p, row_limit_default: Number(e.target.value) }))
                    }
                    size="small"
                    sx={{ width: 180 }}
                  />
                </Stack>
              </Box>

              {/* Action Labels */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Action Labels
                </Typography>
                <KeyValuePairEditor
                  value={uiBehavior.action_labels ?? {}}
                  onChange={(v) => setUiBehavior((p) => ({ ...p, action_labels: v }))}
                  inputLabel="Action Key"
                  outputLabel="Display Label"
                />
              </Box>
            </Stack>
          </TabPanel>

          {/* ════════════════ Tab 6: Flow ════════════════ */}
          <TabPanel value={activeTab} index={6}>
            <Stack spacing={2}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Flow Nodes
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Toggle which pipeline nodes are active or skipped. Skipped nodes will be bypassed during query execution.
              </Typography>
              <Stack spacing={0.5}>
                {ALL_FLOW_NODES.map((node) => {
                  const isSkipped = (flowConfig.skip_nodes ?? []).includes(node);
                  return (
                    <Box
                      key={node}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        p: 1,
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: isSkipped ? "warning.light" : "success.light",
                        bgcolor: isSkipped ? "warning.50" : "success.50",
                        cursor: "pointer",
                        transition: "all 0.15s",
                        "&:hover": { opacity: 0.85 },
                      }}
                      onClick={() => {
                        setFlowConfig((prev) => {
                          const skip = prev.skip_nodes ?? [];
                          const newSkip = isSkipped
                            ? skip.filter((n) => n !== node)
                            : [...skip, node];
                          return { ...prev, skip_nodes: newSkip };
                        });
                      }}
                    >
                      {isSkipped ? (
                        <CheckBoxOutlineBlankIcon fontSize="small" color="warning" />
                      ) : (
                        <CheckBoxIcon fontSize="small" color="success" />
                      )}
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: '"IBM Plex Mono", "Fira Code", monospace',
                          fontWeight: 500,
                          textDecoration: isSkipped ? "line-through" : "none",
                          color: isSkipped ? "text.secondary" : "text.primary",
                        }}
                      >
                        {node}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Chip
                        label={isSkipped ? "Skipped" : "Active"}
                        size="small"
                        color={isSkipped ? "warning" : "success"}
                        variant="outlined"
                      />
                    </Box>
                  );
                })}
              </Stack>
            </Stack>
          </TabPanel>

          {/* ════════════════ Tab 7: Agentic Library (inventory_diagnostic_agent only) ════════════════ */}
          {template.type_key === "inventory_diagnostic_agent" ? (
            <TabPanel value={activeTab} index={7}>
              <AgenticLibraryTab
                extras={agenticExtras}
                onChange={(next) => setAgenticExtras(next)}
              />
            </TabPanel>
          ) : null}
        </Box>

        {/* ── Footer ─────────────────────────────────────── */}
        <Box
          sx={{
            px: 3,
            py: 1.5,
            borderTop: 1,
            borderColor: "divider",
            display: "flex",
            justifyContent: "flex-end",
            gap: 1,
          }}
        >
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>
            Save Template
          </Button>
        </Box>
      </Drawer>

      {/* ── Prompt Preview Dialog ──────────────────────── */}
      <PromptPreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        promptText={assembledPrompt}
      />
    </>
  );
}


// ══════════════════════════════════════════════════════════════════════════
// Agentic Library tab (inventory_diagnostic_agent only)
// ══════════════════════════════════════════════════════════════════════════

interface AgenticLibraryTabProps {
  extras: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}


function AgenticLibraryTab({ extras, onChange }: AgenticLibraryTabProps) {
  const library = (extras.library ?? {}) as Record<string, unknown>;
  const decisionGraph = (extras.decision_graph ?? []) as Array<Record<string, unknown>>;
  const llmCallSites = (extras.llm_call_sites ?? {}) as Record<string, Record<string, unknown>>;
  const slotCatalog = (extras.slot_catalog ?? []) as Array<Record<string, unknown>>;

  const updatePrompt = (siteId: string, field: string, newValue: string | number) => {
    const currentSite = llmCallSites[siteId] ?? {};
    onChange({
      ...extras,
      llm_call_sites: {
        ...llmCallSites,
        [siteId]: { ...currentSite, [field]: newValue },
      },
    });
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          LLM Call Sites
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          The three allowed LLM invocations. System prompts, models, and
          temperatures are all configuration — no code change is required to
          retune the agent's behaviour.
        </Typography>
        {Object.entries(llmCallSites).map(([siteId, cfg]) => (
          <Accordion key={siteId} defaultExpanded={siteId === "explanation"} sx={{ mb: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Chip
                  size="small"
                  color={siteId === "explanation" ? "success" : "primary"}
                  label={siteId}
                  sx={{ fontWeight: 600 }}
                />
                <Typography variant="body2">
                  {(cfg.provider_default as string) ?? "openai"} / {(cfg.model_default as string) ?? "gpt-4.1-mini"}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`temp ${(cfg.temperature as number) ?? 0}`}
                  sx={{ height: 20, fontSize: 10 }}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`max ${(cfg.max_tokens as number) ?? 0}`}
                  sx={{ height: 20, fontSize: 10 }}
                />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1.5}>
                <TextField
                  label="System prompt"
                  multiline
                  minRows={6}
                  fullWidth
                  value={(cfg.system_prompt as string) ?? ""}
                  onChange={(e) => updatePrompt(siteId, "system_prompt", e.target.value)}
                  sx={{ fontFamily: "monospace" }}
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Provider"
                    size="small"
                    value={(cfg.provider_default as string) ?? ""}
                    onChange={(e) => updatePrompt(siteId, "provider_default", e.target.value)}
                  />
                  <TextField
                    label="Model"
                    size="small"
                    value={(cfg.model_default as string) ?? ""}
                    onChange={(e) => updatePrompt(siteId, "model_default", e.target.value)}
                  />
                  <TextField
                    label="Temperature"
                    size="small"
                    type="number"
                    inputProps={{ step: 0.1, min: 0, max: 2 }}
                    value={(cfg.temperature as number) ?? 0}
                    onChange={(e) => updatePrompt(siteId, "temperature", Number(e.target.value))}
                    sx={{ width: 140 }}
                  />
                  <TextField
                    label="Max tokens"
                    size="small"
                    type="number"
                    value={(cfg.max_tokens as number) ?? 400}
                    onChange={(e) => updatePrompt(siteId, "max_tokens", Number(e.target.value))}
                    sx={{ width: 140 }}
                  />
                </Stack>
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
        {Object.keys(llmCallSites).length === 0 ? (
          <Alert severity="info">No LLM call sites defined in the template.</Alert>
        ) : null}
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Library catalogues
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          The full library this agent type supports. Add, edit, or remove
          entries here; each instance picks a subset via the Decision Flow
          editor. Declarative identifiers (<code>rule</code>, <code>evidence_query</code>,
          <code>enumeration_rule</code>) must match a backend handler.
        </Typography>
        <Stack spacing={1.5}>
          <LibrarySection
            title="Problem templates"
            entries={(library.problem_templates as Array<Record<string, unknown>>) ?? []}
            color="error"
            lane="problem"
            onChange={(next) => onChange({ ...extras, library: { ...library, problem_templates: next } })}
          />
          <LibrarySection
            title="Root cause templates"
            entries={(library.root_cause_templates as Array<Record<string, unknown>>) ?? []}
            color="warning"
            lane="root_cause"
            onChange={(next) => onChange({ ...extras, library: { ...library, root_cause_templates: next } })}
          />
          <LibrarySection
            title="Resolution families"
            entries={(library.resolution_families as Array<Record<string, unknown>>) ?? []}
            color="success"
            lane="resolution"
            onChange={(next) => onChange({ ...extras, library: { ...library, resolution_families: next } })}
          />
          <LibrarySection
            title="Action templates"
            entries={Object.entries(
              (library.action_templates as Record<string, Record<string, unknown>>) ?? {},
            ).map(([k, v]) => ({ key: k, ...(v ?? {}) }))}
            color="info"
            lane="action"
            onChange={(next) => {
              const nextMap: Record<string, Record<string, unknown>> = {};
              for (const e of next) {
                const k = String(e.key ?? "").trim();
                if (!k) continue;
                const { key: _k, ...rest } = e;
                nextMap[k] = rest;
              }
              onChange({ ...extras, library: { ...library, action_templates: nextMap } });
            }}
          />
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Decision graph
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          Which root causes + resolutions are legal from each problem.
          Instances can further restrict these edges.
        </Typography>
        <Stack spacing={1}>
          {decisionGraph.map((edge, idx) => (
            <Paper key={idx} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
                <Chip size="small" color="error" label={String(edge.from_problem)} />
                <Typography variant="caption" color="text.secondary">→ RCs</Typography>
                {((edge.compatible_root_causes as string[]) ?? []).map((rc) => (
                  <Chip key={rc} size="small" variant="outlined" color="warning" label={rc} sx={{ height: 20, fontSize: 10 }} />
                ))}
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>· Resolutions</Typography>
                {((edge.compatible_resolutions as string[]) ?? []).map((r) => (
                  <Chip key={r} size="small" variant="outlined" color="success" label={r} sx={{ height: 20, fontSize: 10 }} />
                ))}
              </Stack>
            </Paper>
          ))}
          {decisionGraph.length === 0 ? (
            <Alert severity="info">No decision graph edges defined.</Alert>
          ) : null}
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          Semantic slot catalog ({slotCatalog.length})
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {slotCatalog.map((slot) => {
            const unlocks = (slot.unlocks as string[]) ?? [];
            return (
              <Tooltip
                key={String(slot.slot_key)}
                title={
                  unlocks.length
                    ? `Unlocks: ${unlocks.join(", ")}`
                    : "Does not gate any library entry."
                }
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={String(slot.slot_key)}
                  sx={{ height: 22 }}
                />
              </Tooltip>
            );
          })}
        </Stack>
      </Box>
    </Stack>
  );
}


type LaneKind = "problem" | "root_cause" | "resolution" | "action";

const LANE_SKELETON: Record<LaneKind, string> = {
  problem: `{
  "key": "my_new_problem",
  "display_name": "My New Problem",
  "requires_slots": ["opening_inventory"],
  "rule": { "type": "threshold_on_projection_field", "field": "projected_on_hand_actual_qty", "op": "<", "value": 0 },
  "severity": { "critical_if_weeks_until_breach": 2, "warning_if_weeks_until_breach": 4, "default": "warning" }
}`,
  root_cause: `{
  "key": "my_new_root_cause",
  "display_name": "My New Root Cause",
  "requires_slots": ["supply_plan"],
  "evidence_query": "identifier_for_backend_handler",
  "weight": 0.3
}`,
  resolution: `{
  "key": "my_new_resolution",
  "display_name": "My New Resolution",
  "requires_slots": ["sourcing_network"],
  "enumeration_rule": "identifier_for_backend_handler",
  "default_qty_rule": "min_shortage_or_sibling_excess",
  "direction": "inbound"
}`,
  action: `{
  "key": "my_new_action",
  "delivery_mode": "task",
  "target_system": "servicenow"
}`,
};

function LibrarySection({
  title,
  entries,
  color,
  lane,
  onChange,
}: {
  title: string;
  entries: Array<Record<string, unknown>>;
  color: "error" | "warning" | "success" | "info";
  lane: LaneKind;
  onChange?: (next: Array<Record<string, unknown>>) => void;
}) {
  const [editing, setEditing] = useState<{ idx: number; json: string; error?: string } | null>(null);

  const openEdit = (idx: number) => {
    const entry = idx === -1 ? JSON.parse(LANE_SKELETON[lane]) : entries[idx];
    setEditing({ idx, json: JSON.stringify(entry, null, 2) });
  };

  const saveEdit = () => {
    if (!editing || !onChange) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editing.json);
    } catch (e) {
      setEditing({ ...editing, error: (e as Error).message });
      return;
    }
    if (!parsed || typeof parsed !== "object" || !parsed.key || typeof parsed.key !== "string") {
      setEditing({ ...editing, error: "Entry must be an object with a string `key` field." });
      return;
    }
    const next = [...entries];
    if (editing.idx === -1) {
      next.push(parsed);
    } else {
      next[editing.idx] = parsed;
    }
    onChange(next);
    setEditing(null);
  };

  const deleteEntry = (idx: number) => {
    if (!onChange) return;
    const next = entries.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ flex: 1 }}>
            <Chip size="small" color={color} label={title} sx={{ fontWeight: 600 }} />
            <Typography variant="caption" color="text.secondary">
              {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            </Typography>
          </Stack>
          {onChange ? (
            <Button
              size="small"
              startIcon={<AddOutlinedIcon fontSize="small" />}
              onClick={(e) => { e.stopPropagation(); openEdit(-1); }}
              sx={{ mr: 1 }}
            >
              Add
            </Button>
          ) : null}
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1}>
            {entries.map((entry, idx) => (
              <Paper key={`${String(entry.key ?? idx)}-${idx}`} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {String(entry.display_name ?? entry.key)}
                  </Typography>
                  <Chip size="small" variant="outlined" label={String(entry.key)} sx={{ height: 18, fontSize: 10 }} />
                  {onChange ? (
                    <>
                      <Tooltip title="Edit entry JSON">
                        <IconButton size="small" onClick={() => openEdit(idx)}>
                          <EditNoteOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete entry">
                        <IconButton size="small" color="error" onClick={() => deleteEntry(idx)}>
                          <DeleteOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : null}
                </Stack>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                  {((entry.requires_slots as string[]) ?? []).map((s) => (
                    <Chip key={s} size="small" variant="outlined" label={s} sx={{ height: 18, fontSize: 10 }} />
                  ))}
                </Stack>
                {entry.evidence_query ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    evidence_query: <code>{String(entry.evidence_query)}</code>
                  </Typography>
                ) : null}
                {entry.enumeration_rule ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    enumeration_rule: <code>{String(entry.enumeration_rule)}</code>
                  </Typography>
                ) : null}
                {entry.rule ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    rule: <code>{JSON.stringify(entry.rule)}</code>
                  </Typography>
                ) : null}
              </Paper>
            ))}
            {entries.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                (none)
              </Typography>
            ) : null}
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="md">
        <DialogTitle>
          {editing?.idx === -1 ? `Add ${title}` : `Edit ${title}`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1.5, fontSize: 13 }}>
            Edit the raw JSON definition. <code>key</code> is required and must be
            unique within the library section. Backend handlers are matched by
            <code>rule</code>, <code>evidence_query</code>, and <code>enumeration_rule</code> identifiers.
          </DialogContentText>
          {editing ? (
            <TextField
              multiline
              minRows={14}
              fullWidth
              value={editing.json}
              onChange={(e) => setEditing({ ...editing, json: e.target.value, error: undefined })}
              error={Boolean(editing.error)}
              helperText={editing.error ?? " "}
              sx={{ fontFamily: "monospace", "& textarea": { fontFamily: "monospace", fontSize: 12 } }}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit}>Save</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
