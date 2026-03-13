import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import SettingsApplicationsOutlinedIcon from "@mui/icons-material/SettingsApplicationsOutlined";
import SettingsSuggestOutlinedIcon from "@mui/icons-material/SettingsSuggestOutlined";
import TableViewOutlinedIcon from "@mui/icons-material/TableViewOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

import { ROUTE_PATHS } from "./routePaths";

export interface NavItem {
  id: string;
  label: string;
  route: string;
  icon: SvgIconComponent;
}

export interface NavModule {
  id: string;
  label: string;
  items: NavItem[];
}

/** Demand Analysis: Forecast Alerts, Forecast Modification (pages show "Already developed") */
export const MODULE_DEMAND_ANALYSIS: NavModule = {
  id: "demand-analysis",
  label: "Demand Analysis",
  items: [
    { id: "forecast-alerts", label: "Forecast Alerts", route: ROUTE_PATHS.demandForecastAlerts, icon: WarningAmberOutlinedIcon },
    { id: "forecast-modification", label: "Forecast Modification", route: ROUTE_PATHS.demandForecastModification, icon: EditOutlinedIcon },
  ],
};

/** MEIO and Replenishment: Dashboard, Network, Parameters, Replenishment, Analytics */
export const MODULE_MEIO_REPLENISHMENT: NavModule = {
  id: "meio-replenishment",
  label: "MEIO and Replenishment",
  items: [
    { id: "dashboard", label: "Dashboard", route: ROUTE_PATHS.dashboard, icon: DashboardOutlinedIcon },
    { id: "network", label: "Network", route: ROUTE_PATHS.network, icon: HubOutlinedIcon },
    { id: "parameters", label: "Parameters", route: ROUTE_PATHS.parameters, icon: SettingsSuggestOutlinedIcon },
    { id: "replenishment", label: "Replenishment", route: ROUTE_PATHS.replenishment, icon: LocalShippingOutlinedIcon },
    { id: "maintenance", label: "Analytics", route: ROUTE_PATHS.maintenance, icon: TableViewOutlinedIcon },
  ],
};

/** Agentic AI: Agent configuration */
export const MODULE_AGENTIC_AI: NavModule = {
  id: "agentic-ai",
  label: "Agentic AI",
  items: [
    { id: "agent-configuration", label: "Agent configuration", route: ROUTE_PATHS.agentConfiguration, icon: SettingsApplicationsOutlinedIcon },
    { id: "global-filter-compliance", label: "Filter Compliance", route: ROUTE_PATHS.globalFilterCompliance, icon: FactCheckOutlinedIcon },
  ],
};

export const NAV_MODULES: NavModule[] = [
  MODULE_DEMAND_ANALYSIS,
  MODULE_MEIO_REPLENISHMENT,
  MODULE_AGENTIC_AI,
];

/** Flat list of all nav items (for backward compatibility or collapsed view). */
export const NAV_ITEMS: NavItem[] = NAV_MODULES.flatMap((m) => m.items);
