import type { ReactNode } from "react";
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined";
import { Box, Paper, Stack, Tooltip, Typography } from "@mui/material";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

const TONE_COLORS: Record<
  string,
  { border: string; iconBg: string; iconFg: string; accent: string; chartFill: string }
> = {
  critical: { border: "rgba(220,38,38,0.18)", iconBg: "rgba(220,38,38,0.10)", iconFg: "#dc2626", accent: "#dc2626", chartFill: "#fca5a5" },
  warning:  { border: "rgba(217,119,6,0.18)",  iconBg: "rgba(217,119,6,0.10)",  iconFg: "#b45309", accent: "#d97706", chartFill: "#fcd34d" },
  network:  { border: "rgba(5,150,105,0.18)",  iconBg: "rgba(5,150,105,0.10)",  iconFg: "#047857", accent: "#059669", chartFill: "#6ee7b7" },
  money:    { border: "rgba(13,148,136,0.18)", iconBg: "rgba(13,148,136,0.10)", iconFg: "#0f766e", accent: "#0d9488", chartFill: "#5eead4" },
  demand:   { border: "rgba(79,70,229,0.18)",  iconBg: "rgba(79,70,229,0.10)",  iconFg: "#4338ca", accent: "#4f46e5", chartFill: "#a5b4fc" },
  info:     { border: "rgba(37,99,235,0.18)",  iconBg: "rgba(37,99,235,0.10)",  iconFg: "#1d4ed8", accent: "#2563eb", chartFill: "#93c5fd" },
  risk:     { border: "rgba(219,39,119,0.18)", iconBg: "rgba(219,39,119,0.10)", iconFg: "#be185d", accent: "#db2777", chartFill: "#f9a8d4" },
  neutral:  { border: "rgba(100,116,139,0.16)",iconBg: "rgba(100,116,139,0.08)",iconFg: "#475569", accent: "#64748b", chartFill: "#cbd5e1" },
};

function getTone(tone?: string) {
  return TONE_COLORS[tone ?? "neutral"] ?? TONE_COLORS.neutral;
}

export interface KpiItem {
  label: string;
  value: string | number;
  color?: string;
  bold?: boolean;
  onClick?: () => void;
  active?: boolean;
}

export interface KpiChartSpec {
  // donut → pie chart (severity split etc)
  // bar   → vertical bars (network/lane counts)
  // line  → small trend line (financial)
  // gauge → 0..100% radial fill (accuracy/error %)
  kind: "donut" | "bar" | "line" | "gauge";
  data: { label: string; value: number; color?: string }[];
  // gauge only
  gaugeValue?: number;
  gaugeMax?: number;
  gaugeLabel?: string;
}

export interface KpiCardProps {
  title: string;
  icon?: ReactNode;
  tone?: string;
  // Hero number shown big top-right (e.g. "19" alerts, "$1.46M" cost).
  hero?: string;
  // Optional small caption under the hero (e.g. "total alerts").
  heroSub?: string;
  // Compact secondary pills shown along the bottom — replaces the
  // tall vertical key/value list of the previous design.
  items?: KpiItem[];
  // Embedded micro-chart on the right of the hero number.
  chart?: KpiChartSpec;
  // Legacy single-value mode (kept for back-compat).
  value?: string;
  sub?: string;
  sparkData?: number[];
  iconBg?: string;
}

// ---------------------------------------------------------------------------
// Inline micro-chart renderer
// ---------------------------------------------------------------------------

const CHART_STYLE = { width: 80, height: 44 };

