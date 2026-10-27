# Resource Planner — Technical Design Document (Node / Next.js)

**Paradigm · Brussels Capital Region · v1.13**

Product scope, user stories and business rules: **[`PRD.md`](./PRD.md)**.  
This file is the **Node / Next.js** implementation reference (schema, APIs, views, screens, seeds, ops). Do not duplicate product policy here — if PRD and this file disagree, **PRD wins** and this file should be updated.

---

## Table of Contents

1. [Role & PRD alignment](#1-role--prd-alignment)
2. [Core business logic (implementation)](#2-core-business-logic-implementation)
3. [Technology stack](#3-technology-stack)
4. [Database schema](#4-database-schema)
5. [Reporting SQL views](#5-reporting-sql-views)
6. [Application architecture](#6-application-architecture)
7. [Application screens](#7-application-screens)
8. [Jira sync](#8-jira-sync)
9. [Seed scripts](#9-seed-scripts)
10. [Local development setup](#10-local-development-setup)
11. [Gaps, open items & next steps](#11-gaps-open-items--next-steps)
12. [Project file structure](#12-project-file-structure)

---

## 1. Role & PRD alignment

### Product rules that drive this stack (from PRD)

- **Investments / initiatives** come from **Jira only** (pull-sync). Planner UI must not create or edit catalog fields.
- **Allocations** (and planned initiative revenue) only on **Jira-synced initiatives**.
- **Reporting** is in-app (**Recharts** + Excel); no external BI tool.
- **Access:** IdP in production; among authorized users, flat rights on editable planning data; admin-only bulk import. Confirmed in PRD §7.

### Implementation vs PRD (this repo)

| Area | Status |
|---|---|
| Allocations, rates, EOTP routing, planned revenue, snapshots, SAP baseline, comparison + Excel | Implemented |
| In-app reports (Recharts) + SQL views (planning + realized) | Implemented |
| Realized layer (timesheets, VIM, AR, SAP client revenue, mappings) | Implemented |
| Jira pull-sync (Products → investments, Initiatives) | Implemented — harden field IDs against live Jira (§11) |
| Catalog read-only / no manual investments | **UI:** Details card is read-only; list has no “create investment”. **Gap:** `PATCH`/`DELETE` on `/api/allocation-entities/[id]` still allow catalog mutation — should be locked down to match PRD |
| No create investment/initiative via REST | **OK** — `GET` list only on `/api/allocation-entities` (no `POST`) |
| F36 IdP authentication | **Gap** — no login; `X-Auth-Request-Email` / `planner@local` for audit only |
| F37 Admin-gated bulk CSV / seed | **Gap** — admin generate/seed routes unprotected |
| F22 Duplicate snapshot as editable baseline | **Gap** — Java only |
| F38 Resource Excel import/export | **Gap** — Java only |

---

## 2. Core business logic (implementation)

Business rules with numeric examples: **PRD §6 (R1–R15)**. Below is how this stack implements them.

### 2.1 Resource types & assignment fields

| Type | How planners enter work | Cost driver |
|---|---|---|
| INTERNAL / EXTERNAL | `quantity` = FTE fraction **or** `manDays` | Rate × days (see below) |
| DIRECT_COST | `quantity` = units | `quantity × dailyRate` (unit price) |

If both `manDays` and `quantity` are set, **man-days win** for cost and FTE.

### 2.2 Rate resolution (by initiative year)

Always use **`initiative.year`**, never “today”:

1. Individual `Rate` for `(resourceId, year)` → `dailyRate`
2. Else `RateStandard` for `(type, year)` → `dailyRate` (INTERNAL/EXTERNAL only; no standard for DIRECT_COST)
3. Else 0

**Days per year (`nbrDaysPerYear`):** required on each individual `Rate` row. `v_allocation_costs` uses **only** that column for FTE/man-day math — **no** fallback to `rate_standard.nbrDaysPerYear`. Typical entry values: 200 INTERNAL, 220 EXTERNAL, 1.0 DIRECT_COST units.

### 2.3 Cost formulas (computed on read — never stored)

| Type | Condition | Formula |
|---|---|---|
| DIRECT_COST | Always | `quantity × Rate.dailyRate` |
| INTERNAL / EXTERNAL | `manDays` > 0 | `manDays × effective_rate` |
| INTERNAL / EXTERNAL | else | `quantity × nbrDaysPerYear × effective_rate` |

Split into non-overlapping `internal_cost` / `external_cost` / `direct_cost` (sum = `computed_cost`). **Cash-out** = external + direct.

### 2.4 View helpers (`calculated_man_days`, FTE)

- Staff man-days: raw `manDays`, or `quantity × Rate.nbrDaysPerYear` for FTE entry.
- Staff FTE: `quantity`, or `manDays ÷ daysPerYear` when man-days drive the row.
- DIRECT_COST: FTE columns are 0; quantity path uses `nbrDaysPerYear` (usually 1.0) as unit multiplier.

### 2.5 EOTP exception routing

Exceptions only (`eotp_routing`): EUR INT/EXT/DIR to a **target** EOTP ≠ main `AllocationEntity.sapEotpCode`. Main EOTP gets remainder per bucket, **clamped ≥ 0**. Catalog: `eotp_definition`. Rollup view: `v_eotp_costs` (§5.2).

### 2.6 Reporting SQL conventions

- Prefer `CAST(... AS float)` / `<>` over `::` / `!=`.
- Cast enums to `VARCHAR` in reporting views.
- Grouping dimensions live on **allocation entity**, not initiative `product_group`.

---

## 3. Technology stack

| Component | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, TypeScript, Tailwind, shadcn/ui, cmdk) |
| ORM / DB | Prisma 7 + `@prisma/adapter-pg` → PostgreSQL |
| Reporting | **Recharts** on `/reports/*`; exceljs Excel exports; SQL views feed APIs |
| Jira | jira.js (`Version3Client`) |
| Salesforce (optional) | jsforce (AR API path when enabled) |
| Runtime | Node.js 20 (WSL2 / containers) |

**Prisma 7 notes:** datasource URL in `prisma.config.ts` + adapter at runtime (not in `schema.prisma`); generator `prisma-client` → `src/generated/prisma`; seeds via `tsx`; run `npm run db:seed` explicitly after migrate.

---

## 4. Database schema

**Catalog ownership:** `AllocationEntity` (Investment) and `Initiative` are filled by **Jira sync** (and optional admin CSV bootstrap with Jira keys). Live cost is never stored — computed in views/APIs. Snapshots store frozen EUR at capture time.

Core models: Resource, Rate, RateStandard, **AllocationEntity**, Initiative, Allocation, **InitiativeRevenue**, **EotpDefinition**, **EotpRouting**, **AllocationSnapshot** / **AllocationSnapshotRow**, **BudgetBaseline** / **BudgetBaselineRow**, **DimYear**, plus realized-layer import/entry and mapping tables (§4.12–§4.14).

PostgreSQL reporting views (`v_allocation_costs`, `v_eotp_costs`, `v_revenues`, snapshot/baseline/realized views, `dim_eotp`) are created by **`scripts/seed-production.ts`** (`SEED_VIEW_ONLY=1 npm run db:seed:prod`). Prisma also exposes read-only view models where useful (`VAllocationEntityCostTotals`, `DimEotp`).

### 4.1 Resource

All people and direct cost items available for allocation. Type drives all cost calculation logic.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK. MAT-0000xxx — preserved from source system |
| `fullName` | String | ✓ | Display name used throughout the app |
| `firstName` | String? | | |
| `lastName` | String? | | |
| `function` | String? | | Job title or role description |
| `cellule` | String? | | Organisational cell |
| `direction` | String? | | Direction / department (CRPS, DF, DT, etc.) |
| `type` | ResourceType | ✓ | INTERNAL \| EXTERNAL \| DIRECT_COST |
| `rates` | Rate[] | | Relation — individual rates per year |
| `allocations` | Allocation[] | | Relation — assignments to initiatives |
| `createdOn` | DateTime | ✓ | |
| `modifiedOn` | DateTime | ✓ | |

### 4.2 Rate

Individual daily rate per resource per year. Unique on `(resourceId, year)`. Takes precedence over RateStandard when present. For Direct Costs: `dailyRate` = unit price, `nbrDaysPerYear` = 1.0.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK. Generated as `RATE-{hash(resourceId\|year)}` — CSV RateId is not unique |
| `resourceId` | String | ✓ | FK → Resource.id |
| `year` | Int | ✓ | Year this rate applies to (matched to initiative.year) |
| `dailyRate` | Float | ✓ | EUR/day for Internal/External. Unit price for Direct Costs. |
| `nbrDaysPerYear` | Float | ✓ | Working days per year (FTE↔man-days) or unit multiplier for Direct Costs. Required — not null. |
| `createdOn` | DateTime | ✓ | |
| `modifiedOn` | DateTime | ✓ | |

### 4.3 AllocationEntity (physical table: `allocation_entity`)

Canonical allocation / investment catalog (Jira **Components** ↔ `AllocationEntity.name`). **Physical PostgreSQL table name is `allocation_entity`.** Column **`entity_type`** maps to Prisma enum **`AllocationEntityType`** (`PRODUCT`, `PROJECT`, `PROGRAM`, `INFRASTRUCTURE`, `TEAM`; default `PRODUCT`). Seeded from `scripts/datasets/dev/PRODUCTS.csv` via `npm run db:seed:products`. **`Initiative.allocationEntityId`** in Prisma maps to DB column **`allocation_entity_id`** for reporting and Jira sync.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK (e.g. `PRD-xxx` from CSV) |
| `name` | String | ✓ | Unique — must match Jira Components value for resolution |
| `type` | AllocationEntityType | ✓ | DB column `entity_type` |
| `productFamily` | String? | | Grouping (SALES, WORKPLACE, …) |
| `division` / `subDivision` / `team` | String? | | Org metadata |
| `sapEotpCode` / `sapEotpName` | String? | | SAP EOTP split (code vs label) |
| `eotpDefinitionId` | String? | | Optional FK → **`EotpDefinition`** (**`eotp_definition_id`**) — catalog link for the investment’s main SAP EOTP line |
| `attractiveness` / `competitiveness` | Float? | | Optional marketing-matrix scores |
| `initiatives` | Initiative[] | | Reverse relation |
| `eotpRoutings` | EotpRouting[] | | Optional exception routing rows (see §4.8) |

### 4.4 RateStandard

Fallback rate by year × resource type. Only INTERNAL and EXTERNAL — no standard fallback exists for DIRECT_COST. Unique on `(year, type)`. Contains working days per year (200 internal, 220 external).

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK. SRATE-x |
| `year` | Int | ✓ | Year this standard rate applies to |
| `type` | ResourceType | ✓ | INTERNAL or EXTERNAL only |
| `dailyRate` | Float | ✓ | Standard EUR/day for this type and year |
| `nbrDaysPerYear` | Int | ✓ | 200 for Internal, 220 for External |
| `createdOn` | DateTime | ✓ | |
| `modifiedOn` | DateTime | ✓ | |

### 4.5 Initiative

Synced from Jira via the `/api/jira/sync` route. The `jiraKey` (RI-xxx) is the natural primary key used across all relations. `powerId` (INI-xxx) is mostly null in practice and kept for reference only. The `year` field is critical — it drives rate resolution for all allocations on this initiative.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK. jira_key: RI-xxx |
| `powerId` | String? | | INI-xxx. Unique. Mostly null in current data. |
| `summary` | String | ✓ | Initiative title from Jira |
| `status` | String | ✓ | Kept as String — Jira values vary (Done, In Progress, RFP, etc.) |
| `year` | Int | ✓ | Planning year. CRITICAL — drives all rate resolution. |
| `components` | String? | | Jira components field (product name; used to resolve allocation entity) |
| `allocationEntityId` | String? | | Prisma FK → `AllocationEntity.id`; **DB column `allocation_entity_id`** — set by Jira sync from first matching component, or by seed |
| `productGroup` | String? | | Higher grouping (SALES, SMART ADMIN, eCITIZEN, etc.) |
| `initiativeType` | String? | | Raw Jira `(RI) Type`: Run, Evolution, Rollout, Projet, Analyse, etc. **Run vs Build reporting bucket:** `if initiativeType = "Run" then "Run" else "Build"` (Build is not a Jira type — all non-Run types collapse to Build). |
| `allocations` | Allocation[] | | Relation — all resource assignments for this initiative |
| `revenues` | InitiativeRevenue[] | | Many rows allowed per initiative — see §4.11 |
| `allocationEntity` | AllocationEntity? | | Optional relation when `allocationEntityId` set |
| `createdOn` | DateTime | ✓ | |
| `modifiedOn` | DateTime | ✓ | |

### 4.6 Allocation

One row per resource × initiative assignment. The `manDays` and `quantity` fields are mutually exclusive in practice. Cost is never stored — derived at query time using the initiative's year to resolve the applicable rate. Direct Costs use `quantity` as unit count, not FTE %.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK. `ASS-{hash(resourceId\|initiativeId)}` — one row per resource×initiative after merge |
| `externalId` | String? | | Unique. Original external ID from PowerApps system. |
| `initiativeId` | String | ✓ | FK → Initiative.id (RI-xxx) |
| `resourceId` | String | ✓ | FK → Resource.id (MAT-xxx) |
| `manDays` | Float? | | Man-day billing method. Takes precedence over quantity if > 0. |
| `quantity` | Float? | | FTE decimal for Internal/External (0.5 = 50%). Units for Direct Costs. |
| `createdOn` | DateTime | ✓ | |
| `modifiedOn` | DateTime | ✓ | |

### 4.7 EotpDefinition (SAP EOTP catalog)

PostgreSQL table **`eotp_definition`**. Canonical SAP EOTP lines used by the app for **labels**, **org metadata** (division, team, budget owner, …), and optional FK links from **`allocation_entity`** and **`eotp_routing`**. Seeded from **`scripts/datasets/dev/EOTP-Budget-Owner.csv`** via **`npm run db:seed:eotp`** (`scripts/seed-eotp-definitions.ts`). **Unique** on **`sapEotpCode`** (one row per SAP code).

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK (`cuid`) |
| `sapEotpCode` | String | ✓ | SAP EOTP code (maps to **`eotp_routing.eotp`** and display) |
| `label` | String | ✓ | Human-readable line label |
| `division` / `subDivision` / `team` | String? | | Org metadata |
| `budgetOwner` / `director` | String? | | Optional responsibility fields |

**Resolve helpers:** **`src/lib/eotp-definition-resolve.ts`** — resolve a definition from SAP code for API PATCH/POST and seeds.

### 4.8 EotpRouting (SAP EOTP exception routing)

Stores **exception-only** routing: fixed **EUR** amounts per cost bucket (internal / external / direct) directed to a **target EOTP** for a given **product × planning year**. Rows are **not** percentages. If no row exists for a bucket, that spend stays on the product’s default **`Product.sapEotpCode`** (no database row required for the “main” EOTP).

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK (`cuid`) |
| `allocationEntityId` | String | ✓ | Prisma FK → `AllocationEntity.id`; **DB column `allocation_entity_id`** |
| `year` | Int | ✓ | Planning year (aligned with initiative / budget year) |
| `eotp` | String | ✓ | Target SAP EOTP code (denormalized; should match **`eotp_definition.sap_eotp_code`** when **`eotpDefinitionId`** is set) |
| `eopLabel` | String? | | Display label |
| `eotpDefinitionId` | String? | | Optional FK → **`EotpDefinition`** (**`eotp_definition_id`**) — catalog row for this exception target |
| `internalAmount` | Float | ✓ | EUR routed to this EOTP from the **internal** bucket (default 0) |
| `externalAmount` | Float | ✓ | EUR from the **external** bucket |
| `directAmount` | Float | ✓ | EUR from the **direct** bucket |
| `comment` | String? | | Optional |

**Unique:** `(allocationEntityId, year, eotp)` in Prisma — **DB columns** `(allocation_entity_id, year, eotp)` — one combined row per target code per year.

**App rule:** POST/PATCH must **not** set `eotp` equal to the product’s **`sapEotpCode`** (main bucket is the computed remainder, not a stored routing row). Enforced in **`src/lib/eotp-routing-validation.ts`** (case-insensitive trim).

**Target picker (UI):** **`GET /api/eotp-routing-target-options`** returns options built **only** from **`eotp_definition`** (no allocation-entity fallback). Optional query **`mainSapEotp`** excludes the investment’s main SAP code from the list.

**Downstream:** `src/lib/eotp.ts` — `computeEotpBreakdown(mainEotp, costs, routings)` rolls initiative **internal / external / direct** costs into per–EOTP amounts (main EOTP gets the remainder after subtracting non-main targets). The **budget** API attaches `eotpBreakdown` per initiative row.

Use view **`v_eotp_costs`** (see §5.2) for rolled-up main vs split EOTP costs in reports/APIs. There is **no** `v_eotp_routing` view — raw rows are the **`eotp_routing`** table or the REST APIs under `/api/allocation-entities/[id]/eotp-routing`.

### 4.9 Planning snapshots & budget baselines

| Piece | Role |
|---|---|
| **`allocation_snapshot` / `allocation_snapshot_row`** | Named, immutable **allocation snapshot**: at capture time **`takeSnapshot`** calls **`computeAllocationBreakdownForYear(year)`** (shared with live comparison — same INT/EXT/DIR roll-up as budget API), persists per–EOTP rows. **User identity** for `takenBy` / `importedBy`: header **`X-Auth-Request-Email`** via **`getUserFromRequest`** (`src/lib/auth.ts`); dev fallback when unset. |
| **`budget_baseline` / `budget_baseline_row`** | SAP budget team Excel import (**xlsx**): columns **Prog Fin**, **Prog Fin lib**, **Cellule**, **Budget actuel YYYY**; amounts stored **positive EUR** (SAP negatives negated on import). |
| **`dim_year`** | Small table (years 2023–2028 seeded) for relationships to snapshot/baseline detail views. |
| **`dim_eotp`** | **View**: distinct **`eotp`** (and label) from **`allocation_snapshot_row`** ∪ **`budget_baseline_row`**; **`DISTINCT ON (eotp)`** so one row per code for dimension relationships. |

**Comparison vs baseline:** the primary surface is **`/reports/comparison`**: baseline vs **live planning** (current **`v_allocation_costs`** breakdown) or vs a **saved snapshot**, with ownership filters and an **Excel export** (see §7.6). Gap concept: baseline tracks external + direct “cash out” scope; **`v_snapshot_detail`** exposes **`cash_out`** = `external + direct`.

**APIs:** **`GET` / `POST /api/snapshots`**, **`DELETE /api/snapshots/[id]`**; **`GET` / `POST /api/baselines`** (multipart Excel), **`DELETE /api/baselines/[id]`**; **`GET /api/reports/comparison`** — query **`year`**, **`baselineId`**, optional **`snapshotId`** (omit for live), optional **`division`**, **`subdivision`**, **`team`**, **`owner`**. UI: **`/budget-comparison`** (capture/import), **`/reports/comparison`** (interactive gap table).

### 4.10 Entity Relationship Summary

```
EotpDefinition (1) ── (0..N) AllocationEntity [optional eotp_definition_id on main line]
EotpDefinition (1) ── (0..N) EotpRouting    [optional eotp_definition_id on exception target]
AllocationEntity (table allocation_entity) (1) ───── (N) Initiative    [DB allocation_entity_id optional]
AllocationEntity (1) ───── (N) EotpRouting   [DB allocation_entity_id]
Resource (1) ──── (N) Rate          [resourceId + year — unique]
Resource (1) ──── (N) Allocation   [resourceId]
Initiative (1) ── (N) Allocation    [initiativeId]
Initiative (1) ── (N) InitiativeRevenue [initiative_id — indexed, not unique]
RateStandard     ── (no FK)       [joined by type + year at query time]

# Realized layer (§4.12 – §4.14) — all *_entry rows ON DELETE CASCADE on import_id
TimesheetImport (1) ── (N) TimesheetEntry [allocation_entity_id?, initiative_id?, resource_id?]
InvoiceImport   (1) ── (N) InvoiceEntry   [eotp_definition_id?, cost_type ∈ EXTERNAL|DIRECT_COST]
ArImport        (1) ── (N) ArEntry        [allocation_entity_id?]
RevenueImport   (1) ── (N) RevenueEntry   [allocation_entity_id?, ar_entry_id? → ArEntry]
SnProgrammeMapping       ── (no FK from imports — looked up by sn_programme_name)
SnProjectMapping         ── (no FK from imports — looked up by sn_project_nr)
SfMasterProductMapping   ── (no FK from imports — looked up by sf_product_name)
SapDesignationMapping    ── (no FK from imports — looked up by sap_designation)
```

### 4.11 InitiativeRevenue (table: `initiative_revenue`)

Multiple revenue rows per initiative. **`RevenueType`** enum: **`Mission`** \| **`Subscription`**. Fields: `id`, `initiativeId` (FK → `Initiative`, **no** unique constraint — many rows allowed), `type`, `amount` (EUR), `comment` (optional), `createdOn`, `modifiedOn`. Back-relation: **`Initiative.revenues`**. Seeded from **`REVENU.csv`** via **`npm run db:seed:revenues`** (all CSV lines as **`Mission`**; matched by Jira key in **Colonne1**; **delete-then-insert** per affected initiative for idempotency).

### 4.12 Realized-layer mapping tables (managed in-app)

The realized-cost / revenue imports never reject rows — when source data does not match the planner catalog, the import writes an `import_warning` and the user fixes it from the **`/imports/mappings`** UI (§7.7). Mapping tables are **not** seeded from imports; they are edited by the user (with optional one-off CSV bootstraps).

| Table | Purpose | UNIQUE | Used by |
|---|---|---|---|
| **`sn_programme_mapping`** | ServiceNow `top_program` text → **`AllocationEntity.id`** | **`sn_programme_name`** | timesheet import |
| **`sn_project_mapping`** | ServiceNow `top_task` (PRJxxxxxxx) → **`Initiative.id`** (optional) | **`sn_project_nr`** | timesheet import |
| **`sf_master_product_mapping`** | Salesforce `Product` text → **`AllocationEntity.id`** (when `Product OTP` cannot resolve) | **`sf_product_name`** | AR import |
| **`sap_designation_mapping`** | SAP client-invoice `Désignation poste` (col 23) → **`AllocationEntity.id`** | **`sap_designation`** | revenue import (step 2 fallback — see §4.14) |

All mapping tables share the same shape: surrogate `id` (cuid), the source text key (unique), an optional **`allocation_entity_id`** (or **`initiative_id`** for SN projects), an optional `notes` field, plus `createdAt` / `updatedAt`. Imports do a single in-process lookup per row (no joins) and stamp the resolved FK onto the import-entry row.

### 4.13 Realized-layer import tables (audit + entries)

Each realized-data import follows the same **header + rows** pattern: an `*_import` audit row with file metadata is created in a single transaction with the parsed `*_entry` rows, and **`ON DELETE CASCADE`** on `import_id` lets the user remove an import with one click and reimport.

| Audit table | Entries table | Source file | Cost / revenue type |
|---|---|---|---|
| **`timesheet_import`** | **`timesheet_entry`** | `SN_Time_Card_Export_YYYY.csv` (ServiceNow Platform Analytics) | INTERNAL labour |
| **`invoice_import`** | **`invoice_entry`** | `SAP_VIM_Factures_Fournisseurs.csv` (ZVIM_ANA_DETAIL, périmètre 1700) | EXTERNAL (1211) + DIRECT_COST (1221) |
| **`ar_import`** | **`ar_entry`** | `SalesForce_AR_export.csv` (SF "AR DPM by Product") | Planned revenue (signed contracts) |
| **`revenue_import`** | **`revenue_entry`** | `SAP_Clients_Invoices.csv` (ZCOMM_REPORT, périmètre 1800) | Realized revenue (ZCS positive, ZCR negative — see §4.14) |

**Common fields on every `*_entry` row:** `import_id` (cascade FK), the resolved **`allocation_entity_id`** (nullable when unresolved), an optional **`initiative_id`** / domain-specific FK (e.g. **`ar_entry_id`** on `revenue_entry` — see §4.14), and an **`import_warning`** string set only when resolution failed. Cost / revenue amounts are stored as **EUR (positive)** for invoices and AR, with the SAP credit-note sign convention applied at parse time for `revenue_entry`.

**Filters applied at parse time** (rows failing these are skipped, **not** stored):

- **Timesheets** — `category = 'Project/Project Task'` and `state IN ('Processed', 'Approved')`.
- **VIM invoices** — `Descr = 'Approbation terminée'` and `Compte budgét. ∈ {1211, 1221}`. Skip `Annulé`, `T_GRIR`, blank `Compte`.
- **AR** — `Document Status = 'Signed'`.
- **SAP client invoices** — `Facture` (col 41) non-empty; **`year` parameter** mismatched against col 58 → skipped (`skippedYearMismatch` counter).

**Idempotency / upsert keys:** AR uses `(sf_line_item_id, year)`; revenue uses `(sap_invoice_nr, year, sap_invoice_item)` — one DB row per **SAP invoice line item** (`Poste`, col 48), so a single `Facture` carrying several `Désignation poste` lines (e.g. `CRM UC`, `CRM Framework`, `Consultance Expertise`) lands as several `revenue_entry` rows. Re-importing the same file with the same `year` parameter is idempotent (existing rows are updated, not duplicated). Timesheet and VIM imports are append-only — delete the import header to clear them.

### 4.14 RevenueEntry & SAP designation resolution (sections 5.10 / 7.4 of the realized-revenue design)

**`revenue_entry`** carries three columns added in migration **`20260510063935_revenue_entry_ar_link`** to link SAP client invoices back to the planning catalog and to Salesforce AR contracts, plus a **`sap_invoice_item`** column added in migration **`20260510121147_revenue_entry_invoice_item`** so the unique key is per-line, not per-invoice:

| Column | Type | Source (CSV col) | Notes |
|---|---|---|---|
| `sap_doc_type` | `TEXT NOT NULL` | col 0 — `Type document vente` | `ZCS` (invoice) or `ZCR` (credit note). Backfilled to `'ZCS'` for legacy rows. |
| `sap_invoice_item` | `INTEGER NOT NULL` | col 48 — `Poste` | SAP invoice line item (10/20/30…). Part of the **unique key** `(sap_invoice_nr, year, sap_invoice_item)` so each `Désignation poste` lands as its own row. Backfilled to `0` for legacy rows; re-import the source CSV to recover the real per-line breakdown. |
| `ext_doc_ref` | `TEXT` | col 40 — `Numéro externe de document de vente` | When non-empty, primary lookup key against **`ar_entry.counterpart_reference`**. |
| `ar_entry_id` | `TEXT` (FK → `ar_entry.id`, `ON DELETE SET NULL`) | resolved | Set when an AR line matches: **step 1** — `counterpart_reference` + SAP `product_label` = `sf_product_name`; or **step 2** — same AR ref + **`sap_designation_mapping.sf_product_name`** (after mapping SAP designation) when that row exists on the contract. |

**Sign convention:** the parser negates `amount_eur` when `sap_doc_type = 'ZCR'`. `ZCS` keeps the SAP positive value as imported (already EUR-converted). This makes `SUM(amount_eur)` directly equal **net realized revenue** without further client-side handling.

**4-step resolution (`src/lib/revenue-import-resolve.ts`):** every row is resolved exactly once, in priority order. The resolver returns `{ arEntryId, allocationEntityId, importWarning, step }`; the API route counts steps for the response summary.

| Step | Condition | Output | Warning? |
|---|---|---|---|
| **1** | `ext_doc_ref` non-empty **AND** an `ar_entry` row matches both `sf_product_name = designation` (col 23 — `product_label`) **AND** `counterpart_reference = ext_doc_ref` | `ar_entry_id` set; `allocation_entity_id` inherited from the AR row | No |
| **2** | Step 1 misses **and** `ext_doc_ref` non-empty | Look up **`sap_designation_mapping`** by `sap_designation = designation`. If **`sf_product_name`** is set on the mapping, retry the same AR match as step 1 using `counterpart_reference = ext_doc_ref` and `sf_product_name = mapping.sf_product_name`. If an AR line exists → **`ar_entry_id`** + inherited **`allocation_entity_id`** (same as step 1; response **`step1Count`**). If no AR line but **`allocation_entity_id`** on the mapping → set that only. If mapping missing → both FKs null. | Yes when no AR link is found (warnings describe missing AR line for mapped SF name, allocation-only fallback, or unmapped designation) |
| **3** | `ext_doc_ref` empty | EOTP root from col 31 → **`allocation_entity.sapEotpCode`** (no SAP-designation fallback) | No |
| **4** | Nothing resolved | both FKs `NULL` | Yes — `STEP 4: No EOTP and no AR match` |

**API response** (`POST /api/imports/revenue`) returns `{ import, summary }` where `summary` includes `totalLines`, `parseSkipped`, `skippedYearMismatch`, `upsertedRows`, **`step1Count`**, **`step2Count`**, **`step3Count`**, **`step4Count`**, **`warnCount`**. **`upsertedRows`** counts distinct `(sap_invoice_nr, year, sap_invoice_item)` triples — i.e. one per imported SAP invoice **line item**, so an invoice with several `Désignation poste` lines contributes several rows and several increments.

**Date parsing nuance:** col 59 (`Date de la pièce`) was usually `DD/MM/YYYY` in early exports but newer SAP exports of the same column are **Excel 1900-system serial integers** (e.g. `45497`). `parseInvoicePieceDate` tries `DD/MM/YYYY` first, then falls back to **`parseExcelSerialDate`** (uses 25_569 as the JS-epoch offset, accounting for Excel's 1900 leap-year bug); rows where neither parses are skipped (`parseSkipped`).

**Operational impact:** mapping rows for step 2 are managed at **`/imports/mappings`** (§7.7) — re-running the import after adding mappings will resolve previously-warned rows on the next pass (idempotent on `(sap_invoice_nr, year, sap_invoice_item)`).

---

## 5. Reporting SQL views

The primary cost view is **`v_allocation_costs`** (PostgreSQL), created by the seed script. In-app reports (Recharts) and APIs consume these views / equivalent queries — **not** an external BI tool. The app uses Prisma on raw tables for CRUD. **`v_allocation_costs`** is recreated each time the production seed view step runs, or on demand via:

```bash
SEED_VIEW_ONLY=1 npm run db:seed:prod
```

### 5.1 View Columns

| Column | Description |
|---|---|
| `jira_key` | Initiative identifier (RI-xxx) |
| `summary` | Initiative title |
| `initiative_year` | Planning year — drives rate resolution |
| `allocation_id` | Primary key of the allocation row |
| `power_id` | Initiative `powerId` (INI-xxx), often null |
| `product` | Initiative `components` (Jira text) |
| `product_name` | `LEFT JOIN allocation_entity` — `COALESCE(name,'Unassigned')` |
| `product_family` / `division` / `sub_division` / `team` | From `Product` with `Unassigned` fallbacks (`&` → `and` on family) |
| `sap_eotp_code` / `sap_eotp_name` | From `Product` (`Unassigned` if null) |
| `attractiveness` / `competitiveness` | Raw floats from `Product` (nullable) |
| `man_days` / `quantity` | Raw allocation fields (for validation / reporting) |
| `jira_component_product` | Raw Jira component name from the initiative (traceability). |
| `initiative_type` | Run / Evolution / Rollout / etc. |
| `status` | Initiative status from Jira |
| `resource_id` | Resource PK (MAT-xxx) |
| `resource_name` | Full name of resource |
| `resource_type` | INTERNAL \| EXTERNAL \| DIRECT_COST |
| `cellule` | Resource cell |
| `direction` | Resource direction |
| `effective_rate` | Resolved daily rate (individual or standard fallback) |
| `effective_days_per_year` | `Rate.nbrDaysPerYear` from the joined individual rate row (required on `rate`; no fallback to `rate_standard` for days). |
| `computed_cost` | Total cost — all types |
| `internal_cost` | Cost if INTERNAL, else 0 |
| `external_cost` | Cost if EXTERNAL, else 0 |
| `direct_cost` | Cost if DIRECT_COST, else 0 |
| `fte_decimal` / `fte_percent` | See §2.7 — FTE from % or implied from man-days (staff only) |
| `calculated_man_days` | See §2.6 — unified man-days / direct-cost quantity path |

**Cost safeguards (implementation):** FTE and direct-cost quantity paths multiply by **`rate.nbrDaysPerYear` only** (see `createCostView` in `seed-production.ts` / `seed-dev.ts`). **`dailyRate`** may still fall back to **`rate_standard`** when the individual rate row has no `dailyRate`; days/year do not.

**Key guarantee:** `internal_cost + external_cost + direct_cost = computed_cost` for every row.

### 5.2 View `v_eotp_costs` (EOTP rollups for reporting)

Created by the same production seed path as `v_allocation_costs` (after `eotp_routing` exists). SQL lives in **`scripts/eotp-views.ts`**: **`product_costs`** (per product × year from `v_allocation_costs`), **`routed_non_main`** (sums of exception routing where `eotp <> main_eotp`), then **`UNION ALL`** of exception lines plus one **main** line per product × year (remainders after subtracting `routed_non_main`).

- **Non-main EOTP** rows — one line per routing row targeting a code other than **`sapEotpCode`**, with `internal_cost` / `external_cost` / `direct_cost` from the three amount columns.
- **Main EOTP** row (`is_main_eotp = true`) — `eotp` = main code, `eop_label` = **`sapEotpName`**, amounts = product-year totals minus non-main routing.
- **Derived columns (every row):** **`cash_out`** = `external_cost + direct_cost`; **`total_cost`** = `internal_cost + external_cost + direct_cost`.

**There is no `v_eotp_routing` view** — listing raw exception rows = query **`eotp_routing`** or use the app APIs. To recreate only this view after SQL changes: **`npm run db:recreate:eotp-costs`** (requires **`v_allocation_costs`**). Full planner views: **`SEED_VIEW_ONLY=1 npm run db:seed:prod`** (same as §5 command).

### 5.3 Planning vs budget baseline views

Created by the same production seed path as **`v_allocation_costs`** (after snapshot/baseline tables exist). Used by in-app comparison / snapshot / baseline reports: **`v_snapshot_detail`**, **`v_baseline_detail`**, **`dim_year`**, **`dim_eotp`**.

- **`v_snapshot_detail`** — joins **`allocation_snapshot`** and **`allocation_snapshot_row`**; includes **`cash_out`** (= `external + direct`).
- **`v_baseline_detail`** — joins **`budget_baseline`** and **`budget_baseline_row`**; **`baseline_amount`**.
- Relationships: **`dim_year[year]`** → both detail views; **`dim_eotp[eotp]`** → **`v_snapshot_detail[eotp]`** and **`v_baseline_detail[eotp]`**. **Gap** = baseline amount − planned cash-out (same concept as `/reports/comparison`).

### 5.4 View `v_revenues` (revenue lines)

**`v_revenues`** — one row per **`InitiativeRevenue`** record. Columns: **`revenue_id`**, **`initiative_id`**, **`jira_key`**, **`summary`**, **`initiative_year`**, **`initiative_type`** (varchar), **`status`** (varchar), org dimensions, **`sap_eotp_code`**, **`sap_eotp_name`**, **`revenue_type`** (varchar — `'Mission'` or `'Subscription'`), **`revenue_amount`**, **`revenue_comment`**, timestamps. All enum-like columns **cast to VARCHAR** (§2.8). **`SUM(revenue_amount)`** is additive at revenue-line grain. Do **not** join **`v_revenues`** to **`v_allocation_costs`** in the model — different granularities (revenue line vs allocation row); filter both via shared slicers (e.g. year, product). Created by **`createRevenueView()`** in **`scripts/seed-production.ts`**. Recreated by **`SEED_VIEW_ONLY=1 npm run db:seed:prod`**.

### 5.5 Realized-layer views (`v_realized_costs`, `v_planned_revenue`, `v_realized_revenue`)

Created by **`createRealizedViews()`** in **`scripts/realized-views.ts`** (called from `seed-production.ts`, also rebuilt by `SEED_VIEW_ONLY=1 npm run db:seed:prod`). These views never alter or replace `v_allocation_costs` / `v_eotp_costs`.

- **`v_realized_costs`** — `UNION ALL` of `timesheet_entry` (`cost_type = 'INTERNAL'`, `amount_eur = (hours / 8.0) × COALESCE(rate.dailyRate, rate_standard.dailyRate)`) and `invoice_entry` (`cost_type ∈ {EXTERNAL, DIRECT_COST}`, `amount_eur` from `invoice_entry`). Joins **`eotp_definition`** for division / sub_division / team / owner on the VIM half. Filterable by year / month / cost type / ownership / `allocation_entity_id`.
- **`v_planned_revenue`** — `ar_entry GROUP BY year × allocation_entity_id × sf_product_name × client_name`. Used for AR coverage dashboards.
- **`v_realized_revenue`** — `revenue_entry GROUP BY year × month × allocation_entity_id × sap_article_code × product_label × client_name`. The new **`ar_entry_id`**, **`ext_doc_ref`**, **`sap_doc_type`** columns (§4.14) are **not** projected by this view today — query `revenue_entry` directly when AR-link drilldowns are needed (`revenue_entry.ar_entry_id` → `ar_entry.id`). _Open item: extend the view when reporting needs it._

These views are intentionally additive — `SUM(amount_eur)` is correct at the row grain. Shared `dim_year` / `dim_eotp` (§4.9, §5.3) can slice with the planning views.

---

## 6. Application Architecture

### 6.1 Data Flow

```
Jira API  →  /api/jira/sync  →  Initiative table (upsert by jira_key)
Excel CSVs  →  seed-production.ts  →  Resources, rates, initiatives, allocations (+ view); allocation entities (`allocation_entity` table) seeded first when `PRODUCTS.csv` is present
Browser  →  Next.js API routes (+ Recharts reports)  →  Prisma / SQL views  →  PostgreSQL
Reports UI  →  /api/reports/*  →  v_allocation_costs, v_eotp_costs, v_revenues, v_snapshot_detail, v_baseline_detail, realized views, dim_year, dim_eotp
```

### 6.2 API Routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/jira/sync` | GET | Fetch all initiatives from Jira filter, upsert to DB |
| `/api/allocations` | GET, POST | GET by `initiativeId`. POST creates an allocation; body must include **`initiativeId`** and **`resourceId`** (no server-side default resource). |
| `/api/allocations/[id]` | PATCH, DELETE | Update or delete one allocation. Auto-save on change. |
| `/api/resources/[id]` | GET, PATCH, DELETE | Read, update or delete a resource; **`direction`** must be **`CRPS`**, **`PDS`**, or **null** |
| `/api/rates` | GET, POST | GET by resourceId. POST creates new rate. |
| `/api/rates/[id]` | PATCH, DELETE | Update or delete one rate row |
| `/api/allocation-entities` | GET | List all allocation entities (ordered by family, name) |
| `/api/allocation-entities/[id]` | GET, PATCH, DELETE | One entity by id; PATCH updates catalog fields (including optional `type`) |
| `/api/allocation-entities/[id]/eotp-routing` | GET, POST | List or create **EotpRouting** rows (`GET` optional `?year=`). POST rejects targets equal to **`sapEotpCode`**. |
| `/api/allocation-entities/[id]/eotp-routing/[routingId]` | PATCH, DELETE | Update or delete one routing row (PATCH rejects effective `eotp` = main SAP code). |
| `/api/allocation-entities/[id]/eotp-main-from-view` | GET | Main-bucket rows from **`v_eotp_costs`** (`is_main_eotp = true`); optional `?year=` |
| `/api/allocation-entities/with-budget` | GET | **All** allocation entities with rolled-up INT/EXT/DIR from `v_allocation_costs` via SQL (`LEFT JOIN` — zeros when no initiatives/costs). JSON mirrors Prisma scalars on the entity plus **`totalInternal`**, **`totalExternal`**, **`totalDirect`** (camelCase EUR totals). Used by the investments list in one request. |
| `/api/allocation-entities/[id]/budget` | GET | Optional `?year=` — per-initiative cost rollups; includes **`eotpBreakdown`** when `sapEotpCode` is set; **`total_revenue`**, **`revenue_mission`**, **`revenue_subscription`** (sums over **`initiative_revenue`** lines) |
| `/api/revenues` | GET, POST | GET by **`?initiativeId=`** — all revenue rows for the initiative. POST creates one **`InitiativeRevenue`** line (`type`, `amount`, `comment`). |
| `/api/revenues/[id]` | PATCH, DELETE | Update or delete one revenue row by **`id`**. |
| `/api/allocation-entities/[id]/year-summary` | GET | Required `?year=` — **`totalCost`** (EUR) and **`totalFte`** (sum of **`fte_decimal`**) from **`v_allocation_costs`** for the entity × planning year |
| `/api/eotp-routing-target-options` | GET | Optional **`?mainSapEotp=`** — JSON target options from **`eotp_definition`** only (excludes main SAP code when provided) |
| `/api/resources` | GET | `{ id, fullName, type }[]` for allocation resource picker (ordered by name) |
| `/api/initiative-allocation-costs` | GET | Query `initiativeId` — per-allocation costs from `v_allocation_costs` |
| `/api/snapshots` | GET, POST | List allocation snapshots; POST creates snapshot (**`takeSnapshot`**) — body JSON **`name`**, **`year`**; **`takenBy`** from **`X-Auth-Request-Email`**. |
| `/api/snapshots/[id]` | DELETE | Delete snapshot (cascade rows). |
| `/api/baselines` | GET, POST | List budget baselines; POST multipart **`name`**, **`version`**, **`year`**, **`file`** (Excel). |
| `/api/baselines/[id]` | DELETE | Delete baseline (cascade rows). |
| `/api/reports/comparison` | GET | **Planning vs baseline** rows for **`/reports/comparison`**. Query: **`year`**, **`baselineId`**, optional **`snapshotId`** (absent ⇒ **live** current allocations via **`fetchLivePlanningVsBaselineComparison`** / **`computeAllocationBreakdownForYear`**), optional org filters. Uses view **`v_comparison`** when a snapshot is selected. |

**Realized-layer imports** (multipart `file`, query / form `year`):

| Route | Methods | Purpose |
|---|---|---|
| `/api/imports/timesheets` | GET, POST | List timesheet imports / upload `SN_Time_Card_Export_YYYY.csv`; resolves **`allocation_entity_id`** via **`sn_programme_mapping`** and optional **`initiative_id`** via **`sn_project_mapping`** |
| `/api/imports/timesheets/[id]` | DELETE | Cascade-delete one timesheet import + its `timesheet_entry` rows |
| `/api/imports/timesheets/sync` | POST | Re-resolve unmapped `timesheet_entry` rows after mapping edits (no re-upload) |
| `/api/imports/invoices` | GET, POST | List VIM imports / upload `SAP_VIM_Factures_Fournisseurs.csv`; resolves **`eotp_definition_id`** from EOTP root |
| `/api/imports/invoices/[id]` | DELETE | Cascade-delete one VIM import |
| `/api/imports/ar` | GET, POST | List AR imports / upload `SalesForce_AR_export.csv`; required `year` form field; UPSERT on `(sf_line_item_id, year)` |
| `/api/imports/ar/[id]` | DELETE | Cascade-delete one AR import |
| `/api/imports/ar/sync` | POST | Re-resolve unmapped `ar_entry` rows after **`sf_master_product_mapping`** edits |
| `/api/imports/revenue` | POST | Upload `SAP_Clients_Invoices.csv`; required `year` form field; UPSERT on `(sap_invoice_nr, year, sap_invoice_item)` — one row per SAP invoice **line item** (`Poste`, col 48); runs the **4-step resolver** (§4.14) and returns `summary` with **`step1Count`** / **`step2Count`** / **`step3Count`** / **`step4Count`** / **`warnCount`** |
| `/api/imports/revenue/[id]` | DELETE | Cascade-delete one revenue import |
| `/api/imports/config` | GET | Return server-side defaults for the import UI (e.g. current import year) |

**Realized-layer mapping CRUD** (managed in-app — see §4.12, §7.7):

| Route | Methods | Purpose |
|---|---|---|
| `/api/mappings/sn-programmes` | GET, POST | List / create `sn_programme_mapping` rows |
| `/api/mappings/sn-programmes/[id]` | PATCH, DELETE | Update / delete one row |
| `/api/mappings/sn-projects` | GET, POST | List / create `sn_project_mapping` rows (FK → Initiative) |
| `/api/mappings/sn-projects/[id]` | PATCH, DELETE | Update / delete one row |
| `/api/mappings/sf-products` | GET, POST | List / create `sf_master_product_mapping` rows (Salesforce master `Product` → AllocationEntity) |
| `/api/mappings/sf-products/[id]` | PATCH, DELETE | Update / delete one row |
| `/api/mappings/sap-designations` | GET, POST | List / create `sap_designation_mapping` rows (SAP `Désignation poste` → AllocationEntity) — backs **step 2** of the revenue resolver (§4.14) |
| `/api/mappings/sap-designations/[id]` | DELETE | Delete one row |

**Realized-layer reports**:

| Route | Methods | Purpose |
|---|---|---|
| `/api/reports/ar-invoicing` | GET | Backs **`/reports/ar-invoicing`** (§7.6). Query: optional **`year`** (omitted ⇒ cross-year view), `division`, `subdivision`, `team`, `productId`, `allocationProductName`, `mapped`, `warningsOnly`, `client`, `masterProduct`, `contractNumber`, `counterpartReference`, `signedFrom` / `signedTo`, `importId`, `limit`, `offset`. Returns `{ meta, summary, lines, unmatched }`. `meta.availableYears` lists every year present in `ar_entry ∪ revenue_entry` (drives the UI dropdown). `lines[]` are AR line items with their matched SAP `revenue_entry` rows aggregated via a **lateral join** that links by FK (`re.ar_entry_id = ar.id`, year-agnostic) **or** by the legacy `(sap_so_number, sf_product_name)` heuristic (year-required). `unmatched[]` aggregates SAP rows whose `ext_doc_ref` references an AR on the page but match no AR line item (one bucket per `(counterpart_reference, allocation_entity_id)`). |

**Legacy URLs:** No Next.js redirects are configured for old paths — use the canonical routes in the table above only.

### 6.3 Investments UI and allocation entity catalog

Primary flow: **`/investments`** → **`/investments/[id]`**. Detail loads via **`GET /api/allocation-entities/[id]`**; budget / EOTP / allocations use `v_allocation_costs` and related APIs. Initiatives appear only as children of an investment (no standalone `/initiatives` route). Catalog fields are displayed read-only in the UI (Jira sync is the writer).

---

## 7. Application Screens

### 7.1 Investments (`/investments`, `/investments/[id]`) — Primary

Portfolio table of allocation entities with optional budget columns (€k INT/EXT/DIR from **`/api/allocation-entities/with-budget`**). Row opens **investment detail** (modular client under **`investments/[id]/`**). **No UI to create an investment** — catalog arrives via Jira sync / seed.

**Layout:** Shared panel chrome (**`PANEL_CARD_CLASS`**). **Title** = entity **name · selected year**. **Top row:** **Details** (**read-only** catalog: org, SAP EOTP, scores — PRD: Jira is source of truth) | **Budget Summary {year}** (overview from **`v_allocation_costs`**, FTE via **`year-summary`**). EOTP distribution table: **EOTP · Label · Total · Actions**; INT/EXT/DIR, cash-out, comment on expand.

**EOTP routing card (`InvestmentDetailEotpRoutingSection`):** Card header = **EOTP routing** + main SAP EOTP **pill** (from the entity). **Main** bucket: read-only rows from **`GET /api/allocation-entities/[id]/eotp-main-from-view`** ( **`v_eotp_costs`**, `is_main_eotp`), table styling aligned with exception rows; expand shows INT/EXT/DIR detail. **Exception routing:** heading **Exception Routing** on the **same row** as **Edit routing** / **Cancel** (`justify-between`). Exception targets are chosen from **`eotp_definition`** only (**`/api/eotp-routing-target-options`**). Persisted via **`/api/allocation-entities/[id]/eotp-routing`**. Delete routing uses a **dialog** (not `window.confirm`). **Horizontal separator**, then **bottom row:** **Budget by initiative** | **Allocations** editor ( **`/api/allocations`**, **`/api/initiative-allocation-costs`** ) when an initiative is selected.

**Budget by initiative (`InvestmentDetailBudgetCard`):** Per-initiative cost columns (€k) **only** — revenue is edited in the separate **`InvestmentDetailRevenuePanel`**. Initiatives are **grouped by Jira initiative type** (`(RI) Type` / **`initiativeType`** on the initiative, exposed as **`initiative_type`** on budget rows from **`GET …/budget`**).

**Revenue (`InvestmentDetailRevenuePanel`):** Appears when an initiative is selected (below **Allocations**). **`GET /api/revenues`** lists rows; grouped by **Mission** / **Subscription** with badges and subtotals; **Edit revenues** — type **`Select`**, comment, amount (EUR), **Delete** with **Dialog**; draft rows at top with **Save** / **Discard**. Key‑figure strip **Revenues** / **Margin** uses **`total_revenue`** from **`GET …/budget`**.

**Resource allocations (`InvestmentDetailAllocationsPanel` / `InvestmentDetailAllocationEditor`):** **View** mode by default; **Edit allocations** enables inline editing and **Add allocation**. New rows are **drafts in client state only** until the user picks a resource: draft lines render **at the top of the table** (below the header row), with an empty resource combobox (no automatic selection). Choosing a resource triggers **`POST /api/allocations`** with that **`resourceId`**. **Discard** removes a draft; **Cancel** exits edit mode and clears all drafts; switching initiative or year clears drafts. Rows are grouped by resource type (**Internal / External / Direct**) with group subtotals; the cost column uses extra right inset so figures sit inboard; group label rows stay left-aligned with the table. **Delete** on a saved row uses the same **outline + `Trash2` icon** pattern as **Daily rates by year** on **`/resources`** (not a text **Delete** button).

### 7.2 Resources (`/resources`)

Master-detail: **left** searchable/filterable table (ID, name from Prénom+Nom, function, type); **right** stacked cards (**Details** + **Daily rates by year**) with the same **`PANEL_CARD_CLASS`** border/shadow as investments.

- **Details** — Edit/Save/Cancel; **`PATCH /api/resources/[id]`**; display name derived from first/last name (**`resourceFullNameFromParts`**). **Direction** is restricted to **CRPS** or **PDS** (or empty); legacy CSV values must be replaced in the UI before save.
- **Rates** — Edit rates mode: existing rows **auto-save** (debounced PATCH **`/api/rates/[id]`**); **Add rate** opens a draft row at the top (**Save** posts **`/api/resources/[id]/rates`**); **Delete** uses a **modal** (not `window.confirm`). Numbers are **right-aligned** in the table.

### 7.3 Reports hub (`/reports`)

Sidebar entry **Reports** links to sub-routes (budget rollups, EOTP lines, snapshot rollups, **comparison**, realized/revenue, etc.). Charts use **Recharts**; data comes from report APIs and SQL views (`v_allocation_costs`, baseline/snapshot/realized views). There is **no** external BI tool in the product.

### 7.4 Planning vs budget baseline — capture (`/budget-comparison`)

Management screen: **take snapshots** (name, year), **import baselines** (Excel), list/delete with **Dialog** confirmations. This screen **prepares** snapshot and baseline data; **interactive comparison** is on **`/reports/comparison`** (§7.5). Snapshot/baseline drilldowns use the views in §5.3.

### 7.5 Baseline vs planning comparison (`/reports/comparison`)

**Planning vs baseline** table: select **year**, **baseline**, and **planning source** — **current allocations (live)** or a saved **snapshot**. Optional filters: division, subdivision, team, owner (narrowed from loaded rows). KPIs and sortable columns include internal / external / direct / **cash out**, baseline amount, coverage, gap. **`GET /api/reports/comparison`**: without **`snapshotId`**, the API builds rows from **`computeAllocationBreakdownForYear`** + baseline join (**`comparison-live.ts`**); with **`snapshotId`**, it reads **`v_comparison`**. **Export Excel** writes an **Excel table** (exceljs): formatted EUR (`#,##0`), coverage **`0%`**, metadata rows for filters, totals row; download name **`Baseline-Planning_Comparison_{year}_{dd.MM.yyyy}.xlsx`**.

### 7.6 Realized-layer reports (`/reports/realized-costs`, `/reports/revenu`, `/reports/ar`, `/reports/ar-invoicing`)

In-app drilldowns over the realized layer (§5.5):

- **`/reports/realized-costs`** — INTERNAL labour (timesheet) + EXTERNAL/DIRECT (VIM) split by year/month/cost type and ownership hierarchy from `eotp_definition`.
- **`/reports/revenu`** — Realized revenue (`v_realized_revenue` + raw `revenue_entry` for AR-link drilldown). Surfaces step-1/step-2 resolution rates and unresolved warnings to flag missing **`sap_designation_mapping`** rows.
- **`/reports/ar`** — Salesforce AR coverage (`v_planned_revenue`) vs realized revenue gap.
- **`/reports/ar-invoicing`** — **AR invoicing follow-up.** For each AR contract, shows planned revenue (from `ar_entry`) vs invoiced (from `revenue_entry`) and the **delta**. Filters: **Year** (defaults to *All years*; options come from `meta.availableYears` — every year actually present in `ar_entry ∪ revenue_entry`), Division, Subdivision, Team, Product, Status, Mapped/Unmapped, Warnings only, client / master product / contract / counterpart-reference / signed-date range. Lines are grouped client-side by **`counterpart_reference`** (one card per AR contract) and within each card a **table of AR line items** (`sf_product_name`, `Description`, allocation entity, planned, invoiced, delta) drills down on click into the matching SAP `revenue_entry` rows (`sapDocType`, `sapInvoiceNr`, `sapInvoiceItem`, month/year, amount, designation, `extDocRef`, allocation entity). **Cross-year matching:** when `revenue_entry.ar_entry_id` is set (resolver step 1 / step 2 with mapped SF name), the join ignores the year — a 2025 AR contract correctly shows its 2023 SAP invoices. The legacy `(sap_so_number, sf_product_name)` heuristic fallback still requires `re.year = ar.year` to avoid spurious matches between unrelated years. SAP invoice rows whose `ext_doc_ref` matches an AR's `counterpart_reference` but no AR line item are surfaced as a synthetic **"Unmatched line items"** row per `(counterpart_reference, allocation_entity_id)` bucket, displayed with an amber background. Read by **`GET /api/reports/ar-invoicing`** (§6.2).

These are the product reporting surfaces for actuals (alongside planning reports in §7.3–§7.5).

### 7.7 Imports & realized-data mappings (`/imports`, `/imports/mappings`)

- **`/imports`** — operations console for the four realized-layer imports (timesheets, VIM, AR, SAP client revenue). Each card shows recent `*_import` headers with row counts and `import_warning` totals, an **Upload** button (multipart `file` + `year` for AR / revenue), per-import **Delete** with **Dialog** confirmation, and (for timesheets / AR) a **Re-resolve** action that runs the corresponding `/sync` endpoint after the user has edited mappings. The revenue card displays the full **4-step summary** (`step1` / `step2` / `step3` / `step4` / `warnCount`) returned by the import.
- **`/imports/mappings`** — single-page editor for the four managed mapping tables (§4.12). Layout: four `PANEL_CARD_CLASS` cards in a responsive grid:
  1. **SN — Programme → Investment** (`sn_programme_mapping`)
  2. **SN — Project → Initiative** (`sn_project_mapping`, optional Initiative FK)
  3. **Salesforce — Master Product → Investment** (`sf_master_product_mapping`)
  4. **SAP — Désignation poste → produit** (`sap_designation_mapping`) — backs **step 2** of the revenue resolver (§4.14); columns: **Désignation SAP**, **Produit SF (réf.)**, **Produit** (allocation entity), **Notes**, delete action

  Each card includes an inline "add new" form and an editable table with row-level delete (icon-only, outline button — same pattern as **Daily rates** on `/resources`). After saving a new mapping, the user can hit **Re-resolve** on `/imports` (or re-upload the source file) to clear the corresponding `import_warning` rows on already-imported entries.

### 7.8 Legacy routes

Older prototype paths (e.g. `/test/products`, `/api/products`, `/initiatives`) are **not** mapped — they 404 unless you add routes or redirects. Use **`/investments`**, **`/budget-comparison`**, **`/reports/*`**, **`/imports`**, **`/imports/mappings`**, and **`/api/allocation-entities`** (see §6.2).

---

## 8. Jira Sync

| | |
|---|---|
| Library | jira.js (Version3Client) — preferred over raw fetch calls |
| Auth method | Basic auth: email + API token (not password) |
| Source | Initiatives: JQL from `JIRA_JQL` (preferred) or saved filter `JIRA_FILTER_ID`. Products: JQL from `JIRA_PRODUCT_JQL` (default `issuetype = Product`). |
| Pagination | 100 results per page, loop with startAt until all fetched (~1,200 initiatives) |
| Strategy | Upsert — initiatives matched by initiative key (`RI-xxx`); allocation entities matched for Product sync by `jiraIssueId` → `jiraKey` → `name` |
| Allocation entity link | Initiative upsert sets `allocationEntityId` (DB `allocation_entity_id`) using the mapping priority below. **Important:** `AllocationEntity.name` must match Jira Initiative **component name** exactly (after trim) for auto prod update compatibility. |

Mapping priority (Initiative → AllocationEntity):

1. **Preferred**: exactly one Jira issue link where:
   - link has an `outwardIssue`
   - `outwardIssue.fields.issuetype.name === "Product"`
   - resolve the allocation entity by `AllocationEntity.jiraKey` **or** by `AllocationEntity.id` (Jira-created entities use `id = jiraKey`)
2. **Fallback**: no outward Product link → use the initiative’s first component name and match `AllocationEntity.name` (case-insensitive match as a fallback)
3. **Ambiguous**: multiple outward Product links → do not choose; log and persist mapping source as ambiguous

Product sync (Product → AllocationEntity):

- Products are synced **first** in the same `/api/jira/sync` call.
- Upsert / attach rule (in order):
  - match by `AllocationEntity.jiraIssueId` (most stable)
  - else match by `AllocationEntity.jiraKey`
  - else match by **exact** `AllocationEntity.name === Jira Product summary.trim()` (CSV-seeded rows before first sync attaches ids)
- If a Product is renamed in Jira, the sync updates `AllocationEntity.name` to the new summary **when possible** (if the new name is already taken by another row, it logs a warning and keeps the old name).
- If not found, create a new AllocationEntity with `id = jiraKey` (collision guard: `PRD-JIRA-${jiraKey}`), `name = summary.trim()`, and `source = "jira"`.
- CSV-seeded allocation entities set `source = "csv"` (see `seed-products.ts`).

Required environment variables:

```env
JIRA_HOST=https://your-company.atlassian.net
JIRA_EMAIL=your.email@company.be
JIRA_TOKEN=your_api_token_from_jira_profile
JIRA_FILTER_ID=12345

# Optional
# JIRA_JQL=project = RI AND status in (Done, "In Progress", RFP, "Selected for Development") ORDER BY component, summary ASC
# JIRA_PRODUCT_JQL=issuetype = Product
```

Jira custom fields:

- `year` and `initiativeType` are resolved by heuristics at runtime (the sync route loads Jira’s field catalog and tries common labels). Env overrides are available when needed (`JIRA_FIELD_YEAR`, `JIRA_FIELD_INITIATIVE_TYPE`, `JIRA_FIELD_INITIATIVE_TYPE_NAME`).

---

## 8.1 Jira updater script (create Products + link Initiatives)

Purpose:

- Create missing Jira **Product** issues from `scripts/datasets/dev/PRODUCTS.csv`
- Add **Enables** issue links from Jira **Initiatives** (scoped by `JIRA_JQL` / `JIRA_FILTER_ID`) to their Product
- **Safety**: defaults to dry-run and writes a timestamped plan under `scripts/jira/out/`

Script:

- `scripts/jira/update-jira-products-and-links.ts`

Environment variables:

- Auth: `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_TOKEN`
- Initiatives scope: `JIRA_JQL` (preferred) or `JIRA_FILTER_ID`
- Products scope (optional): `JIRA_PRODUCT_JQL` (default `issuetype = Product`)
- Custom-field overrides (optional): `JIRA_FIELD_PRODUCT_FAMILY`, `JIRA_FIELD_DIVISION`, `JIRA_FIELD_SUB_DIVISION`, `JIRA_FIELD_TEAM`, `JIRA_FIELD_SAP_PROG_FIN`, `JIRA_FIELD_ATTRACTIVENESS`, `JIRA_FIELD_COMPETITIVENESS`, `JIRA_FIELD_TYPE_PRODUCT`

Matching rules:

- **Products**: Jira Product `summary.trim()` exact match to CSV `name.trim()` to decide “already exists”
- **Initiative → Product mapping**: Initiative first component name (exact trim) → Product summary
- **Already-linked detection**: skips Initiatives that already have an **Enables** link to a Jira issue of issuetype `Product`

**Product create payloads:** for Jira fields configured as **select / multi-select**, the script loads allowed values from the Jira field metadata and maps CSV text to **option IDs** (normalized label match, with substring fallback); **`sapProgFin`** and similar fields send **`{ id }`** when a match exists. The dry-run plan includes human-readable **`fieldValues`** alongside API field payloads.

Progressive review workflow (3 → 10 → apply):

```bash
# Dry-run: plan product creates
npx tsx scripts/jira/update-jira-products-and-links.ts --step products --sample 3
npx tsx scripts/jira/update-jira-products-and-links.ts --step products --sample 10

# Dry-run: plan enables links
npx tsx scripts/jira/update-jira-products-and-links.ts --step links --sample 3
npx tsx scripts/jira/update-jira-products-and-links.ts --step links --sample 10

# Apply (only after review)
npx tsx scripts/jira/update-jira-products-and-links.ts --step all --sample all --apply
```

## 9. Seed Scripts

| Script | Command | Source Files | Purpose |
|---|---|---|---|
| `seed-dev.ts` | `npm run db:seed` (or `db:seed:dev`) | `scripts/datasets/dev/*.csv` | Dev/test seed dataset |
| `seed-products.ts` | `npm run db:seed:products` | `scripts/datasets/dev/PRODUCTS.csv` | Upsert **`AllocationEntity`** rows (table `allocation_entity`; SAP fields, scores, **`entity_type`**) |
| `seed-production.ts` | `npm run db:seed:prod` | `scripts/datasets/prod-import/*.csv` | Production import: resources, standards, rates, initiatives, allocations, **`v_allocation_costs`**, **`v_eotp_costs`**, **`v_snapshot_detail`**, **`v_baseline_detail`**, **`v_comparison`**, **`v_revenues`**, **`v_realized_costs`**, **`v_planned_revenue`**, **`v_realized_revenue`**, **`dim_eotp`**, seed **`dim_year`**; also calls `seedSapDesignationMappingIfPresent()` so the `sap_designation_mapping` CSV (when present) is upserted as part of a full seed |
| `seed-eotp-definitions.ts` | `npm run db:seed:eotp` | `scripts/datasets/dev/EOTP-Budget-Owner.csv` | Upsert **`eotp_definition`** (SAP code, label, org metadata) |
| `seed-eotp-routing.ts` | `npm run db:seed:routing` | `scripts/datasets/dev/EOTP_ROUTING.csv` | Upsert **`eotp_routing`** from CSV (`productName` → **`AllocationEntity.name`**, columns: internal / external / direct EUR); links **`eotp_definition_id`** when definitions exist |
| `seed-revenues.ts` | `npm run db:seed:revenues` | `scripts/datasets/dev/REVENU.csv` | Insert **`InitiativeRevenue`** (type = **`Mission`**) one row per CSV line; matched by Jira key in **Colonne1**; **delete-then-insert** per affected initiative |
| `seed-sn-programme-mapping.ts` | `npm run db:seed:sn-programmes` | `scripts/datasets/dev/SN_PROGRAMME_MAPPING.csv` | Bootstrap **`sn_programme_mapping`** (one-off, ongoing edits via `/imports/mappings`) |
| `seed-sn-project-mapping.ts` | `npm run db:seed:sn-projects` | `scripts/datasets/dev/SN_PROJECT_MAPPING.csv` | Bootstrap **`sn_project_mapping`** (one-off) |
| `seed-sf-master-product-mapping.ts` | `npm run db:seed:sf-master-products` | `scripts/datasets/dev/SF_MASTER_PRODUCT_MAPPING.csv` | Bootstrap **`sf_master_product_mapping`** (one-off) |
| `seed-sap-designation-mapping.ts` | `npm run db:seed:sap-designations` | `scripts/datasets/dev/SAP_DESIGNATION_MAPPING.csv` | Bootstrap **`sap_designation_mapping`** (one-off); validates `allocation_entity_id` against the catalog and skips invalid / blank rows |
| `build-sap-designation-mapping-csv.ts` | `npm run db:build:sap-designation-mapping-csv` | `revenue_entry` warnings + `PRODUCTS.csv` + **`scripts/data/sf-product-names.ts`** | Writes **`scripts/datasets/dev/SAP_DESIGNATION_MAPPING.csv`** (union of DB warnings, fallback list, and existing CSV keys) with **`sf_product_name`** from **fuzzy** match to the canonical SF catalogue (tiered confidence). Writes **`scripts/datasets/dev/SAP_DESIGNATION_FUZZY_REPORT.md`** (per-row score, runner-up, tier). Overrides in the script still win for `allocation_entity_id` / explicit `sf_product_name`. |
| `build-sf-master-product-mapping-suggestions.ts` | (manual `tsx`) | `ar_entry` warnings + `PRODUCTS.csv` | Same idea as above for the AR side — proposes Salesforce master product mappings from unresolved AR rows |
| `xlsx-to-prod-data-auto.ts` | `tsx scripts/xlsx-to-prod-data-auto.ts --input "<xlsx>" --outDir scripts/datasets/prod-import` | Excel workbook | Generate `Assignement.csv`, `RESSOURCES.csv`, `RATES.csv`, `REVENU.csv` into **`scripts/datasets/prod-import/`**; also copies **`EOTP_ROUTING.csv`** from the script’s reference dataset directory when present so prod reset can seed routing |
| `backfill-eotp-routing-eotp-definition-ids.ts` | `npm run db:backfill:eotp-routing-fks` | — | One-off: set **`eotp_definition_id`** on existing **`eotp_routing`** / **`allocation_entity`** rows from code ± label |
| `convert-eotp-routing-csv.ts` | `npm run db:convert:eotp-csv` | (optional path) | One-off: convert **legacy** routing CSV (cost type + percent/amount) → new three-column format (needs DB + **`v_allocation_costs`** for percent→EUR) |
| `rebuild-eotp-routing-csv.ts` | `npm run db:rebuild:routing-csv` | `EOTP_ROUTING_SOURCE.csv` | Rebuild **`EOTP_ROUTING.csv`** from wide export (outputs merged EUR columns) |

**Order for a full prod load:** run **`npm run db:migrate`** (same as **`npx prisma migrate deploy`**) or **`npx prisma migrate dev`** locally, then **`db:seed:products`** (or ensure `PRODUCTS.csv` is present so the prod seed can upsert allocation entities), then **`db:seed:prod`**. The prod script upserts catalog rows from `PRODUCTS.csv` when that file exists. **EOTP routing CSV** is optional: run **`db:seed:routing`** when `EOTP_ROUTING.csv` is ready.

### 9.0 Production import dataset (`scripts/datasets/prod-import`)

The production import workflow uses a single directory:

- **Location**: `scripts/datasets/prod-import/`
- **Generated by**: `scripts/xlsx-to-prod-data-auto.ts` (and the in-app endpoint)
- **Imported by**: `scripts/seed-production.ts`

Override for CSV lookups in `seed-production.ts`:

1. `SEED_DATASET_DIR` (if provided)
2. `scripts/datasets/prod-import/`

### 9.1 Production Seed — Run Modes

```bash
# Full reload: clears planner tables (allocations, rates, initiatives, resources — NOT the `allocation_entity` table), then import
SEED_PROD_RESET=1 npm run db:seed:prod

# Upsert only (leave existing rows not touched by CSV logic)
npm run db:seed:prod

# Recreate reporting views only — no CSV import (`v_allocation_costs`, `v_eotp_costs`, `v_revenues`, snapshot/baseline views, realized-layer views, `dim_eotp`, seed `dim_year`)
SEED_VIEW_ONLY=1 npm run db:seed:prod

# Recreate only v_eotp_costs (requires v_allocation_costs)
npm run db:recreate:eotp-costs
```

### 9.2 Production Seed Notes

- **Files** — `JIRA.csv`, `RESSOURCES.csv`, `RateStandard.csv`, `RATES.csv`, `Assignement.csv`; optional **`PRODUCTS.csv`** for allocation-entity master data (table `allocation_entity`). `RateStandard.csv` can be omitted if a standard file is bundled next to the script (`resolveRateStandardPath` fallback).
- **EOTP definition reset** — `SEED_PROD_RESET=1 npm run db:seed:eotp` clears `eotp_definition` (and nulls optional FKs) before re-importing from `EOTP-Budget-Owner.csv`.
- **Drop order / idempotency** — some views depend on others. Seed scripts use `DROP VIEW ... CASCADE` when necessary (e.g. `v_allocation_costs`, snapshot/baseline views) so repeated runs work even if reporting views were already created.
- **`v_comparison`** — created as part of the views pipeline; used by `/reports/comparison` (snapshot vs baseline gap drilldown).
- **ID-based linking** — `InitiativeId` (RI-xxx), `RessourceId` (MAT-xxx), etc.
- **Duplicate assignment rows** — CSV can list the same resource×initiative twice (e.g. % line + man-days line). The seed **merges** into one DB row: **percent values are summed**; **man-days** — **first line with a positive man-days value wins** (CSV order), not the sum. This matches business rules for split Excel exports.
- **Allocation IDs** — Deterministic `ASS-{hash(resourceId|initiativeId)}` after merge (one row per pair).
- **Number format** — Swiss apostrophe thousands separator (`1'100`) stripped before parsing.
- **Percent & ManDays** — Trailing `%`; values divided by 100 for storage (`34%` → `0.34` FTE decimal; large “%” man-days columns → man-days).
- **Rate row IDs** — Deterministic `RATE-{resourceId}-{year}` (CSV `RateId` not trusted as unique).
- **RESSOURCES blank rows** — Rows without an ID are skipped.
- **RESSOURCES encoding** — File is **UTF-8 with BOM**. **`seed-production.ts`** reads **`RESSOURCES.csv`** as **`utf8`** (not `latin1`) so headers **`Nom` / `Prénom`** parse correctly.
- **JIRA encoding** — Generated `scripts/datasets/prod-import/JIRA.csv` is **UTF-8**, and `seed-production.ts` reads it as **`utf8`** to preserve accents (é, à, …).
- **`SEED_PROD_RESET`** — Truncates allocation/rate/initiative/resource (and related) and clears **`eotp_routing`**, but **does not** delete rows in **`allocation_entity`** — allocation-entity catalog survives full reloads.
- **Views** — `createCostView()` defines `v_allocation_costs`; **`createEotpCostsView()`** (shared with `scripts/eotp-views.ts`) defines **`v_eotp_costs`**. **`v_eotp_routing` is not used** (removed). Migrations that alter columns depended on by views may need **`DROP VIEW IF EXISTS …`** before column changes — `createCostView()` already drops dependent EOTP views before recreating `v_allocation_costs`.

**Manual truncate (rare)** — If you need a clean slate including the allocation-entity catalog, truncate `allocation_entity` explicitly or use SQL; default reset keeps those rows.

### 9.3 In-app “Admin” buttons (generate + seed)

The header includes operational buttons used during the Excel → CSV → DB refresh workflow:

- **Generate CSVs**: calls `POST /api/admin/prod-data-auto/generate`
  - Requires `PROD_IMPORT_XLSX_PATH` (no hardcoded fallback)
  - Runs `tsx scripts/xlsx-to-prod-data-auto.ts --input "$PROD_IMPORT_XLSX_PATH" --outDir scripts/datasets/prod-import`
- **Generate + re-seed** (danger): calls `POST /api/admin/db/seed-prod-reset`
  - Requires `PROD_IMPORT_XLSX_PATH`
  - Runs CSV generation first, then `SEED_PROD_RESET=1 tsx scripts/seed-production.ts` with `SEED_STRICT_DATASET=1`
  - Guarded by env var: **`ALLOW_ADMIN_SEED=1`** (returns 403 otherwise)
  - UI shows a confirmation dialog warning that planner data will be deleted before re-import.

---

## 10. Local Development Setup

| | |
|---|---|
| OS | Windows 11 with WSL2 (Ubuntu) |
| Node | v20.20.2 installed via nvm inside WSL |
| Database | PostgreSQL 16 in Docker (WSL2 backend), container: `resource-planner-db` |
| Editor | Cursor — opened from WSL terminal: `cursor .` |
| DB Explorer | Prisma Studio: `npx prisma studio` → localhost:5555 |
| Project path | `~/projects/resource-planner` (inside WSL filesystem, not `/mnt/c/`) |

### 10.1 Daily Startup

```bash
# 1. Launch Docker Desktop from Windows (system tray or Start menu)
# 2. Open WSL terminal: Win+R → wsl
docker start resource-planner-db   # skip if restart:always is set
cd ~/projects/resource-planner
nvm use   # uses .nvmrc (Node >=20.19 required by Prisma/tooling)
npm run db:migrate   # after pulling schema/migration changes (alias for prisma migrate deploy)
cursor .   # optional
npm run dev   # → http://localhost:3000
```

**Tests** require a running DB:

```bash
npm test
```

**Layer 2 (API) tests** require a running dev server against the same DB:

```bash
# Terminal 1
DATABASE_URL=postgresql://... npm run dev

# Terminal 2
npm run test:api
```

**Layer 3 (UI) smoke tests** use Playwright against that same running dev server:

```bash
# Terminal 2
npm run test:ui
```

On a fresh clone or after schema updates, run **`npm run db:migrate`** (production-like) or **`npx prisma migrate dev`** (local dev, applies pending migrations and regenerates the client) before **`npm run dev`**.

**Prisma client:** `src/generated/prisma` is **gitignored** — **`npm install`** runs **`prisma generate`** via **`postinstall`**. After schema changes, run **`npx prisma generate`** if needed. If **`next dev`** errors with table **`public.product`** (or other stale names) while the schema uses **`allocation_entity`**, delete **`.next`** and restart the dev server so Turbopack picks up the regenerated client.

### 10.2 Make Postgres Survive Reboots

```bash
docker update --restart always resource-planner-db
```

Combined with Docker Desktop set to start on Windows login, this means no manual DB startup ever needed.

### 10.3 Environment Variables (.env)

```env
DATABASE_URL=postgresql://admin:admin@localhost:5432/resource_planner?schema=public
```

### 10.4 Docker and OpenShift packaging

- **`Dockerfile`** — multi-stage image: **`npm ci`** → **`next build`** (standalone) → runtime **`node server.js`**. Listens on **`PORT`** (default **8080**). Runs as **`uid 1001`** (non-root).
- **`compose.yaml`** — local **Postgres 16** (`resource-planner-db`); optional **`app`** service via profile **`app`** (`npm run docker:up`) builds the image without a registry.
- **`GET /api/health`** — lightweight probe (no DB call).
- **`deploy/README.md`** — runbook: local tag, compose, registry workflow, OpenShift probes.
- **`deploy/kubernetes/`** — sample **Deployment** + **Service** + secret template.

**Runtime `DATABASE_URL` in containers**

- Do not use **`127.0.0.1`** as the DB host from inside an app container unless Postgres runs in that same network namespace. Prefer the **Postgres container name** (e.g. `resource-planner-db`) on a **shared user-defined network** (e.g. `rp`), or `host.docker.internal` where supported.
- **`src/lib/prisma.ts`** reads **`process.env["DATABASE_URL"]`** (bracket form) so Next.js does not bake a build-time URL into the server bundle.
- **`Dockerfile`** sets a **dummy** `DATABASE_URL` only for **`prisma generate`** and **`npm run build`** (API routes import Prisma at build time). The **runtime** image has no DB URL; pass **` -e DATABASE_URL=...`** on `docker run` / Kubernetes Secret.
- **`/investments`** uses **`dynamic = "force-dynamic"`** so the investments list is not statically generated against a DB during `next build`.

**Updating the image after code changes** — run **`docker build -t resource-planner:local .`** (or **`npm run docker:build`**) and restart the container; env-only changes need a restart, not necessarily a rebuild.

---

## 11. Gaps, open items & next steps

Product open questions: [`PRD.md` §12](./PRD.md#12-open-questions-and-risks). Stack-specific notes below.

### Gaps vs PRD (code to change)

1. **Lock investment catalog APIs** — Remove or restrict `PATCH`/`DELETE` on `/api/allocation-entities/[id]` so catalog fields cannot be edited outside Jira sync (UI is already read-only).
2. **IdP auth (F36)** — No login today; required before production.
3. **Admin gate (F37)** — Protect seed/generate admin routes.
4. **F22 / F38** — Editable snapshot-baseline and resource Excel I/O exist on Java only (Should in PRD).

### Still to confirm / finish

- **Jira custom field IDs** for year, initiative type, Product org/SAP/score fields on the target Cloud instance.
- **Working days** 200 / 220 / 1.0 — business confirmation (PRD R5).
- **Deploy** — Image and `deploy/kubernetes` samples exist; wire registry / OpenShift with DevOps.

### Prioritised next steps

1. Catalog API lockdown + IdP/admin hardening  
2. Finish Jira field mapping against a real instance  
3. Validate Recharts reports vs cost views locally  
4. Production push with DevOps  

### History

Detailed feature changelog previously lived in this section (v1.2–v1.13). Prefer **`git log`** for history; current documented baseline is **v1.13** (realized layer + AR invoicing report).

---

## 12. Project File Structure

```
src/
  app/
    layout.tsx                  ← Root layout (nav sidebar, header)
    page.tsx                    ← Redirect to /investments
    budget-comparison/page.tsx  ← Snapshots + baseline import (data prep for in-app comparison)
    reports/comparison/page.tsx ← Baseline vs planning (live or snapshot), Excel export
    investments/page.tsx        ← Investment list + budget columns
    investments/[id]/page.tsx   ← Investment detail shell
    investments/[id]/InvestmentDetailClient.tsx ← Layout: Details | Budget Summary, separator, initiatives | allocations
    investments/[id]/InvestmentDetailAllocationsPanel.tsx ← Initiative allocations table (view/edit, drafts, groups)
    investments/[id]/InvestmentDetailAllocationEditor.tsx ← One allocation row (auto-save, delete)
    investments/[id]/InvestmentDetailAllocationPendingRow.tsx ← Draft row before POST (resource combobox)
    investments/[id]/use-investment-initiative-allocations.ts ← Initiative selection, allocations, pending drafts
    investments/[id]/InvestmentDetailEotpRoutingSection.tsx ← EOTP card: main from view + exception routing
    investments/[id]/InvestmentDetailBudgetKeyFigures.tsx ← Budget overview / key figures strip
    resources/page.tsx          ← Resources screen (in progress)
    api/
      jira/sync/route.ts        ← Jira sync
      allocations/route.ts      ← GET by initiative; POST requires resourceId + initiativeId
      allocations/[id]/route.ts ← PATCH, DELETE (includes resource.type on PATCH response)
      resources/route.ts        ← GET — resource picker list (+ type)
      initiative-allocation-costs/route.ts ← Per-allocation costs for an initiative
      allocation-entities/route.ts ← GET — list allocation entities
      allocation-entities/[id]/route.ts ← GET, PATCH, DELETE
      allocation-entities/with-budget/route.ts ← Per-entity INT/EXT/DIR from v_allocation_costs
      allocation-entities/[id]/budget/route.ts ← Per-initiative costs + eotpBreakdown
      allocation-entities/[id]/eotp-routing/route.ts ← GET, POST — EotpRouting rows
      allocation-entities/[id]/eotp-routing/[routingId]/route.ts ← PATCH, DELETE
      allocation-entities/[id]/eotp-main-from-view/route.ts ← GET — main rows from v_eotp_costs
      allocation-entities/[id]/year-summary/route.ts ← GET — totalCost + totalFte for entity × year
      eotp-routing-target-options/route.ts ← GET — EOTP targets from eotp_definition only
      resources/[id]/route.ts   ← GET, PATCH, DELETE
      rates/route.ts            ← GET by resource, POST
      rates/[id]/route.ts       ← PATCH, DELETE
      snapshots/route.ts        ← GET, POST allocation snapshots
      snapshots/[id]/route.ts   ← DELETE snapshot
      baselines/route.ts        ← GET, POST baseline (multipart Excel)
      baselines/[id]/route.ts   ← DELETE baseline
      reports/comparison/route.ts ← GET — planning vs baseline (omit snapshotId = live)
      health/route.ts           ← GET — liveness/readiness (no DB)
      imports/timesheets/route.ts ← GET, POST — SN timesheet imports
      imports/timesheets/[id]/route.ts ← DELETE
      imports/timesheets/sync/route.ts ← POST — re-resolve unmapped rows
      imports/invoices/route.ts ← GET, POST — SAP VIM imports
      imports/invoices/[id]/route.ts ← DELETE
      imports/ar/route.ts       ← GET, POST — Salesforce AR imports
      imports/ar/[id]/route.ts  ← DELETE
      imports/ar/sync/route.ts  ← POST — re-resolve unmapped rows
      imports/revenue/route.ts  ← POST — SAP client revenue (4-step resolver, returns step counts)
      imports/revenue/[id]/route.ts ← DELETE
      imports/config/route.ts   ← GET — UI defaults (current import year)
      mappings/sn-programmes/route.ts ← GET, POST
      mappings/sn-programmes/[id]/route.ts ← PATCH, DELETE
      mappings/sn-projects/route.ts ← GET, POST
      mappings/sn-projects/[id]/route.ts ← PATCH, DELETE
      mappings/sf-products/route.ts ← GET, POST
      mappings/sf-products/[id]/route.ts ← PATCH, DELETE
      mappings/sap-designations/route.ts ← GET, POST
      mappings/sap-designations/[id]/route.ts ← DELETE
    imports/page.tsx            ← Imports console (timesheets, VIM, AR, revenue)
    imports/imports-home-client.tsx ← Cards + upload + delete + per-import summaries
    imports/mappings/page.tsx   ← Realized-data mapping tables
    imports/mappings/imports-mappings-client.tsx ← 4 cards: SN programme/project, SF master product, SAP designation
  generated/prisma/             ← Auto-generated Prisma client (do not edit)
  lib/prisma.ts                 ← Prisma singleton with PrismaPg adapter
  lib/auth.ts                   ← getUserFromRequest (X-Auth-Request-Email)
  lib/snapshot.ts               ← computeAllocationBreakdownForYear, takeSnapshot (frozen EOTP breakdown)
  lib/comparison-live.ts        ← Live planning vs baseline rows (no snapshot)
  lib/export-comparison-xlsx.ts ← Excel table export for comparison report (exceljs)
  lib/baseline-parser.ts        ← SAP baseline Excel parse
  lib/eotp.ts                   ← computeEotpBreakdown (budget / reporting)
  lib/eotp-routing-validation.ts ← reject routing target = main SAP EOTP
  lib/eotp-definition-resolve.ts ← resolve / pick EotpDefinition for APIs and seeds
  lib/eotp-routing-target-options-query.ts ← load definition rows for target picker
  lib/eotp-target-options.ts    ← build JSON options; exclude main SAP code
  lib/investment-year-summary.ts ← helpers for year-summary / budget UI
  lib/sap-revenue-parser.ts     ← SAP_Clients_Invoices.csv parser (ZCS/ZCR sign, Excel-serial date fallback)
  lib/sap-vim-parser.ts         ← SAP VIM supplier-invoice parser (cost_type from Compte budgét.)
  lib/sn-timesheet-parser.ts    ← SN_Time_Card_Export parser (filters: category/state)
  lib/salesforce-ar-parser.ts   ← Salesforce AR export parser (outer-quoted CSV)
  lib/revenue-import-resolve.ts ← 4-step resolver for revenue_entry (AR match → designation map → EOTP → null)
prisma.config.ts                ← Prisma 7 config (project root; datasource URL for CLI)
next.config.ts                  ← Next.js config (`output: "standalone"` for Docker)
Dockerfile                      ← Multi-stage production image (Next standalone + non-root)
compose.yaml                    ← Local Postgres; optional `app` profile (no registry)
.dockerignore                   ← Docker build context exclusions
deploy/
  README.md                     ← Docker / K8s / OpenShift runbook
  kubernetes/                   ← Sample Deployment, Service, Secret template
prisma/
  schema.prisma                 ← Database schema (source of truth)
  migrations/                   ← Baseline + incremental (e.g. eotp_definition catalog)
scripts/
  seed-dev.ts                   ← Dev/test seed dataset
  seed-products.ts              ← Upsert AllocationEntity rows from PRODUCTS.csv (table `allocation_entity`)
  seed-production.ts            ← Prod seed + v_allocation_costs + v_eotp_costs + snapshot/baseline views + dim_eotp + dim_year seed
  eotp-views.ts                 ← Shared CREATE VIEW for v_eotp_costs
  seed-eotp-definitions.ts      ← Seed eotp_definition from EOTP-Budget-Owner.csv
  seed-eotp-routing.ts          ← Seed eotp_routing from EOTP_ROUTING.csv
  seed-sn-programme-mapping.ts  ← Bootstrap sn_programme_mapping from CSV
  seed-sn-project-mapping.ts    ← Bootstrap sn_project_mapping from CSV
  seed-sf-master-product-mapping.ts ← Bootstrap sf_master_product_mapping from CSV
  seed-sap-designation-mapping.ts ← Bootstrap sap_designation_mapping (validates allocation_entity_id)
  build-sap-designation-mapping-csv.ts ← Generate SAP_DESIGNATION_MAPPING.csv + SAP_DESIGNATION_FUZZY_REPORT.md (fuzzy SF names from scripts/data/sf-product-names.ts)
  build-sf-master-product-mapping-suggestions.ts ← Same idea for AR side (Salesforce master products)
  realized-views.ts             ← Shared CREATE OR REPLACE for v_realized_costs, v_planned_revenue, v_realized_revenue
  backfill-eotp-routing-eotp-definition-ids.ts ← Backfill eotp_definition_id FKs
  convert-eotp-routing-csv.ts   ← Legacy CSV → three-column EUR format
  rebuild-eotp-routing-csv.ts   ← Rebuild EOTP_ROUTING.csv from source export
  recreate-eotp-costs-view.ts    ← Recreate v_eotp_costs only
  datasets/dev/                 ← Dev/test CSV dataset (incl. mapping bootstraps: SN_*, SF_MASTER_*, SAP_DESIGNATION_MAPPING.csv)
  datasets/prod-import/         ← Production import dataset (generated from Excel)
```

---

*Last updated: 2026-10-28 — Node technical design aligned with PRD v0.1 (v1.13 feature baseline)*
