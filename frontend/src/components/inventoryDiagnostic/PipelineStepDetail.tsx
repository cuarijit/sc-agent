/**
 * Per-step polished detail renderers for the Inventory Diagnostic pipeline.
 *
 * Each exported component takes a `RunStepArtifact` and returns an elegant,
 * human-readable view of what the step did. The parent `PipelineStepCard`
 * decides which renderer to use based on `step.step_id` and always offers a
 * `Show JSON` toggle that falls back to the raw artifact (Inputs / Outputs /
 * Sample rows / LLM call) for power users who want to inspect the payload.
 */
import { useState } from "react";
import {
  Alert,
  Box,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import {
  CheckCircleOutlineOutlined as CheckIcon,
  CodeOutlined as CodeIcon,
  ErrorOutlineOutlined as ErrorIcon,
  HelpOutlineOutlined as HelpIcon,
  LockOpenOutlined as UnlockIcon,
  WarningAmberOutlined as WarnIcon,
} from "@mui/icons-material";

import type { RunStepArtifact } from "../../services/api";

// ────────────────────────────────────────────────────────── shared primitives

const preSx = {
  bgcolor: "grey.50",
  p: 1.25,
  borderRadius: 1,
  fontSize: 11,
  fontFamily: "ui-monospace, Menlo, monospace",
  maxHeight: 260,
  overflow: "auto" as const,
  whiteSpace: "pre-wrap" as const,
  margin: 0,
  border: 1,
  borderColor: "divider",
};

const sectionLabelSx = {
  fontWeight: 700,
  fontSize: 10.5,
  textTransform: "uppercase" as const,
  letterSpacing: 0.8,
  color: "text.secondary",
  mb: 0.75,
  display: "block" as const,
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Typography sx={sectionLabelSx}>{children}</Typography>;
}

function StatCard({
  value,
  label,
  color = "primary.main",
  icon,
}: {
  value: React.ReactNode;
  label: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      sx={{
        px: 1.5,
        py: 1,
        borderRadius: 2,
        minWidth: 112,
        borderLeft: 3,
        borderLeftColor: color,
        bgcolor: alpha(theme.palette.grey[50], 1),
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75}>
        {icon}
        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
          {value}
        </Typography>
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10, fontWeight: 600 }}
      >
        {label}
      </Typography>
    </Paper>
  );
}

// ──────────────────────────────────────────── JSON panel (toggleable for any step)

export function RawJsonPanel({ step }: { step: RunStepArtifact }) {
  const inputs = step.inputs ?? {};
  const outputs = step.outputs ?? {};
  const llm = step.llm_call ?? {};
  const hasLlm =
    typeof llm === "object" &&
    llm !== null &&
    (llm as Record<string, unknown>).provider &&
    !(llm as Record<string, unknown>).error;

  return (
    <Stack spacing={1.25}>
      {Object.keys(inputs).length > 0 ? (
        <Box>
          <SectionLabel>Inputs</SectionLabel>
          <Box component="pre" sx={preSx}>
            {JSON.stringify(inputs, null, 2)}
          </Box>
        </Box>
      ) : null}
      {Object.keys(outputs).length > 0 ? (
        <Box>
          <SectionLabel>Outputs</SectionLabel>
          <Box component="pre" sx={preSx}>
            {JSON.stringify(outputs, null, 2)}
          </Box>
        </Box>
      ) : null}
      {step.sample_rows?.length ? (
        <Box>
          <SectionLabel>Sample rows ({step.sample_rows.length})</SectionLabel>
          <Box component="pre" sx={preSx}>
            {JSON.stringify(step.sample_rows, null, 2)}
          </Box>
        </Box>
      ) : null}
      {hasLlm ? (
        <Box>
          <SectionLabel>LLM call</SectionLabel>
          <Box component="pre" sx={preSx}>
            {JSON.stringify(llm, null, 2)}
          </Box>
        </Box>
      ) : null}
    </Stack>
  );
}

// ────────────────────────────────────────────────────────────── step renderers

// 1. Follow-up interpreter. Outputs match FollowUpRefinement.to_payload():
// {scope_delta, prior_run_id, prior_turn_index, invoked_llm, fallback_reason, warnings}.
export function FollowupView({ step }: { step: RunStepArtifact }) {
  const outputs = step.outputs ?? {};
  const delta = (outputs.scope_delta as Record<string, unknown>) ?? {};
  const fallbackReason = (outputs.fallback_reason as string | null) ?? null;
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard
          value={outputs.invoked_llm ? "LLM" : "deterministic"}
          label="Refinement path"
          color={outputs.invoked_llm ? "success.main" : "primary.main"}
        />
        {outputs.prior_turn_index != null ? (
          <StatCard value={`#${outputs.prior_turn_index}`} label="Prior turn" />
        ) : null}
        <StatCard value={Object.keys(delta).length} label="Scope-delta keys" />
      </Stack>
      {outputs.prior_run_id ? (
        <KVRow label="Inherits from run" value={String(outputs.prior_run_id)} mono />
      ) : null}
      {fallbackReason ? (
        <KVRow label="Fallback reason" value={fallbackReason} />
      ) : null}
      {Object.keys(delta).length > 0 ? (
        <Box>
          <SectionLabel>Scope delta applied</SectionLabel>
          <KeyValueGrid values={delta} />
        </Box>
      ) : (
        <Alert severity="info" sx={{ py: 0.5 }}>
          No prior conversation — new run from a clean scope.
        </Alert>
      )}
    </Stack>
  );
}

