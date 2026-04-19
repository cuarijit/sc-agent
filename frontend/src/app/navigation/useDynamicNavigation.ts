/**
 * useDynamicNavigation — fetches modules + pages from /admin/modules and
 * converts them to the NavModule[] structure consumed by LeftNav. Admin
 * edits in /agentic-ai/admin/modules now flow through to the sidebar.
 *
 * Pages have a page_slug; the actual frontend route is resolved from a
 * static SLUG_TO_ROUTE map mirroring main.tsx route registrations.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { request } from "../../services/api";
import { resolveIcon } from "./iconRegistry";
import { NAV_MODULES, type NavItem, type NavModule } from "../navigation";
import { ROUTE_PATHS } from "../routePaths";

interface AdminPage {
  id: number;
  page_slug: string;
  label: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
}
interface AdminModule {
  id: number;
  module_slug: string;
  label: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  pages?: AdminPage[];
}

// Maps page_slug (DB) → actual frontend route registered in main.tsx.
// Mirrors what was seeded in module_config_service.seed_default_modules.
const SLUG_TO_ROUTE: Record<string, string> = {
  // Smart Execution
  "dashboard": ROUTE_PATHS.dashboard,
  "network": ROUTE_PATHS.network,
  "parameters": ROUTE_PATHS.parameters,
  "replenishment": ROUTE_PATHS.replenishment,
  "maintenance": ROUTE_PATHS.maintenance,
  "recommendations": ROUTE_PATHS.recommendations,
  "scenarios": ROUTE_PATHS.scenarios,
  "documents": ROUTE_PATHS.documents,
  "chat": ROUTE_PATHS.chat,
  // Intelligent Planning
  "demand-forecasting": ROUTE_PATHS.demandForecasting,
  "collaborative-planning": ROUTE_PATHS.demandCollaborative,
  "forecast-accuracy": ROUTE_PATHS.demandAccuracy,
  "sop-ibp": ROUTE_PATHS.demandSop,
  "supply-integration": ROUTE_PATHS.demandSupplyIntegration,
  "financial-planning": ROUTE_PATHS.demandFinancial,
  "trade-promotion": ROUTE_PATHS.demandTradePromotion,
  "ibp-analytics": ROUTE_PATHS.demandAnalytics,
  "customer-hierarchy": ROUTE_PATHS.demandCustomers,
  // Puls8 Agents (agentic-ai module)
  "agent-configuration": ROUTE_PATHS.agentConfiguration,
  "inventory-diagnostic": ROUTE_PATHS.inventoryDiagnosticConsole,
  "demand-sensing": ROUTE_PATHS.demandSensingConsole,
  "allocation-distribution": ROUTE_PATHS.allocationConsole,
  "global-filter-compliance": ROUTE_PATHS.globalFilterCompliance,
  // Administration
  "admin-users": ROUTE_PATHS.adminUsers,
  "admin-modules": ROUTE_PATHS.adminModules,
  "admin-branding": ROUTE_PATHS.adminBranding,
};

const SLUG_TO_ENTITLEMENT: Record<string, string> = {
  "admin-users": "page.admin_users",
  "admin-modules": "page.admin_modules",
  "admin-branding": "page.admin_branding",
};

function dbModuleToNav(mod: AdminModule): NavModule | null {
  if (!mod.is_active) return null;
  const items: NavItem[] = (mod.pages || [])
    .filter((p) => p.is_active && SLUG_TO_ROUTE[p.page_slug])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => ({
      id: p.page_slug,
      label: p.label,
      route: SLUG_TO_ROUTE[p.page_slug],
      icon: resolveIcon(p.icon || ""),
      entitlement: SLUG_TO_ENTITLEMENT[p.page_slug],
    }));
  if (items.length === 0) return null;
  return { id: mod.module_slug, label: mod.label, items };
}

export function useDynamicNavigation(): NavModule[] {
  const { data } = useQuery<AdminModule[]>({
    queryKey: ["nav-modules"],
    queryFn: () => request<AdminModule[]>("/api/nav/modules"),
    staleTime: 15_000,
    retry: false,
  });

  return useMemo(() => {
    if (!data || data.length === 0) return NAV_MODULES;
    const built = data
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(dbModuleToNav)
      .filter((m): m is NavModule => m !== null);
    return built.length > 0 ? built : NAV_MODULES;
  }, [data]);
}
