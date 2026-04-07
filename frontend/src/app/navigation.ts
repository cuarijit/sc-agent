import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import SettingsApplicationsOutlinedIcon from "@mui/icons-material/SettingsApplicationsOutlined";
import SettingsSuggestOutlinedIcon from "@mui/icons-material/SettingsSuggestOutlined";
import TableViewOutlinedIcon from "@mui/icons-material/TableViewOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import TrackChangesOutlinedIcon from "@mui/icons-material/TrackChangesOutlined";
import EventNoteOutlinedIcon from "@mui/icons-material/EventNoteOutlined";
import SyncAltOutlinedIcon from "@mui/icons-material/SyncAltOutlined";
import AttachMoneyOutlinedIcon from "@mui/icons-material/AttachMoneyOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import PeopleOutlineOutlinedIcon from "@mui/icons-material/PeopleOutlineOutlined";
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

/** Intelligent Planning: forecasting, collaborative planning, S&OP, financial, trade, analytics */
export const MODULE_DEMAND_ANALYSIS: NavModule = {
  id: "intelligent-planning",
  label: "Intelligent Planning",
  items: [
    { id: "demand-forecasting", label: "Demand Forecasting", route: ROUTE_PATHS.demandForecasting, icon: TrendingUpOutlinedIcon },
    { id: "collaborative-planning", label: "Collaborative Planning", route: ROUTE_PATHS.demandCollaborative, icon: GroupsOutlinedIcon },
    { id: "forecast-accuracy", label: "Forecast Accuracy", route: ROUTE_PATHS.demandAccuracy, icon: TrackChangesOutlinedIcon },
    { id: "sop-ibp", label: "S&OP / IBP", route: ROUTE_PATHS.demandSop, icon: EventNoteOutlinedIcon },  
    { id: "supply-integration", label: "Supply Integration", route: ROUTE_PATHS.demandSupplyIntegration, icon: SyncAltOutlinedIcon },
    { id: "financial-planning", label: "Financial Planning", route: ROUTE_PATHS.demandFinancial, icon: AttachMoneyOutlinedIcon },
    { id: "trade-promotion", label: "Trade Promotion", route: ROUTE_PATHS.demandTradePromotion, icon: CampaignOutlinedIcon },
    { id: "ibp-analytics", label: "Planning Analytics", route: ROUTE_PATHS.demandAnalytics, icon: AssessmentOutlinedIcon },
    { id: "customer-hierarchy", label: "Customers", route: ROUTE_PATHS.demandCustomers, icon: PeopleOutlineOutlinedIcon },
  ],
};

/** Smart Execution: Dashboard, Network, Parameters, Replenishment, Analytics */
export const MODULE_PLANNING_REPLENISHMENT: NavModule = {
  id: "smart-execution",
  label: "Smart Execution",
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
  MODULE_PLANNING_REPLENISHMENT,
  MODULE_AGENTIC_AI,
];

/** Flat list of all nav items (for backward compatibility or collapsed view). */
export const NAV_ITEMS: NavItem[] = NAV_MODULES.flatMap((m) => m.items);
