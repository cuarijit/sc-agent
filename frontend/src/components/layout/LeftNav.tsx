import AppsOutlinedIcon from "@mui/icons-material/AppsOutlined";
import KeyboardDoubleArrowLeftOutlinedIcon from "@mui/icons-material/KeyboardDoubleArrowLeftOutlined";
import KeyboardDoubleArrowRightOutlinedIcon from "@mui/icons-material/KeyboardDoubleArrowRightOutlined";
import { Box, ButtonBase, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { type NavItem, type NavModule } from "../../app/navigation";
import { useAuth } from "../../features/auth/AuthContext";
import { useDynamicNavigation } from "../../app/navigation/useDynamicNavigation";

function isActive(pathname: string, route: string) {
  if (route === "/") {
    return pathname === route;
  }
  return pathname === route || pathname.startsWith(`${route}/`);
}

function NavButton({
  item,
  collapsed,
  tooltipTitle,
}: {
  item: NavItem;
  collapsed: boolean;
  tooltipTitle?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = isActive(location.pathname, item.route);
  const hardNavigate = (route: string) => {
    if (typeof window === "undefined") return;
    if (window.location.protocol === "file:") {
      window.location.hash = `#${route}`;
    }
  };
  return (
    <Tooltip title={tooltipTitle ?? item.label} placement="right" disableHoverListener={!collapsed}>
      <ButtonBase
        className={`side-nav-btn ${active ? "side-nav-btn-active" : ""}`}
        onClick={() => {
          if (item.route === "/replenishment") {
            if (typeof window !== "undefined" && window.location.protocol === "file:") {
              hardNavigate(item.route);
            } else {
              navigate(item.route);
            }
            return;
          }
          navigate(item.route);
        }}
        sx={{ justifyContent: collapsed ? "center" : "flex-start", px: 1, py: 0.6, gap: 0.8, borderRadius: "6px" }}
      >
        <item.icon fontSize="small" />
        {!collapsed ? <Typography variant="caption" sx={{ fontSize: "0.74rem" }}>{item.label}</Typography> : null}
      </ButtonBase>
    </Tooltip>
  );
}

export default function LeftNav({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasEntitlement, state: authState } = useAuth();
  // Live nav from /api/nav/modules — admin edits in Module Configurator
  // flow through to the sidebar. Falls back to static NAV_MODULES when the
  // user isn't authenticated or the API hasn't responded yet.
  const liveModules = useDynamicNavigation();
  const visibleModules: NavModule[] = useMemo(() => {
    if (authState !== "authenticated") return liveModules;
    return liveModules
      .map((m) => ({
        ...m,
        items: m.items.filter((it) => !it.entitlement || hasEntitlement(it.entitlement)),
      }))
      .filter((m) => m.items.length > 0);
  }, [authState, hasEntitlement, liveModules]);
  const routeModuleId = useMemo(
    () => visibleModules.find((module) => module.items.some((item) => isActive(location.pathname, item.route)))?.id ?? visibleModules[0]?.id ?? "",
    [location.pathname, visibleModules],
  );
  const [selectedModuleId, setSelectedModuleId] = useState<string>(() => {
    const stored = localStorage.getItem("asc_selected_module_id");
    return stored && visibleModules.some((module) => module.id === stored) ? stored : routeModuleId;
  });
  const [moduleAnchorEl, setModuleAnchorEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!selectedModuleId || !visibleModules.some((module) => module.id === selectedModuleId)) {
      setSelectedModuleId(routeModuleId);
    }
  }, [routeModuleId, selectedModuleId]);

  useEffect(() => {
    if (!selectedModuleId) return;
    localStorage.setItem("asc_selected_module_id", selectedModuleId);
  }, [selectedModuleId]);

  const selectedModule = visibleModules.find((module) => module.id === selectedModuleId) ?? visibleModules[0];

  return (
    <Box component="nav" className={`side-nav ${collapsed ? "side-nav-collapsed" : ""}`}>
      <Stack spacing={0.9} sx={{ width: "100%" }}>
        <Tooltip title={collapsed ? "Expand menu" : "Collapse menu"} placement="right">
          <ButtonBase className="side-nav-btn" onClick={onToggleCollapsed} sx={{ justifyContent: collapsed ? "center" : "flex-start", px: 1, py: 0.6, borderRadius: "6px", gap: 0.8 }}>
            {collapsed ? <KeyboardDoubleArrowRightOutlinedIcon fontSize="small" /> : <KeyboardDoubleArrowLeftOutlinedIcon fontSize="small" />}
            {!collapsed ? <Typography variant="caption" sx={{ fontSize: "0.74rem" }}>Collapse</Typography> : null}
          </ButtonBase>
        </Tooltip>
        <Tooltip title={collapsed ? "Select module" : "Modules"} placement="right">
          <ButtonBase
            className="side-nav-btn side-nav-module-btn"
            onClick={(event) => setModuleAnchorEl(event.currentTarget)}
            sx={{ justifyContent: collapsed ? "center" : "flex-start", px: 1, py: 0.6, borderRadius: "6px", gap: 0.8 }}
          >
            <AppsOutlinedIcon fontSize="small" />
            {!collapsed ? <Typography variant="caption" sx={{ fontSize: "0.74rem" }}>{selectedModule?.label ?? "Modules"}</Typography> : null}
          </ButtonBase>
        </Tooltip>
        <Menu
          anchorEl={moduleAnchorEl}
          open={Boolean(moduleAnchorEl)}
          onClose={() => setModuleAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
        >
          {visibleModules.map((module) => (
            <MenuItem
              key={module.id}
              selected={module.id === selectedModule?.id}
              onClick={() => {
                setSelectedModuleId(module.id);
                const firstRoute = module.items[0]?.route;
                if (firstRoute) {
                  navigate(firstRoute);
                }
                setModuleAnchorEl(null);
              }}
            >
              {module.label}
            </MenuItem>
          ))}
        </Menu>
        <Stack spacing={0.5} sx={{ width: "100%" }}>
          {selectedModule?.items.length === 0 && !collapsed ? (
            <Typography variant="caption" sx={{ px: 1, color: "text.secondary", fontStyle: "italic" }}>
              —
            </Typography>
          ) : null}
          {(selectedModule?.items ?? []).map((item) => (
            <NavButton
              key={item.id}
              item={item}
              collapsed={collapsed}
              tooltipTitle={collapsed ? `${selectedModule?.label ?? "Module"} › ${item.label}` : undefined}
            />
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}
