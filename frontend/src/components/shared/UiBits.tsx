import type { PropsWithChildren } from "react";
import { Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { EffectiveParameterValue, OptionDetail, ParameterException, ProjectionPoint, RecommendationSummary } from "../../types";

export function SectionCard({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle?: string }>) {
  return (
    <Paper elevation={0} className="content-card section-card">
      <Stack spacing={1} className="section-card-stack">
        <div className="section-card-head">
          <Typography variant="h6" className="section-card-title">{title}</Typography>
          {subtitle ? <Typography variant="caption" color="text.secondary" className="section-card-subtitle">{subtitle}</Typography> : null}
        </div>
        <div className="section-card-body">
          {children}
        </div>
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
    <div className="chart-shell">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="week_start" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="ending_qty" stroke="#2563eb" strokeWidth={3} name="Ending Qty" />
          <Line type="monotone" dataKey="safety_stock_qty" stroke="#f97316" strokeDasharray="5 5" name="Safety Stock" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScenarioDeltaChart({ data }: { data: RecommendationSummary[] }) {
  return (
    <div className="chart-shell">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="sku" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Area type="monotone" dataKey="shortage_qty" stroke="#dc2626" fill="rgba(220,38,38,0.24)" name="Scenario Shortage" />
        </AreaChart>
      </ResponsiveContainer>
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