function buildOption(chart: KpiChartSpec, accent: string, chartFill: string): EChartsOption {
  const baseGrid = { left: 2, right: 2, top: 4, bottom: 2, containLabel: false };

  if (chart.kind === "donut") {
    const total = chart.data.reduce((sum, d) => sum + d.value, 0);
    return {
      tooltip: {
        trigger: "item",
        formatter: (p: any) => `${p.name}: <b>${p.value}</b> (${p.percent}%)`,
        confine: true,
        textStyle: { fontSize: 10 },
      },
      series: [
        {
          type: "pie",
          radius: ["58%", "92%"],
          avoidLabelOverlap: false,
          padAngle: 1,
          itemStyle: { borderColor: "#fff", borderWidth: 1 },
          label: { show: false },
          labelLine: { show: false },
          data: chart.data.map((d) => ({
            name: d.label,
            value: d.value,
            itemStyle: { color: d.color ?? accent },
          })),
          // Center label rendered via graphic to keep it crisp.
          silent: false,
          animation: false,
        },
      ],
      graphic: {
        type: "text",
        left: "center",
        top: "center",
        style: {
          text: String(total),
          fontSize: 11,
          fontWeight: 700,
          fill: "#0A2248",
          fontFamily: "'Inter','IBM Plex Sans',sans-serif",
        },
      },
    };
  }

  if (chart.kind === "bar") {
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        confine: true,
        textStyle: { fontSize: 10 },
        formatter: (p: any) => {
          const item = Array.isArray(p) ? p[0] : p;
          return `${item.name}: <b>${item.value}</b>`;
        },
      },
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: chart.data.map((d) => d.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      yAxis: { type: "value", show: false },
      series: [
        {
          type: "bar",
          data: chart.data.map((d) => ({
            value: d.value,
            itemStyle: { color: d.color ?? chartFill, borderRadius: [2, 2, 0, 0] },
          })),
          barWidth: "60%",
          animation: false,
        },
      ],
    };
  }

  if (chart.kind === "line") {
    return {
      tooltip: {
        trigger: "axis",
        confine: true,
        textStyle: { fontSize: 10 },
        formatter: (p: any) => {
          const item = Array.isArray(p) ? p[0] : p;
          return `${item.name}: <b>${Math.round(item.value).toLocaleString()}</b>`;
        },
      },
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: chart.data.map((d) => d.label),
        show: false,
      },
      yAxis: { type: "value", show: false },
      series: [
        {
          type: "line",
          data: chart.data.map((d) => d.value),
          smooth: true,
          symbol: "none",
          lineStyle: { color: accent, width: 1.8 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: `${accent}44` },
                { offset: 1, color: `${accent}00` },
              ],
            },
          },
          animation: false,
        },
      ],
    };
  }

  if (chart.kind === "gauge") {
    const max = chart.gaugeMax ?? 100;
    const v = Math.min(Math.max(chart.gaugeValue ?? 0, 0), max);
    return {
      series: [
        {
          type: "gauge",
          startAngle: 90,
          endAngle: -270,
          min: 0,
          max,
          radius: "92%",
          progress: {
            show: true,
            width: 6,
            roundCap: true,
            itemStyle: { color: accent },
          },
          axisLine: {
            lineStyle: { width: 6, color: [[1, "rgba(0,0,0,0.07)"]] },
          },
          pointer: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          anchor: { show: false },
          title: { show: false },
          detail: {
            valueAnimation: false,
            offsetCenter: [0, 0],
            fontSize: 10,
            fontWeight: 700,
            color: "#0A2248",
            fontFamily: "'Inter','IBM Plex Sans',sans-serif",
            formatter: () => chart.gaugeLabel ?? `${Math.round((v / max) * 100)}%`,
          },
          data: [{ value: v }],
          animation: false,
        },
      ],
    };
  }

  return {};
}

