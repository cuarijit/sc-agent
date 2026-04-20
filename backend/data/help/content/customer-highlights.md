# Solution Overview

The **layered Puls8 solution**. Each layer is built on top of the previous one. 

> Customer-stated challenges live on the dedicated **Customer → Challenges** page.

---

# Puls8 Solution — Four Layers

Each layer is built on top of the previous one. The first three stabilise and improve the planning baseline; the fourth (Agentic AI) is the differentiator.

## Layer 1 — Baseline Forecast & Planning Improvements (Mid to Long term)

- Clean demand signals (remove noise: stockouts, promotions, anomalies)
- Create Mid-term plan using **Puls8 DBF (Driver Based Forecasting)** to accurately predict demand (Promotions, Ramadan month spike in demand etc.)
- Establish a segmented forecasting approach 
- Define granularity — **all the way to product, route level**

**Impact:**

- **Better Shape to know how much milk is needed and what to do with it.**
- Better baseline forecast
- Convert high level plan to right product mix.

---

## Layer 2 — Puls8 360 ADS Demand-Sensing Hybrid Approach (Short Term)

Different methods for different demand behaviours — this is critical; **don't treat all SKUs the same**.

### A. Stable / High-Volume SKUs

- Use statistical + ML hybrid models
- Introduce **Puls 8 360 Advanced Demand Sensing (ADS)**:
  - Incorporate near-real-time signals (orders, shipments, POS , Customer Inventory if available)
  - Short-term forecast correction (1–6 weeks horizon)

### B. Intermittent & Long-Tail SKUs

- Use **Puls8 360 ADS probabilistic** forecasting models:
  - LightGBM / SBA / TSB methods
  - Bayesian / distribution-based models
  - Forecast **demand distribution**, not just point forecast

**Impact:**

- Better service-level control
- Reduced overstock from "average-based" planning
- Product, route-level granularity

---

## Layer 3 — Inventory Optimisation & Safety Stock

Move from **static rules → dynamic, risk-based inventory policies**.

Key enhancements:

- Service-level-driven safety stock — use of **Puls8 360 Probabilistic Models** to set the correct min-max to reduce **waste **and** stockout**

---

## Layer 4 — Agentic AI Layer *(Differentiator)*

Agents monitoring (**Analyse, Simulate, Solve**) real-time POS and inventory data at route level, combined with route-level demand-sensing forecast / demand, provide a powerful tool to be **pro-active** and have better control of the situation.

### Concept

An Agentic AI layer that sits across:

- Demand planning data
- Supply / inventory data
- Supplier and lead-time signals
- **Real-time POS and Inventory data at route level**, combined with route-level demand-sensing forecast / demand at product, route level

It continuously **scans, diagnoses, and recommends actions**.

### How It Works (Simplified)

**User Prompt → Intent → Action**

Example:

> *"Where are my biggest stock-out and risks in the next 2 days?"*
OR
> *"Sweep my dairy network for the highest-value problem right now — stockout, expiry, or excess — tell me which SKU at which node it is, why it's happening, and the value-optimal action plan."*
> → Agent identifies SKUs + locations + root cause + recommended action


### Business Impact

- Faster issue detection (**days → hours**)
- Reduced manual analysis effort
- More **proactive** vs reactive planning
- Improved planner productivity
