/**
 * DecisionTreeEditor — visual editor for an Inventory Diagnostic Agent
 * instance. Shows the template's library as 4 ordered swim lanes (Problems →
 * Root Causes → Resolutions → Actions). Each node has a checkbox to include
 * it in this instance's `enabled_library`. Edges are drawn between nodes
 * that are connected in the template's `decision_graph` (+
 * `resolution_to_actions` map).
 *
 * Per-instance overrides the editor maintains:
 *   enabled_library.{problem_templates, root_cause_templates,
 *                    resolution_families, action_templates}[]
 *   decision_graph_overrides.disabled_edges[]  (future; not authored here)
 *
 * Click a node to open a side drawer showing that node's template-level
 * definition — useful when an admin wants to see exactly what the template
 * says about the entry they're toggling.
 *
 * Intentionally no new runtime dependencies — uses plain DOM + MUI only.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

type Lane = "problem" | "root_cause" | "resolution" | "action";

interface LibraryEntry {
  key: string;
  display_name?: string;
  description?: string;
  requires_slots?: string[];
  severity?: Record<string, unknown>;
  weight?: number;
  rule?: Record<string, unknown>;
  evidence_query?: string;
  enumeration_rule?: string;
  direction?: string;
}

interface DecisionGraphEdge {
  from_problem: string;
  compatible_root_causes?: string[];
  compatible_resolutions?: string[];
  default_rank?: string[];
}

interface TemplateBehavior {
  library?: {
    problem_templates?: LibraryEntry[];
    root_cause_templates?: LibraryEntry[];
    resolution_families?: LibraryEntry[];
    action_templates?: Record<string, Record<string, unknown>>;
  };
  // Legacy shape (pre-v7): library entries declared at the top level. The
  // backend MergedRuntime tolerates both shapes; the editor must too so
  // existing DB rows continue to render.
  problem_templates?: LibraryEntry[];
  root_cause_templates?: LibraryEntry[];
  resolution_families?: LibraryEntry[];
  action_templates?: Record<string, Record<string, unknown>>;
  decision_graph?: DecisionGraphEdge[];
  resolution_to_actions?: Record<string, string[]>;
  slot_catalog?: Array<{ slot_key: string; unlocks?: string[] }>;
}

export interface EnabledLibrary {
  problem_templates: string[];
  root_cause_templates: string[];
  resolution_families: string[];
  action_templates: string[];
}

export interface DecisionTreeEditorValue {
  enabled_library: EnabledLibrary;
  disabled_edges: Array<Record<string, string>>;
}

export interface NodeOverrides {
  per_template_overrides: Record<string, Record<string, unknown>>;
  action_template_overrides: Record<string, Record<string, unknown>>;
}

interface Props {
  behavior: TemplateBehavior;
  value: DecisionTreeEditorValue;
  onChange: (next: DecisionTreeEditorValue) => void;
  overrides?: NodeOverrides;
  onOverridesChange?: (next: NodeOverrides) => void;
  capabilitySlotsAvailable?: string[];
}

const LANE_TITLES: Record<Lane, string> = {
  problem: "Problem templates",
  root_cause: "Root causes",
  resolution: "Resolutions",
  action: "Action templates",
};


export default function DecisionTreeEditor({
  behavior,
  value,
  onChange,
  overrides,
  onOverridesChange,
  capabilitySlotsAvailable,
}: Props) {
  const theme = useTheme();
  const effectiveOverrides: NodeOverrides = overrides ?? {
    per_template_overrides: {},
    action_template_overrides: {},
  };
  const overridesEditable = Boolean(onOverridesChange);

  // Read library entries from `behavior.library.X` (v7+) and fall back to
  // the legacy top-level shape so older template rows still render.
  const problems = (behavior.library?.problem_templates?.length ? behavior.library?.problem_templates : behavior.problem_templates) ?? [];
  const rcs = (behavior.library?.root_cause_templates?.length ? behavior.library?.root_cause_templates : behavior.root_cause_templates) ?? [];
  const resolutions = (behavior.library?.resolution_families?.length ? behavior.library?.resolution_families : behavior.resolution_families) ?? [];
  const actionTemplatesObj = (behavior.library?.action_templates && Object.keys(behavior.library.action_templates).length
    ? behavior.library.action_templates
    : behavior.action_templates) ?? {};
  const actions: LibraryEntry[] = useMemo(
    () => Object.entries(actionTemplatesObj).map(([key, tpl]) => ({
      key,
      display_name: humanize(key),
      ...((tpl as Record<string, unknown>) ?? {}),
    })) as LibraryEntry[],
    [actionTemplatesObj],
  );

  const graph = behavior.decision_graph ?? [];
  const resolutionToActions = behavior.resolution_to_actions ?? {};
  const capabilitySet = new Set(capabilitySlotsAvailable ?? []);

  const [hoveredNode, setHoveredNode] = useState<{ lane: Lane; key: string } | null>(null);
  const [drawerNode, setDrawerNode] = useState<{ lane: Lane; entry: LibraryEntry } | null>(null);

  const enabledProblems = new Set(value.enabled_library.problem_templates);
  const enabledRcs = new Set(value.enabled_library.root_cause_templates);
  const enabledResolutions = new Set(value.enabled_library.resolution_families);
  const enabledActions = new Set(value.enabled_library.action_templates);

  const toggle = (lane: Lane, key: string) => {
    const next = {
      ...value,
      enabled_library: {
        ...value.enabled_library,
        problem_templates: [...value.enabled_library.problem_templates],
        root_cause_templates: [...value.enabled_library.root_cause_templates],
        resolution_families: [...value.enabled_library.resolution_families],
        action_templates: [...value.enabled_library.action_templates],
      },
    };
    const field =
      lane === "problem" ? "problem_templates"
      : lane === "root_cause" ? "root_cause_templates"
      : lane === "resolution" ? "resolution_families"
      : "action_templates";
    const arr = next.enabled_library[field];
    const idx = arr.indexOf(key);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(key);
    onChange(next);
  };

  // Highlight connected nodes when a node is hovered.
  const connected: Set<string> = useMemo(() => {
    if (!hoveredNode) return new Set();
    const out = new Set<string>([`${hoveredNode.lane}:${hoveredNode.key}`]);
    if (hoveredNode.lane === "problem") {
      const edge = graph.find((e) => e.from_problem === hoveredNode.key);
      (edge?.compatible_root_causes ?? []).forEach((rc) => out.add(`root_cause:${rc}`));
      (edge?.compatible_resolutions ?? []).forEach((r) => out.add(`resolution:${r}`));
      (edge?.compatible_resolutions ?? []).forEach((r) => {
        (resolutionToActions[r] ?? []).forEach((a) => out.add(`action:${a}`));
      });
    } else if (hoveredNode.lane === "root_cause") {
      graph.forEach((e) => {
        if ((e.compatible_root_causes ?? []).includes(hoveredNode.key)) {
          out.add(`problem:${e.from_problem}`);
        }
      });
    } else if (hoveredNode.lane === "resolution") {
      graph.forEach((e) => {
        if ((e.compatible_resolutions ?? []).includes(hoveredNode.key)) {
          out.add(`problem:${e.from_problem}`);
        }
      });
      (resolutionToActions[hoveredNode.key] ?? []).forEach((a) => out.add(`action:${a}`));
    } else if (hoveredNode.lane === "action") {
      Object.entries(resolutionToActions).forEach(([r, arr]) => {
        if (arr.includes(hoveredNode.key)) {
          out.add(`resolution:${r}`);
          graph.forEach((e) => {
            if ((e.compatible_resolutions ?? []).includes(r)) {
              out.add(`problem:${e.from_problem}`);
            }
          });
        }
      });
    }
    return out;
  }, [hoveredNode, graph, resolutionToActions]);

  const totals = {
    problem: enabledProblems.size + " / " + problems.length,
    root_cause: enabledRcs.size + " / " + rcs.length,
    resolution: enabledResolutions.size + " / " + resolutions.length,
    action: enabledActions.size + " / " + actions.length,
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Chip size="small" color="primary" label={`Problems enabled: ${totals.problem}`} />
        <Chip size="small" color="primary" label={`Root causes: ${totals.root_cause}`} />
        <Chip size="small" color="primary" label={`Resolutions: ${totals.resolution}`} />
        <Chip size="small" color="primary" label={`Actions: ${totals.action}`} />
      </Stack>
      <Alert severity="info" sx={{ mb: 2 }}>
        Each lane lists the template's full library. Toggle on the items this
        instance should run. Hover a node to highlight its downstream branches.
        Click a node for its full declarative definition.
      </Alert>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 2,
          alignItems: "flex-start",
        }}
      >
        <Lane
          title={LANE_TITLES.problem}
          entries={problems}
          lane="problem"
          enabled={enabledProblems}
          connected={connected}
          capabilitySet={capabilitySet}
          onHover={setHoveredNode}
          onClick={(entry) => setDrawerNode({ lane: "problem", entry })}
          onToggle={(key) => toggle("problem", key)}
          accent={theme.palette.error.main}
        />
        <Lane
          title={LANE_TITLES.root_cause}
          entries={rcs}
          lane="root_cause"
          enabled={enabledRcs}
          connected={connected}
          capabilitySet={capabilitySet}
          onHover={setHoveredNode}
          onClick={(entry) => setDrawerNode({ lane: "root_cause", entry })}
          onToggle={(key) => toggle("root_cause", key)}
          accent={theme.palette.warning.main}
        />
        <Lane
          title={LANE_TITLES.resolution}
          entries={resolutions}
          lane="resolution"
          enabled={enabledResolutions}
          connected={connected}
          capabilitySet={capabilitySet}
          onHover={setHoveredNode}
          onClick={(entry) => setDrawerNode({ lane: "resolution", entry })}
          onToggle={(key) => toggle("resolution", key)}
          accent={theme.palette.success.main}
        />
        <Lane
          title={LANE_TITLES.action}
          entries={actions}
          lane="action"
          enabled={enabledActions}
          connected={connected}
          capabilitySet={capabilitySet}
          onHover={setHoveredNode}
          onClick={(entry) => setDrawerNode({ lane: "action", entry })}
          onToggle={(key) => toggle("action", key)}
          accent={theme.palette.info.main}
        />
      </Box>

      <Drawer anchor="right" open={Boolean(drawerNode)} onClose={() => setDrawerNode(null)}>
        {drawerNode ? (
          <NodeOverrideDrawer
            lane={drawerNode.lane}
            entry={drawerNode.entry}
            laneTitle={LANE_TITLES[drawerNode.lane]}
            overrides={effectiveOverrides}
            onOverridesChange={onOverridesChange}
            onClose={() => setDrawerNode(null)}
            editable={overridesEditable}
          />
        ) : null}
      </Drawer>
    </Box>
  );
}


function Lane({
  title,
  entries,
  lane,
  enabled,
  connected,
  capabilitySet,
  onHover,
  onClick,
  onToggle,
  accent,
}: {
  title: string;
  entries: LibraryEntry[];
  lane: Lane;
  enabled: Set<string>;
  connected: Set<string>;
  capabilitySet: Set<string>;
  onHover: (node: { lane: Lane; key: string } | null) => void;
  onClick: (entry: LibraryEntry) => void;
  onToggle: (key: string) => void;
  accent: string;
}) {
  const theme = useTheme();
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: accent }} />
        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>
          {title}
        </Typography>
      </Stack>
      <Stack spacing={1}>
        {entries.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 2, textAlign: "center" }}>
            <Typography variant="caption" color="text.secondary">
              No entries in template.
            </Typography>
          </Paper>
        ) : null}
        {entries.map((entry) => {
          const isEnabled = enabled.has(entry.key);
          const isConnected = connected.has(`${lane}:${entry.key}`);
          const missingSlots = (entry.requires_slots ?? []).filter(
            (s) => capabilitySet.size > 0 && !capabilitySet.has(s),
          );
          const hasMissing = missingSlots.length > 0;
          return (
            <Paper
              key={entry.key}
              variant="outlined"
              onMouseEnter={() => onHover({ lane, key: entry.key })}
              onMouseLeave={() => onHover(null)}
              onClick={() => onClick(entry)}
              sx={{
                p: 1.25,
                cursor: "pointer",
                borderRadius: 2,
                borderColor: isConnected ? accent : "divider",
                borderWidth: isConnected ? 2 : 1,
                bgcolor: isEnabled ? alpha(accent, 0.06) : "background.paper",
                opacity: isEnabled ? 1 : 0.6,
                transition: "all 0.12s",
                "&:hover": {
                  boxShadow: 1,
                  borderColor: accent,
                },
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1}>
                <Switch
                  size="small"
                  checked={isEnabled}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggle(entry.key)}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {entry.display_name || entry.key}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} noWrap>
                    {entry.key}
                  </Typography>
                </Box>
                {isEnabled && !hasMissing ? (
                  <Tooltip title="Enabled for this instance">
                    <CheckCircleOutlineIcon color="success" sx={{ fontSize: 16 }} />
                  </Tooltip>
                ) : null}
                {isEnabled && hasMissing ? (
                  <Tooltip title={`Missing slots: ${missingSlots.join(", ")}`}>
                    <WarningAmberIcon color="warning" sx={{ fontSize: 16 }} />
                  </Tooltip>
                ) : null}
                {!isEnabled ? (
                  <ErrorOutlineIcon sx={{ fontSize: 16, color: theme.palette.text.disabled }} />
                ) : null}
              </Stack>
              {entry.requires_slots?.length ? (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                  {entry.requires_slots.map((slot) => (
                    <Chip
                      key={slot}
                      size="small"
                      label={slot}
                      variant="outlined"
                      color={capabilitySet.size === 0 ? "default" : capabilitySet.has(slot) ? "success" : "warning"}
                      sx={{ height: 18, fontSize: 9 }}
                    />
                  ))}
                </Stack>
              ) : null}
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}


function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── NodeOverrideDrawer ────────────────────────────────────────────────────

interface NodeOverrideDrawerProps {
  lane: Lane;
  entry: LibraryEntry;
  laneTitle: string;
  overrides: NodeOverrides;
  onOverridesChange?: (next: NodeOverrides) => void;
  onClose: () => void;
  editable: boolean;
}

function NodeOverrideDrawer({
  lane,
  entry,
  laneTitle,
  overrides,
  onOverridesChange,
  onClose,
  editable,
}: NodeOverrideDrawerProps) {
  // Library lanes (problem/root_cause/resolution) live under
  // `per_template_overrides`; action lane uses `action_template_overrides`.
  const isActionLane = lane === "action";
  const currentOverride = isActionLane
    ? overrides.action_template_overrides[entry.key] ?? {}
    : overrides.per_template_overrides[entry.key] ?? {};

  const [draft, setDraft] = useState<Record<string, unknown>>(currentOverride);

  useEffect(() => {
    setDraft(currentOverride);
  }, [entry.key, lane]);  // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: Record<string, unknown>) => {
    setDraft(next);
    if (!onOverridesChange) return;
    // Empty override object → remove the entry so the template default wins.
    const hasValues = Object.keys(next).length > 0;
    if (isActionLane) {
      const nextMap = { ...overrides.action_template_overrides };
      if (hasValues) nextMap[entry.key] = next; else delete nextMap[entry.key];
      onOverridesChange({ ...overrides, action_template_overrides: nextMap });
    } else {
      const nextMap = { ...overrides.per_template_overrides };
      if (hasValues) nextMap[entry.key] = next; else delete nextMap[entry.key];
      onOverridesChange({ ...overrides, per_template_overrides: nextMap });
    }
  };

  const reset = () => commit({});

  const setField = (key: string, value: unknown) => {
    const next = { ...draft };
    if (value === "" || value === undefined || value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    commit(next);
  };

  const setNestedField = (parent: string, key: string, value: unknown) => {
    const parentObj = { ...((draft[parent] as Record<string, unknown>) ?? {}) };
    if (value === "" || value === undefined || value === null) {
      delete parentObj[key];
    } else {
      parentObj[key] = value;
    }
    const next = { ...draft };
    if (Object.keys(parentObj).length > 0) {
      next[parent] = parentObj;
    } else {
      delete next[parent];
    }
    commit(next);
  };

  const overrideKeys = Object.keys(draft);

  return (
    <Box sx={{ width: 460, p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Chip size="small" color="primary" label={laneTitle} />
        <Typography variant="h6" sx={{ flex: 1 }} noWrap>
          {entry.display_name || entry.key}
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
        {entry.key}
      </Typography>

      {editable ? (
        <>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
              Instance overrides
            </Typography>
            {overrideKeys.length > 0 ? (
              <Tooltip title="Remove all overrides — fall back to template defaults">
                <Button size="small" startIcon={<RestartAltIcon fontSize="small" />} onClick={reset}>
                  Reset
                </Button>
              </Tooltip>
            ) : null}
          </Stack>
          <Alert severity="info" sx={{ mb: 2, py: 0.5 }}>
            Leave fields blank to inherit the template default.
          </Alert>

          {lane === "problem" ? (
            <ProblemOverrideFields draft={draft} setNestedField={setNestedField} setField={setField} />
          ) : null}
          {lane === "root_cause" ? (
            <RootCauseOverrideFields draft={draft} setField={setField} />
          ) : null}
          {lane === "resolution" ? (
            <ResolutionOverrideFields draft={draft} setField={setField} />
          ) : null}
          {lane === "action" ? (
            <ActionOverrideFields entry={entry} draft={draft} setField={setField} />
          ) : null}

          <Divider sx={{ my: 2 }} />
        </>
      ) : null}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Template definition (read-only)
      </Typography>
      <Box
        component="pre"
        sx={{
          bgcolor: "grey.50",
          p: 1.5,
          borderRadius: 1,
          fontSize: 11,
          maxHeight: 300,
          overflow: "auto",
          mt: 1,
          fontFamily: "monospace",
        }}
      >
        {JSON.stringify(entry, null, 2)}
      </Box>
    </Box>
  );
}

interface FieldsProps {
  draft: Record<string, unknown>;
  setField: (key: string, value: unknown) => void;
  setNestedField?: (parent: string, key: string, value: unknown) => void;
}

function numberOrBlank(draft: Record<string, unknown>, path: string[]): string {
  let cur: unknown = draft;
  for (const p of path) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
    else return "";
  }
  return cur === undefined || cur === null ? "" : String(cur);
}

function ProblemOverrideFields({ draft, setField, setNestedField }: FieldsProps) {
  return (
    <Stack spacing={2}>
      <TextField
        label="Critical if weeks-until-breach ≤"
        size="small"
        type="number"
        value={numberOrBlank(draft, ["severity", "critical_if_weeks_until_breach"])}
        onChange={(e) => setNestedField && setNestedField("severity", "critical_if_weeks_until_breach", e.target.value === "" ? null : Number(e.target.value))}
        helperText="Override the template's critical threshold (in weeks). Blank = inherit."
      />
      <TextField
        label="Warning if weeks-until-breach ≤"
        size="small"
        type="number"
        value={numberOrBlank(draft, ["severity", "warning_if_weeks_until_breach"])}
        onChange={(e) => setNestedField && setNestedField("severity", "warning_if_weeks_until_breach", e.target.value === "" ? null : Number(e.target.value))}
        helperText="Override the template's warning threshold."
      />
      <TextField
        label="Rule value (threshold)"
        size="small"
        type="number"
        value={numberOrBlank(draft, ["rule", "value"])}
        onChange={(e) => setNestedField && setNestedField("rule", "value", e.target.value === "" ? null : Number(e.target.value))}
        helperText="Numeric threshold for rules of type threshold_on_projection_field."
      />
      <TextField
        label="Weight"
        size="small"
        type="number"
        inputProps={{ step: 0.1, min: 0, max: 1 }}
        value={numberOrBlank(draft, ["weight"])}
        onChange={(e) => setField("weight", e.target.value === "" ? null : Number(e.target.value))}
        helperText="Prioritisation weight (0.0–1.0)."
      />
    </Stack>
  );
}

function RootCauseOverrideFields({ draft, setField }: FieldsProps) {
  return (
    <Stack spacing={2}>
      <TextField
        label="Weight"
        size="small"
        type="number"
        inputProps={{ step: 0.05, min: 0, max: 1 }}
        value={numberOrBlank(draft, ["weight"])}
        onChange={(e) => setField("weight", e.target.value === "" ? null : Number(e.target.value))}
        helperText="Root-cause weight used in the RCA ranking. Blank = inherit."
      />
      <TextField
        label="Evidence threshold"
        size="small"
        type="number"
        inputProps={{ step: 0.05 }}
        value={numberOrBlank(draft, ["evidence_threshold"])}
        onChange={(e) => setField("evidence_threshold", e.target.value === "" ? null : Number(e.target.value))}
        helperText="Minimum evidence score required for this RC to surface."
      />
    </Stack>
  );
}

function ResolutionOverrideFields({ draft, setField }: FieldsProps) {
  return (
    <Stack spacing={2}>
      <TextField
        label="Max candidates per problem"
        size="small"
        type="number"
        inputProps={{ step: 1, min: 1 }}
        value={numberOrBlank(draft, ["max_candidates_per_problem"])}
        onChange={(e) => setField("max_candidates_per_problem", e.target.value === "" ? null : Number(e.target.value))}
        helperText="Cap on resolution candidates emitted per problem instance."
      />
      <TextField
        label="Default quantity rule"
        size="small"
        value={(draft.default_qty_rule as string) ?? ""}
        onChange={(e) => setField("default_qty_rule", e.target.value)}
        helperText="Identifier for the quantity-picking rule (must match a backend handler)."
      />
    </Stack>
  );
}

function ActionOverrideFields({ entry, draft, setField }: { entry: LibraryEntry; draft: Record<string, unknown>; setField: (k: string, v: unknown) => void; }) {
  const isCsv = entry.key === "export_action_csv";
  const isWebhook = entry.key === "create_webhook_payload";
  return (
    <Stack spacing={2}>
      {isCsv ? (
        <TextField
          label="Columns (comma-separated)"
          size="small"
          value={Array.isArray(draft.columns) ? (draft.columns as string[]).join(", ") : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v.trim()) setField("columns", null);
            else setField("columns", v.split(",").map((s) => s.trim()).filter(Boolean));
          }}
          helperText="Override the CSV column list for this instance. Blank = template default."
        />
      ) : null}
      {isWebhook ? (
        <TextField
          label="Webhook schema_ref"
          size="small"
          value={(draft.schema_ref as string) ?? ""}
          onChange={(e) => setField("schema_ref", e.target.value)}
          helperText="Schema identifier this instance sends (e.g. v2_resolution_payload)."
        />
      ) : null}
      <TextField
        label="Target system"
        size="small"
        value={(draft.target_system as string) ?? ""}
        onChange={(e) => setField("target_system", e.target.value)}
        helperText="Override the downstream system (e.g. servicenow, jira)."
      />
      <TextField
        label="Delivery mode"
        size="small"
        value={(draft.delivery_mode as string) ?? ""}
        onChange={(e) => setField("delivery_mode", e.target.value)}
        helperText="One of: task, webhook, csv, record. Blank = template default."
      />
    </Stack>
  );
}