function MicroChart({ chart, accent, chartFill }: { chart: KpiChartSpec; accent: string; chartFill: string }) {
  const option = buildOption(chart, accent, chartFill);
  return (
    <Box sx={{ ...CHART_STYLE, flexShrink: 0 }}>
      <ReactECharts
        option={option}
        style={{ width: "100%", height: "100%" }}
        opts={{ renderer: "svg" }}
        notMerge
        lazyUpdate
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// KpiCard
// ---------------------------------------------------------------------------

export default function KpiCard({
  title,
  icon,
  tone,
  hero,
  heroSub,
  value,
  sub,
  items,
  chart,
  sparkData,
  iconBg,
}: KpiCardProps) {
  const t = getTone(tone);
  const effectiveIconBg = iconBg ?? t.iconBg;
  // Back-compat: callers that used the old `value` prop continue to work.
  const heroNumber = hero ?? value;
  const heroCaption = heroSub ?? sub;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: "8px 12px 9px",
        borderRadius: 1.25,
        background: "linear-gradient(180deg, #ffffff 0%, rgba(248,252,255,0.7) 100%)",
        borderColor: t.border,
        borderLeftWidth: 3,
        borderLeftColor: t.accent,
        transition: "box-shadow 0.18s, transform 0.18s",
        "&:hover": { boxShadow: "0 3px 10px rgba(10,34,72,0.06)" },
        position: "relative",
        overflow: "hidden",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 0.6,
        "html[data-theme='dark'] &": {
          background: "linear-gradient(180deg, rgba(24,28,36,0.95) 0%, rgba(30,40,54,0.6) 100%)",
        },
      }}
    >
      {/* Header row: icon + title */}
      <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
        <Box
          sx={{
            width: 20,
            height: 20,
            borderRadius: 0.75,
            bgcolor: effectiveIconBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            "& .MuiSvgIcon-root": { fontSize: 13, color: t.iconFg },
          }}
        >
          {icon ?? <BarChartOutlinedIcon />}
        </Box>
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 600,
            color: "text.secondary",
            lineHeight: 1.2,
            textTransform: "uppercase",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
            minWidth: 0,
          }}
        >
          {title}
        </Typography>
      </Stack>

      {/* Hero row: big number left, micro-chart right */}
      {(heroNumber || chart) ? (
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ minWidth: 0 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            {heroNumber ? (
              <Typography
                sx={{
                  fontFamily: "'Inter','IBM Plex Sans',sans-serif",
                  fontSize: 22,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  letterSpacing: "-0.02em",
                  color: t.accent,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {heroNumber}
              </Typography>
            ) : null}
            {heroCaption ? (
              <Typography sx={{ fontSize: 10, color: "text.disabled", lineHeight: 1.25, mt: 0.1 }}>
                {heroCaption}
              </Typography>
            ) : null}
          </Box>
          {chart ? <MicroChart chart={chart} accent={t.accent} chartFill={t.chartFill} /> : null}
        </Stack>
      ) : null}

      {/* Compact pills row — replaces tall vertical key/value list */}
      {items && items.length > 0 ? (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: items.length > 3 ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(0, 1fr))",
            gap: "4px 8px",
            mt: heroNumber || chart ? 0.4 : 0,
          }}
        >
          {items.map((item, idx) => {
            const clickable = !!item.onClick;
            return (
              <Tooltip key={idx} title={item.label} disableHoverListener={!clickable} arrow>
                <Stack
                  direction="row"
                  alignItems="baseline"
                  justifyContent="space-between"
                  spacing={0.5}
                  onClick={item.onClick}
                  sx={{
                    px: 0.6,
                    py: 0.2,
                    borderRadius: 0.75,
                    minWidth: 0,
                    cursor: clickable ? "pointer" : undefined,
                    bgcolor: item.active ? `${t.accent}1f` : "transparent",
                    border: "1px solid",
                    borderColor: item.active ? `${t.accent}66` : "transparent",
                    transition: "background 0.15s, border-color 0.15s",
                    "&:hover": clickable
                      ? { bgcolor: `${t.accent}14`, borderColor: `${t.accent}40` }
                      : undefined,
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: 10.5,
                      color: "text.secondary",
                      fontWeight: 500,
                      lineHeight: 1.3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0,
                    }}
                  >
                    {item.label}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 11.5,
                      fontWeight: item.bold || item.active ? 700 : 600,
                      color: item.color ?? "text.primary",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {item.value}
                  </Typography>
                </Stack>
              </Tooltip>
            );
          })}
        </Box>
      ) : null}

      {/* Legacy sparkline support — convert to inline echarts line if caller still uses it */}
      {sparkData && sparkData.length >= 2 && !chart && (
        <Box sx={{ position: "absolute", bottom: 0, right: 0, width: "55%", height: 22, opacity: 0.18, pointerEvents: "none" }}>
          <ReactECharts
            option={{
              grid: { left: 0, right: 0, top: 0, bottom: 0 },
              xAxis: { type: "category", show: false, data: sparkData.map((_, i) => i) },
              yAxis: { type: "value", show: false },
              series: [{
                type: "line",
                data: sparkData,
                smooth: true,
                symbol: "none",
                lineStyle: { color: t.accent, width: 1.4 },
                animation: false,
              }],
            } satisfies EChartsOption}
            style={{ width: "100%", height: "100%" }}
            opts={{ renderer: "svg" }}
          />
        </Box>
      )}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// KpiCardRow — denser grid (180px min vs 190px before, smaller gap)
// ---------------------------------------------------------------------------

export function KpiCardRow({ children, columns }: { children: ReactNode; columns?: number }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: columns
          ? `repeat(${columns}, minmax(0, 1fr))`
          : "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 1,
        alignItems: "stretch",
      }}
    >
      {children}
    </Box>
  );
}
