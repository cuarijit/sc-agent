import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import MemoryOutlinedIcon from "@mui/icons-material/MemoryOutlined";
import PreviewOutlinedIcon from "@mui/icons-material/PreviewOutlined";
import RestoreOutlinedIcon from "@mui/icons-material/RestoreOutlined";
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
  IconButton,
  InputLabel,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
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
import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveIcon, getAvailableIconNames } from "../../../app/navigation/iconRegistry";
import {
  fetchAgentTemplate,
  type AdminModuleRecord,
  type AgentButtonStyle,
  type AgentInstance,
  type AgentInstanceCreateRequest,
  type AgentInstanceUpdateRequest,
  type AgentTemplate,
  type AgentTypeDefinition,
  type Role,
} from "../../../services/agentConfigApi";
import TypeSpecificConfigEditor from "./TypeSpecificConfigEditor";
import DecisionTreeEditor, { type DecisionTreeEditorValue, type NodeOverrides } from "./DecisionTreeEditor";
import TagInput from "./TagInput";
import PromptSectionEditor from "./PromptSectionEditor";
import SliderWithLabel from "./SliderWithLabel";
import MetricFormulaEditor from "./MetricFormulaEditor";
import KeyValuePairEditor from "./KeyValuePairEditor";
import PromptPreviewDialog from "./PromptPreviewDialog";

// ── Type helpers for behavior sub-objects (same as template editor) ────

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

interface AgentInstanceFormDialogProps {
  open: boolean;
  editingInstance: AgentInstance | null;
  agentTypes: AgentTypeDefinition[];
  templates: AgentTemplate[];
  roles: Role[];
  modules: AdminModuleRecord[];
  onClose: () => void;
  onSave: (payload: AgentInstanceCreateRequest | AgentInstanceUpdateRequest, isEdit: boolean) => void;
}

// ── Constants ───────────────────────────────────────────────────────────

const BUTTON_STYLE_OPTIONS: { value: AgentButtonStyle; label: string }[] = [
  { value: "icon_only", label: "Icon only" },
  { value: "text_only", label: "Text only" },
  { value: "icon_and_text", label: "Icon + Text" },
];

const LLM_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-3.5-turbo",
  "claude-3-haiku",
  "claude-3-sonnet",
  "claude-3-opus",
];

const ALL_FLOW_NODES = [
  "resolve_context",
  "guard_api_key",
  "guard_scope",
  "guard_ambiguity",
  "build_response",
  "append_history",
];

// ── Tab panel helper ────────────────────────────────────────────────────

function TabPanel({ value, index, children }: { value: number; index: number; children: React.ReactNode }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

// ── Customized field label — shows override badge + reset button ────────

function OverrideFieldLabel({
  label,
  isModified,
  onReset,
}: {
  label: string;
  isModified: boolean;
  onReset: () => void;
}) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      {isModified && (
        <>
          <Chip
            label="Customized"
            size="small"
            color="primary"
            variant="outlined"
            sx={{ height: 18, fontSize: 10 }}
          />
          <Tooltip title="Reset to template default">
            <IconButton size="small" onClick={onReset} sx={{ p: 0.25 }}>
              <RestoreOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </>
      )}
    </Stack>
  );
}

// ── Deep comparison helpers ─────────────────────────────────────────────

function _buildDecisionTreeValue(
  typeSpecific: Record<string, unknown> | null | undefined,
  behavior: Record<string, unknown> | null | undefined,
): DecisionTreeEditorValue {
  const cfg = (typeSpecific ?? {}) as Record<string, unknown>;
  const lib = (cfg.enabled_library ?? {}) as Record<string, unknown>;
  // Default: enable EVERYTHING the template library exposes so a freshly
  // created instance matches the old behaviour (no filtering).
  const beh = (behavior ?? {}) as Record<string, unknown>;
  const behLib = (beh.library ?? {}) as Record<string, unknown>;
  const pickList = (k: string): Array<{ key?: string }> => {
    const fromLib = behLib[k] as Array<{ key?: string }> | undefined;
    if (Array.isArray(fromLib) && fromLib.length > 0) return fromLib;
    const fromTop = beh[k] as Array<{ key?: string }> | undefined;
    return Array.isArray(fromTop) ? fromTop : [];
  };
  const pickActions = (): Record<string, unknown> => {
    const fromLib = behLib.action_templates as Record<string, unknown> | undefined;
    if (fromLib && Object.keys(fromLib).length > 0) return fromLib;
    const fromTop = beh.action_templates as Record<string, unknown> | undefined;
    return fromTop ?? {};
  };
  const allProblems = pickList("problem_templates")
    .map((p) => String(p.key ?? ""))
    .filter(Boolean);
  const allRcs = pickList("root_cause_templates")
    .map((p) => String(p.key ?? ""))
    .filter(Boolean);
  const allResolutions = pickList("resolution_families")
    .map((p) => String(p.key ?? ""))
    .filter(Boolean);
  const allActions = Object.keys(pickActions());
  const dgo = (cfg.decision_graph_overrides ?? {}) as Record<string, unknown>;
  return {
    enabled_library: {
      problem_templates: (lib.problem_templates as string[] | undefined) ?? allProblems,
      root_cause_templates: (lib.root_cause_templates as string[] | undefined) ?? allRcs,
      resolution_families: (lib.resolution_families as string[] | undefined) ?? allResolutions,
      action_templates: (lib.action_templates as string[] | undefined) ?? allActions,
    },
    disabled_edges: (dgo.disabled_edges as Array<Record<string, string>> | undefined) ?? [],
  };
}


