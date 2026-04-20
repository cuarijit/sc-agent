"""Puls8 DBF (Driver-Based Forecast) service package.

Public surface:
    seed_dbf_demo(db)       — idempotent demo seed (8 SKUs × 5 customers × 52 weeks)
    DbfScenarios(db)        — scenario CRUD + adjustment + publish
    DbfAccuracy(db)         — MAPE / bias / WMAPE at driver, consumption, shipment tiers
    fit_regression / apply_regression — consumption → shipment regressor

The DBF flow:
    1. Each driver (price, ACV/dist, display, feature) has its own forecast
       table at SKU × Customer × Week grain (for the active scenario).
    2. The composer multiplies driver effects by their elasticity coefficients
       to produce a consumption forecast at the same grain.
    3. The regressor applies a per-SKU × Location coefficient pair to convert
       consumption to shipment forecast at SKU × Customer × Location × Week.
    4. Publishing a scenario emits rows into demand_forecast with
       forecast_source='puls8_dbf' so Demand Forecasting picks it up.
"""

from .engine import compose_consumption, recompute_for_scenario
from .scenarios import DbfScenarios, PRODUCTION_SCENARIO_ID
from .accuracy import DbfAccuracy
from .demo_seed import seed_dbf_demo

__all__ = [
    "seed_dbf_demo",
    "DbfScenarios",
    "DbfAccuracy",
    "compose_consumption",
    "recompute_for_scenario",
    "PRODUCTION_SCENARIO_ID",
]
