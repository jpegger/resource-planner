# Resource Planner — Product Requirements Document

| | |
|---|---|
| **Version** | 0.1 |
| **Date** | 2026-10-27 |
| **Author** | Jean-Philippe Egger |
| **Owner (validation)** | |
| **Status** | Draft |

**Implementation details** for each stack live in that repository’s [`CONTEXT.md`](./CONTEXT.md). This PRD is product-facing and stack-agnostic. The same document is maintained in both the Node/Next.js and Java/Angular repositories (byte-identical).

---

## Table of contents

1. [Context](#1-context)
2. [Goals and non-goals](#2-goals-and-non-goals)
3. [Scope](#3-scope)
4. [Business objects](#4-business-objects)
5. [What users must be able to do](#5-what-users-must-be-able-to-do)
6. [Business rules and calculations](#6-business-rules-and-calculations)
7. [Roles and rights](#7-roles-and-rights)
8. [Reports and exports](#8-reports-and-exports)
9. [Data sources and exchanges](#9-data-sources-and-exchanges)
10. [Non-functional requirements](#10-non-functional-requirements)
11. [Glossary](#11-glossary)
12. [Open questions and risks](#12-open-questions-and-risks)

---

## 1. Context

Paradigm (Brussels Capital Region) plans IT and digital investments using a mix of Excel workbooks, Jira, SAP budget lines (EOTP), and later actuals from ServiceNow, SAP, and Salesforce. Spreadsheets do not scale for multi-year portfolios, EOTP splits, rate changes, or reliable interactive reporting.

**Resource Planner** is an internal web application that:

- Holds planning data against a **Jira-sourced** catalog (Products → investments, Initiatives), plus resources, rates, allocations, planned revenues, and EOTP exception routing.
- Computes **costs on read** (never stored as fact tables) so in-app reports and APIs always use the same rules.
- Freezes **snapshots**, imports **SAP budget baselines**, and compares planning vs budget (gap / coverage).
- Imports **realized** costs and revenues (timesheets, supplier invoices, signed AR, client invoices) and reconciles them with planning through mapping tables.
- Exposes **in-app reports** (charts + tables + Excel) backed by SQL views / APIs, and supports **Jira pull-sync** for Products and Initiatives.

Primary users are portfolio / budget planners, team leads, and controllers who already work in Excel and Jira today.

---

## 2. Goals and non-goals

### Goals

- Replace the operational Excel planning workbook as the system of record for allocations, rates, EOTP routing, and planned initiative revenue.
- Give a single place to see **internal / external / direct** cost and FTE by investment, initiative, division, and EOTP for a planning year.
- Keep **historical consistency**: rates resolve by the **initiative’s year**, not the calendar year of the consultation.
- Deliver portfolio and finance reports **inside the application** (charts, drill-downs, Excel exports), with stable SQL views / APIs behind them.
- Support **budget governance**: snapshot planning, import SAP baselines, show gap and coverage, export Excel.
- Support **actuals follow-up**: import realized labour and invoices, planned AR, and SAP client revenue; map unresolved rows; report planned vs realized.

### Non-goals

- Writing Product issues or initiative links **back to Jira from the web UI** (any write-back stays offline / CLI if needed).
- Replacing SAP, Jira, ServiceNow, or Salesforce as masters of their own domains.
- Multi-tenant SaaS or public internet product packaging.
- Fine-grained approval workflows or per-division ACLs in the first validated product (see §7).
- Live Salesforce / ServiceNow APIs as a hard dependency when **CSV import** already covers the flow.

---

## 3. Scope

### In scope (first product definition)

- Investments (allocation entities) and initiatives **originating from Jira** via pull-sync (catalog is read-only in the planner).
- Resources (INTERNAL, EXTERNAL, DIRECT_COST) and per-year rates; standard rates as fallback.
- Allocations (FTE % or man-days for staff; quantity for direct costs) **only** on Jira-synced initiatives (hence only under Jira-synced Products / investments).
- Planned initiative revenue (Mission / Subscription).
- EOTP definition catalog and **exception** EUR routing (main EOTP = remainder).
- Named planning snapshots; SAP budget baseline Excel import; live or snapshot vs baseline comparison; Excel export of comparison.
- In-app reports (budget, assignments, EOTP, baseline/snapshot, comparison, realized/revenue follow-up) with charts and Excel exports; SQL views (`v_allocation_costs`, `v_eotp_costs`, revenues, snapshot/baseline/comparison, realized) back the report APIs — no external BI tool.
- Realized layer: ServiceNow timesheets, SAP VIM supplier invoices, Salesforce AR, SAP client invoices; mapping tables and re-resolve; related reports.
- Organisation IdP authentication for production access; admin-gated bulk master-data import.

### Explicitly out of scope

- Creating or editing **investments** or **initiatives** in the planner UI (including “manual” investments not present in Jira). Catalog changes happen in **Jira**; the tool only syncs them.
- Allocating resources to anything other than a Jira-synced initiative.
- In-app Jira write-back (create Products / “Enables” links from the UI).
- Salesforce Credit Bookings / Availability Checks and similar SAP extracts not listed above.
- An external BI platform as a product dependency (reporting is in-app).
- Destructive “wipe database” admin tools as a product feature for end users.

### Later / open

- Harden Node auth to match IdP + admin model (see §7 and §12).
- Editable “duplicate snapshot as baseline” if both stacks must converge (already in Java stack — product Should).
- Confirm standard working days (200 / 220) with the business.
- Live API modes for AR / timesheets when credentials and ops are ready (CSV remains sufficient).

---

## 4. Business objects

*The “things” the tool talks about. Use business vocabulary; technical table names belong in `CONTEXT.md`.*

| Object | What it is (one sentence) | What describes it | Links to other objects | Real example |
|---|---|---|---|---|
| **Investment** | A product, project, programme, infrastructure, or team that consumes budget and hosts initiatives. | Name, type, product family, division / sub-division / team, main SAP EOTP code & name, attractiveness / competitiveness, Jira linkage. | Has many initiatives; has many EOTP routings; may link to one EOTP definition (main line). | “CRM Use Case” product for 2026 |
| **Initiative** | A Jira-backed piece of work under an investment for a planning year. | Code (e.g. RI-0001), summary, status, year, type (Run, Evolution, …), components. | Belongs to at most one investment; has many allocations and revenue lines. | RI-0421 “Rollout CRM 2026” |
| **Resource** | A person or a non-human cost item that can be allocated. | External id (MAT-…), name, function, cellule, direction (CRPS/PDS), type INTERNAL / EXTERNAL / DIRECT_COST. | Has many rates; has many allocations. | “Alice Dupont” (INTERNAL); “AWS Hosting” (DIRECT_COST) |
| **Rate** | The daily (or unit) price of a resource for one year. | Year, daily rate (EUR), days per year (or unit multiplier). | Belongs to one resource. | 650 €/day, 200 days, 2026 |
| **Rate standard** | Default daily rate (and days) for a resource type and year when no individual rate exists. | Year, type (INTERNAL/EXTERNAL only), daily rate, days per year. | No FK; joined by type + year at calculation time. | EXTERNAL 2026 → 750 €/day, 220 days |
| **Allocation** | Assignment of one resource to one initiative. | Quantity (FTE fraction or units) and/or man-days. | Resource ↔ Initiative. | 0.5 FTE of Alice on RI-0421 |
| **Initiative revenue** | Planned revenue line on an initiative. | Type Mission or Subscription, amount EUR, comment. | Belongs to one initiative. | Mission 40 000 € on RI-0421 |
| **EOTP definition** | A SAP financial programme line (budget structure). | SAP code, label, division, sub-division, team, budget owner, director. | Targeted by investments (main) and routing exceptions. | Prog Fin `X1234` “Digital Workplace” |
| **EOTP routing** | Exception that sends part of an investment’s yearly cost to another EOTP. | Year, target EOTP, internal / external / direct EUR amounts, comment. | Belongs to one investment; targets one EOTP definition. | 10 000 € external to `X5678` for 2026 |
| **Snapshot** | Frozen copy of planning totals (and EOTP detail) for a year at a point in time. | Label, year, taken-by, type SNAPSHOT or editable BASELINE copy. | Has many snapshot lines (per investment / EOTP). | “Freeze Q1 2026 planning” |
| **Budget baseline** | SAP budget imported from Excel for a year (governance reference). | Name, version, year, imported-by; lines per EOTP (and cellule). | Compared to live planning or a snapshot. | “Budget actuel 2026 v3” |
| **Timesheet import / entry** | Realized internal labour from ServiceNow. | Hours, programme/project refs, resolved investment/initiative, warnings. | Linked via mappings to investment / initiative / resource. | Approved time on PRJ… |
| **Invoice import / entry** | Realized external/direct cost from SAP VIM. | Amount EUR, account → EXTERNAL or DIRECT_COST, EOTP, warnings. | May link to EOTP definition. | Supplier invoice account 1211 |
| **AR import / entry** | Planned revenue from signed Salesforce AR lines. | Product, amounts, status Signed, counterpart reference. | May link to investment via mapping. | Signed AR for “CRM - Use Case” |
| **Revenue import / entry** | Realized client invoicing from SAP (incl. credit notes). | Invoice + line item, designation, amount (ZCR negative), AR link when resolved. | May link to AR entry and/or investment. | Facture 90836590 / Poste 10 |
| **Mapping tables** | Admin-maintained bridges from source system text to investments/initiatives. | Source key → investment or initiative id, notes. | Used by realized imports; no cascade from imports. | SN programme “CRM” → investment id |

### Relationships (cardinality)

- An **investment** has *many* **initiatives**; an **initiative** belongs to *at most one* **investment**.
- An **initiative** has *many* **allocations** and *many* **initiative revenues**.
- A **resource** has *many* **rates** (one per year) and *many* **allocations**.
- An **investment** has *many* **EOTP routings** for a year; the **main EOTP** is not stored as a routing row — it receives the remainder.
- A **snapshot** / **budget baseline** has *many* lines; comparison is by EOTP (and optionally by investment for snapshot variance).
- Each realized **import** has *many* **entries**; deleting the import removes its entries.

### Lifecycle answers (per object family)

| Question | Planning catalog (investment, resource, rate, allocation, revenue, routing) | Snapshot | SAP baseline | Realized imports |
|---|---|---|---|---|
| Who creates / updates? | **Investments / initiatives:** **Jira only** (pull-sync). No planner create/edit of those catalog objects in the UI. Optional admin CSV may bootstrap rows that already exist in Jira (must carry Jira keys) — not a way to invent orphan investments. **Resources, rates, allocations, planned revenue, EOTP routing:** planners in the tool (or CSV). | Any authorized planner. | Planner importing SAP Excel. | Planner / controller uploading files; mappings by planner/admin. |
| Can it change over time? History? | Yes — live data changes; history of planning is via **snapshots**, not row versioning. Catalog refreshes on each Jira sync. | SNAPSHOT immutable; BASELINE copy may be edited (product Should). | Replace by new import / delete + re-import. | Re-import or delete import header; mappings edited in place. |
| Delete or only close? | Soft close via Jira status; the planner does not offer create/delete of investments/initiatives as a normal user action. | Delete allowed. | Delete allowed. | Delete import (cascade entries). |
| Unique identity | Investment: name (+ business code); Resource: MAT-…; Initiative: RI-…; EOTP: SAP code; Rate: resource×year; Routing: investment×year×target EOTP. | Snapshot id + label/year. | Baseline id + name/version/year. | Import id; entry natural keys (e.g. AR line×year, invoice×year×item). |

---

## 5. What users must be able to do

*One line = one precise, verifiable need. Describe the expected outcome, not the technical solution.*

**Format:** “As a [who], I want [what] so that [why].”

**Priority:** `Must` (without this the tool has no value) · `Should` (strongly desired) · `Could` (if time allows) · `Won't` (not now).

### Portfolio and investments

| ID | Need | Priority |
|---|---|---|
| F1 | As a planner, I want to list investments for a year with internal, external and direct budget totals and filter by organisation fields so that I can find where money is committed. | Must |
| F2 | As a planner, I want to open an investment for a chosen year and see details, budget summary, FTE, EOTP breakdown and initiatives so that I can manage that product’s plan. | Must |
| F3 | As a planner, I want investment catalog fields (type, product family, division / sub-division / team, main SAP EOTP, attractiveness / competitiveness) to stay correct for reporting. **Source of truth: Jira Product issues only** — I maintain those fields in Jira; pull-sync (F4) applies them. The planner UI does **not** create investments or edit these catalog fields. | Must |
| F4 | As a planner, I want to pull Jira **Products** (→ investments) and **Initiatives** into the tool so that the only portfolio I can plan against is the one that exists in Jira (name, status, org, SAP programme, scores, initiative↔product links). | Must |

### Initiatives and allocations

| ID | Need | Priority |
|---|---|---|
| F5 | As a planner, I want to see initiatives under an investment (status, type, year) as synced from Jira so that I know what work drives the budget. | Must |
| F6 | As a planner, I want to assign INTERNAL or EXTERNAL resources by FTE fraction or by man-days **to a Jira-synced initiative** so that I can plan capacity only on real Jira work. | Must |
| F7 | As a planner, I want to assign DIRECT_COST resources by quantity (units × unit price) **to a Jira-synced initiative** so that licences and contracts appear on real Jira work. | Must |
| F8 | As a planner, I want to edit or remove allocations on those initiatives so that the plan stays current. | Must |
| F9 | As a planner, I want to see cost by initiative grouped by initiative type with subtotals so that I can compare Run vs Evolution vs other types. | Must |

### Resources and rates

| ID | Need | Priority |
|---|---|---|
| F10 | As a planner, I want to maintain resources (identity, direction CRPS/PDS, type) so that the pool of people and direct costs is accurate. | Must |
| F11 | As a planner, I want to maintain each resource’s daily rate and days-per-year for each planning year so that cost and FTE conversions are correct. | Must |
| F12 | As a planner, I want missing individual rates to fall back to the standard rate for that type and year so that incomplete rate sheets still produce a usable plan. | Must |

### EOTP routing

| ID | Need | Priority |
|---|---|---|
| F13 | As a planner, I want an investment’s yearly internal/external/direct cost to land on its main SAP EOTP by default so that finance sees the default programme line. | Must |
| F14 | As a planner, I want to add, edit and delete exception routings (EUR per bucket to another EOTP) so that shared costs can be split across programme lines. | Must |
| F15 | As a planner, I want the tool to refuse routing to the main EOTP and to keep the main remainder at zero or above so that over-routing never shows a negative main line. | Must |

### Planned revenue

| ID | Need | Priority |
|---|---|---|
| F16 | As a planner, I want to capture multiple Mission and Subscription revenue lines on an initiative so that expected income sits next to cost. | Must |
| F17 | As a planner, I want to see revenue and margin against cost on the investment so that I can spot loss-making plans early. | Must |

### Snapshots and SAP baseline

| ID | Need | Priority |
|---|---|---|
| F18 | As a planner, I want to take a named snapshot of planning for a year so that I can freeze a reference for later comparison. | Must |
| F19 | As a planner, I want to import a SAP budget baseline from Excel (programme, label, cellule, budget amount) so that the official budget is available in the tool. | Must |
| F20 | As a controller, I want to compare live planning or a snapshot to a SAP baseline by EOTP (with filters) and see gap and coverage so that I know what budget remains. | Must |
| F21 | As a controller, I want to export that comparison to Excel so that I can share it outside the app. | Must |
| F22 | As a planner, I want to duplicate a snapshot as an editable baseline so that I can adjust frozen amounts without changing live planning. | Should |

### Reports

| ID | Need | Priority |
|---|---|---|
| F23 | As a controller, I want a budget drill-down by division → team → investment (and initiative where relevant) so that I can steer the portfolio. | Must |
| F24 | As a planner, I want a resource-assignment report (EUR, man-days, %) so that I can see overload and coverage by person. | Must |
| F25 | As a planner, I want EOTP rollups and investment↔EOTP line detail so that I can explain where cost is booked. | Must |
| F26 | As a controller, I want to browse imported SAP baseline totals by EOTP and cellule so that I can validate the import. | Must |
| F27 | As a planner, I want to drill a frozen snapshot (division → team → investment → EOTP) so that I can explain a past freeze. | Must |
| F28 | As a user, I want charts on key report tabs so that patterns are visible at a glance. | Must |
| F29 | As a controller, I want report data to come from the same cost rules as planning screens (via APIs / SQL views) so that figures stay consistent when the schema evolves. | Must |

### Realized costs and revenue

| ID | Need | Priority |
|---|---|---|
| F30 | As a controller, I want to import ServiceNow timesheets (approved project time) so that realized internal labour is available. | Must |
| F31 | As a controller, I want to import SAP VIM supplier invoices (approved, relevant budget accounts) so that realized external and direct costs are available. | Must |
| F32 | As a controller, I want to import Salesforce AR lines with status Signed so that planned contract revenue is available. | Must |
| F33 | As a controller, I want to import SAP client invoices and credit notes (per invoice line) so that realized revenue is available. | Must |
| F34 | As a planner, I want to maintain mapping tables and re-resolve imports so that unmatched source rows can be fixed without rejecting the whole file. | Must |
| F35 | As a controller, I want reports for realized costs, planned vs invoiced revenue, and AR follow-up so that I can close the loop with finance. | Must |

### Access and administration

| ID | Need | Priority |
|---|---|---|
| F36 | As an organisation member, I want to sign in via the corporate identity provider so that only authorized people use the tool. | Must |
| F37 | As an administrator, I want to bulk-import planner master CSVs (EOTP, rates, resources, assignments, routing, revenues — and optionally Jira-keyed investments/initiatives for bootstrap) so that production data can be loaded idempotently without inventing investments outside Jira. | Should |
| F38 | As a planner, I want to import and export resources via Excel so that HR-style lists can be bulk-edited. | Should |

### Won't (for now)

| ID | Need | Priority |
|---|---|---|
| F39 | As a planner, I want the web app to create Jira Product issues and links automatically. | Won't |
| F40 | As a division head, I want per-division edit rights and approval workflows before allocations are saved. | Won't |
| F41 | As a planner, I want to create a “manual” investment or initiative in the tool that does not exist in Jira. | Won't |

---

## 6. Business rules and calculations

*Rules the tool must apply. Each rule includes a numeric example usable as a test. Also list exceptions.*

| ID | Rule (in words) | Example: starting data | Expected result |
|---|---|---|---|
| R1 | **DIRECT_COST** cost = `quantity × resource daily rate` for the initiative year. No rate → cost 0. | quantity 12, unit rate 100 € | Cost = 1 200 € (all in **direct**) |
| R2 | **INTERNAL / EXTERNAL** with man-days > 0: cost = `manDays × daily rate`; FTE = `manDays ÷ daysPerYear`. Man-days win if both man-days and quantity are set. | 60 man-days, 200 days/year, 500 €/day | Cost = 30 000 €; FTE = 0.30 |
| R3 | **INTERNAL / EXTERNAL** with man-days absent/0: quantity is an FTE fraction; cost = `quantity × daysPerYear × daily rate`; FTE = quantity. | quantity 0.5, 200 days, 500 €/day | Cost = 50 000 €; FTE = 0.5 |
| R4 | **Rate resolution** uses the **initiative’s year**: (1) individual Rate for resource×year; else (2) RateStandard for type×year; else 0. DIRECT_COST has no standard fallback. | Initiative year 2025; resource has only 2026 rate; standard INTERNAL 2025 = 480 € | Use 480 € (standard), not 2026 individual |
| R5 | **Days per year** for FTE math come from the individual rate when present. Typical business defaults: 200 INTERNAL, 220 EXTERNAL, 1.0 for direct-cost unit model (confirm §12). | — | Documented defaults; owner to validate |
| R6 | Cost is **never stored** as a fact; internal + external + direct for a row partition the computed cost with no overlap. | One INTERNAL allocation costing 10 000 € | `internal_cost=10000`, `external_cost=0`, `direct_cost=0` |
| R7 | **Cash-out** = external + direct. Internal is shown in totals but is not cash-out. | INT 40k, EXT 10k, DIR 5k | Cash-out = 15 000 €; total cost = 55 000 € |
| R8 | **Main EOTP** receives per-bucket remainder: investment totals minus sum of exception routings; remainder **clamped at ≥ 0**. Exceptions are EUR amounts, not percentages. Exception target must not equal the main SAP EOTP. | Total EXT 20 000; route 25 000 EXT away | Main EXT = 0 (not −5 000); routed shows 25 000 |
| R9 | A **snapshot** freezes computed planning amounts (investment and EOTP detail) at capture time; later live edits do not change the snapshot. | Snapshot taken at 100 000 € total; live plan later 120 000 € | Snapshot still 100 000 € |
| R10 | **Gap** (baseline vs planning) = baseline amount − planned cash-out (EXT+DIR) for that EOTP. Coverage relates planned cash-out to baseline. | Baseline 50 000; planned cash-out 40 000 | Gap = 10 000 € (budget left) |
| R11 | **Timesheet** import keeps only category Project/Project Task and state Processed or Approved; labour cost uses hours÷8 × daily rate (internal). | 8 hours, rate 500 € | 1 man-day → 500 € internal realized |
| R12 | **VIM** import keeps “Approbation terminée” and budget accounts 1211 → EXTERNAL, 1221 → DIRECT_COST. | Account 1211, 2 000 € | Realized external 2 000 € |
| R13 | **AR** import keeps Document Status = Signed only. | Status Draft vs Signed | Only Signed rows stored |
| R14 | **SAP client revenue**: ZCS positive, ZCR negated; grain = invoice × year × line item. Unmatched rows are kept with warnings, not rejected. | ZCR 1 000 € | amount_eur = −1 000 € |
| R15 | Revenue resolution prefers AR match (designation + external doc ref), then designation mapping, then EOTP root, else unresolved with warning. | Mapped designation + matching AR | Links to AR and inherits investment |

### Exceptions

- Both `manDays` and `quantity` set (rare): **man-days take precedence** for cost and FTE.
- Over-routing EOTP buckets: main line **floors at zero**, does not go negative.
- Investments and initiatives are **Jira-sourced only**; the planner must not expose create/edit of their catalog fields. Allocations and planned revenues attach only to initiatives that exist after Jira sync (or an admin bootstrap that carries the same Jira keys).
- Realized imports that cannot resolve a catalog match **do not fail the file**; they store a warning for later mapping / re-resolve.
- Timesheet and VIM imports are append-style (delete import to redo); AR and client-revenue imports upsert on their natural keys.

---

## 7. Roles and rights

**Target product behaviour**

- Access is gated by the organisation identity provider (**Entra ID** in deployed environments; local/dev may use a mock IdP).
- All authorized users share the same rights on **planning** data they are allowed to change (resources, rates, allocations, routing, planned revenue, snapshots, baselines, realized imports, Jira sync). They can **view** investments/initiatives but not create or edit their catalog; catalog changes are in Jira. Admin-only operations as below.
- **Administrator** (list of emails configured for the app): bulk CSV master-data import and other sensitive operational imports as implemented. Empty admin list ⇒ no one is admin.

**Sensitive information**

- Individual **daily rates** and person names are sensitive; the app is internal-only and must not be exposed publicly.
- Baseline and snapshot exports may contain budget figures — treat as confidential.

**Decision (confirmed)**

- Flat access is accepted for editable planning data (rates, allocations, routing, sync, etc.): every authorized user has the same rights on those objects.
- Investment / initiative **catalog** remains read-only in the planner (Jira is source of truth).
- Only **bulk master-data import** (and similar admin ops) is restricted to administrators.

---

## 8. Reports and exports

| Report / export | Expected content (columns, filters, groupings) | Format |
|---|---|---|
| Investment list with budget | Per investment: INT / EXT / DIR (and total) for selected year; filters name, division, team, family | Screen; Excel export where available |
| Investment detail | Details, year budget tiles, EOTP main + exceptions, budget by initiative, allocations, planned revenues | Screen |
| Budget by organisation | Drill-down division → team → investment → initiative; INT/EXT/DIR | Screen (+ chart, Must per F28); Excel where available |
| Resource assignments | Resource → initiatives / products; EUR, man-days, %; filters type, Run/Build | Screen; Excel where available |
| EOTP rollup | Cost per EOTP aggregated across investments | Screen (+ chart); Excel |
| EOTP line detail | One row per investment × EOTP (main + routed) | Screen; Excel |
| Products / investments budget | One row per investment; navigate to detail | Screen; Excel |
| SAP baseline browse | Totals by EOTP and by cellule for a baseline | Screen |
| Snapshot drill-down | Division → team → investment → EOTP for a snapshot | Screen |
| Baseline vs planning comparison | Per EOTP: baseline, planned cash-out, gap, coverage; filters division / sub-division / team / owner; planning = live or snapshot | Screen; **Excel** (Must) |
| Snapshot vs current (variance) | Per investment: baseline/snapshot amounts vs current, variance; optional grouping | Screen; Excel where available |
| Realized costs | Labour (timesheets) + VIM by year/month/type/ownership | Screen |
| Planned vs invoiced revenue / AR follow-up | AR contracts vs SAP invoice lines; deltas; filters/years from data | Screen; Excel for AR where available |
| Supporting SQL views | `v_allocation_costs`, `v_eotp_costs`, `v_revenues`, snapshot/baseline/comparison dims, realized cost/revenue views | Used by in-app report APIs (not an external BI tool) |

---

## 9. Data sources and exchanges

| Information | Where it lives today | What it is used for | How it enters the tool |
|---|---|---|---|
| Investments / Products | **Jira Product** issues only (custom fields: family, division, team, SAP Prog Fin, scores, type) | Portfolio structure, org dims, main EOTP, scores | **Jira pull-sync** (sole ongoing source). Optional admin CSV bootstrap must use Jira keys — no orphan / manual investments |
| Initiatives | **Jira Initiative** issues | Work breakdown, year, type; only target for allocations | Jira pull-sync (sole ongoing source); optional admin CSV bootstrap with Jira keys |
| Resources & rates | HR / Excel exports | Costing and FTE | Admin CSV; UI; Excel import (Should) |
| Allocations | Excel assignment sheets | Planned cost | Admin CSV; UI |
| EOTP catalog & routing | SAP / Excel | Budget structure and exceptions | Admin CSV; UI for routing |
| Planned initiative revenue | Excel | Margin vs cost | Admin CSV; UI |
| SAP budget baseline | SAP Excel extract | Governance comparison | Excel upload in app |
| Timesheets | ServiceNow export | Realized internal cost | CSV upload (+ optional API later) |
| Supplier invoices | SAP VIM extract | Realized external/direct | CSV upload |
| Signed AR | Salesforce export | Planned contract revenue | CSV upload (+ optional API later) |
| Client invoices | SAP ZCOMM extract | Realized revenue | CSV upload |
| Analytics / charts | In-app reports | Portfolio and finance steering | Report APIs + charts (Node: **Recharts**; Java: inline SVG) + Excel |

---

## 10. Non-functional requirements

- **Audience:** internal Paradigm users only; not a public product.
- **Languages:** UI must support **English**. FR / NL are optional extras (already present on the Java stack).
- **Correctness:** cost and FTE rules in §6 must match between planning screens and report APIs / SQL views (same product contract).
- **Persistence of cost:** computed on read; do not persist computed cost as source of truth.
- **Identity:** production access via corporate IdP; sessions must survive normal pod restarts in clustered deploy.
- **Audit-lite:** record who took a snapshot / imported a baseline (and similar) when identity is available.
- **Performance:** interactive screens and report charts must remain usable for a full regional portfolio for one planning year (exact SLAs left to implementation).

---

## 11. Glossary

| Term | Definition |
|---|---|
| **Investment** | UI name for an allocation entity (product, project, programme, infrastructure, or team) that owns initiatives and a main SAP EOTP. |
| **Allocation entity** | Same as Investment — domain/backend name. |
| **Product** | Often used interchangeably with Investment when type = PRODUCT; also a Jira issue type synced into investments. |
| **Initiative** | Jira-backed work item (code RI-…) under an investment for a planning year. |
| **Resource** | Person (INTERNAL/EXTERNAL) or non-human DIRECT_COST item. |
| **Allocation** | Assignment of a resource to an initiative (FTE %, man-days, or quantity). |
| **FTE** | Full-time equivalent as a fraction of a year (1.0 = full year). |
| **Man-days** | Number of working days allocated; convertible with days-per-year. |
| **Rate / Rate standard** | Individual vs type-level daily (or unit) price for a year. |
| **EOTP** | SAP “Engagement / programme financier” budget line (code + label). |
| **Main EOTP** | Default programme line of an investment; receives unrouted remainder. |
| **EOTP routing** | Exception EUR split of INT/EXT/DIR to another EOTP. |
| **Cash-out** | External + direct cost (internal excluded). |
| **Snapshot** | Frozen planning picture for a year. |
| **Budget baseline (SAP)** | Imported SAP budget amounts per EOTP — distinct from an editable snapshot-baseline copy. |
| **Gap** | Baseline − planned cash-out (budget left when positive). |
| **Mission / Subscription** | Types of planned initiative revenue. |
| **Realized** | Actuals imported from timesheets / invoices / SAP revenue (vs planned allocations). |
| **AR** | Salesforce Account Receivable / contract line used as planned revenue. |

---

## 12. Open questions and risks

| Item | Notes | Owner |
|---|---|---|
| Working days 200 / 220 / 1.0 | Confirm business defaults for INTERNAL / EXTERNAL / DIRECT_COST. | Business |
| Jira custom field IDs | Must match the target Jira Cloud instance before sync is production-ready. | Delivery |
| Auth parity across stacks | IdP + admin model is required for production; one stack may still be catching up — track in each `CONTEXT.md`. | Delivery |
| Realized layer on Java stack | In product scope (this PRD); implementation may lag — track gaps in Java `CONTEXT.md`. | Delivery |
| Editable snapshot-baseline (F22) | Should; present on Java, missing on Node — converge or demote. | Owner |
| Chart library parity | Node uses Recharts; Java uses hand-rolled SVG — both must cover the same report stories. | Delivery |

---

*End of PRD v0.1 — Jean-Philippe Egger · 2026-10-27*
