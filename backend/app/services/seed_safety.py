"""Guardrails for seed-data modifications.

The agentic AI demos (demand_sensing, inventory_allocation,
inventory_diagnostic) rely on a specific slice of the seed data to produce
their canned narratives. Any seed-enhancement code that might re-touch SKUs
the agents read should consult this module first.

Empirical audit (grep DemandForecast / NetworkForecastWeekly /
NetworkActualWeekly in backend/app/services) shows:
  - The agentic services read NetworkForecastWeekly / NetworkActualWeekly /
    NetworkInventorySnapshot / StoreVelocity / PosHourlyActual.
  - None of them read from DemandForecast.

So `demand_forecast` is safe to enhance freely. Per-network tables, however,
remain off-limits for the protected SKU set.

The PROTECTED sets below are the union of SKUs seeded by the three agentic
demo fixtures. Keep in sync if new agent demos are added.
"""

from __future__ import annotations

# Inventory diagnostic (_DEMO_SKUS at inventory_diagnostic/demo_seed.py)
_DIAGNOSTIC_SKUS = frozenset({
    "BAR-002",
    "WATER-001",
    "SNACK-007",
    "CHOC-DB1",
    "TEA-050",
    "COFFEE-088",
    "ENERGY-110",
    "ENERGY-110X",
    "JUICE-044",
})

# Dairy allocation-distribution + POS sensing share this SKU set
# (_DAIRY_SKUS at inventory_diagnostic/demo_seed.py).
_DAIRY_SKUS = frozenset({
    "MILK-FULL-1L",
    "MILK-LOW-1L",
    "LABAN-500ML",
    "YOGURT-PLAIN-500G",
    "YOGURT-FRUIT-4P",
    "CHEESE-SLICE-200G",
    "CHEESE-FETA-400G",
    "JUICE-ORANGE-1L",
    "JUICE-MANGO-1L",
})

PROTECTED_AGENTIC_SKUS: frozenset[str] = _DIAGNOSTIC_SKUS | _DAIRY_SKUS

# Network tables agents DO read — changes to rows keyed by these SKUs against
# these tables will alter demo output.
PROTECTED_NETWORK_TABLES: frozenset[str] = frozenset({
    "network_forecast_weekly",
    "network_actual_weekly",
    "network_pos_weekly",
    "network_inventory_snapshot",
    "store_velocity",
    "pos_hourly_actual",
    "inventory_batch_snapshot",
    "replenishment_orders",
    "replenishment_order_details",
})


def is_protected(sku: str | None) -> bool:
    """Return True if seed enhancement should skip this SKU."""
    return bool(sku) and sku in PROTECTED_AGENTIC_SKUS