// 2. Intent parser — intent mode + extracted tokens.
export function IntentParseView({ step }: { step: RunStepArtifact }) {
  const out = step.outputs ?? {};
  const intent = String(out.intent_mode ?? "—");
  // The parser emits `scope.{skus,nodes,weeks,week_range,focus}`. Older UI
  // versions read top-level `week_offsets` which never existed — read the
  // nested scope here and compute both explicit weeks + week_range span.
  const scope = (out.scope as Record<string, unknown> | undefined) ?? {};
  const skus = ((scope.skus as string[]) ?? (out.skus as string[]) ?? []).filter(Boolean);
  const nodes = ((scope.nodes as string[]) ?? (out.nodes as string[]) ?? []).filter(Boolean);
  const explicitWeeks = ((scope.weeks as number[]) ?? []).filter((n) => typeof n === "number");
  const wr = (scope.week_range as { start?: number; end?: number } | undefined) ?? undefined;
  const rangeWeeks: number[] =
    wr && typeof wr.start === "number" && typeof wr.end === "number" && wr.end >= wr.start
      ? Array.from({ length: wr.end - wr.start + 1 }, (_, i) => wr.start! + i)
      : [];
  // Union of explicit weeks + range span, de-duped and sorted.
  const weeks = Array.from(new Set([...explicitWeeks, ...rangeWeeks])).sort((a, b) => a - b);
  const focus = (scope.focus as string | undefined) ?? (out.focus as string | undefined) ?? "";
  const confidence = typeof out.confidence === "number" ? (out.confidence as number) : null;

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard value={intent} label="intent mode" color="secondary.main" />
        <StatCard value={skus.length} label="SKUs detected" />
        <StatCard value={nodes.length} label="Nodes detected" />
        <StatCard value={weeks.length} label="Weeks detected" />
        {confidence !== null ? (
          <StatCard value={`${Math.round(confidence * 100)}%`} label="Confidence" color="info.main" />
        ) : null}
      </Stack>
      {wr && typeof wr.start === "number" && typeof wr.end === "number" ? (
        <KVRow label="Week range" value={`wk+${wr.start} → wk+${wr.end} (${rangeWeeks.length} weeks)`} />
      ) : null}
      {skus.length > 0 ? <ChipGroup label="SKUs" items={skus} color="primary" /> : null}
      {nodes.length > 0 ? <ChipGroup label="Nodes" items={nodes} color="info" /> : null}
      {weeks.length > 0 ? (
        <ChipGroup label="Weeks" items={weeks.map((w) => `wk+${w}`)} color="success" />
      ) : null}
      {focus ? <KVRow label="Focus" value={focus} /> : null}
    </Stack>
  );
}

