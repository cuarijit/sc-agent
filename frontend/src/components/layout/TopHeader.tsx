import AppsOutlinedIcon from "@mui/icons-material/AppsOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import RestartAltOutlinedIcon from "@mui/icons-material/RestartAltOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { Avatar, Button, IconButton, Paper, Stack, Typography } from "@mui/material";
import { useLocation } from "react-router-dom";
import { NAV_MODULES } from "../../app/navigation";

export default function TopHeader({
  themeMode,
  collapsed,
  onToggleThemeMode,
  onOpenSettings,
  onOpenInformation,
  onResetDemo,
  resetInProgress,
}: {
  themeMode: "light" | "dark";
  collapsed: boolean;
  onToggleThemeMode: () => void;
  onOpenSettings: () => void;
  onOpenInformation: () => void;
  onResetDemo: () => void;
  resetInProgress: boolean;
}) {
  const location = useLocation();
  const pageTitle = location.pathname.startsWith("/recommendations")
    ? "Sourcing Recommendations"
    : location.pathname.startsWith("/replenishment")
      ? "Replenishment Control Tower"
      : location.pathname.startsWith("/scenarios")
        ? "Scenario Simulation"
        : location.pathname.startsWith("/network")
          ? "Supply Chain Network Digital Twin"
          : location.pathname.startsWith("/parameters")
            ? "Inventory Parameter Governance"
            : location.pathname.startsWith("/documents")
              ? "Vendor Document Search"
              : location.pathname.startsWith("/agentic-ai/global-filter-compliance")
                ? "Global Filter Compliance"
              : location.pathname.startsWith("/maintenance")
                ? "Master Data Maintenance"
                : location.pathname.startsWith("/chat")
                  ? "Planner Chat"
                  : "MEIO Dashboard";
  const isActive = (route: string) =>
    route === "/" ? location.pathname === "/" : location.pathname === route || location.pathname.startsWith(`${route}/`);
  const selectedNavLabel =
    NAV_MODULES.flatMap((module) => module.items).find((item) => isActive(item.route))?.label ?? pageTitle;

  return (
    <Paper elevation={0} className="app-header-stack">
      <Stack direction="row" alignItems="center" justifyContent="space-between" className="app-brand-strip">
        <Stack direction="row" alignItems="center" spacing={1.2}>
          <AppsOutlinedIcon sx={{ fontSize: 16 }} />
          <Typography variant="body2" sx={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.04em", lineHeight: 1 }}>
            ZEBRA
          </Typography>
          <Typography variant="caption" className="brand-divider">|</Typography>
          <Typography variant="body2" sx={{ fontSize: 16, fontWeight: 500, lineHeight: 1 }}>
            antuit.ai
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0.8}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<RestartAltOutlinedIcon fontSize="small" />}
            onClick={onResetDemo}
            disabled={resetInProgress}
            sx={{
              borderColor: "rgba(255,255,255,0.35)",
              color: "rgba(255,255,255,0.92)",
              "&:hover": { borderColor: "rgba(255,255,255,0.62)" },
            }}
          >
            {resetInProgress ? "Resetting..." : "Reset Demo"}
          </Button>
          <IconButton size="small" onClick={onOpenInformation} aria-label="Information" sx={{ color: "rgba(255,255,255,0.86)" }}>
            <InfoOutlinedIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onOpenSettings} aria-label="Settings" sx={{ color: "rgba(255,255,255,0.86)" }}>
            <SettingsOutlinedIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onToggleThemeMode} aria-label="Toggle day or dark mode" sx={{ color: "rgba(255,255,255,0.86)" }}>
            {themeMode === "light" ? <DarkModeOutlinedIcon fontSize="small" /> : <LightModeOutlinedIcon fontSize="small" />}
          </IconButton>
          <Typography variant="caption" sx={{ color: "rgba(255, 255, 255, 0.86)" }}>
            My Account
          </Typography>
          <Avatar sx={{ width: 24, height: 24, fontSize: 11, bgcolor: "success.main", color: "success.contrastText", fontWeight: 700 }}>
            AC
          </Avatar>
        </Stack>
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        className={`app-top-nav-strip ${collapsed ? "app-top-nav-strip-collapsed" : "app-top-nav-strip-expanded"}`}
      >
        <Stack direction="row" alignItems="center" spacing={1} className="top-nav-main" sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" className="workspace-label">
            {selectedNavLabel}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography variant="caption" color="text.secondary" noWrap className="page-level-meta">
            {pageTitle}
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}
