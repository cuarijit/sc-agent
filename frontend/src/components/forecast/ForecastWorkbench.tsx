import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip as MuiTooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";

import EChartBase, { type EChartOption } from "../../charts/EChartBase";
import {
  aggregateToBuckets,
  applyHorizonCap,
  type AggregationMethod,
  type BucketKind,
  type BucketedRow,
  type WeeklyRow,
} from "./bucketAggregation";
import { useSyncedScroll } from "./useSyncedScroll";

export type ForecastSeriesType = "line" | "bar";

export interface ForecastSeriesDef {
  /** Key matches `WeeklyRow.values[field]`. */
  key: string;
  label: string;
  type: ForecastSeriesType;
  color: string;
  strokeWidth?: number;
  dashed?: boolean;
  showDot?: boolean;
  /** Render as a metric row in the grid (default: true). */
  showInGrid?: boolean;
  /** Number formatter. */
  format?: (v: number | null) => string;
  /** Aggregation method when bucketing. Default "sum". */
  aggregation?: AggregationMethod;
  /** Cap series to `currentWeek + horizonWeeks`. */
  horizonWeeks?: number;
  /** Visual z-order (higher = drawn on top). */
  z?: number;
  /** Bold grid label. */
  bold?: boolean;
  /** Row background tint for the grid. */
  rowTint?: string;
  /** Render adjustment bars: positive green, negative red. */
  diverging?: boolean;
}

export interface ForecastWorkbenchProps {
  title?: string;
  /** Weekly source data (grain: one row per week). */
  rows: WeeklyRow[];
  series: ForecastSeriesDef[];
  /** Bucket state (controlled). */
  bucket: BucketKind;
  onBucketChange: (b: BucketKind) => void;
  /** Which bucket kinds to enable. Defaults to all 4. */
  enabledBuckets?: BucketKind[];
  /** Tooltip explaining why a bucket is disabled. */
  disabledBucketLabel?: string;
  /** Editable-row behaviour. Key of the editable series (renders below metric rows). */
  adjustmentKey?: string;
  /** Per-bucket adjustment deltas. */
  adjustments: Record<string, number>;
  onAdjust: (bucket: string, value: number) => void;
  /** Locked buckets (Set of bucket keys). */
  locks: Set<string>;
  onToggleLock: (bucket: string) => void;
  /** Key of the "adjusted forecast" row (locked rendering). */
  adjustedKey?: string;
  /** Field name holding the base value that adjustment is added to. */
  baseForAdjustedKey?: string;
  /** Snapshot values to use when a bucket is locked (captured at lock time). */
  lockedValues?: Record<string, number>;
  /** Save callback. */
  onSave?: () => void;
  dirty?: boolean;
  loading?: boolean;
  /** Extra variance rows rendered below the adjusted row. */
  varianceRows?: Array<{
    key: string;
    label: string;
    format: (v: number | null) => string;
    colorize?: boolean;
  }>;
  /** Optional header/action slot rendered to the right of the title. */
  rightActions?: React.ReactNode;
  /** Chart height in px. */
  chartHeight?: number;
  /** Override "current week" (for tests / demos). Defaults to new Date(). */
  now?: Date;
}

const DEFAULT_NUMBER_FMT = (v: number | null): string =>
  v == null ? "—" : Math.round(v).toLocaleString();

/**
 * Pre-blend a (possibly translucent) rowTint over white so the sticky-left
 * column never lets scrolling content bleed through. Accepts rgba/rgb/hex;
 * returns an opaque hex color. Falls back to white for unknown inputs.
 */
function solidTint(tint: string | undefined): string {
  if (!tint) return "#ffffff";
  const m = tint.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    const a = m[4] != null ? Number(m[4]) : 1;
    const blend = (c: number) => Math.round(c * a + 255 * (1 - a));
    const hex = (c: number) => c.toString(16).padStart(2, "0");
    return `#${hex(blend(r))}${hex(blend(g))}${hex(blend(b))}`;
  }
  return tint; // hex or named color — assume already opaque
}

const BUCKET_OPTIONS: BucketKind[] = ["day", "week", "month", "quarter"];
const BUCKET_LABELS: Record<BucketKind, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

