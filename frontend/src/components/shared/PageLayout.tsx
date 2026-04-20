/**
 * PageLayout — pixel-match wrappers for puls8-primo page layout.
 *
 * Uses the .pg-* CSS classes (defined in styles.css) so every page across
 * Smart Execution, Intelligent Planning, Agentic AI, Administration shares
 * identical chrome: compact 7px header, brand gradient top border, blue→
 * lavender background, breadcrumb above title, filter+agent buttons inline
 * to the right of the title.
 */
import type { PropsWithChildren, ReactNode } from "react";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { useNavigate, useOutletContext } from "react-router-dom";

import HeaderActionsInline from "../layout/HeaderActionsInline";
import type { ShellContextValue } from "../layout/AppShellLayout";

interface BreadcrumbCrumb {
  label: string;
  to?: string;
}

interface PageShellProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbCrumb[];
  helpId?: string;
  onOpenHelp?: () => void;
  rightActions?: ReactNode;
  bodyClassName?: string;
  scrollClassName?: string;
}

export function PageShell({
  title,
  subtitle,
  breadcrumbs,
  helpId,
  onOpenHelp,
  rightActions,
  bodyClassName,
  scrollClassName,
  children,
}: PropsWithChildren<PageShellProps>) {
  const navigate = useNavigate();
  const crumbs = breadcrumbs ?? [];
  const shellCtx = (useOutletContext() ?? null) as ShellContextValue | null;

  return (
    <div className={scrollClassName ? `pg-scroll ${scrollClassName}` : "pg-scroll"}>
      <Paper elevation={0} className="pg-container">
        <div className="pg-header">
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              {crumbs.length > 0 ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={0.3}
                  className="pg-breadcrumb"
                  sx={{ flexWrap: "wrap" }}
                >
                  {crumbs.map((crumb, idx) => (
                    <Stack key={`${crumb.label}-${idx}`} direction="row" alignItems="center" spacing={0.3}>
                      {idx > 0 ? <ChevronRightIcon className="pg-breadcrumb-sep" /> : null}
                      {crumb.to ? (
                        <Typography
                          component="span"
                          className="pg-breadcrumb-link"
                          onClick={() => navigate(crumb.to!)}
                        >
                          {crumb.label}
                        </Typography>
                      ) : (
                        <Typography component="span" className="pg-breadcrumb-current">
                          {crumb.label}
                        </Typography>
                      )}
                    </Stack>
                  ))}
                </Stack>
              ) : null}
              <Typography component="h1" variant="h6" className="pg-header-title" sx={{ m: 0 }}>
                {title}
              </Typography>
              {subtitle ? (
                <Typography variant="caption" className="pg-header-subtitle">
                  {subtitle}
                </Typography>
              ) : null}
            </Box>
            <Stack
              direction="row"
              spacing={0.5}
              alignItems="center"
              flexWrap="wrap"
              className="pg-header-actions"
              sx={{ flexShrink: 0 }}
            >
              {rightActions}
              {(helpId || onOpenHelp) ? (
                <Tooltip title="Page help" arrow>
                  <IconButton
                    size="small"
                    onClick={onOpenHelp}
                    aria-label="Page help"
                    className="pg-help-btn"
                  >
                    <HelpOutlineOutlinedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              ) : null}
              {shellCtx ? (
                <HeaderActionsInline
                  filters={shellCtx.filters}
                  setFilters={shellCtx.setFilters}
                  config={shellCtx.config}
                  openAiApiKey={shellCtx.openAiApiKey}
                />
              ) : null}
            </Stack>
          </Stack>
        </div>
        <div
          className={bodyClassName ? `pg-body ${bodyClassName}` : "pg-body"}
          data-page-shell-body
        >
          {children}
        </div>
      </Paper>
    </div>
  );
}

// ─── PageActions ──────────────────────────────────────────────────────────────
export function PageActions({ children }: { children: ReactNode }) {
  return (
    <Paper elevation={0} className="pg-actions">
      <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap">
        {children}
      </Stack>
    </Paper>
  );
}

// ─── TabPanel ─────────────────────────────────────────────────────────────────
export function TabPanel({
  value,
  current,
  children,
  keepMounted = false,
  title,
  subtitle,
  actions,
}: {
  value?: string | number;
  current?: string | number;
  children: ReactNode;
  keepMounted?: boolean;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  // Backwards-compat: if value/current are passed, behave as a switch.  If
  // omitted (puls8 style), render the panel unconditionally.
  const showSwitch = value !== undefined && current !== undefined;
  const active = showSwitch ? value === current : true;
  if (showSwitch && !active && !keepMounted) return null;
  return (
    <Paper
      elevation={0}
      className="pg-tab-panel"
      role={showSwitch ? "tabpanel" : undefined}
      hidden={showSwitch && !active}
      sx={{ display: showSwitch && !active ? "none" : "flex" }}
    >
      {title ? (
        <div className="pg-tab-header">
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
            spacing={0.8}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" className="pg-tab-title">{title}</Typography>
              {subtitle ? (
                <Typography variant="caption" className="pg-tab-subtitle">{subtitle}</Typography>
              ) : null}
            </Box>
            {actions ? (
              <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap">
                {actions}
              </Stack>
            ) : null}
          </Stack>
        </div>
      ) : null}
      <div className="pg-tab-body">{children}</div>
    </Paper>
  );
}

// ─── ContentSection ───────────────────────────────────────────────────────────
export function ContentSection({
  title,
  subtitle,
  rightActions,
  children,
  noPad,
}: {
  title?: string;
  subtitle?: string;
  rightActions?: ReactNode;
  children: ReactNode;
  noPad?: boolean;
}) {
  return (
    <Paper elevation={0} className="pg-content-section">
      {(title || rightActions) ? (
        <div className="pg-content-section-head">
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
            spacing={0.6}
          >
            <Box sx={{ minWidth: 0 }}>
              {title ? (
                <Typography variant="subtitle2" className="pg-content-section-title">
                  {title}
                </Typography>
              ) : null}
              {subtitle ? (
                <Typography variant="caption" className="pg-content-section-subtitle">
                  {subtitle}
                </Typography>
              ) : null}
            </Box>
            {rightActions ? (
              <Stack direction="row" spacing={0.6} alignItems="center" flexWrap="wrap">
                {rightActions}
              </Stack>
            ) : null}
          </Stack>
        </div>
      ) : null}
      <div className={noPad ? "pg-content-section-body-flush" : "pg-content-section-body"}>
        {children}
      </div>
    </Paper>
  );
}