function _buildNodeOverrides(
  typeSpecific: Record<string, unknown> | null | undefined,
): NodeOverrides {
  const cfg = (typeSpecific ?? {}) as Record<string, unknown>;
  const pt = cfg.per_template_overrides;
  const at = cfg.action_template_overrides;
  return {
    per_template_overrides: (pt && typeof pt === "object" ? pt : {}) as Record<string, Record<string, unknown>>,
    action_template_overrides: (at && typeof at === "object" ? at : {}) as Record<string, Record<string, unknown>>,
  };
}


function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
  }
  return false;
}

// ── Main component ──────────────────────────────────────────────────────

export default function AgentInstanceFormDialog({
  open,
  editingInstance,
  agentTypes,
  templates,
  roles,
  modules,
  onClose,
  onSave,
}: AgentInstanceFormDialogProps) {
  const isEdit = editingInstance !== null;

  // Tab state
  const [activeTab, setActiveTab] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── General ──────────────────────────────────────────────────────────
  const [instanceId, setInstanceId] = useState("");
  const [agentType, setAgentType] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceDirectory, setSourceDirectory] = useState("");
  const [configRef, setConfigRef] = useState("");
  const [moduleSlug, setModuleSlug] = useState("");
  const [isActive, setIsActive] = useState(true);

  // ── Appearance ───────────────────────────────────────────────────────
  const [buttonStyle, setButtonStyle] = useState<AgentButtonStyle>("icon_and_text");
  const [icon, setIcon] = useState("SmartToyOutlined");
  const [buttonText, setButtonText] = useState("");
  const [tooltipText, setTooltipText] = useState("");

  // ── Type-specific config ─────────────────────────────────────────────
  const [typeSpecificConfig, setTypeSpecificConfig] = useState<Record<string, unknown>>({});

  // ── Role access ──────────────────────────────────────────────────────
  const [roleIds, setRoleIds] = useState<number[]>([]);

  // ── Action permissions ───────────────────────────────────────────────
  const [actionPermissions, setActionPermissions] = useState<Record<string, number[]>>({});

  // ── Behavior state (mirrors template editor exactly) ─────────────────
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

  // ── Template tracking ────────────────────────────────────────────────
  const [currentTemplate, setCurrentTemplate] = useState<AgentTemplate | null>(null);

  // Snapshot of template behavior values (for override detection)
  const [templateSnapshot, setTemplateSnapshot] = useState<Record<string, unknown>>({});

  const matchedTemplate = useMemo(
    () => templates.find((t) => t.type_key === agentType) ?? null,
    [templates, agentType],
  );

  const selectedTypeDefinition = useMemo(
    () => agentTypes.find((t) => t.type_key === agentType) ?? null,
    [agentTypes, agentType],
  );

  const availableActions = useMemo(
    () => matchedTemplate?.available_actions ?? selectedTypeDefinition?.available_actions ?? [],
    [matchedTemplate, selectedTypeDefinition],
  );

  const configSchema = useMemo(
    () => currentTemplate?.config_schema ?? selectedTypeDefinition?.config_schema ?? null,
    [currentTemplate, selectedTypeDefinition],
  );

  const isDraftTemplate = matchedTemplate?.status === "draft";
  const isOutdated = editingInstance?.template_sync_status === "outdated";

  // ── Extract template behavior into a flat snapshot for diff detection ──

  const extractBehaviorSnapshot = useCallback((b: Record<string, unknown>) => {
    const scope = (b.scope_detection ?? {}) as ScopeDetection;
    const ambiguity = (b.ambiguity_detection ?? {}) as AmbiguityDetection;
    const kpi = (b.kpi_detection ?? {}) as KpiDetection;
    const temps = (b.llm_temperatures ?? {}) as LlmTemperatures;
    const rl = (b.row_limits ?? {}) as RowLimits;
    const cw = (b.confidence_weights ?? {}) as ConfidenceWeights;
    const cc = (b.column_classification ?? {}) as ColumnClassification;
    const uiB = (b.ui_behavior ?? {}) as UiBehavior;
    const fl = (b.flow ?? {}) as FlowConfig;

    return {
      system_prompt: (b.system_prompt as string) ?? "",
      system_prompt_sections: (b.system_prompt_sections as Record<string, string>) ?? {},
      system_message: (b.system_message as string) ?? "",
      reasoning_system_prompt: (b.reasoning_system_prompt as string) ?? "",
      explanation_system_prompt: (b.explanation_system_prompt as string) ?? "",
      metric_formulas: (b.metric_formulas as Record<string, string>) ?? {},
      scope_enabled: scope.enabled !== false,
      out_of_scope_keywords: scope.out_of_scope_keywords ?? [],
      in_scope_keywords: scope.db_signal_keywords ?? [],
      out_of_scope_response: scope.out_of_scope_response ?? "",
      ambiguity_enabled: ambiguity.enabled !== false,
      weak_keywords: ambiguity.weak_keywords ?? [],
      min_question_tokens: ambiguity.min_question_tokens ?? 2,
      kpi_keywords: kpi.keywords ?? [],
      kpi_playbooks: kpi.playbook ?? {},
      default_model: (b.default_model as string) ?? "gpt-4o-mini",
      temperatures: {
        sql_generation: temps.sql_generation ?? 0,
        reasoning: temps.reasoning ?? 0.2,
        explanation: temps.explanation ?? 0.3,
      },
      row_limits: {
        max_rows_default: rl.max_rows_default ?? 200,
        row_limit_default: rl.row_limit_default ?? 2000,
      },
      confidence_weights: {
        base_score: cw.base_score ?? 0.45,
        llm_invoked_bonus: cw.llm_invoked_bonus ?? 0.2,
        has_rows_bonus: cw.has_rows_bonus ?? 0.2,
        large_result_bonus: cw.large_result_bonus ?? 0.05,
        warning_penalty: cw.warning_penalty ?? 0.06,
      },
      column_classification: cc,
      ui_behavior: uiB,
      flow: fl,
    };
  }, []);

  // ── Populate all behavior fields from a behavior object ──────────────

  const populateBehaviorState = useCallback((b: Record<string, unknown>) => {
    setSystemPrompt((b.system_prompt as string) ?? "");
    setSystemPromptSections((b.system_prompt_sections as Record<string, string>) ?? {});
    setSystemMessage((b.system_message as string) ?? "");
    setReasoningPrompt((b.reasoning_system_prompt as string) ?? "");
    setExplanationPrompt((b.explanation_system_prompt as string) ?? "");
    setMetricFormulas((b.metric_formulas as Record<string, string>) ?? {});

    const scope = (b.scope_detection ?? {}) as ScopeDetection;
    setScopeEnabled(scope.enabled !== false);
    setOutOfScopeKeywords(scope.out_of_scope_keywords ?? []);
    setInScopeKeywords(scope.db_signal_keywords ?? []);
    setOutOfScopeResponse(scope.out_of_scope_response ?? "");

    const ambiguity = (b.ambiguity_detection ?? {}) as AmbiguityDetection;
    setAmbiguityEnabled(ambiguity.enabled !== false);
    setWeakKeywords(ambiguity.weak_keywords ?? []);
    setMinQuestionTokens(ambiguity.min_question_tokens ?? 2);

    const kpi = (b.kpi_detection ?? {}) as KpiDetection;
    setKpiKeywords(kpi.keywords ?? []);
    setKpiPlaybooks(kpi.playbook ?? {});

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

    const cc = (b.column_classification ?? {}) as ColumnClassification;
    setColumnClassification(cc);

    const uiB = (b.ui_behavior ?? {}) as UiBehavior;
    setUiBehavior({
      enable_charts: uiB.enable_charts !== false,
      grid_collapsed_default: uiB.grid_collapsed_default === true,
      row_limit_default: uiB.row_limit_default ?? 2000,
      action_labels: uiB.action_labels ?? {},
    });

    const fl = (b.flow ?? {}) as FlowConfig;
    setFlowConfig({
      nodes: fl.nodes ?? ALL_FLOW_NODES,
      skip_nodes: fl.skip_nodes ?? [],
    });
  }, []);

  // ── Merge template behavior + instance overrides ──────────────────────

  const mergedBehavior = useCallback((templateBehavior: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> => {
    // Deep merge: overrides on top of template behavior
    const result = structuredClone(templateBehavior);
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== null && typeof value === "object" && !Array.isArray(value) &&
          result[key] !== null && typeof result[key] === "object" && !Array.isArray(result[key])) {
        result[key] = { ...(result[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
      } else {
        result[key] = value;
      }
    }
    return result;
  }, []);

  // ── Reset form when drawer opens / changes ───────────────────────────

  useEffect(() => {
    if (!open) return;
    setActiveTab(0);
    if (editingInstance) {
      setInstanceId(editingInstance.instance_id);
      setAgentType(editingInstance.agent_type);
      setDisplayName(editingInstance.display_name);
      setDescription(editingInstance.description ?? "");
      setSourceDirectory(editingInstance.source_directory ?? "");
      setConfigRef(editingInstance.config_ref ?? "");
      setModuleSlug(editingInstance.module_slug ?? "");
      setIsActive(editingInstance.is_active);
      setButtonStyle(editingInstance.button_style);
      setIcon(editingInstance.icon ?? "SmartToyOutlined");
      setButtonText(editingInstance.button_text ?? "");
      setTooltipText(editingInstance.tooltip_text ?? "");
      setTypeSpecificConfig(structuredClone(editingInstance.type_specific_config ?? {}));
      setRoleIds(editingInstance.role_ids);
      setActionPermissions({ ...editingInstance.action_permissions });
    } else {
      setInstanceId("");
      setAgentType(agentTypes.length > 0 ? agentTypes[0].type_key : "");
      setDisplayName("");
      setDescription("");
      setSourceDirectory("");
      setConfigRef("");
      setModuleSlug("");
      setIsActive(true);
      setButtonStyle("icon_and_text");
      setIcon("SmartToyOutlined");
      setButtonText("");
      setTooltipText("");
      setTypeSpecificConfig({});
      setRoleIds([]);
      setActionPermissions({});
    }
  }, [open, editingInstance, agentTypes]);

  // ── Fetch template and populate behavior on agent type change ─────────

  useEffect(() => {
    if (!open || !agentType) {
      setCurrentTemplate(null);
      setTemplateSnapshot({});
      return;
    }

    const applyTemplate = (tpl: AgentTemplate) => {
      setCurrentTemplate(tpl);
      const snap = extractBehaviorSnapshot(tpl.behavior ?? {});
      setTemplateSnapshot(snap);

      if (isEdit && editingInstance) {
        // Merge template behavior + instance overrides
        const bo = (editingInstance.type_specific_config?.behavior_overrides ?? {}) as Record<string, unknown>;
        const merged = mergedBehavior(tpl.behavior ?? {}, bo);
        populateBehaviorState(merged);
      } else {
        // Create mode — use pure template defaults
        populateBehaviorState(tpl.behavior ?? {});
        autoPopulateFromTemplate(tpl);
      }
    };

    // Try local template first
    const local = templates.find((t) => t.type_key === agentType);
    if (local) {
      applyTemplate(local);
      return;
    }

    // Fall back to API fetch
    let cancelled = false;
    fetchAgentTemplate(agentType)
      .then((tpl) => {
        if (!cancelled) applyTemplate(tpl);
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentTemplate(null);
          setTemplateSnapshot({});
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentType, open, isEdit, templates]);

  const autoPopulateFromTemplate = (tpl: AgentTemplate) => {
    setDisplayName(tpl.display_name);
    setDescription(tpl.description);
    if (tpl.default_instance) {
      setIcon(tpl.default_instance.icon ?? "SmartToyOutlined");
      setButtonText(tpl.default_instance.button_text ?? "");
      setButtonStyle((tpl.default_instance.button_style ?? "icon_and_text") as AgentButtonStyle);
      setTooltipText(tpl.default_instance.tooltip_text ?? "");
      setConfigRef(tpl.default_instance.config_ref ?? "");
    }
    if (tpl.default_config) {
      setTypeSpecificConfig(structuredClone(tpl.default_config));
    }
  };

  // ── Assembled prompt for preview ─────────────────────────────────────

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

  // ── Build current behavior object from state ─────────────────────────

  const buildCurrentBehavior = useCallback((): Record<string, unknown> => {
    return {
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
  }, [
    systemPrompt, systemPromptSections, systemMessage, reasoningPrompt,
    explanationPrompt, metricFormulas, scopeEnabled, outOfScopeKeywords,
    inScopeKeywords, outOfScopeResponse, ambiguityEnabled, weakKeywords,
    minQuestionTokens, kpiKeywords, kpiPlaybooks, defaultModel, temperatures,
    rowLimits, confidenceWeights, columnClassification,
    uiBehavior, flowConfig,
  ]);

  // ── Compute behavior_overrides: only diffs from template ─────────────

  const computeBehaviorOverrides = useCallback((): Record<string, unknown> | undefined => {
    if (!currentTemplate) return undefined;
    const templateBehavior = currentTemplate.behavior ?? {};
    const currentBehavior = buildCurrentBehavior();
    const overrides: Record<string, unknown> = {};
    let hasOverrides = false;

    for (const key of Object.keys(currentBehavior)) {
      const current = currentBehavior[key];
      const original = templateBehavior[key];
      if (!deepEqual(current, original)) {
        overrides[key] = current;
        hasOverrides = true;
      }
    }

    return hasOverrides ? overrides : undefined;
  }, [currentTemplate, buildCurrentBehavior]);

  // ── Detect which fields are modified vs template ─────────────────────

  const isFieldModified = useCallback((fieldKey: string, currentValue: unknown): boolean => {
    const snapValue = (templateSnapshot as Record<string, unknown>)[fieldKey];
    return !deepEqual(currentValue, snapValue);
  }, [templateSnapshot]);

  const resetFieldToTemplate = useCallback((fieldKey: string) => {
    const snap = templateSnapshot as Record<string, unknown>;
    const val = snap[fieldKey];
    switch (fieldKey) {
      case "system_prompt": setSystemPrompt(val as string); break;
      case "system_prompt_sections": setSystemPromptSections(val as Record<string, string>); break;
      case "system_message": setSystemMessage(val as string); break;
      case "reasoning_system_prompt": setReasoningPrompt(val as string); break;
      case "explanation_system_prompt": setExplanationPrompt(val as string); break;
      case "metric_formulas": setMetricFormulas(val as Record<string, string>); break;
      case "scope_enabled": setScopeEnabled(val as boolean); break;
      case "out_of_scope_keywords": setOutOfScopeKeywords(val as string[]); break;
      case "in_scope_keywords": setInScopeKeywords(val as string[]); break;
      case "out_of_scope_response": setOutOfScopeResponse(val as string); break;
      case "ambiguity_enabled": setAmbiguityEnabled(val as boolean); break;
      case "weak_keywords": setWeakKeywords(val as string[]); break;
      case "min_question_tokens": setMinQuestionTokens(val as number); break;
      case "kpi_keywords": setKpiKeywords(val as string[]); break;
      case "kpi_playbooks": setKpiPlaybooks(val as Record<string, string>); break;
      case "default_model": setDefaultModel(val as string); break;
      case "temperatures": setTemperatures(val as LlmTemperatures); break;
      case "row_limits": setRowLimits(val as RowLimits); break;
      case "confidence_weights": setConfidenceWeights(val as ConfidenceWeights); break;
      case "column_classification": setColumnClassification(val as ColumnClassification); break;
      case "ui_behavior": setUiBehavior(val as UiBehavior); break;
      case "flow": setFlowConfig(val as FlowConfig); break;
    }
  }, [templateSnapshot]);

  // ── Count total overrides for tab badge ──────────────────────────────

  const overrideCount = useMemo(() => {
    if (!currentTemplate) return 0;
    const snap = templateSnapshot as Record<string, unknown>;
    let count = 0;
    const checkList: Array<[string, unknown]> = [
      ["system_prompt", systemPrompt],
      ["system_message", systemMessage],
      ["reasoning_system_prompt", reasoningPrompt],
      ["explanation_system_prompt", explanationPrompt],
      ["metric_formulas", metricFormulas],
      ["system_prompt_sections", systemPromptSections],
      ["scope_enabled", scopeEnabled],
      ["out_of_scope_keywords", outOfScopeKeywords],
      ["in_scope_keywords", inScopeKeywords],
      ["out_of_scope_response", outOfScopeResponse],
      ["ambiguity_enabled", ambiguityEnabled],
      ["weak_keywords", weakKeywords],
      ["min_question_tokens", minQuestionTokens],
      ["kpi_keywords", kpiKeywords],
      ["kpi_playbooks", kpiPlaybooks],
      ["default_model", defaultModel],
      ["temperatures", temperatures],
      ["row_limits", rowLimits],
      ["confidence_weights", confidenceWeights],
      ["column_classification", columnClassification],
      ["ui_behavior", uiBehavior],
      ["flow", flowConfig],
    ];
    for (const [key, val] of checkList) {
      if (!deepEqual(val, snap[key])) count++;
    }
    return count;
  }, [
    currentTemplate, templateSnapshot, systemPrompt, systemMessage, reasoningPrompt,
    explanationPrompt, metricFormulas, systemPromptSections, scopeEnabled,
    outOfScopeKeywords, inScopeKeywords, outOfScopeResponse, ambiguityEnabled,
    weakKeywords, minQuestionTokens, kpiKeywords, kpiPlaybooks, defaultModel,
    temperatures, rowLimits, confidenceWeights, columnClassification,
    uiBehavior, flowConfig,
  ]);

  // ── Save handler ─────────────────────────────────────────────────────

  const handleSave = () => {
    const bo = computeBehaviorOverrides();
    const tsc = { ...typeSpecificConfig };
    if (bo) {
      tsc.behavior_overrides = bo;
    } else {
      delete tsc.behavior_overrides;
    }

    if (isEdit) {
      const payload: AgentInstanceUpdateRequest = {
        display_name: displayName,
        icon: icon || null,
        button_text: buttonText || null,
        button_style: buttonStyle,
        tooltip_text: tooltipText || null,
        description: description || null,
        source_directory: sourceDirectory || null,
        config_ref: configRef || null,
        module_slug: moduleSlug || null,
        role_ids: roleIds,
        action_permissions: actionPermissions,
        type_specific_config: tsc,
        is_active: isActive,
      };
      onSave(payload, true);
    } else {
      const payload: AgentInstanceCreateRequest = {
        instance_id: instanceId,
        agent_type: agentType,
        display_name: displayName,
        icon: icon || null,
        button_text: buttonText || null,
        button_style: buttonStyle,
        tooltip_text: tooltipText || null,
        description: description || null,
        source_directory: sourceDirectory || null,
        config_ref: configRef || null,
        module_slug: moduleSlug || null,
        role_ids: roleIds,
        action_permissions: actionPermissions,
        type_specific_config: tsc,
        is_active: isActive,
      };
      onSave(payload, false);
    }
  };

  const PreviewIcon = resolveIcon(icon);

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
              {isEdit ? "Edit Instance" : "Create Instance"}: {displayName || instanceId || "New"}
            </Typography>
            {overrideCount > 0 && (
              <Chip
                label={`${overrideCount} override${overrideCount !== 1 ? "s" : ""}`}
                size="small"
                color="primary"
                variant="outlined"
              />
            )}
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
            <Tab label="General" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Appearance" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Config" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Prompt Engineering" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Intelligence" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="LLM Settings" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Data Mapping" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="UI & Presentation" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Flow" sx={{ minHeight: 40, fontSize: 13 }} />
            <Tab label="Access" sx={{ minHeight: 40, fontSize: 13 }} />
          </Tabs>
        </Box>

        {/* ── Content ────────────────────────────────────── */}
        <Box sx={{ flex: 1, overflow: "auto", px: 3, pb: 3 }}>

          {/* Draft template warning */}
          {isDraftTemplate && !isEdit && (
            <Alert severity="warning" sx={{ mt: 2, mb: 1 }}>
              This template is in draft status. Instance creation is not available until the template is activated.
            </Alert>
          )}

          {/* Outdated sync indicator */}
          {isEdit && isOutdated && (
            <Alert
              severity="info"
              icon={<SyncOutlinedIcon />}
              sx={{ mt: 2, mb: 1 }}
              action={
                <Button color="inherit" size="small">
                  Sync with Template
                </Button>
              }
            >
              This instance has outdated configuration. New fields may be available from the template.
            </Alert>
          )}

          {/* ════════════════ Tab 0: General ════════════════ */}
          <TabPanel value={activeTab} index={0}>
            <Stack spacing={2.5}>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField
                  label="Instance ID"
                  value={instanceId}
                  onChange={(e) => setInstanceId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  size="small"
                  sx={{ minWidth: 200, flex: 1 }}
                  disabled={isEdit}
                  helperText={isEdit ? "Cannot change after creation" : "Lowercase, hyphens/underscores only"}
                />
                <TextField
                  label="Agent Type"
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value)}
                  size="small"
                  select
                  slotProps={{ select: { native: true } }}
                  sx={{ minWidth: 200, flex: 1 }}
                  disabled={isEdit}
                >
                  {agentTypes.map((t) => (
                    <option key={t.type_key} value={t.type_key}>{t.display_name}</option>
                  ))}
                </TextField>
              </Stack>
              <TextField label="Display Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} size="small" fullWidth />
              <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} size="small" fullWidth multiline rows={2} />
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <TextField label="Source Directory" value={sourceDirectory} onChange={(e) => setSourceDirectory(e.target.value)} size="small" sx={{ flex: 1, minWidth: 200 }} />
                <TextField label="Config Ref" value={configRef} onChange={(e) => setConfigRef(e.target.value)} size="small" sx={{ flex: 1, minWidth: 200 }} />
              </Stack>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <TextField
                  label="Module"
                  value={moduleSlug}
                  onChange={(e) => setModuleSlug(e.target.value)}
                  size="small"
                  select
                  slotProps={{ select: { native: true } }}
                  sx={{ minWidth: 200 }}
                >
                  <option value="">-- None --</option>
                  {modules.map((m) => (
                    <option key={m.module_slug} value={m.module_slug}>{m.label}</option>
                  ))}
                </TextField>
                <FormControlLabel
                  control={<Switch checked={isActive} onChange={() => setIsActive(!isActive)} size="small" />}
                  label={<Typography variant="caption">{isActive ? "Active" : "Inactive"}</Typography>}
                />
              </Stack>
            </Stack>
          </TabPanel>

          {/* ════════════════ Tab 1: Appearance ════════════════ */}
          <TabPanel value={activeTab} index={1}>
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5, display: "block" }}>
                  Button Style
                </Typography>
                <RadioGroup
                  row
                  value={buttonStyle}
                  onChange={(e) => setButtonStyle(e.target.value as AgentButtonStyle)}
                >
                  {BUTTON_STYLE_OPTIONS.map((opt) => (
                    <FormControlLabel key={opt.value} value={opt.value} control={<Radio size="small" />} label={opt.label} />
                  ))}
                </RadioGroup>
              </Box>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel>Icon</InputLabel>
                  <Select
                    value={icon}
                    label="Icon"
                    onChange={(e) => setIcon(e.target.value)}
                    disabled={buttonStyle === "text_only"}
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
                <TextField label="Button Text" value={buttonText} onChange={(e) => setButtonText(e.target.value)} size="small" sx={{ flex: 1, minWidth: 160 }} />
                <TextField label="Tooltip Text" value={tooltipText} onChange={(e) => setTooltipText(e.target.value)} size="small" sx={{ flex: 1, minWidth: 160 }} />
              </Stack>
              {/* Live preview */}
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: "block", mb: 0.5 }}>
                  Preview
                </Typography>
                <Tooltip title={tooltipText || displayName} arrow>
                  <Button variant="outlined" size="small" startIcon={buttonStyle !== "text_only" ? <PreviewIcon fontSize="small" /> : undefined}>
                    {buttonStyle !== "icon_only" ? (buttonText || displayName || "Agent") : null}
                  </Button>
                </Tooltip>
              </Paper>
            </Stack>
          </TabPanel>

          {/* ════════════════ Tab 2: Config ════════════════ */}
          <TabPanel value={activeTab} index={2}>
            {agentType === "inventory_diagnostic_agent" && currentTemplate?.behavior ? (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Agent decision flow
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                  Select which problem templates, root causes, resolutions, and
                  action templates THIS instance uses. Changes save to
                  <code> type_specific_config.enabled_library</code>. The full
                  library comes from the published template.
                </Typography>
                <DecisionTreeEditor
                  behavior={currentTemplate.behavior as Record<string, unknown>}
                  value={_buildDecisionTreeValue(typeSpecificConfig, currentTemplate.behavior)}
                  onChange={(next) => {
                    const merged: Record<string, unknown> = {
                      ...(typeSpecificConfig ?? {}),
                      enabled_library: next.enabled_library,
                      decision_graph_overrides: {
                        disabled_edges: next.disabled_edges,
                      },
                    };
                    setTypeSpecificConfig(merged);
                  }}
                  overrides={_buildNodeOverrides(typeSpecificConfig)}
                  onOverridesChange={(next) => {
                    const merged: Record<string, unknown> = { ...(typeSpecificConfig ?? {}) };
                    if (Object.keys(next.per_template_overrides).length > 0) {
                      merged.per_template_overrides = next.per_template_overrides;
                    } else {
                      delete merged.per_template_overrides;
                    }
                    if (Object.keys(next.action_template_overrides).length > 0) {
                      merged.action_template_overrides = next.action_template_overrides;
                    } else {
                      delete merged.action_template_overrides;
                    }
                    setTypeSpecificConfig(merged);
                  }}
                />
                <Divider sx={{ my: 3 }} />
              </Box>
            ) : null}

            {configSchema && Object.keys((configSchema as { properties?: Record<string, unknown> }).properties ?? {}).length > 0 ? (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Type-specific Configuration ({currentTemplate?.display_name ?? selectedTypeDefinition?.display_name ?? agentType})
                </Typography>
                <TypeSpecificConfigEditor
                  schema={configSchema}
                  value={typeSpecificConfig}
                  onChange={setTypeSpecificConfig}
                  uiHints={currentTemplate?.ui_hints}
                />
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                No type-specific configuration fields for this agent type.
              </Typography>
            )}
          </TabPanel>

          {/* ════════════════ Tab 3: Prompt Engineering ════════════════ */}
          <TabPanel value={activeTab} index={3}>
            <Stack spacing={3}>
              {/* System Prompt Base */}
              <Box>
                <OverrideFieldLabel
                  label="System Prompt Base"
                  isModified={isFieldModified("system_prompt", systemPrompt)}
                  onReset={() => resetFieldToTemplate("system_prompt")}
                />
                <PromptSectionEditor
                  label=""
                  value={systemPrompt}
                  onChange={setSystemPrompt}
                  helperText="The foundational system prompt sent to the LLM."
                  minRows={4}
                />
              </Box>

              {/* System Message */}
              <Box>
                <OverrideFieldLabel
                  label="System Message (Instruction)"
                  isModified={isFieldModified("system_message", systemMessage)}
                  onReset={() => resetFieldToTemplate("system_message")}
                />
                <PromptSectionEditor
                  label=""
                  value={systemMessage}
                  onChange={setSystemMessage}
                  helperText="Concise instruction message appended after the system prompt."
                  minRows={3}
                />
              </Box>

              {/* Reasoning Prompt */}
              <Box>
                <OverrideFieldLabel
                  label="Reasoning System Prompt"
                  isModified={isFieldModified("reasoning_system_prompt", reasoningPrompt)}
                  onReset={() => resetFieldToTemplate("reasoning_system_prompt")}
                />
                <PromptSectionEditor
                  label=""
                  value={reasoningPrompt}
                  onChange={setReasoningPrompt}
                  helperText="System prompt used for the reasoning/analysis LLM call."
                  minRows={4}
                />
              </Box>

              {/* Explanation Prompt */}
              <Box>
                <OverrideFieldLabel
                  label="Explanation System Prompt"
                  isModified={isFieldModified("explanation_system_prompt", explanationPrompt)}
                  onReset={() => resetFieldToTemplate("explanation_system_prompt")}
                />
                <PromptSectionEditor
                  label=""
                  value={explanationPrompt}
                  onChange={setExplanationPrompt}
                  helperText="System prompt used for the explanation LLM call."
                  minRows={4}
                />
              </Box>

              {/* Prompt Sections — Accordion per section */}
              <Box>
                <OverrideFieldLabel
                  label="Prompt Sections"
                  isModified={isFieldModified("system_prompt_sections", systemPromptSections)}
                  onReset={() => resetFieldToTemplate("system_prompt_sections")}
                />
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
                <OverrideFieldLabel
                  label="Metric Formulas"
                  isModified={isFieldModified("metric_formulas", metricFormulas)}
                  onReset={() => resetFieldToTemplate("metric_formulas")}
                />
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

          {/* ════════════════ Tab 4: Intelligence ════════════════ */}
          <TabPanel value={activeTab} index={4}>
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
                    {isFieldModified("scope_enabled", scopeEnabled) && (
                      <Chip label="Customized" size="small" color="primary" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    )}
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
                      <Box>
                        <OverrideFieldLabel
                          label="Out-of-scope Keywords"
                          isModified={isFieldModified("out_of_scope_keywords", outOfScopeKeywords)}
                          onReset={() => resetFieldToTemplate("out_of_scope_keywords")}
                        />
                        <TagInput
                          label="Out-of-scope Keywords"
                          value={outOfScopeKeywords}
                          onChange={setOutOfScopeKeywords}
                          helperText="Questions containing these are rejected."
                        />
                      </Box>
                      <Box>
                        <OverrideFieldLabel
                          label="In-scope (DB Signal) Keywords"
                          isModified={isFieldModified("in_scope_keywords", inScopeKeywords)}
                          onReset={() => resetFieldToTemplate("in_scope_keywords")}
                        />
                        <TagInput
                          label="In-scope (DB Signal) Keywords"
                          value={inScopeKeywords}
                          onChange={setInScopeKeywords}
                          helperText="Keywords that signal a database-related query."
                        />
                      </Box>
                      <Box>
                        <OverrideFieldLabel
                          label="Out-of-scope Response"
                          isModified={isFieldModified("out_of_scope_response", outOfScopeResponse)}
                          onReset={() => resetFieldToTemplate("out_of_scope_response")}
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
                      </Box>
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
                    {isFieldModified("ambiguity_enabled", ambiguityEnabled) && (
                      <Chip label="Customized" size="small" color="primary" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    )}
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
                      <Box>
                        <OverrideFieldLabel
                          label="Weak Keywords"
                          isModified={isFieldModified("weak_keywords", weakKeywords)}
                          onReset={() => resetFieldToTemplate("weak_keywords")}
                        />
                        <TagInput
                          label="Weak Keywords"
                          value={weakKeywords}
                          onChange={setWeakKeywords}
                          helperText="Keywords that trigger ambiguity clarification."
                        />
                      </Box>
                      <Box>
                        <OverrideFieldLabel
                          label="Min Question Tokens"
                          isModified={isFieldModified("min_question_tokens", minQuestionTokens)}
                          onReset={() => resetFieldToTemplate("min_question_tokens")}
                        />
                        <SliderWithLabel
                          label=""
                          value={minQuestionTokens}
                          onChange={setMinQuestionTokens}
                          min={1}
                          max={10}
                          step={1}
                          helperText="Minimum word count before a question is considered specific enough."
                        />
                      </Box>
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
                  <Box>
                    <OverrideFieldLabel
                      label="KPI Keywords"
                      isModified={isFieldModified("kpi_keywords", kpiKeywords)}
                      onReset={() => resetFieldToTemplate("kpi_keywords")}
                    />
                    <TagInput
                      label="KPI Keywords"
                      value={kpiKeywords}
                      onChange={setKpiKeywords}
                      helperText="Keywords that trigger KPI-specific guidance."
                    />
                  </Box>
                  <Box>
                    <OverrideFieldLabel
                      label="KPI Playbooks"
                      isModified={isFieldModified("kpi_playbooks", kpiPlaybooks)}
                      onReset={() => resetFieldToTemplate("kpi_playbooks")}
                    />
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

          {/* ════════════════ Tab 5: LLM Settings ════════════════ */}
          <TabPanel value={activeTab} index={5}>
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

                  <Box>
                    <OverrideFieldLabel
                      label="Default Model"
                      isModified={isFieldModified("default_model", defaultModel)}
                      onReset={() => resetFieldToTemplate("default_model")}
                    />
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
                  </Box>

                  <Box>
                    <OverrideFieldLabel
                      label="Temperatures"
                      isModified={isFieldModified("temperatures", temperatures)}
                      onReset={() => resetFieldToTemplate("temperatures")}
                    />
                    <Stack spacing={2}>
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
                </Stack>
              </Box>

              {/* Row Limits */}
              <Box>
                <OverrideFieldLabel
                  label="Row Limits"
                  isModified={isFieldModified("row_limits", rowLimits)}
                  onReset={() => resetFieldToTemplate("row_limits")}
                />
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
                <OverrideFieldLabel
                  label="Confidence Weights"
                  isModified={isFieldModified("confidence_weights", confidenceWeights)}
                  onReset={() => resetFieldToTemplate("confidence_weights")}
                />
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

          {/* ════════════════ Tab 6: Data Mapping ════════════════ */}
          <TabPanel value={activeTab} index={6}>
            <Stack spacing={3}>
              {/* Column Classification */}
              <Box>
                <OverrideFieldLabel
                  label="Column Classification Keywords"
                  isModified={isFieldModified("column_classification", columnClassification)}
                  onReset={() => resetFieldToTemplate("column_classification")}
                />
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

          {/* ════════════════ Tab 7: UI & Presentation ════════════════ */}
          <TabPanel value={activeTab} index={7}>
            <Stack spacing={3}>
              {/* Runtime UI Toggles */}
              <Box>
                <OverrideFieldLabel
                  label="Runtime UI Settings"
                  isModified={isFieldModified("ui_behavior", uiBehavior)}
                  onReset={() => resetFieldToTemplate("ui_behavior")}
                />
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

          {/* ════════════════ Tab 8: Flow ════════════════ */}
          <TabPanel value={activeTab} index={8}>
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Flow Nodes
                </Typography>
                {isFieldModified("flow", flowConfig) && (
                  <>
                    <Chip label="Customized" size="small" color="primary" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    <Tooltip title="Reset to template default">
                      <IconButton size="small" onClick={() => resetFieldToTemplate("flow")} sx={{ p: 0.25 }}>
                        <RestoreOutlinedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Stack>
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

          {/* ════════════════ Tab 9: Access ════════════════ */}
          <TabPanel value={activeTab} index={9}>
            <Stack spacing={3}>
              {/* Role Access */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Role Access</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                  Select which roles can see and use this agent instance.
                </Typography>
                <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                  {roles.map((role) => {
                    const assigned = roleIds.includes(role.id);
                    return (
                      <Chip
                        key={role.id}
                        label={role.name}
                        size="small"
                        color={assigned ? "primary" : "default"}
                        variant={assigned ? "filled" : "outlined"}
                        onClick={() => {
                          setRoleIds(
                            assigned ? roleIds.filter((r) => r !== role.id) : [...roleIds, role.id],
                          );
                        }}
                      />
                    );
                  })}
                  {roleIds.length === 0 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                      No roles assigned -- visible to all users
                    </Typography>
                  ) : null}
                </Stack>
              </Box>

              <Divider />

              {/* Action Permissions */}
              {availableActions.length > 0 ? (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Action Permissions</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                    For each action, select roles that are allowed to perform it. Leave empty for all roles.
                  </Typography>
                  <Stack spacing={1.5}>
                    {availableActions.map((action) => {
                      const assignedRoleIds = actionPermissions[action] ?? [];
                      return (
                        <Box key={action}>
                          <Typography variant="caption" sx={{ fontWeight: 600, mb: 0.3, display: "block" }}>
                            {action}
                          </Typography>
                          <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                            {roles.map((role) => {
                              const isAssigned = assignedRoleIds.includes(role.id);
                              return (
                                <Chip
                                  key={role.id}
                                  label={role.name}
                                  size="small"
                                  color={isAssigned ? "primary" : "default"}
                                  variant={isAssigned ? "filled" : "outlined"}
                                  onClick={() => {
                                    const newIds = isAssigned
                                      ? assignedRoleIds.filter((r) => r !== role.id)
                                      : [...assignedRoleIds, role.id];
                                    setActionPermissions((prev) => ({ ...prev, [action]: newIds }));
                                  }}
                                />
                              );
                            })}
                            {assignedRoleIds.length === 0 ? (
                              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                                All roles permitted
                              </Typography>
                            ) : null}
                          </Stack>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>
              ) : null}
            </Stack>
          </TabPanel>
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
          <Button
            variant="contained"
            disabled={!instanceId || !agentType || !displayName || (isDraftTemplate && !isEdit)}
            onClick={handleSave}
          >
            {isEdit ? "Save Instance" : "Create Instance"}
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