export default function ForecastWorkbench({
  title = "Forecast workbench",
  rows,
  series,
  bucket,
  onBucketChange,
  enabledBuckets = BUCKET_OPTIONS,
  disabledBucketLabel,
  adjustmentKey,
  adjustments,
  onAdjust,
  locks,
  onToggleLock,
  adjustedKey,
  baseForAdjustedKey,
  lockedValues,
  onSave,
  dirty = false,
  loading,
  varianceRows = [],
  rightActions,
  chartHeight = 320,
  now,
}: ForecastWorkbenchProps) {
  // ── 1. Bucket the weekly source rows ────────────────────────────────
  const aggregationMethods = useMemo<Record<string, AggregationMethod>>(() => {
    const m: Record<string, AggregationMethod> = {};
    for (const s of series) if (s.aggregation) m[s.key] = s.aggregation;
    return m;
  }, [series]);

  const bucketedRows = useMemo<BucketedRow[]>(() => {
    let out = aggregateToBuckets(rows, bucket, aggregationMethods, now);
    // Merge adjustments as a virtual field so the chart/grid read them uniformly
    if (adjustmentKey) {
      out = out.map((r) => ({
        ...r,
        values: {
          ...r.values,
          [adjustmentKey]: adjustments[r.bucket] ?? 0,
        },
      }));
    }
    // Recompute the adjusted field: base forecast + adjustment, unless locked
    if (adjustedKey && adjustmentKey) {
      out = out.map((r) => {
        const locked = locks.has(r.bucket);
        const baseKey = baseForAdjustedKey ?? adjustedKey;
        const base = Number(r.values[baseKey] ?? 0);
        const adj = Number(r.values[adjustmentKey] ?? 0);
        let adjustedValue: number;
        if (locked && lockedValues && r.bucket in lockedValues) {
          adjustedValue = lockedValues[r.bucket];
        } else {
          adjustedValue = base + adj;
        }
        return {
          ...r,
          values: {
            ...r.values,
            [adjustedKey]: adjustedValue,
          },
        };
      });
    }
    // Apply horizon caps
    for (const s of series) {
      if (s.horizonWeeks) {
        out = applyHorizonCap(out, s.key, s.horizonWeeks, now);
      }
    }
    return out;
  }, [rows, bucket, aggregationMethods, adjustmentKey, adjustments, adjustedKey, baseForAdjustedKey, lockedValues, locks, series, now]);

  // Scaling horizon caps for month / quarter: shrink horizonWeeks proportionally
  // Already handled by applyHorizonCap (works on calendar days, not buckets).

  const bucketCount = bucketedRows.length;
  const sync = useSyncedScroll(bucketCount);

  // ── Past-bucket detection ───────────────────────────────────────────
  // A bucket is "past" when it ends strictly before today. We keep the
  // current bucket editable (still partially in the future). `sortKey` is
  // the first calendar day in the bucket; for week/month/quarter we add
  // the bucket length so a bucket that *contains* today is NOT past.
  const todayIso = useMemo(() => {
    const d = now ?? new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, [now]);

  const isPastBucket = useCallback(
    (b: BucketedRow): boolean => {
      if (b.isCurrent) return false;
      // sortKey is first day of bucket. The current bucket is already
      // marked via isCurrent — so any non-current bucket whose sortKey is
      // before today's bucket can be treated as past. For day buckets the
      // sortKey IS the bucket; for week/month/quarter, `isCurrent` already
      // covers the case where today falls inside the bucket.
      return b.sortKey < todayIso;
    },
    [todayIso],
  );

  // Slice bucketedRows to the zoom window so the grid and chart render the
  // exact same week range. The chart's ECharts dataZoom is the source of
  // truth; the grid below mirrors that slice (no independent scrollbar).
  const visibleRows = useMemo(() => {
    if (bucketedRows.length === 0) return bucketedRows;
    const startIdx = Math.max(
      0,
      Math.min(bucketedRows.length - 1, Math.floor((sync.window[0] / 100) * bucketedRows.length)),
    );
    const endIdx = Math.max(
      startIdx + 1,
      Math.min(bucketedRows.length, Math.ceil((sync.window[1] / 100) * bucketedRows.length)),
    );
    return bucketedRows.slice(startIdx, endIdx);
  }, [bucketedRows, sync.window]);

  // ── 2. Input-only state for adjustment cells (string state while typing) ──
  const [inputStr, setInputStr] = useInputMap(bucketedRows.map((r) => r.bucket));

  const handleInputChange = useCallback(
    (b: string, raw: string) => setInputStr(b, raw),
    [setInputStr],
  );
  const handleCommit = useCallback(
    (b: string) => {
      const raw = inputStr.get(b) ?? "";
      const num = raw === "" || raw === "-" ? 0 : Number(raw);
      if (Number.isNaN(num)) return;
      if (locks.has(b)) return;
      // Reject adjustments for past buckets — historical periods are read-only.
      const row = bucketedRows.find((r) => r.bucket === b);
      if (row && isPastBucket(row)) return;
      onAdjust(b, num);
    },
    [inputStr, locks, onAdjust, bucketedRows, isPastBucket],
  );

  // ── 3. Build the ECharts option ─────────────────────────────────────
  const chartOption = useMemo<EChartOption>(() => {
    const xData = bucketedRows.map((r) => r.bucketLabel);
    const currentIdx = bucketedRows.findIndex((r) => r.isCurrent);

    const echartsSeries = series
      .map((s, i) => {
        const data = bucketedRows.map((r) => {
          const v = r.values[s.key];
          if (v == null) return null;
          if (s.diverging) return v === 0 ? null : v;
          return v;
        });
        const isBar = s.type === "bar";
        const common: Record<string, unknown> = {
          id: `fw_${s.key}_${i}`,
          name: s.label,
          type: isBar ? "bar" : "line",
          data,
          itemStyle: { color: s.color },
          z: s.z ?? (isBar ? 2 : 5),
          emphasis: { focus: "series" },
        };

        if (isBar) {
          if (s.diverging) {
            // Positive green bars, negative red — override per data point
            common.itemStyle = {
              color: (p: { data: number | null }) =>
                p.data == null || p.data >= 0 ? "#16a34a" : "#dc2626",
            };
          }
          common.barMaxWidth = 28;
          (common.itemStyle as Record<string, unknown>).borderRadius = [2, 2, 0, 0];
          return common;
        }

        common.smooth = true;
        common.smoothMonotone = "x";
        common.showSymbol = s.showDot !== false;
        common.symbol = "circle";
        common.symbolSize = 5;
        common.lineStyle = {
          width: s.strokeWidth ?? 2,
          color: s.color,
          type: s.dashed ? "dashed" : "solid",
        };
        // Breaks in the line where null appears (horizon cap)
        common.connectNulls = false;
        return common;
      })
      .filter(Boolean);

    // Current-bucket markers hang off the first line series
    if (currentIdx >= 0 && echartsSeries.length > 0) {
      const firstLineIdx = series.findIndex((s) => s.type === "line");
      if (firstLineIdx >= 0) {
        const target = echartsSeries[firstLineIdx] as Record<string, unknown>;
        target.markLine = {
          silent: true,
          symbol: "none",
          lineStyle: {
            color: "rgba(234,88,12,0.7)",
            width: 1.5,
            type: "solid",
          },
          label: {
            formatter: "Now",
            color: "#ea580c",
            fontSize: 10,
            position: "end",
          },
          data: [{ xAxis: xData[currentIdx] }],
        };
        target.markArea = {
          silent: true,
          itemStyle: { color: "rgba(234,88,12,0.08)" },
          data: [[{ xAxis: xData[currentIdx] }, { xAxis: xData[currentIdx] }]],
        };
      }
    }

    return {
      grid: { left: 56, right: 24, top: 56, bottom: 78, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
      },
      legend: {
        top: 4,
        left: "center",
        type: "scroll",
        itemGap: 18,
        itemWidth: 14,
        itemHeight: 10,
        textStyle: { fontSize: 11 },
      },
      xAxis: {
        type: "category",
        data: xData,
        boundaryGap: true,
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          fontSize: 10,
          formatter: (v: number) => {
            if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}k`;
            return String(v);
          },
        },
      },
      dataZoom: [
        {
          type: "slider",
          bottom: 32,
          height: 14,
          start: sync.window[0],
          end: sync.window[1],
          borderColor: "transparent",
          handleSize: 14,
          handleStyle: { color: "#cbd5e1" },
          fillerColor: "rgba(59,130,246,0.12)",
          showDetail: false,
          labelFormatter: "",
        },
        {
          type: "inside",
          start: sync.window[0],
          end: sync.window[1],
        },
      ],
      series: echartsSeries,
    };
  }, [bucketedRows, series, sync.window]);

  const chartEvents = useMemo(() => {
    return {
      dataZoom: (p: unknown) => {
        const params = p as {
          start?: number;
          end?: number;
          batch?: Array<{ start?: number; end?: number }>;
        };
        const start = params.start ?? params.batch?.[0]?.start;
        const end = params.end ?? params.batch?.[0]?.end;
        if (start == null || end == null) return;
        sync.onChartZoom(start, end);
      },
    };
  }, [sync]);

  // (Grid scrolling is no longer user-driven — the grid only renders the
  // slice of buckets within the chart's dataZoom window, so columns are
  // always 1-to-1 aligned with visible chart bars.)

  // ── 4. Render ───────────────────────────────────────────────────────
  const gridSeries = series.filter((s) => s.showInGrid !== false && s.key !== adjustmentKey && s.key !== adjustedKey);

  return (
    <Box className="content-card" sx={{ p: 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
        <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600 }}>
          {title}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <ToggleButtonGroup
            size="small"
            value={bucket}
            exclusive
            onChange={(_e, val) => {
              if (val && BUCKET_OPTIONS.includes(val)) onBucketChange(val as BucketKind);
            }}
            sx={{ "& .MuiToggleButton-root": { fontSize: 10.5, py: 0.1, px: 1, textTransform: "none" } }}
          >
            {BUCKET_OPTIONS.map((b) => {
              const disabled = !enabledBuckets.includes(b);
              const btn = (
                <ToggleButton key={b} value={b} disabled={disabled}>
                  {BUCKET_LABELS[b]}
                </ToggleButton>
              );
              if (disabled && disabledBucketLabel) {
                return (
                  <MuiTooltip key={b} title={disabledBucketLabel} arrow>
                    <span>{btn}</span>
                  </MuiTooltip>
                );
              }
              return btn;
            })}
          </ToggleButtonGroup>
          {rightActions}
          {dirty ? (
            <Chip size="small" label="Unsaved" color="warning" variant="outlined" sx={{ fontSize: 10, height: 22 }} />
          ) : null}
          {onSave ? (
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveOutlinedIcon sx={{ fontSize: 14 }} />}
              disabled={!dirty}
              onClick={onSave}
              sx={{ textTransform: "none", fontSize: 11, height: 28, px: 1.5 }}
            >
              Save Adjustments
            </Button>
          ) : null}
        </Stack>
      </Stack>

      <div className="chart-shell">
        <EChartBase
          option={chartOption}
          height={chartHeight}
          loading={loading}
          empty={bucketedRows.length === 0}
          onEvents={chartEvents as Record<string, (p: unknown) => void>}
          onInstanceReady={(inst) => sync.setChartInstance(inst)}
        />
      </div>

      <Box
        sx={{
          mt: 1,
          overflowX: "auto",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
        }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
          <thead>
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  background: "#f8fafc",
                  padding: "6px 12px",
                  textAlign: "left",
                  borderBottom: "2px solid #e2e8f0",
                  whiteSpace: "nowrap",
                  minWidth: 180,
                  fontWeight: 600,
                  zIndex: 4,
                  boxShadow: "2px 0 0 0 #fff",
                }}
              >
                Metric
              </th>
              {visibleRows.map((d) => (
                <th
                  key={d.bucket}
                  style={{
                    padding: "6px 10px",
                    textAlign: "right",
                    borderBottom: "2px solid #e2e8f0",
                    whiteSpace: "nowrap",
                    fontSize: 10,
                    fontWeight: d.isCurrent ? 700 : 500,
                    minWidth: 72,
                    background: d.isCurrent ? "rgba(234,88,12,0.10)" : undefined,
                    color: d.isCurrent ? "#9a3412" : undefined,
                  }}
                >
                  {d.bucketLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gridSeries.map((s) => {
              const fmt = s.format ?? DEFAULT_NUMBER_FMT;
              return (
                <tr key={s.key}>
                  <td
                    style={{
                      position: "sticky",
                      left: 0,
                      // Always opaque — tinted rows pre-blend with #fff so the
                      // sticky column never lets scrolling content bleed
                      // through onto the metric label.
                      background: solidTint(s.rowTint),
                      padding: "5px 12px",
                      fontWeight: s.bold ? 600 : 400,
                      borderBottom: "1px solid #f1f5f9",
                      whiteSpace: "nowrap",
                      color: s.color,
                      zIndex: 3,
                      boxShadow: "2px 0 0 0 #fff",
                    }}
                  >
                    {s.label}
                  </td>
                  {visibleRows.map((d) => {
                    const v = d.values[s.key];
                    return (
                      <td
                        key={d.bucket}
                        style={{
                          padding: "5px 10px",
                          textAlign: "right",
                          borderBottom: "1px solid #f1f5f9",
                          fontWeight: s.bold ? 600 : 400,
                          fontVariantNumeric: "tabular-nums",
                          color: s.color,
                          background: d.isCurrent ? "rgba(234,88,12,0.06)" : s.rowTint,
                        }}
                      >
                        {fmt(v ?? null)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Editable adjustment row */}
            {adjustmentKey ? (
              <tr>
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    background: "#fef3c7",
                    padding: "4px 12px",
                    fontWeight: 600,
                    borderBottom: "2px solid #fbbf24",
                    whiteSpace: "nowrap",
                    color: "#92400e",
                    zIndex: 3,
                    boxShadow: "2px 0 0 0 #fff",
                  }}
                >
                  ✏️ Adjustment
                </td>
                {visibleRows.map((d) => {
                  const locked = locks.has(d.bucket);
                  const past = isPastBucket(d);
                  const readOnly = locked || past;
                  const storedValue = d.values[adjustmentKey] ?? 0;
                  const display =
                    inputStr.get(d.bucket) ??
                    (Number(storedValue) === 0 ? "" : String(storedValue));
                  const cellBg = past
                    ? "#eef2f7"
                    : locked
                    ? "#f1f5f9"
                    : d.isCurrent
                    ? "rgba(234,88,12,0.08)"
                    : "#fffbeb";
                  return (
                    <td
                      key={d.bucket}
                      style={{
                        padding: "2px 4px",
                        textAlign: "right",
                        borderBottom: "2px solid #fbbf24",
                        background: cellBg,
                      }}
                    >
                      <MuiTooltip title={past ? "Past period — read only" : ""} arrow disableHoverListener={!past}>
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={readOnly}
                          value={past ? "" : display}
                          placeholder={past ? "—" : "0"}
                          onChange={(e) => handleInputChange(d.bucket, e.target.value)}
                          onBlur={() => handleCommit(d.bucket)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          style={{
                            width: 62,
                            textAlign: "right",
                            fontSize: 11,
                            border: readOnly ? "1px solid #e2e8f0" : "1px solid #fbbf24",
                            borderRadius: 3,
                            padding: "3px 5px",
                            background: readOnly ? "#f1f5f9" : "#fff",
                            color: readOnly ? "#94a3b8" : "#1e293b",
                            fontVariantNumeric: "tabular-nums",
                            outline: "none",
                            cursor: past ? "not-allowed" : "text",
                          }}
                        />
                      </MuiTooltip>
                    </td>
                  );
                })}
              </tr>
            ) : null}

            {/* Adjusted forecast row with locks */}
            {adjustedKey ? (
              <tr>
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    // Opaque pre-blend of rgba(220,38,38,0.06) over white.
                    background: "#fbeeee",
                    padding: "5px 12px",
                    fontWeight: 700,
                    borderBottom: "2px solid #dc2626",
                    whiteSpace: "nowrap",
                    color: "#dc2626",
                    zIndex: 3,
                    boxShadow: "2px 0 0 0 #fff",
                  }}
                >
                  Adjusted Forecast
                </td>
                {visibleRows.map((d) => {
                  const locked = locks.has(d.bucket);
                  const past = isPastBucket(d);
                  const v = d.values[adjustedKey];
                  // Past buckets render as locked (read-only) but the lock
                  // toggle is hidden — these cells are *historically* fixed,
                  // not user-locked.
                  const cellBg = past
                    ? "rgba(148,163,184,0.12)"
                    : locked
                    ? "rgba(220,38,38,0.10)"
                    : d.isCurrent
                    ? "rgba(234,88,12,0.06)"
                    : "rgba(220,38,38,0.03)";
                  const cellColor = past ? "#64748b" : "#dc2626";
                  return (
                    <td
                      key={d.bucket}
                      style={{
                        padding: "3px 4px",
                        textAlign: "right",
                        borderBottom: "2px solid #dc2626",
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                        color: cellColor,
                        background: cellBg,
                      }}
                    >
                      <Stack direction="row" spacing={0} alignItems="center" justifyContent="flex-end">
                        <span>{v == null ? "—" : Math.round(v).toLocaleString()}</span>
                        {past ? (
                          <MuiTooltip title="Past period — read only" arrow>
                            <span style={{ display: "inline-flex", alignItems: "center" }}>
                              <LockOutlinedIcon sx={{ fontSize: 13, ml: 0.25, color: "#94a3b8" }} />
                            </span>
                          </MuiTooltip>
                        ) : (
                          <MuiTooltip title={locked ? "Unlock" : "Lock"} arrow>
                            <IconButton
                              size="small"
                              onClick={() => onToggleLock(d.bucket)}
                              sx={{ p: 0.2, ml: 0.25, color: locked ? "#dc2626" : "#94a3b8" }}
                            >
                              {locked ? (
                                <LockOutlinedIcon sx={{ fontSize: 13 }} />
                              ) : (
                                <LockOpenOutlinedIcon sx={{ fontSize: 13 }} />
                              )}
                            </IconButton>
                          </MuiTooltip>
                        )}
                      </Stack>
                    </td>
                  );
                })}
              </tr>
            ) : null}

            {/* Variance rows */}
            {varianceRows.map((vr) => (
              <tr key={vr.key}>
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    background: "#fff",
                    padding: "5px 12px",
                    fontWeight: 400,
                    borderBottom: "1px solid #f1f5f9",
                    whiteSpace: "nowrap",
                    fontSize: 10.5,
                    zIndex: 3,
                    boxShadow: "2px 0 0 0 #fff",
                  }}
                >
                  {vr.label}
                </td>
                {visibleRows.map((d) => {
                  const v = d.values[vr.key];
                  const num = typeof v === "number" ? v : null;
                  const color = vr.colorize && num != null
                    ? num < 0
                      ? "#dc2626"
                      : num > 0
                      ? "#16a34a"
                      : undefined
                    : undefined;
                  return (
                    <td
                      key={d.bucket}
                      style={{
                        padding: "5px 10px",
                        textAlign: "right",
                        borderBottom: "1px solid #f1f5f9",
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 10.5,
                        color,
                        background: d.isCurrent ? "rgba(234,88,12,0.06)" : undefined,
                      }}
                    >
                      {vr.format(num)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Box>
  );
}

// Tiny input-state manager for editable adjustment cells. Returns a snapshot
// Map and a setter; typing invalidates entries whose bucket no longer exists.
function useInputMap(
  bucketKeys: string[],
): [Map<string, string>, (b: string, v: string) => void] {
  const [state, setState] = useState<Record<string, string>>({});
  const bucketKeysSig = bucketKeys.join("|");
  // Prune stale keys when the bucket set changes (e.g. week→month toggle)
  useEffect(() => {
    setState((prev) => {
      const known = new Set(bucketKeysSig.split("|"));
      let changed = false;
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (known.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [bucketKeysSig]);
  const map = useMemo(() => new Map(Object.entries(state)), [state]);
  const set = useCallback((b: string, v: string) => {
    setState((prev) => {
      if (v === "") {
        if (!(b in prev)) return prev;
        const { [b]: _removed, ...rest } = prev;
        return rest;
      }
      if (prev[b] === v) return prev;
      return { ...prev, [b]: v };
    });
  }, []);
  return [map, set];
}
