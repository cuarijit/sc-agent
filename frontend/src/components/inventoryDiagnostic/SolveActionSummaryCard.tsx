import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForwardOutlined";
import CheckIcon from "@mui/icons-material/CheckOutlined";
import CloseIcon from "@mui/icons-material/CloseOutlined";
import { useMemo } from "react";

import type { InventoryDiagnosticResponse } from "../../services/api";

type Status = "DRAFT" | "SIMULATED" | "QUEUED" | "DISPATCHED";

type FamilyGroup = {
  family: string;
  actions: number;
  skus: string[];
  totalQty: number;
  resolvesCount: number;
  resolvesTotal: number;
  unknownResolves: number;
};

type NormalizedRow = {
  family_key: string;
  sku: string | null;
  qty: number;
  resolves_breach: boolean | null;
};

const TARGET_INTENTS = new Set(["solve", "simulate", "execute"]);

const HUMAN_FAMILY_LABELS: Record<string, string> = {
  phase_promotion: "Phase promotion",
  transfer_excess: "Transfer excess",
  expedite_inbound: "Expedite inbound",
  reallocate_demand: "Reallocate demand",
  walk_sourcing_network_siblings_with_excess: "Sibling sourcing (excess)",
};

function humanizeFamily(key: string): string {
  if (!key) return "Other";
  const mapped = HUMAN_FAMILY_LABELS[key];
  if (mapped) return mapped;
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizePlan(plan: Record<string, unknown>): NormalizedRow {
  const payload = (plan.payload as Record<string, unknown> | undefined) ?? {};
  const rawQty = payload.qty ?? plan.qty;
  const qty = typeof rawQty === "number" ? rawQty : Number(rawQty ?? 0) || 0;
  const sku = typeof payload.sku === "string" ? payload.sku : typeof plan.sku === "string" ? (plan.sku as string) : null;
  const family =
    typeof payload.family_key === "string"
      ? (payload.family_key as string)
      : typeof plan.family_key === "string"
        ? (plan.family_key as string)
        : "";
  const rb = payload.resolves_breach ?? plan.resolves_breach;
  const resolves_breach = typeof rb === "boolean" ? rb : null;
  return { family_key: family, sku, qty, resolves_breach };
}

function groupByFamily(rows: NormalizedRow[]): FamilyGroup[] {
  const map = new Map<string, FamilyGroup>();
  for (const row of rows) {
    const family = row.family_key || "Other";
    let group = map.get(family);
    if (!group) {
      group = {
        family,
        actions: 0,
        skus: [],
        totalQty: 0,
        resolvesCount: 0,
        resolvesTotal: 0,
        unknownResolves: 0,
      };
      map.set(family, group);
    }
    group.actions += 1;
    group.totalQty += row.qty;
    if (row.sku && !group.skus.includes(row.sku)) {
      group.skus.push(row.sku);
    }
    if (row.resolves_breach === true) {
      group.resolvesCount += 1;
      group.resolvesTotal += 1;
    } else if (row.resolves_breach === false) {
      group.resolvesTotal += 1;
    } else {
      group.unknownResolves += 1;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.actions - a.actions);
}

function pickStatus(response: InventoryDiagnosticResponse): Status {
  const intent = response.intent_mode;
  const actionPlan = response.structured.action_plan as Record<string, unknown> | null | undefined;
  const planStatus = typeof actionPlan?.status === "string" ? (actionPlan.status as string).toLowerCase() : "";
  const dispatchEnabled = Boolean(actionPlan?.dispatch_enabled);
  if (intent === "simulate") return "SIMULATED";
  if (intent === "execute") {
    if (dispatchEnabled) return "DISPATCHED";
    if (planStatus === "queued") return "QUEUED";
    return "QUEUED";
  }
  return "DRAFT";
}

function statusColor(status: Status): "primary" | "info" | "success" | "warning" {
  switch (status) {
    case "SIMULATED":
      return "info";
    case "QUEUED":
      return "warning";
    case "DISPATCHED":
      return "success";
    default:
      return "primary";
  }
}

const FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export default function SolveActionSummaryCard({
  response,
  onViewResults,
}: {
  response: InventoryDiagnosticResponse;
  onViewResults: () => void;
}) {
  const groups = useMemo<FamilyGroup[]>(() => {
    if (!TARGET_INTENTS.has(response.intent_mode)) return [];
    const actionPlan = response.structured.action_plan as Record<string, unknown> | null | undefined;
    const rawPlans = Array.isArray(actionPlan?.plans) ? (actionPlan!.plans as Record<string, unknown>[]) : [];
    if (rawPlans.length > 0) {
      return groupByFamily(rawPlans.map(normalizePlan));
    }
    // Simulate intent typically has no action_plan; fall back to resolutions.
    if (response.intent_mode === "simulate") {
      const rawResolutions = Array.isArray(response.structured.resolutions)
        ? (response.structured.resolutions as Record<string, unknown>[])
        : [];
      return groupByFamily(rawResolutions.map(normalizePlan));
    }
    return [];
  }, [response.run_id, response.intent_mode, response.structured]);

  if (groups.length === 0) return null;

  const status = pickStatus(response);
  const color = statusColor(status);
  const totalActions = groups.reduce((acc, g) => acc + g.actions, 0);
  const uniqueSkus = new Set<string>();
  let totalQty = 0;
  for (const g of groups) {
    for (const sku of g.skus) uniqueSkus.add(sku);
    totalQty += g.totalQty;
  }
  const topGroups = groups.slice(0, 3);
  const overflowFamilies = groups.length - topGroups.length;

  return (
    <Paper
      variant="outlined"
      sx={{
        mt: 1,
        p: 1.25,
        borderRadius: 2,
        borderLeft: 3,
        borderLeftColor: `${color}.main`,
        bgcolor: "background.paper",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "text.secondary",
          }}
        >
          Actions
        </Typography>
        <Chip
          size="small"
          label={status}
          color={color}
          sx={{ height: 18, fontSize: 10, fontWeight: 700, letterSpacing: 0.4 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
          {FMT.format(totalActions)} {totalActions === 1 ? "plan" : "plans"}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
          · {uniqueSkus.size} {uniqueSkus.size === 1 ? "SKU" : "SKUs"}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
          · {FMT.format(totalQty)} units
        </Typography>
      </Stack>

      <Stack spacing={0.75}>
        {topGroups.map((g) => {
          const all = g.resolvesCount === g.resolvesTotal && g.resolvesTotal > 0;
          const none = g.resolvesCount === 0 && g.resolvesTotal > 0;
          const resolvesColor: "success" | "warning" | "default" = all
            ? "success"
            : none
              ? "default"
              : g.resolvesTotal > 0
                ? "warning"
                : "default";
          const ResolvesIcon = all ? CheckIcon : none ? CloseIcon : CheckIcon;
          return (
            <Box key={g.family}>
              <Stack direction="row" spacing={0.75} alignItems="baseline" flexWrap="wrap" useFlexGap>
                <Typography variant="body2" sx={{ fontSize: 12.5, fontWeight: 600 }}>
                  {humanizeFamily(g.family)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                  {g.actions} {g.actions === 1 ? "action" : "actions"} · {g.skus.length}{" "}
                  {g.skus.length === 1 ? "SKU" : "SKUs"}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
                {g.skus.slice(0, 3).map((sku) => (
                  <Chip
                    key={sku}
                    size="small"
                    label={sku}
                    sx={{
                      height: 18,
                      fontSize: 10,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      bgcolor: "grey.100",
                    }}
                  />
                ))}
                {g.skus.length > 3 ? (
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                    +{g.skus.length - 3}
                  </Typography>
                ) : null}
                {g.resolvesTotal > 0 ? (
                  <Chip
                    size="small"
                    icon={<ResolvesIcon sx={{ fontSize: 12 }} />}
                    label={`clears ${g.resolvesCount}/${g.resolvesTotal}${
                      g.unknownResolves > 0 ? ` · ${g.unknownResolves} unknown` : ""
                    }`}
                    color={resolvesColor}
                    variant={resolvesColor === "default" ? "outlined" : "filled"}
                    sx={{ height: 18, fontSize: 10 }}
                  />
                ) : null}
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                  · {FMT.format(g.totalQty)} units
                </Typography>
              </Stack>
            </Box>
          );
        })}
        {overflowFamilies > 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
            +{overflowFamilies} more {overflowFamilies === 1 ? "family" : "families"}
          </Typography>
        ) : null}
      </Stack>

      <Box sx={{ mt: 0.75 }}>
        <Button
          size="small"
          variant="text"
          endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
          onClick={(e) => {
            e.stopPropagation();
            onViewResults();
          }}
          sx={{ px: 0.5, minWidth: 0, fontSize: 11, fontWeight: 600, textTransform: "none" }}
        >
          View full action plan in Results tab
        </Button>
      </Box>
    </Paper>
  );
}

export { groupByFamily, humanizeFamily, normalizePlan };
