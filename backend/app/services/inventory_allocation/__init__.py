"""Inventory Allocation & Distribution Agent service package.

Pipeline: intent_parse → scope → capability → detect → prioritize →
rca → resolve → compose (with LLM explanation) → audit.

Problem types focus on allocation fair-share, delivery-route / Iftar-window
feasibility, and batch-level expiry clusters; resolutions span velocity-weighted
allocation rebalance, route reordering, inter-store transfers, markdowns,
donate/scrap, and vehicle-capacity swaps.
"""
from .orchestrator import InventoryAllocationRunner, AllocationRunResult

__all__ = ["InventoryAllocationRunner", "AllocationRunResult"]
