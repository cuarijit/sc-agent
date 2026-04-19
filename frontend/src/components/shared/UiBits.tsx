import type { PropsWithChildren } from "react";
import { Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { Link } from "react-router-dom";

import LineChart from "../../charts/LineChart";
import type { EffectiveParameterValue, OptionDetail, ParameterException, ProjectionPoint, RecommendationSummary } from "../../types";

export function SectionCard({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle?: string; helpId?: string }>) {
  return (
    <Paper
      elevation={0}
      className="content-card section-card"
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "6px",
        overflow: "hidden",
        bgcolor: "background.paper",
      }}
    >
      <Stack spacing={0} className="section-card-stack">
        <Box
          className="section-card-head"
          sx={{
            px: 1.75,
            py: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
            background: "linear-gradient(180deg, rgba(248,252,255,0.9) 0%, rgba(255,255,255,0.6) 100%)",
            "html[data-theme='dark'] &": {
              background: "linear-gradient(180deg, rgba(11,74,111,0.18) 0%, transparent 100%)",
            },
          }}
        >
          <Typography
            className="section-card-title"
            sx={{
              fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif',
              fontWeight: 700,
              fontSize: "12px",
              color: "text.primary",
              lineHeight: 1.4,
            }}
          >
            {title}
          </Typography>
          {subtitle ? (
            <Typography
              className="section-card-subtitle"
              sx={{ fontSize: "10px", color: "text.secondary", fontFamily: '"IBM Plex Sans", sans-serif', mt: 0.25 }}
            >
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        <Box className="section-card-body" sx={{ p: 1.75 }}>
          {children}
        </Box>
      </Stack>
    </Paper>
  );
}

export function RecommendationTable({ rows }: { rows: RecommendationSummary[] }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>SKU</TableCell>
          <TableCell>Location</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Action</TableCell>
          <TableCell>Shortage</TableCell>
          <TableCell>ETA</TableCell>
          <TableCell>Confidence</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.sku}-${row.location}`}>
            <TableCell><Link to={`/sku/${row.sku}/location/${row.location}`}>{row.sku}</Link></TableCell>
            <TableCell>{row.location}</TableCell>
            <TableCell><Chip size="small" label={row.status} color={row.status === "at_risk" ? "warning" : row.status === "excess" ? "info" : "error"} /></TableCell>
            <TableCell>{row.action}</TableCell>
            <TableCell>{row.shortage_qty || row.excess_qty}</TableCell>
            <TableCell>{row.eta}</TableCell>
            <TableCell>{Math.round(row.confidence_score * 100)}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function InventoryProjectionChart({ data }: { data: ProjectionPoint[] }) {
  return (
    <div className="chart-shell" style={{ height: 280 }}>
      <LineChart
        chartId="inventory-projection"
        data={data as unknown as Record<string, unknown>[]}
        xKey="week_start"
        series={[
          { field: "ending_qty", label: "Ending Qty", color: "#3C95D1", strokeWidth: 3 },
          { field: "safety_stock_qty", label: "Safety Stock", color: "#d97706", strokeDasharray: "dashed" },
        ]}
      />
    </div>
  );
}

export function ScenarioDeltaChart({ data }: { data: RecommendationSummary[] }) {
  return (
    <div className="chart-shell" style={{ height: 280 }}>
      <LineChart
        chartId="scenario-delta"
        data={data as unknown as Record<string, unknown>[]}
        xKey="sku"
        renderAsArea
        series={[
          { field: "shortage_qty", label: "Scenario Shortage", color: "#dc2626" },
        ]}
      />
    </div>
  );
}

export function OptionTable({ options }: { options: OptionDetail[] }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Option</TableCell>
          <TableCell>Supplier / Source</TableCell>
          <TableCell>Qty</TableCell>
          <TableCell>ETA</TableCell>
          <TableCell>Cost</TableCell>
          <TableCell>Risk</TableCell>
          <TableCell>Feasible</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {options.map((option, index) => (
          <TableRow key={`${option.option_type}-${index}`}>
            <TableCell>{option.option_type}</TableCell>
            <TableCell>{option.supplier ?? option.from_location ?? "Network"}</TableCell>
            <TableCell>{option.recommended_qty}</TableCell>
            <TableCell>{option.earliest_arrival_date}</TableCell>
            <TableCell>${option.incremental_cost.toFixed(0)}</TableCell>
            <TableCell>{option.risk_score}</TableCell>
            <TableCell>{option.feasible_flag ? "Yes" : "No"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ParameterExceptionTable({
  rows,
  onApply,
}: {
  rows: ParameterException[];
  onApply?: (id: string) => void;
}) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>SKU</TableCell>
          <TableCell>Location</TableCell>
          <TableCell>Parameter</TableCell>
          <TableCell>Issue</TableCell>
          <TableCell>Current</TableCell>
          <TableCell>Recommended</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Action</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.recommendation_id}>
            <TableCell><Link to={`/parameters/${row.sku}/${row.location}`}>{row.sku}</Link></TableCell>
            <TableCell>{row.location}</TableCell>
            <TableCell>{row.parameter_code}</TableCell>
            <TableCell>{row.issue_type}</TableCell>
            <TableCell>{row.current_effective_value}</TableCell>
            <TableCell>{row.recommended_value}</TableCell>
            <TableCell>{row.status}</TableCell>
            <TableCell>
              {onApply && row.status !== "applied" ? (
                <button className="inline-action" onClick={() => onApply(row.recommendation_id)}>Apply</button>
              ) : "Applied"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function EffectiveValueTable({ rows }: { rows: EffectiveParameterValue[] }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Parameter</TableCell>
          <TableCell>Effective</TableCell>
          <TableCell>Explicit</TableCell>
          <TableCell>Source</TableCell>
          <TableCell>Inherited From</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.parameter_code}>
            <TableCell>{row.parameter_name}</TableCell>
            <TableCell>{row.effective_value}</TableCell>
            <TableCell>{row.explicit_value ?? "Inherited"}</TableCell>
            <TableCell>{row.source_type}</TableCell>
            <TableCell>{row.inherited_from}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
