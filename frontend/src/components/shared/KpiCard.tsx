import type { ReactNode } from "react";
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { Line, LineChart, ResponsiveContainer } from "recharts";

const TONE_COLORS: Record<string, { bg: string; border: string; iconBg: string; iconFg: string; accent: string }> = {
  critical: { bg: "#fff", border: "rgba(220,38,38,0.14)", iconBg: "rgba(220,38,38,0.08)", iconFg: "#dc2626", accent: "#dc2626" },
  warning:  { bg: "#fff", border: "rgba(217,119,6,0.14)",  iconBg: "rgba(217,119,6,0.08)",  iconFg: "#b45309", accent: "#d97706" },
  network:  { bg: "#fff", border: "rgba(5,150,105,0.14)",  iconBg: "rgba(5,150,105,0.08)",  iconFg: "#047857", accent: "#059669" },
  money:    { bg: "#fff", border: "rgba(13,148,136,0.14)", iconBg: "rgba(13,148,136,0.08)", iconFg: "#0f766e", accent: "#0d9488" },
  demand:   { bg: "#fff", border: "rgba(79,70,229,0.14)",  iconBg: "rgba(79,70,229,0.08)",  iconFg: "#4338ca", accent: "#4f46e5" },
  info:     { bg: "#fff", border: "rgba(37,99,235,0.14)",  iconBg: "rgba(37,99,235,0.08)",  iconFg: "#1d4ed8", accent: "#2563eb" },
  risk:     { bg: "#fff", border: "rgba(219,39,119,0.14)", iconBg: "rgba(219,39,119,0.08)", iconFg: "#be185d", accent: "#db2777" },
  neutral:  { bg: "#fff", border: "rgba(100,116,139,0.14)",iconBg: "rgba(100,116,139,0.07)",iconFg: "#475569", accent: "#64748b" },
};

function getTone(tone?: string) {
  return TONE_COLORS[tone ?? "neutral"] ?? TONE_COLORS.neutral;
}

// ---------------------------------------------------------------------------
// KpiItem — single label/value row
// ---------------------------------------------------------------------------

export interface KpiItem {
  label: string;
  value: string | number;
  color?: string;
  bold?: boolean;
  onClick?: () => void;
  active?: boolean;
}

function KpiItemRow({ item }: { item: KpiItem }) {
  const clickable = !!item.onClick;
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="baseline"
      spacing={0.5}
      onClick={item.onClick}
      sx={{
        minHeight: 20,
        px: 0.5,
        mx: -0.5,
        borderRadius: 0.75,
        cursor: clickable ? "pointer" : undefined,
        transition: clickable ? "background 0.15s" : undefined,
        bgcolor: item.active ? "rgba(37,99,235,0.10)" : "transparent",
        border: "1px solid",
        borderColor: item.active ? "rgba(37,99,235,0.35)" : "transparent",
        "&:hover": clickable ? { bgcolor: "rgba(37,99,235,0.06)", borderColor: "rgba(37,99,235,0.25)" } : undefined,
      }}
    >
      <Typography
        variant="body2"
        sx={{ fontSize: 12, color: "text.secondary", fontWeight: 400, lineHeight: 1.4 }}
      >
        {item.label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontSize: 12,
          fontWeight: item.bold || item.active ? 600 : 500,
          whiteSpace: "nowrap",
          color: item.color ?? "text.primary",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {item.value}
      </Typography>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// KpiCard
// ---------------------------------------------------------------------------

export interface KpiCardProps {
  title: string;
  icon?: ReactNode;
  tone?: string;
  value?: string;
  sub?: string;
  items?: KpiItem[];
  sparkData?: number[];
  iconBg?: string;
}

export default function KpiCard({ title, icon, tone, value, sub, items, sparkData, iconBg }: KpiCardProps) {
  const t = getTone(tone);
  const effectiveIconBg = iconBg ?? t.iconBg;
  const isSingleValue = !!value && !items?.length;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: "10px 14px",
        borderRadius: 2.5,
        background: t.bg,
        borderColor: t.border,
        borderLeftWidth: 3,
        borderLeftColor: t.accent,
        transition: "box-shadow 0.2s",
        "&:hover": { boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },
        position: "relative",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {/* Header */}
      <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mb: isSingleValue ? 0.3 : 0.6 }}>
        <Box
          sx={{
            width: 22,
            height: 22,
            borderRadius: 1,
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
          variant="body2"
          sx={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "text.secondary",
            lineHeight: 1.3,
          }}
        >
          {title}
        </Typography>
      </Stack>

      {/* Single value */}
      {isSingleValue && (
        <>
          <Typography
            sx={{
              fontFamily: "'Inter','Roboto',sans-serif",
              fontSize: 20,
              fontWeight: 700,
              lineHeight: 1.25,
              letterSpacing: -0.3,
              color: "text.primary",
            }}
          >
            {value}
          </Typography>
          {sub && (
            <Typography variant="caption" sx={{ fontSize: 10.5, color: "text.disabled", lineHeight: 1.3, display: "block", mt: 0.2 }}>
              {sub}
            </Typography>
          )}
        </>
      )}

      {/* Multi-row */}
      {items && items.length > 0 && (
        <Stack spacing={0.25}>
          {items.map((item, idx) => (
            <KpiItemRow key={idx} item={item} />
          ))}
        </Stack>
      )}

      {/* Sparkline */}
      {sparkData && sparkData.length >= 2 && (
        <Box sx={{ position: "absolute", bottom: 0, right: 0, width: "50%", height: 24, opacity: 0.12, pointerEvents: "none" }}>
          <ResponsiveContainer width="100%" height={24}>
            <LineChart data={sparkData.map((v, i) => ({ i, v }))}>
              <Line type="monotone" dataKey="v" stroke={t.accent} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// KpiCardRow — grid wrapper
// ---------------------------------------------------------------------------

export function KpiCardRow({ children, columns }: { children: ReactNode; columns?: number }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: columns
          ? `repeat(${columns}, minmax(0, 1fr))`
          : "repeat(auto-fill, minmax(190px, 1fr))",
        gap: 1,
        alignItems: "stretch",
      }}
    >
      {children}
    </Box>
  );
}