// 3. Scope resolver — chip groups + compact sku×node table.
export function ScopeResolverView({ step }: { step: RunStepArtifact }) {
  const out = step.outputs ?? {};
  const weekOffsets = (out.week_offsets as number[]) ?? [];
  const baseWeek = (out.base_week as string) ?? null;
  const pairs = (step.sample_rows ?? []) as unknown[];
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard value={(out.skus_count as number) ?? 0} label="SKUs" />
        <StatCard value={(out.nodes_count as number) ?? 0} label="Nodes" color="info.main" />
        <StatCard
          value={(out.sku_node_pairs_count as number) ?? 0}
          label="SKU × Node pairs"
          color="success.main"
        />
        <StatCard value={weekOffsets.length} label="Weeks in horizon" color="warning.main" />
      </Stack>
      {weekOffsets.length > 0 ? (
        <Box>
          <SectionLabel>Weeks evaluated{baseWeek ? ` (base: ${baseWeek.slice(0, 10)})` : ""}</SectionLabel>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {weekOffsets.map((w) => (
              <Chip
                key={w}
                size="small"
                label={`wk+${w}`}
                variant="outlined"
                sx={{ height: 22, fontSize: 11 }}
              />
            ))}
          </Stack>
        </Box>
      ) : null}
      {pairs.length > 0 ? (
        <Box>
          <SectionLabel>SKU × Node pairs in scope</SectionLabel>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={thCellSx}>SKU</TableCell>
                  <TableCell sx={thCellSx}>Node</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pairs.slice(0, 20).map((p, idx) => {
                  const arr = Array.isArray(p) ? p : [];
                  return (
                    <TableRow key={idx} hover>
                      <TableCell sx={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                        {String(arr[0] ?? "")}
                      </TableCell>
                      <TableCell sx={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                        {String(arr[1] ?? "")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          {pairs.length > 20 ? (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              Showing 20 of {pairs.length}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}

// 4. Capability check — dedicated slot cards.
interface SlotDetail {
  slot_key: string;
  status: "available" | "degraded" | "missing" | string;
  reason?: string | null;
  missing_required_fields?: string[];
  missing_optional_fields?: string[];
  binding_kind?: string | null;
  source_ref?: string | null;
  required_fields?: string[];
  optional_fields?: string[];
  unlocks?: string[];
}

const SLOT_STATUS_ICON: Record<string, React.ReactNode> = {
  available: <CheckIcon sx={{ color: "success.main", fontSize: 18 }} />,
  degraded: <WarnIcon sx={{ color: "warning.main", fontSize: 18 }} />,
  missing: <ErrorIcon sx={{ color: "error.main", fontSize: 18 }} />,
};

const SLOT_STATUS_COLOR: Record<string, string> = {
  available: "success.main",
  degraded: "warning.main",
  missing: "error.main",
};

export function CapabilityCheckView({ step }: { step: RunStepArtifact }) {
  const theme = useTheme();
  const out = step.outputs ?? {};
  const rawDetails = (out.slot_details as SlotDetail[] | undefined) ?? [];
  const disabledProblems = (out.disabled_problems as string[]) ?? [];
  const disabledRootCauses = (out.disabled_root_causes as string[]) ?? [];
  const disabledResolutions = (out.disabled_resolutions as string[]) ?? [];

  // Legacy payloads that only carried available/degraded/missing name lists:
  // synthesise minimal slot details so the view is never empty.
  const slots: SlotDetail[] =
    rawDetails.length > 0
      ? rawDetails
      : [
          ...((out.available as string[]) ?? []).map(
            (k) => ({ slot_key: k, status: "available" } as SlotDetail),
          ),
          ...((out.degraded as string[]) ?? []).map(
            (k) => ({ slot_key: k, status: "degraded" } as SlotDetail),
          ),
          ...((out.missing as string[]) ?? []).map(
            (k) => ({ slot_key: k, status: "missing" } as SlotDetail),
          ),
        ];

  const counts = slots.reduce(
    (acc, s) => {
      if (s.status === "available") acc.available += 1;
      else if (s.status === "degraded") acc.degraded += 1;
      else if (s.status === "missing") acc.missing += 1;
      return acc;
    },
    { available: 0, degraded: 0, missing: 0 },
  );

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard
          value={counts.available}
          label="Available slots"
          color="success.main"
          icon={<CheckIcon sx={{ color: "success.main", fontSize: 18 }} />}
        />
        <StatCard
          value={counts.degraded}
          label="Degraded slots"
          color="warning.main"
          icon={<WarnIcon sx={{ color: "warning.main", fontSize: 18 }} />}
        />
        <StatCard
          value={counts.missing}
          label="Missing slots"
          color="error.main"
          icon={<ErrorIcon sx={{ color: "error.main", fontSize: 18 }} />}
        />
        <StatCard
          value={disabledProblems.length + disabledRootCauses.length + disabledResolutions.length}
          label="Library entries gated"
          color="grey.700"
        />
      </Stack>

      {disabledProblems.length + disabledRootCauses.length + disabledResolutions.length > 0 ? (
        <Alert severity="warning" sx={{ py: 0.75 }}>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            Gated off because a required slot isn't bound:
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {[...disabledProblems, ...disabledRootCauses, ...disabledResolutions].map((k) => (
              <Chip key={k} size="small" label={k} color="default" variant="outlined" sx={{ height: 20 }} />
            ))}
          </Stack>
        </Alert>
      ) : null}

      <Box>
        <SectionLabel>Semantic slots ({slots.length})</SectionLabel>
        <Stack spacing={1}>
          {slots.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              No slot information recorded.
            </Typography>
          ) : null}
          {slots.map((slot) => {
            const color = SLOT_STATUS_COLOR[slot.status] ?? "grey.500";
            const missingReq = slot.missing_required_fields ?? [];
            const missingOpt = slot.missing_optional_fields ?? [];
            return (
              <Paper
                key={slot.slot_key}
                variant="outlined"
                sx={{
                  borderRadius: 1.5,
                  borderLeft: 3,
                  borderLeftColor: color,
                  p: 1.25,
                  bgcolor: slot.status === "missing" ? alpha(theme.palette.error.light, 0.04) : "background.paper",
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1}>
                  {SLOT_STATUS_ICON[slot.status] ?? <HelpIcon sx={{ fontSize: 18 }} />}
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 700, fontFamily: "ui-monospace, monospace", flex: 1 }}
                  >
                    {slot.slot_key}
                  </Typography>
                  <Chip
                    size="small"
                    label={slot.status}
                    color={
                      slot.status === "available"
                        ? "success"
                        : slot.status === "degraded"
                          ? "warning"
                          : slot.status === "missing"
                            ? "error"
                            : "default"
                    }
                    variant={slot.status === "available" ? "filled" : "outlined"}
                    sx={{ height: 20, textTransform: "uppercase", fontSize: 9.5, fontWeight: 700 }}
                  />
                  {slot.binding_kind ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={slot.binding_kind}
                      sx={{ height: 20, fontSize: 10 }}
                    />
                  ) : null}
                </Stack>

                {slot.reason ? (
                  <Typography
                    variant="caption"
                    color={slot.status === "missing" ? "error.main" : "text.secondary"}
                    sx={{ mt: 0.5, display: "block" }}
                  >
                    {slot.reason}
                  </Typography>
                ) : null}

                <Box sx={{ mt: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
                  {(slot.required_fields ?? []).length > 0 ? (
                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 9.5 }}
                      >
                        Required fields
                      </Typography>
                      <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
                        {(slot.required_fields ?? []).map((f) => (
                          <Chip
                            key={f}
                            size="small"
                            label={f}
                            variant="outlined"
                            color={missingReq.includes(f) ? "error" : "default"}
                            sx={{ height: 18, fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  ) : null}
                  {(slot.optional_fields ?? []).length > 0 ? (
                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 9.5 }}
                      >
                        Optional fields
                      </Typography>
                      <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
                        {(slot.optional_fields ?? []).map((f) => (
                          <Chip
                            key={f}
                            size="small"
                            label={f}
                            variant="outlined"
                            color={missingOpt.includes(f) ? "warning" : "default"}
                            sx={{ height: 18, fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  ) : null}
                </Box>

                {(slot.unlocks ?? []).length > 0 ? (
                  <Box sx={{ mt: 1 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 9.5, display: "flex", alignItems: "center", gap: 0.4 }}
                    >
                      <UnlockIcon sx={{ fontSize: 12 }} /> Unlocks
                    </Typography>
                    <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
                      {(slot.unlocks ?? []).map((u) => (
                        <Chip
                          key={u}
                          size="small"
                          label={u}
                          color={slot.status === "available" ? "success" : "default"}
                          variant="outlined"
                          sx={{ height: 18, fontSize: 10 }}
                        />
                      ))}
                    </Stack>
                  </Box>
                ) : null}
              </Paper>
            );
          })}
        </Stack>
      </Box>
    </Stack>
  );
}

// 5. Problem detection — mini table.
export function ProblemDetectionView({ step }: { step: RunStepArtifact }) {
  const out = step.outputs ?? {};
  const rows = (step.sample_rows ?? []) as Array<Record<string, unknown>>;
  const inputs = step.inputs ?? {};
  const activeKeys = (inputs.active_problem_keys as string[]) ?? [];
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard value={(out.problem_count as number) ?? 0} label="Problems detected" color="error.main" />
        <StatCard value={activeKeys.length} label="Active problem templates" color="primary.main" />
      </Stack>
      {activeKeys.length > 0 ? <ChipGroup label="Active templates" items={activeKeys} color="primary" /> : null}
      {rows.length > 0 ? (
        <Box>
          <SectionLabel>Top detected problems</SectionLabel>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={thCellSx}>SKU</TableCell>
                  <TableCell sx={thCellSx}>Node</TableCell>
                  <TableCell sx={thCellSx}>Problem</TableCell>
                  <TableCell sx={thCellSx}>Severity</TableCell>
                  <TableCell sx={thCellSx} align="right">Breach wk</TableCell>
                  <TableCell sx={thCellSx} align="right">On hand</TableCell>
                  <TableCell sx={thCellSx} align="right">ROP</TableCell>
                  <TableCell sx={thCellSx} align="right">Shortage</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.slice(0, 10).map((r, idx) => (
                  <TableRow key={idx} hover>
                    <TableCell sx={cellMonoSx}>{String(r.sku ?? "")}</TableCell>
                    <TableCell sx={cellMonoSx}>{String(r.node_id ?? "")}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{String(r.problem_key ?? "")}</TableCell>
                    <TableCell>
                      <SeverityChip severity={String(r.severity ?? "info")} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 12 }}>
                      {r.breach_week != null ? `wk+${r.breach_week}` : "—"}
                    </TableCell>
                    <TableCell align="right" sx={cellMonoSx}>
                      {typeof r.projected_on_hand_actual_qty === "number"
                        ? Math.round(r.projected_on_hand_actual_qty as number).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell align="right" sx={cellMonoSx}>
                      {typeof r.reorder_point_qty === "number"
                        ? Math.round(r.reorder_point_qty as number).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 12, fontWeight: 700, color: "error.main" }}>
                      {typeof r.shortage_qty === "number"
                        ? Math.round(r.shortage_qty as number).toLocaleString()
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {rows.length > 10 ? (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              Showing 10 of {rows.length}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}

// 6. Prioritization — top ranked with bar-style score.
export function PrioritizationView({ step }: { step: RunStepArtifact }) {
  const rows = (step.sample_rows ?? []) as Array<Record<string, unknown>>;
  const maxScore = rows.reduce((m, r) => Math.max(m, Number(r.score ?? 0)), 0);
  const weights = (step.inputs?.weights as Record<string, number>) ?? {};
  return (
    <Stack spacing={1.25}>
      {Object.keys(weights).length > 0 ? (
        <Box>
          <SectionLabel>Prioritization weights</SectionLabel>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {Object.entries(weights).map(([k, v]) => (
              <Chip
                key={k}
                size="small"
                label={`${k}: ${v}`}
                variant="outlined"
                sx={{ height: 20, fontSize: 10.5 }}
              />
            ))}
          </Stack>
        </Box>
      ) : null}
      {rows.length > 0 ? (
        <Box>
          <SectionLabel>Top ranked problems</SectionLabel>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ ...thCellSx, width: 36 }} align="center">#</TableCell>
                  <TableCell sx={thCellSx}>SKU</TableCell>
                  <TableCell sx={thCellSx}>Node</TableCell>
                  <TableCell sx={thCellSx}>Severity</TableCell>
                  <TableCell sx={thCellSx}>Score</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.slice(0, 10).map((r, idx) => {
                  const score = Number(r.score ?? 0);
                  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
                  return (
                    <TableRow key={idx} hover>
                      <TableCell align="center" sx={{ fontWeight: 700 }}>
                        {String(r.rank ?? idx + 1)}
                      </TableCell>
                      <TableCell sx={cellMonoSx}>{String(r.sku ?? "")}</TableCell>
                      <TableCell sx={cellMonoSx}>{String(r.node_id ?? "")}</TableCell>
                      <TableCell>
                        <SeverityChip severity={String(r.severity ?? "info")} />
                      </TableCell>
                      <TableCell sx={{ minWidth: 160 }}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Box
                            sx={{
                              flex: 1,
                              height: 6,
                              borderRadius: 3,
                              bgcolor: "grey.200",
                              overflow: "hidden",
                            }}
                          >
                            <Box
                              sx={{
                                width: `${pct}%`,
                                height: "100%",
                                bgcolor: "primary.main",
                              }}
                            />
                          </Box>
                          <Typography variant="caption" sx={{ fontFamily: "ui-monospace, monospace", minWidth: 42, textAlign: "right" }}>
                            {score.toFixed(3)}
                          </Typography>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          {rows.length > 10 ? (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              Showing 10 of {rows.length}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Stack>
  );
}

// 7. Root-cause analyzer — table with optional evidence summary.
export function RootCauseView({ step }: { step: RunStepArtifact }) {
  const rows = (step.sample_rows ?? []) as Array<Record<string, unknown>>;
  const out = step.outputs ?? {};
  const inputs = step.inputs ?? {};
  if (rows.length === 0) {
    return (
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <StatCard
            value={(out.root_cause_count as number) ?? 0}
            label="Root causes found"
            color="warning.main"
          />
          <StatCard
            value={((inputs.rca_template_keys as string[]) ?? []).length}
            label="RC templates evaluated"
          />
        </Stack>
        <Alert severity="info" sx={{ py: 0.5 }}>
          No root causes fired for the top-ranked problems.
        </Alert>
      </Stack>
    );
  }
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard
          value={(out.root_cause_count as number) ?? rows.length}
          label="Root causes found"
          color="warning.main"
        />
        <StatCard
          value={((inputs.rca_template_keys as string[]) ?? []).length}
          label="RC templates evaluated"
        />
        <StatCard
          value={(inputs.top_problem_count as number) ?? 0}
          label="Top problems analysed"
        />
      </Stack>
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={thCellSx}>Root cause</TableCell>
              <TableCell sx={thCellSx}>For problem</TableCell>
              <TableCell sx={thCellSx}>Breach wk</TableCell>
              <TableCell sx={thCellSx} align="right">Weight</TableCell>
              <TableCell sx={thCellSx} align="right">Score</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(0, 12).map((r, idx) => {
              const ref = (r.problem_ref as Record<string, unknown>) ?? {};
              return (
                <TableRow key={idx} hover>
                  <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{String(r.rc_key ?? "")}</TableCell>
                  <TableCell sx={{ fontSize: 12, color: "text.secondary" }}>
                    <Box component="span" sx={{ fontFamily: "ui-monospace, monospace" }}>
                      {String(ref.sku ?? "")}
                    </Box>
                    {" @ "}
                    <Box component="span" sx={{ fontFamily: "ui-monospace, monospace" }}>
                      {String(ref.node_id ?? "")}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    {ref.breach_week != null ? `wk+${ref.breach_week}` : "—"}
                  </TableCell>
                  <TableCell align="right" sx={cellMonoSx}>
                    {typeof r.weight === "number" ? (r.weight as number).toFixed(2) : "—"}
                  </TableCell>
                  <TableCell align="right" sx={cellMonoSx}>
                    {typeof r.score === "number" ? (r.score as number).toFixed(3) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}

// 8. Resolution generator — candidate enumeration (pre-simulation).
// Sample rows: ResolutionCandidate.to_payload() — simulation_score + resolves_breach
// are typically null at this stage (the SimulationView renders them filled in).
export function ResolutionView({ step }: { step: RunStepArtifact }) {
  const rows = (step.sample_rows ?? []) as Array<Record<string, unknown>>;
  const out = step.outputs ?? {};
  const inputs = step.inputs ?? {};
  const familyKeys = ((inputs.resolver_family_keys as string[]) ?? []).filter(Boolean);
  if (rows.length === 0) {
    return (
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <StatCard value={0} label="Candidates generated" />
          <StatCard value={familyKeys.length} label="Resolution families active" />
        </Stack>
        <Alert severity="info" sx={{ py: 0.5 }}>
          No resolution candidates generated — no feasible moves found for the
          top problems with the enabled families.
        </Alert>
      </Stack>
    );
  }
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard
          value={(out.candidate_count_pre_simulation as number) ?? rows.length}
          label="Candidates generated"
        />
        <StatCard value={familyKeys.length} label="Resolution families active" />
        <StatCard
          value={rows.filter((r) => r.feasible === true).length}
          label="Feasible"
          color="success.main"
        />
      </Stack>
      {familyKeys.length > 0 ? (
        <ChipGroup label="Active families" items={familyKeys} color="success" />
      ) : null}
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={thCellSx}>Family</TableCell>
              <TableCell sx={thCellSx}>For problem</TableCell>
              <TableCell sx={thCellSx}>From → To</TableCell>
              <TableCell sx={thCellSx} align="right">Qty</TableCell>
              <TableCell sx={thCellSx} align="right">Lead</TableCell>
              <TableCell sx={thCellSx}>Feasible</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.slice(0, 15).map((r, idx) => {
              const ref = (r.problem_ref as Record<string, unknown>) ?? {};
              return (
                <TableRow key={idx} hover>
                  <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>{String(r.family_key ?? "")}</TableCell>
                  <TableCell sx={{ fontSize: 11.5, color: "text.secondary", fontFamily: "ui-monospace, monospace" }}>
                    {String(ref.sku ?? r.sku ?? "—")} @ {String(ref.node_id ?? r.to_node ?? "—")}
                  </TableCell>
                  <TableCell sx={cellMonoSx}>
                    {String(r.from_node ?? "—")} → {String(r.to_node ?? "—")}
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: 12, fontWeight: 600 }}>
                    {typeof r.qty === "number" ? Math.round(r.qty as number).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: 12 }}>
                    {r.lead_time_days != null ? `${r.lead_time_days}d` : "—"}
                  </TableCell>
                  <TableCell>
                    {r.feasible === true ? (
                      <Chip size="small" color="success" label="yes" sx={{ height: 18, fontSize: 10 }} />
                    ) : r.feasible === false ? (
                      <Chip size="small" color="default" label="no" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    ) : (
                      <Chip size="small" color="default" label="—" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {rows.length > 15 ? (
        <Typography variant="caption" color="text.secondary">
          Showing 15 of {rows.length}
        </Typography>
      ) : null}
    </Stack>
  );
}

// 9. Simulation ranker — resolves_breach flag + sim score.
export function SimulationView({ step }: { step: RunStepArtifact }) {
  const rows = (step.sample_rows ?? []) as Array<Record<string, unknown>>;
  const out = step.outputs ?? {};
  // The sim step emits `{total_count, resolves_breach_count}`. Fall back to
  // `candidate_count_pre_simulation` so old runs still render.
  const totalCount =
    (out.total_count as number) ??
    (out.candidate_count_pre_simulation as number) ??
    rows.length;
  const resolvesCount = (out.resolves_breach_count as number) ?? 0;
  const resolveRate = totalCount > 0 ? Math.round((resolvesCount / totalCount) * 100) : 0;
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard value={totalCount} label="Candidates simulated" />
        <StatCard value={resolvesCount} label="Resolve the breach" color="success.main" />
        <StatCard value={`${resolveRate}%`} label="Resolution rate" color="primary.main" />
      </Stack>
      {rows.length > 0 ? (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...thCellSx, width: 36 }} align="center">#</TableCell>
                <TableCell sx={thCellSx}>Family</TableCell>
                <TableCell sx={thCellSx}>For problem</TableCell>
                <TableCell sx={thCellSx} align="right">Qty</TableCell>
                <TableCell sx={thCellSx}>Resolves?</TableCell>
                <TableCell sx={thCellSx} align="right">Sim score</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.slice(0, 12).map((r, idx) => {
                const ref = (r.problem_ref as Record<string, unknown>) ?? {};
                return (
                  <TableRow key={idx} hover>
                    <TableCell align="center" sx={{ fontWeight: 700, fontSize: 12 }}>
                      {r.rank != null ? String(r.rank) : idx + 1}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>{String(r.family_key ?? "")}</TableCell>
                    <TableCell sx={{ fontSize: 11.5, color: "text.secondary", fontFamily: "ui-monospace, monospace" }}>
                      {String(ref.sku ?? r.sku ?? "—")} @ {String(ref.node_id ?? r.to_node ?? "—")}
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 12 }}>
                      {typeof r.qty === "number" ? Math.round(r.qty as number).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>
                      {r.resolves_breach === true ? (
                        <Chip size="small" color="success" label="yes" sx={{ height: 18, fontSize: 10 }} />
                      ) : r.resolves_breach === false ? (
                        <Chip size="small" color="default" label="no" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                      ) : (
                        <Chip size="small" color="default" label="—" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                      )}
                    </TableCell>
                    <TableCell align="right" sx={cellMonoSx}>
                      {typeof r.simulation_score === "number" ? (r.simulation_score as number).toFixed(3) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </Stack>
  );
}

// 10. Action mapper — planned actions.
// Backend PlannedAction.to_payload() is:
//   {plan_id, run_id, instance_id, plan_status, action_template_key,
//    target_system, delivery_mode, webhook_url, payload: {...}}
// where family_key / sku / qty / breach_week / resolves_breach live INSIDE
// `payload` (ActionMapper._build_payload composes them there).
export function ActionMapperView({ step }: { step: RunStepArtifact }) {
  const rows = (step.sample_rows ?? []) as Array<Record<string, unknown>>;
  const out = step.outputs ?? {};
  const planStatus = String(out.plan_status ?? "—");
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard value={(out.plan_count as number) ?? rows.length} label="Action plans produced" />
        <StatCard
          value={planStatus}
          label="Plan status"
          color={planStatus === "queued" ? "success.main" : planStatus === "draft" ? "primary.main" : "grey.600"}
        />
      </Stack>
      {rows.length > 0 ? (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={thCellSx}>Action</TableCell>
                <TableCell sx={thCellSx}>Family</TableCell>
                <TableCell sx={thCellSx}>SKU</TableCell>
                <TableCell sx={thCellSx} align="right">Qty</TableCell>
                <TableCell sx={thCellSx}>Delivery</TableCell>
                <TableCell sx={thCellSx}>Plan status</TableCell>
                <TableCell sx={thCellSx}>Resolves?</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.slice(0, 12).map((r, idx) => {
                const payload = (r.payload as Record<string, unknown>) ?? {};
                const resolves = payload.resolves_breach;
                const status = String(r.plan_status ?? "—");
                return (
                  <TableRow key={idx} hover>
                    <TableCell sx={{ fontSize: 12, fontWeight: 600 }}>
                      {String(r.action_template_key ?? "")}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{String(payload.family_key ?? "—")}</TableCell>
                    <TableCell sx={cellMonoSx}>{String(payload.sku ?? "—")}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 12, fontWeight: 600 }}>
                      {typeof payload.qty === "number"
                        ? Math.round(payload.qty as number).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Chip
                        size="small"
                        label={String(r.delivery_mode ?? "—")}
                        variant="outlined"
                        sx={{ height: 20, fontSize: 10 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={status}
                        color={status === "queued" ? "success" : status === "draft" ? "primary" : "default"}
                        variant={status === "queued" ? "filled" : "outlined"}
                        sx={{ height: 18, fontSize: 10, textTransform: "uppercase" }}
                      />
                    </TableCell>
                    <TableCell>
                      {resolves === true ? (
                        <Chip size="small" color="success" label="yes" sx={{ height: 18, fontSize: 10 }} />
                      ) : resolves === false ? (
                        <Chip size="small" color="default" label="no" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                      ) : (
                        <Chip size="small" color="default" label="—" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </Stack>
  );
}

// 11. Response composer — narrative preview + LLM summary.
export function ResponseComposerView({ step }: { step: RunStepArtifact }) {
  const out = step.outputs ?? {};
  const narrativeLen = Number(out.narrative_length ?? 0);
  const narrativePreview = String(out.narrative_preview ?? "");
  const llm = step.llm_call ?? {};
  const hasLlm =
    typeof llm === "object" &&
    llm !== null &&
    (llm as Record<string, unknown>).provider &&
    !(llm as Record<string, unknown>).error;
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard value={narrativeLen.toLocaleString()} label="Narrative chars" />
        {hasLlm ? (
          <>
            <StatCard
              value={String((llm as Record<string, unknown>).model ?? "—")}
              label="Model"
              color="secondary.main"
            />
            <StatCard
              value={`${(llm as Record<string, unknown>).latency_ms ?? 0}ms`}
              label="LLM latency"
              color="success.main"
            />
          </>
        ) : (
          <StatCard value="fallback" label="Narrative source" color="warning.main" />
        )}
      </Stack>
      {narrativePreview ? (
        <Box>
          <SectionLabel>Narrative preview</SectionLabel>
          <Paper
            variant="outlined"
            sx={{ p: 1.5, borderRadius: 1.5, fontSize: 13, lineHeight: 1.55, bgcolor: "grey.50" }}
          >
            {narrativePreview}
            {narrativeLen > narrativePreview.length ? "…" : ""}
          </Paper>
        </Box>
      ) : null}
    </Stack>
  );
}

// 12. Audit logger — `audit_art.outputs = {run_id, agent_type_version, llm_calls_count}`.
export function AuditView({ step }: { step: RunStepArtifact }) {
  const out = step.outputs ?? {};
  const runId = String(out.run_id ?? "—");
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <StatCard value={(out.llm_calls_count as number) ?? 0} label="LLM calls this run" color="secondary.main" />
        <StatCard
          value={`v${(out.agent_type_version as number) ?? "—"}`}
          label="Template version"
          color="primary.main"
        />
      </Stack>
      <KVRow label="Run ID" value={runId} mono />
    </Stack>
  );
}

// ───────────────────────────────────────────────────────────── tiny helpers

function KVRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="baseline">
      <Typography
        variant="caption"
        sx={{ minWidth: 140, color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10.5 }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontFamily: mono ? "ui-monospace, Menlo, monospace" : undefined, fontSize: 12.5 }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function KeyValueGrid({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
      <Stack spacing={0.5}>
        {entries.map(([k, v]) => (
          <Stack key={k} direction="row" spacing={1} alignItems="baseline">
            <Typography
              variant="caption"
              sx={{ minWidth: 160, color: "text.secondary", fontWeight: 600, fontFamily: "ui-monospace, monospace", fontSize: 10.5 }}
            >
              {k}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: 11.5, wordBreak: "break-word" }}>
              {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

function ChipGroup({
  label,
  items,
  color = "default",
}: {
  label: string;
  items: string[];
  color?: "default" | "primary" | "info" | "success" | "warning" | "error";
}) {
  return (
    <Box>
      <SectionLabel>{label}</SectionLabel>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {items.map((item) => (
          <Chip
            key={item}
            size="small"
            label={item}
            color={color}
            variant="outlined"
            sx={{ height: 22, fontSize: 11, fontFamily: "ui-monospace, monospace" }}
          />
        ))}
      </Stack>
    </Box>
  );
}

function SeverityChip({ severity }: { severity: string }) {
  const color =
    severity === "critical" ? "error" : severity === "warning" ? "warning" : "default";
  return (
    <Chip
      size="small"
      label={severity}
      color={color as "error" | "warning" | "default"}
      variant={severity === "critical" ? "filled" : "outlined"}
      sx={{ height: 18, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}
    />
  );
}

const thCellSx = {
  fontWeight: 700,
  fontSize: 10.5,
  textTransform: "uppercase" as const,
  letterSpacing: 0.6,
  color: "text.secondary",
  bgcolor: "grey.50",
  py: 0.75,
};

const cellMonoSx = {
  fontFamily: "ui-monospace, Menlo, monospace" as const,
  fontSize: 12,
};

// ──────────────────────────────────────────────── step dispatcher

export function StepDetailBody({ step }: { step: RunStepArtifact }) {
  if (step.status === "skipped") {
    const reason = (step.outputs?.reason as string) ?? "Not enabled for this intent";
    return (
      <Alert severity="info" sx={{ py: 0.5 }}>
        Step skipped — {reason}.
      </Alert>
    );
  }
  switch (step.step_id) {
    case "followup_interpret":
      return <FollowupView step={step} />;
    case "intent_parse":
      return <IntentParseView step={step} />;
    case "scope_resolve":
      return <ScopeResolverView step={step} />;
    case "capability_check":
      return <CapabilityCheckView step={step} />;
    case "detect_problems":
      return <ProblemDetectionView step={step} />;
    case "prioritize":
      return <PrioritizationView step={step} />;
    case "analyze_root_cause":
      return <RootCauseView step={step} />;
    case "enumerate_resolutions":
      return <ResolutionView step={step} />;
    case "simulate_rank":
      return <SimulationView step={step} />;
    case "map_actions":
      return <ActionMapperView step={step} />;
    case "compose_response":
      return <ResponseComposerView step={step} />;
    case "audit":
      return <AuditView step={step} />;
    default:
      return <RawJsonPanel step={step} />;
  }
}

// ─────────────────────────────────────── reusable Show-JSON toggle

export function JsonToggleButton({
  showJson,
  onToggle,
}: {
  showJson: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip title={showJson ? "Hide raw JSON" : "Show raw JSON"}>
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        sx={{
          color: showJson ? "primary.main" : "text.secondary",
        }}
      >
        <CodeIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

// Convenience wrapper so pages can render the panel with its own Divider.
export function JsonPanelWithDivider({ step }: { step: RunStepArtifact }) {
  return (
    <>
      <Divider sx={{ my: 1.25 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, letterSpacing: 0.6 }}>
          RAW JSON
        </Typography>
      </Divider>
      <RawJsonPanel step={step} />
    </>
  );
}

// Single hook that returns showJson state + toggle + elements — saves boilerplate in callers.
export function useJsonToggle(initial = false) {
  const [showJson, setShowJson] = useState(initial);
  return {
    showJson,
    setShowJson,
    toggle: () => setShowJson((v) => !v),
  };
}
