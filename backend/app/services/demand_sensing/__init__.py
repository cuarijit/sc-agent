"""Demand Sensing Agent service package.

Pipeline: intent_parse → scope → capability → signal_detect → prioritize →
rca → resolve → compose (with LLM explanation) → audit.

Focus: real-time POS divergence, short-horizon shortage, and event-driven
pre-position gaps. Inputs are PosHourlyActual, RamadanCalendar,
NetworkInventorySnapshot, NetworkForecastWeekly; outputs are
ProblemInstance-shaped records compatible with the diagnostic ranker.
"""
from .orchestrator import DemandSensingRunner, DemandSensingRunResult

__all__ = ["DemandSensingRunner", "DemandSensingRunResult"]
