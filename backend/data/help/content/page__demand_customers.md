# Customers

## Purpose
The Customers page is the planning-level customer hierarchy view. It shows direct customers (Costco, Whole Foods, Target), indirect customers (regional sub-orgs that roll up to direct), and brokers / distributors. The planning_level field tells you which row is the consensus-forecast level for each customer chain.

## When to use it
- Validating customer hierarchy after a new onboarding.
- Identifying which planning level to use for consensus.
- Drilling from a high-level customer into its sub-region children.

## Tabs / sub-sections

### tab__customer_list — Customer List
Grid: customer_id, name, type (direct / indirect / broker), parent_customer_id, channel, region, planning_level, bill_to / sold_to.

### tab__planning_level_summary — Planning Level Summary
KPI count of customers per planning_level + a bar chart of customer-count by region.

## Key controls explained
| Control | What it does |
|---|---|
| Customer type chips | Filter the grid by direct / indirect / broker. |
| Hierarchy expand arrow | Show / hide children of a parent. |

## Data flow
- Reads: `/api/demand/customers`.
- Source: `customer_hierarchy` table.

## Permissions
Read for all roles. Editing the hierarchy requires **admin**.

## Common pitfalls
- Some customers (e.g. brokers) have `planning_level='direct'` even though they have no parent — that's intentional, not a bug.
