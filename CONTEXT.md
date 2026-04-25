# Resource Planner — Application Design Document

**Paradigm · Brussels Capital Region · v1.9 · April 2026**

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Core Business Logic](#2-core-business-logic)
3. [Technology Stack](#3-technology-stack)
4. [Database Schema](#4-database-schema)
5. [Power BI Cost View](#5-power-bi-cost-view-v_allocation_costs) (includes §5.3 planning vs baseline views, §5.4 `v_revenues`)
6. [Application Architecture](#6-application-architecture)
7. [Application Screens](#7-application-screens)
8. [Jira Sync](#8-jira-sync)
9. [Seed Scripts](#9-seed-scripts)
10. [Local Development Setup](#10-local-development-setup)
11. [Open Questions & Next Steps](#11-open-questions--next-steps)
12. [Project File Structure](#12-project-file-structure)

---

## 1. Purpose & Scope

This document captures all design decisions, architecture choices, trade-offs and open questions for the Resource Planner internal tool. It serves as a handoff document between development sessions and as a reference for any developer picking up the project.

The application manages resource allocations against a portfolio of Jira initiatives for the Brussels Capital Region (Paradigm). It replaces a set of Excel workbooks and exposes the underlying data to Power BI for reporting.

---

## 2. Core Business Logic

> Understanding this section is essential before touching any code. The cost model is the heart of the application.

### 2.1 The Three Resource Types

Every resource belongs to one of three types, which determines how cost is calculated:

- **INTERNAL** — Named employees of the organisation. Allocated by % FTE or man-days. Cost calculated against an internal daily rate (EUR/day) × working days.
- **EXTERNAL** — Named consultants or external roles. Same allocation and cost logic as Internal, but with external daily rates which are typically higher.
- **DIRECT_COST** — Non-human costs: software licences, hosting fees, event costs, framework contracts, etc. Allocated by quantity (units). Cost = unit rate × quantity assigned.

### 2.2 Two Ways to Assign a Resource to an Initiative

When assigning an Internal or External resource to an initiative, the planner chooses one of two methods. Direct Costs always use quantity.

#### Method A — Percentage of FTE

The planner enters what fraction of the person's working capacity is dedicated to this initiative, expressed as a decimal (e.g. 0.5 = 50%, 1.2 = 120% meaning overtime or shared between two people counted as one).

Stored in the `quantity` field. The man-days equivalent is derived automatically:

```
Man Days = quantity × nbrDaysPerYear
Example: 0.5 FTE × 200 days/year = 100 man-days
```

#### Method B — Man Days

The planner enters a fixed number of working days directly. Useful for fixed-scope deliverables or external contractors billed by the day.

Stored in the `manDays` field. The FTE % equivalent is derived automatically:

```
FTE % = manDays / nbrDaysPerYear × 100
Example: 60 man-days / 200 days/year = 30% FTE
```

> **Important:** the two fields are mutually exclusive in practice. If `manDays > 0`, it takes precedence over `quantity` for cost calculation. Only 2 rows in the entire historical dataset use both simultaneously.

### 2.3 Days Per Year — nbrDaysPerYear

This value converts between FTE % and man-days. **`rate.nbrDaysPerYear` is required** (non-null): each individual **`Rate`** row stores the working days (or unit multiplier for direct costs) for that resource×year. **`v_allocation_costs` uses only this column** for FTE/man-day math — **no** `COALESCE` to `rate_standard.nbrDaysPerYear`.

Typical values when entering data: **200** internal staff, **220** external, **1.0** direct-cost unit model. **`RateStandard`** still carries 200/220 for **daily rate** fallbacks and documentation; it is **not** used as a days fallback in the cost view.

### 2.4 Rate Resolution — Always by Initiative Year

A critical design decision: rates are always resolved using the `year` field of the **initiative**, not the current calendar year. This guarantees historical consistency — a 2023 initiative always uses 2023 rates even when consulted in 2026.

The resolution order is:

1. Look for an individual `Rate` row matching `(resourceId, initiative.year)`. If found, use its `dailyRate`.
2. If no individual rate exists, fall back to the `RateStandard` row matching `(type, initiative.year)`.
3. Direct Cost resources always have an individual Rate. There is no standard fallback for `DIRECT_COST`.

### 2.5 Cost Calculation Formula

Cost is never stored in the database — always computed on read. The `v_allocation_costs` view handles this for Power BI.

| Resource Type | Condition | Formula |
|---|---|---|
| DIRECT_COST | Always | `quantity × Rate.dailyRate` |
| INTERNAL / EXTERNAL | Man-days billing | `manDays × effective_rate` |
| INTERNAL / EXTERNAL | FTE billing | `quantity × nbrDaysPerYear × effective_rate` |

Where `effective_rate` = individual `Rate.dailyRate` if exists, else `RateStandard.dailyRate` for `(type, initiative.year)`.

The cost is then split into three non-overlapping columns in the view: `internal_cost`, `external_cost`, `direct_cost`. Their sum always equals `computed_cost`.

### 2.6 Calculated Man Days in the Power BI View

The view exposes a unified `calculated_man_days` column for capacity-style reporting:

- **INTERNAL / EXTERNAL** — If `manDays` > 0: raw man-days. If FTE (`quantity` > 0): `quantity × Rate.nbrDaysPerYear` (from the joined rate row only).
- **DIRECT_COST** — Man-days path uses `manDays` directly. Quantity path uses `quantity × Rate.nbrDaysPerYear` (typically **1.0** for licences). If there is **no** matching `rate` row for `(resource, initiative year)`, view columns that depend on `rt.*` are null — data should always include a rate row with **`nbrDaysPerYear` set**.

So `SUM(calculated_man_days)` is comparable across assignment methods for staff; direct-cost quantity and cost use the same per-unit multiplier as in `computed_cost` (cost still needs a `Rate.dailyRate` for a non-zero EUR amount).

### 2.7 FTE % in the Power BI View

For **INTERNAL** and **EXTERNAL** only (`fte_decimal` / `fte_percent` are 0 for **DIRECT_COST**):

| Entry method | `fte_decimal` (0–1) | `fte_percent` |
|---|---|---|
| **FTE / %** (`quantity` > 0, man-days not used) | `quantity` | `quantity × 100` |
| **Man-days** (`manDays` > 0) | `manDays ÷ effective_days_per_year` (same `nbrDaysPerYear` resolution as costing) | implied FTE × 100 |

If **both** are present (rare), **man-days** take precedence for FTE so the same row can be summed in `SUM(fte_decimal)` with FTE-only rows. Missing rate days → `COALESCE` to 0 to avoid NULLs in DirectQuery.

### 2.8 Power BI Compatibility Notes

- `product_group` values containing `&` (e.g. `CLOUD & SECURITY`) break Power BI's query folding. The view uses `REPLACE(i."productGroup", '&', 'and')` to sanitise this.
- NULL values in slicer fields also break DirectQuery button slicers. The view uses `COALESCE(..., 'Unassigned')` on `product_group`.
- The `::` cast syntax is avoided in the view — `CAST(... AS float)` is used instead for ODBC compatibility.
- `<>` is used instead of `!=` for the same reason.
- **Enum columns must always be cast to `VARCHAR` in any view exposed to Power BI.** PostgreSQL enum types are not foldable by the ODBC driver. Apply `CAST(col AS VARCHAR)` to every enum column in every Power BI-facing view.

### 2.9 EOTP exception routing (summary)

Financial initiative costs (INT / EXT / DIR) for a product can be **split across SAP EOTP codes** for a given year. The **`eotp_routing`** table holds **exceptions only**: each row fixes how many **EUR** go to a **target EOTP** for each of the three buckets. Anything not explicitly routed remains on **`Product.sapEotpCode`**. There are **no percentage fields** in the current model — amounts are EUR. Routing targets and labels are backed by the **`eotp_definition`** catalog (**§4.7**); exception rows: **§4.8**. Power BI rollups: **§5.2**.

---

## 3. Technology Stack

### 3.1 Chosen Stack

| Component | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, TypeScript, Tailwind CSS) |
| UI Components | shadcn/ui + cmdk (combobox search) |
| ORM | Prisma 7 with @prisma/adapter-pg (PostgreSQL adapter) |
| Database | PostgreSQL — company-hosted cluster (dev: Docker local) |
| Reporting | Power BI Desktop connected directly to PostgreSQL view |
| Jira Sync | jira.js (Version3Client) — official TypeScript Jira client |
| Salesforce (optional) | jsforce — used for describing / integrating custom objects |
| IDE | Cursor (AI-assisted) running against WSL2 on Windows |
| Runtime | Node.js 20 inside WSL2 (Ubuntu) |

### 3.2 Key Decisions & Rationale

- **Next.js fullstack** — Single project, API routes replace a dedicated backend. Developer has PHP/Java expertise but wanted to avoid writing a traditional backend for a simple internal tool.
- **Prisma over Supabase** — Company already runs a PostgreSQL cluster. Supabase's managed layer was unnecessary overhead. Prisma gives type-safe queries and a raw SQL escape hatch.
- **Power BI retained** — Developer already has complete reports built on the Excel structure. A PostgreSQL view (`v_allocation_costs`) feeds Power BI directly — zero rework on existing reports.
- **jira.js over raw fetch** — Official TypeScript-first Jira client with proper types, built-in pagination helpers, Jira Cloud/Server support. Eliminates manual base64 auth and response parsing.
- **Docker for local Postgres** — One command spins up PostgreSQL 16. Switching to company cluster = one line in `.env`. Set to `restart:always` so it survives machine reboots.

### 3.3 Prisma 7 Breaking Changes

Prisma 7 introduced significant breaking changes from v6. Key adaptations:

- **datasource url** — Removed from `schema.prisma`. URL now lives only in `prisma.config.ts` (for CLI) and passed via PrismaPg adapter at runtime.
- **PrismaClient constructor** — Requires a driver adapter: `new PrismaClient({ adapter })` where `adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })`.
- **Generator** — Changed from `prisma-client-js` to `prisma-client` with explicit output: `src/generated/prisma`.
- **Seed script** — Uses `tsx` instead of `ts-node` due to ESM/CommonJS conflicts with the generated client.
- **Auto-seeding removed** — Must run `npm run db:seed` explicitly after migrations.

---

## 4. Database Schema

Core Prisma models on the planner side: Resource, Rate, RateStandard, **AllocationEntity**, Initiative, Allocation, **InitiativeRevenue**, **EotpDefinition**, **EotpRouting**; plus **AllocationSnapshot** / **AllocationSnapshotRow** (frozen EOTP breakdowns), **BudgetBaseline** / **BudgetBaselineRow** (SAP Excel import), and **DimYear** (Power BI year bridge). Read-only Prisma **views**: **`VAllocationEntityCostTotals`**, **`DimEotp`** (`dim_eotp` — distinct EOTP codes from snapshot and baseline rows). PostgreSQL views **`v_allocation_costs`**, **`v_eotp_costs`**, **`v_revenues`**, **`v_snapshot_detail`**, **`v_baseline_detail`** are created by **`scripts/seed-production.ts`** (`SEED_VIEW_ONLY=1 npm run db:seed:prod`). All IDs are preserved from the source systems (PowerApps/Jira) where applicable. Live allocation cost is never stored — computed at query time; **snapshots** store frozen EUR amounts at capture time. **InitiativeRevenue** stores **multiple** revenue lines per initiative (**`RevenueType`**: Mission \| Subscription). **EotpRouting** stores explicit EUR splits (exception rows only); optional FKs to **`eotp_definition`** link catalog rows for the main investment line and for each exception target.

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
| `initiativeType` | String? | | Run, Evolution, Rollout, Projet, Analyse, etc. |
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

PostgreSQL table **`eotp_definition`**. Canonical SAP EOTP lines used by the app for **labels**, **org metadata** (division, team, budget owner, …), and optional FK links from **`allocation_entity`** and **`eotp_routing`**. Seeded from **`scripts/datasets/dev/EOTP-Budget-Owner.csv`** via **`npm run db:seed:eotp`** (`scripts/seed-eotp-definitions.ts`). **Unique** on **`(sapEotpCode, label)`** — the same SAP code may appear more than once with different labels.
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

**Power BI:** use view **`v_eotp_costs`** (see §5.2) for rolled-up main vs split EOTP costs. There is **no** `v_eotp_routing` view — raw rows are the **`eotp_routing`** table or the REST APIs under `/api/allocation-entities/[id]/eotp-routing`.

### 4.9 Planning snapshots & budget baselines

| Piece | Role |
|---|---|
| **`allocation_snapshot` / `allocation_snapshot_row`** | Named, immutable **allocation snapshot**: at capture time the app aggregates **`v_allocation_costs`** by `product_name` × `initiative_year`, runs **`computeEotpBreakdown`** (same logic as budget API) per **AllocationEntity** with **`sapEotpCode`** and year-scoped **`eotp_routing`**, and persists per–EOTP INT/EXT/DIR. **User identity** for `takenBy` / `importedBy`: header **`X-Auth-Request-Email`** via **`getUserFromRequest`** (`src/lib/auth.ts`); dev fallback when unset. |
| **`budget_baseline` / `budget_baseline_row`** | SAP budget team Excel import (**xlsx**): columns **Prog Fin**, **Prog Fin lib**, **Cellule**, **Budget actuel YYYY**; amounts stored **positive EUR** (SAP negatives negated on import). |
| **`dim_year`** | Small table (years 2023–2028 seeded) for Power BI relationships to snapshot/baseline detail views. |
| **`dim_eotp`** | **View**: distinct **`eotp`** (and label) from **`allocation_snapshot_row`** ∪ **`budget_baseline_row`**; **`DISTINCT ON (eotp)`** so one row per code for dimension relationships. |

**Comparison vs baseline:** done in **Power BI**, not in-app. Gap concept: baseline tracks external + direct “catchout” scope; **`v_snapshot_detail`** exposes **`catchout`** = `external + direct`. See **§5.3**.

**APIs:** **`GET` / `POST /api/snapshots`**, **`DELETE /api/snapshots/[id]`**; **`GET` / `POST /api/baselines`** (multipart Excel), **`DELETE /api/baselines/[id]`**. UI: **`/budget-comparison`**.

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
```

### 4.11 InitiativeRevenue (table: `initiative_revenue`)

Multiple revenue rows per initiative. **`RevenueType`** enum: **`Mission`** \| **`Subscription`**. Fields: `id`, `initiativeId` (FK → `Initiative`, **no** unique constraint — many rows allowed), `type`, `amount` (EUR), `comment` (optional), `createdOn`, `modifiedOn`. Back-relation: **`Initiative.revenues`**. Seeded from **`REVENU.csv`** via **`npm run db:seed:revenues`** (all CSV lines as **`Mission`**; matched by Jira key in **Colonne1**; **delete-then-insert** per affected initiative for idempotency).

---

## 5. Power BI Cost View (v_allocation_costs)

The primary reporting view is **`v_allocation_costs`** (PostgreSQL), created by the seed script. Power BI should consume **views**, not ad-hoc table queries for reporting. The app uses Prisma on raw tables. **`v_allocation_costs`** is recreated each time the production seed view step runs, or on demand via:

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
| `man_days` / `quantity` | Raw allocation fields (for validation / BI) |
| `product_group` | Higher grouping (`&` → `and`, NULL → `Unassigned`) |
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

### 5.3 Planning vs budget baseline (Power BI)

Created by the same production seed path as **`v_allocation_costs`** (after snapshot/baseline tables exist). Import into Power BI: **`v_snapshot_detail`**, **`v_baseline_detail`**, **`dim_year`**, **`dim_eotp`**.

- **`v_snapshot_detail`** — joins **`allocation_snapshot`** and **`allocation_snapshot_row`**; includes **`catchout`** (= `external + direct`).
- **`v_baseline_detail`** — joins **`budget_baseline`** and **`budget_baseline_row`**; **`baseline_amount`**.
- Relationships: **`dim_year[year]`** → both detail views; **`dim_eotp[eotp]`** → **`v_snapshot_detail[eotp]`** and **`v_baseline_detail[eotp]`** (many-to-one from facts to **`dim_eotp`**). Use **`dim_eotp`** on matrix rows so measures from both facts filter per EOTP. **Measures (example):** `Planned Catchout = SUM(v_snapshot_detail[catchout])`, `Baseline Amount = SUM(v_baseline_detail[baseline_amount])`, `Gap = [Baseline Amount] - [Planned Catchout]`.

See `README.md` (Power BI notes) for step-by-step import notes.

### 5.4 View `v_revenues` (revenue lines)

**`v_revenues`** — one row per **`InitiativeRevenue`** record. Columns: **`revenue_id`**, **`initiative_id`**, **`jira_key`**, **`summary`**, **`initiative_year`**, **`initiative_type`** (varchar), **`status`** (varchar), org dimensions, **`sap_eotp_code`**, **`sap_eotp_name`**, **`revenue_type`** (varchar — `'Mission'` or `'Subscription'`), **`revenue_amount`**, **`revenue_comment`**, timestamps. All enum-like columns **cast to VARCHAR** (§2.8). **`SUM(revenue_amount)`** is additive at revenue-line grain. Do **not** join **`v_revenues`** to **`v_allocation_costs`** in the model — different granularities (revenue line vs allocation row); filter both via shared slicers (e.g. year, product). Created by **`createRevenueView()`** in **`scripts/seed-production.ts`**. Recreated by **`SEED_VIEW_ONLY=1 npm run db:seed:prod`**.

---

## 6. Application Architecture

### 6.1 Data Flow

```
Jira API  →  /api/jira/sync  →  Initiative table (upsert by jira_key)
Excel CSVs  →  seed-production.ts  →  Resources, rates, initiatives, allocations (+ view); allocation entities (`allocation_entity` table) seeded first when `PRODUCTS.csv` is present
Browser  →  Next.js API routes  →  Prisma  →  PostgreSQL
Power BI  →  PostgreSQL direct connection  →  v_allocation_costs, v_eotp_costs, v_revenues, v_snapshot_detail, v_baseline_detail, dim_year, dim_eotp
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

**Legacy URLs:** No Next.js redirects are configured for old paths — use the canonical routes in the table above only.

### 6.3 Investments UI and allocation entity catalog

The primary planner flow is **`/investments`** and **`/investments/[id]`** (UI label: **Investment**). The detail screen loads the allocation entity with **`GET /api/allocation-entities/[id]`** and drives budget, EOTP routing, and allocations against `v_allocation_costs`. The old **`/initiatives`** screen was removed; it is not redirected.

---

## 7. Application Screens

### 7.1 Investments (`/investments`, `/investments/[id]`) — Primary

Portfolio table of allocation entities with optional budget columns (€k INT/EXT/DIR from **`/api/allocation-entities/with-budget`**). Row opens **investment detail** (modular client under **`investments/[id]/`**).

**Layout (v1.6):** Shared panel chrome (**`PANEL_CARD_CLASS`** in **`src/lib/panel-card.ts`**) matches **`/resources`**. **Main title** = allocation entity **name · selected year**; **year** chips sit in the **same grid column** as the **Details** card so they align with its right edge. **Top row (two columns):** **Details** (readonly catalog: division, SAP EOTP, etc.) | **Budget Summary {year}** — opens with a **budget overview** (year, **actual budget** from **`v_allocation_costs`**, **FTE sum** via **`/api/allocation-entities/[id]/year-summary`**), short copy linking overview to the **Distribution across EOTP lines** table below. The table defaults to **EOTP · Label · Total · Actions**; **internal / external / direct**, **cash out**, and **comment** are on **expandable** rows. Optional consistency hint compares summed EOTP line totals to the overview budget.

**EOTP routing card (`InvestmentDetailEotpRoutingSection`):** Card header = **EOTP routing** + main SAP EOTP **pill** (from the entity). **Main** bucket: read-only rows from **`GET /api/allocation-entities/[id]/eotp-main-from-view`** ( **`v_eotp_costs`**, `is_main_eotp`), table styling aligned with exception rows; expand shows INT/EXT/DIR detail. **Exception routing:** heading **Exception Routing** on the **same row** as **Edit routing** / **Cancel** (`justify-between`). Exception targets are chosen from **`eotp_definition`** only (**`/api/eotp-routing-target-options`**). Persisted via **`/api/allocation-entities/[id]/eotp-routing`**. Delete routing uses a **dialog** (not `window.confirm`). **Horizontal separator**, then **bottom row:** **Budget by initiative** | **Allocations** editor ( **`/api/allocations`**, **`/api/initiative-allocation-costs`** ) when an initiative is selected.

**Budget by initiative (`InvestmentDetailBudgetCard`):** Per-initiative cost columns (€k) **only** — revenue is edited in the separate **`InvestmentDetailRevenuePanel`**.

**Revenue (`InvestmentDetailRevenuePanel`):** Appears when an initiative is selected (below **Allocations**). **`GET /api/revenues`** lists rows; grouped by **Mission** / **Subscription** with badges and subtotals; **Edit revenues** — type **`Select`**, comment, amount (EUR), **Delete** with **Dialog**; draft rows at top with **Save** / **Discard**. Key‑figure strip **Revenues** / **Margin** uses **`total_revenue`** from **`GET …/budget`**.

**Resource allocations (`InvestmentDetailAllocationsPanel` / `InvestmentDetailAllocationEditor`):** **View** mode by default; **Edit allocations** enables inline editing and **Add allocation**. New rows are **drafts in client state only** until the user picks a resource: draft lines render **at the top of the table** (below the header row), with an empty resource combobox (no automatic selection). Choosing a resource triggers **`POST /api/allocations`** with that **`resourceId`**. **Discard** removes a draft; **Cancel** exits edit mode and clears all drafts; switching initiative or year clears drafts. Rows are grouped by resource type (**Internal / External / Direct**) with group subtotals; the cost column uses extra right inset so figures sit inboard; group label rows stay left-aligned with the table. **Delete** on a saved row uses the same **outline + `Trash2` icon** pattern as **Daily rates by year** on **`/resources`** (not a text **Delete** button).

### 7.2 Resources (`/resources`)

Master-detail: **left** searchable/filterable table (ID, name from Prénom+Nom, function, type); **right** stacked cards (**Details** + **Daily rates by year**) with the same **`PANEL_CARD_CLASS`** border/shadow as investments.

- **Details** — Edit/Save/Cancel; **`PATCH /api/resources/[id]`**; display name derived from first/last name (**`resourceFullNameFromParts`**). **Direction** is restricted to **CRPS** or **PDS** (or empty); legacy CSV values must be replaced in the UI before save.
- **Rates** — Edit rates mode: existing rows **auto-save** (debounced PATCH **`/api/rates/[id]`**); **Add rate** opens a draft row at the top (**Save** posts **`/api/resources/[id]/rates`**); **Delete** uses a **modal** (not `window.confirm`). Numbers are **right-aligned** in the table.

### 7.3 Report — Planned

To be defined. Likely a link to Power BI Service or an embedded report. No in-app charts planned — Power BI handles all analytics.

### 7.4 Planning vs budget baseline (`/budget-comparison`)

Management screen (sidebar): **take snapshots** (name, year), **import baselines** (Excel), list/delete with **Dialog** confirmations. Comparison **vs** baseline is **not** rendered in the app — use Power BI on **`v_snapshot_detail`** / **`v_baseline_detail`** / **`dim_year`** / **`dim_eotp`** (§5.3).

### 7.5 Legacy routes

Older prototype paths (e.g. `/test/products`, `/api/products`, `/initiatives`) are **not** mapped — they 404 unless you add routes or redirects. Use **`/investments`**, **`/budget-comparison`**, and **`/api/allocation-entities`** (see §6.2).

---

## 8. Jira Sync

| | |
|---|---|
| Library | jira.js (Version3Client) — preferred over raw fetch calls |
| Auth method | Basic auth: email + API token (not password) |
| Source | Single JQL filter ID covering all relevant initiatives |
| Pagination | 100 results per page, loop with startAt until all fetched (~1,200 initiatives) |
| Strategy | Upsert — create new, update existing matched by jira_key |
| Allocation entity link | After upsert, `allocationEntityId` (DB `allocation_entity_id`) is set when a Jira **component** string (split on comma) **case-insensitively matches** `AllocationEntity.name` (first match wins) |

Required environment variables:

```env
JIRA_HOST=https://your-company.atlassian.net
JIRA_EMAIL=your.email@company.be
JIRA_TOKEN=your_api_token_from_jira_profile
JIRA_FILTER_ID=12345
```

> **Open question:** the custom field IDs for `year` and `initiativeType` (`customfield_xxxxx`) need to be confirmed by inspecting a live Jira API response before the sync route can be completed.

---

## 9. Seed Scripts

| Script | Command | Source Files | Purpose |
|---|---|---|---|
| `seed-dev.ts` | `npm run db:seed` (or `db:seed:dev`) | `scripts/datasets/dev/*.csv` | Dev/test seed dataset |
| `seed-products.ts` | `npm run db:seed:products` | `scripts/datasets/dev/PRODUCTS.csv` | Upsert **`AllocationEntity`** rows (table `allocation_entity`; SAP fields, scores, **`entity_type`**) |
| `seed-production.ts` | `npm run db:seed:prod` | `scripts/datasets/prod-import/*.csv` | Production import: resources, standards, rates, initiatives, allocations, **`v_allocation_costs`**, **`v_eotp_costs`**, **`v_snapshot_detail`**, **`v_baseline_detail`**, **`v_comparison`**, **`v_revenues`**, **`dim_eotp`**, seed **`dim_year`** |
| `seed-eotp-definitions.ts` | `npm run db:seed:eotp` | `scripts/datasets/dev/EOTP-Budget-Owner.csv` | Upsert **`eotp_definition`** (SAP code, label, org metadata) |
| `seed-eotp-routing.ts` | `npm run db:seed:routing` | `scripts/datasets/dev/EOTP_ROUTING.csv` | Upsert **`eotp_routing`** from CSV (`productName` → **`AllocationEntity.name`**, columns: internal / external / direct EUR); links **`eotp_definition_id`** when definitions exist |
| `seed-revenues.ts` | `npm run db:seed:revenues` | `scripts/datasets/dev/REVENU.csv` | Insert **`InitiativeRevenue`** (type = **`Mission`**) one row per CSV line; matched by Jira key in **Colonne1**; **delete-then-insert** per affected initiative |
| `xlsx-to-prod-data-auto.ts` | `tsx scripts/xlsx-to-prod-data-auto.ts --input "<xlsx>" --outDir scripts/datasets/prod-import` | Excel workbook | Generate `Assignement.csv`, `RESSOURCES.csv`, `RATES.csv`, `REVENU.csv` into **`scripts/datasets/prod-import/`** |
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

# Recreate Power BI views only — no CSV import (`v_allocation_costs`, `v_eotp_costs`, `v_revenues`, snapshot/baseline views, `dim_eotp`, seed `dim_year`)
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
- **RESSOURCES encoding** — File is **UTF-8 with BOM**. **`seed-production.ts`** reads **`RESSOURCES.csv`** as **`utf8`** (not `latin1`) so headers **`Nom` / `Prénom`** parse correctly; **`JIRA.csv`** remains **`latin1`**.
- **`SEED_PROD_RESET`** — Truncates allocation/rate/initiative/resource (and related) and clears **`eotp_routing`**, but **does not** delete rows in **`allocation_entity`** — allocation-entity catalog survives full reloads.
- **Views** — `createCostView()` defines `v_allocation_costs`; **`createEotpCostsView()`** (shared with `scripts/eotp-views.ts`) defines **`v_eotp_costs`**. **`v_eotp_routing` is not used** (removed). Migrations that alter columns depended on by views may need **`DROP VIEW IF EXISTS …`** before column changes — `createCostView()` already drops dependent EOTP views before recreating `v_allocation_costs`.

**Manual truncate (rare)** — If you need a clean slate including the allocation-entity catalog, truncate `allocation_entity` explicitly or use SQL; default reset keeps those rows.

### 9.3 In-app “Admin” buttons (generate + seed)

The header includes operational buttons used during the Excel → CSV → DB refresh workflow:

- **Generate CSVs**: calls `POST /api/admin/prod-data-auto/generate`
  - Runs `tsx scripts/xlsx-to-prod-data-auto.ts --input "<xlsx>" --outDir scripts/datasets/prod-import`
  - Intended for local/WIP workflows (paths are currently hardcoded to the workbook location in WSL).
- **Re-seed DB** (danger): calls `POST /api/admin/db/seed-prod-reset`
  - Runs `SEED_PROD_RESET=1 tsx scripts/seed-production.ts`
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

## 11. Open Questions & Next Steps

### 11.1 Open Questions

- **Jira custom field IDs** — The field names for `year` and `initiativeType` (`customfield_xxxxx`) need to be discovered by inspecting a live Jira API response before the sync route can be completed.
- **Standard rate values** — `nbrDaysPerYear` values (200 internal, 220 external) need confirmation from the business as these drive all FTE → man-days conversions.
- **Authentication** — App currently has no login. Multi-user with no access control is acceptable for now. Decision needed before production deployment.
- **Kubernetes deployment** — Company runs a K8s cluster. A Dockerfile needs to be written when ready for production. DevOps team to confirm the deployment pipeline and container registry.
- **Power BI read-only role** — A `powerbi_reader` Postgres role should be created on the company cluster before connecting Power BI in production:

```sql
CREATE ROLE powerbi_reader WITH LOGIN PASSWORD 'choose_a_password';
GRANT USAGE ON SCHEMA public TO powerbi_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powerbi_reader;
```

### 11.2 Prioritised Next Steps

1. **Hardening** — Auth, tests (`vitest`), CI fixes for **`tests/fixtures/load-csv.ts`** typing if needed
2. **Apply be.brussels colour scheme** globally (sidebar `#1a2f4e`, primary `#185FA5`, background `#f4f6f8`)
3. **Discover Jira custom field IDs** then finish field mapping in Jira sync (`year`, `initiativeType`, etc.)
4. **Validate Power BI reports** against `v_allocation_costs` on local Docker Postgres (refresh model after view changes)
5. **Production deployment** — Push image to registry; apply **`deploy/kubernetes`** (or OpenShift) with DevOps team

### 11.3 Changelog — v1.2 (April 2026)

Consolidated documentation of major changes since the initial design doc:

- **Docker / OpenShift prep** — Multi-stage **`Dockerfile`** (Next **standalone**, non-root, **`PORT=8080`**), **`compose.yaml`** (Postgres + optional **`app`** profile), **`GET /api/health`**, **`deploy/README.md`** and **`deploy/kubernetes/`** samples. Prisma reads **`process.env["DATABASE_URL"]`**; build uses a dummy URL only for **`prisma generate`** / **`next build`**; runtime **`DATABASE_URL`** from container env. **`/investments`** is **`force-dynamic`** to avoid DB access during image build. Rebuild image after code changes.
- **Revenue assignment (v1.9)** — **`RevenueType`** enum (**`Mission`** \| **`Subscription`**); **`InitiativeRevenue`** (table **`initiative_revenue`**) — **multiple** rows per initiative (`type`, `comment`, EUR **`amount`**). Seeded from **`REVENU.csv`** (**`npm run db:seed:revenues`**, all lines **`Mission`**; delete-then-insert). API: **`GET` / `POST /api/revenues`**, **`PATCH` / `DELETE /api/revenues/[id]`**; budget API returns **`total_revenue`** + per-type sums. UI: **`InvestmentDetailRevenuePanel`** (grouped table, drafts, auto-save, delete **Dialog**); **Budget Key Figures**: **Revenues** + **Margin**. Power BI: **`v_revenues`** one row per revenue line (varchar casts); use **independently** of **`v_allocation_costs`** (different grain).
- **Investment allocation drafts + API (v1.8)** — **`POST /api/allocations`** requires **`resourceId`** (no default first resource). **Resource allocations** panel: client-side **draft** rows at the **top** of the table until a resource is chosen; then **`POST`** persists. **`InvestmentDetailAllocationsPanel`**, **`InvestmentDetailAllocationEditor`**, **`InvestmentDetailAllocationPendingRow`**, **`use-investment-initiative-allocations`**. Delete row control: **`Trash2`** + outline styling (same as **Daily rates** on **`/resources`**). See §7.1.
- **Planning vs budget baseline (v1.7)** — **AllocationSnapshot** / **AllocationSnapshotRow**, **BudgetBaseline** / **BudgetBaselineRow**, **DimYear**; **`takeSnapshot`** (`src/lib/snapshot.ts`) freezes **`computeEotpBreakdown`** + **`v_allocation_costs`** aggregates; baseline Excel via **`xlsx`** (`src/lib/baseline-parser.ts`). APIs: **`/api/snapshots`**, **`/api/baselines`**. UI **`/budget-comparison`**. Seed: **`v_snapshot_detail`**, **`v_baseline_detail`**, **`dim_eotp`**, **`dim_year`** in **`scripts/seed-production.ts`**. Power BI: **`dim_eotp`** bridges **`eotp`** on both detail views. **`getUserFromRequest`** (`src/lib/auth.ts`). README: Power BI setup for baseline comparison.
- **EOTP definition catalog + routing UI (v1.6)** — Prisma **`EotpDefinition`** / table **`eotp_definition`**; optional **`eotp_definition_id`** on **`allocation_entity`** and **`eotp_routing`** (migration **`20260412130000_eotp_definition_catalog`**). Seeds: **`npm run db:seed:eotp`** (`EOTP-Budget-Owner.csv`); optional **`npm run db:backfill:eotp-routing-fks`**. APIs: **`GET /api/eotp-routing-target-options`**; **`GET/PATCH`** allocation-entity and eotp-routing routes resolve or persist definition links (**`src/lib/eotp-definition-resolve.ts`**, **`eotp-target-options.ts`**, **`eotp-routing-target-options-query.ts`**). Investment **EOTP routing** panel: main lines from **`eotp-main-from-view`**; **Exception Routing** title **aligned with Edit routing**; exception target combobox from **definitions only**; delete **Dialog**. **Tests:** **`tests/fixtures/load-csv.ts`** typing fix for Vitest. After markup changes, **`rm -rf .next`** / hard refresh avoids stale SSR hydration mismatches in dev.
- **Investment detail layout + resources UX (v1.5)** — Modular **`InvestmentDetailClient`** and panels; **title** = name **·** year; year selector column-aligned with **Details**; **Budget Summary {year}** card (EOTP routing) top-right vs Details; **separator**; **Budget by initiative** + **Allocations** row. **Resources** screen: **`PANEL_CARD_CLASS`**, details/rates editing, rate **auto-save**, add-rate draft row, delete **modal**, **CRPS/PDS** direction validation, **`resource-display-name`**. **Prod seed:** **`RESSOURCES.csv`** read as **UTF-8**. Shared **`src/lib/panel-card.ts`**, **`resource-direction.ts`**, **`resource-display-name.ts`**.
- **Schema baseline + physical rename (v1.4)** — Incremental migrations were **squashed** into a single migration **`20260405120000_baseline`**. PostgreSQL table **`allocation_entity`** replaces legacy **`product`**; FK columns **`allocation_entity_id`** on **`initiative`** and **`eotp_routing`** replace **`productId`**. Seeds, **`v_allocation_costs`** / **`v_eotp_costs`** SQL, EOTP CSV helpers, and allocation-entity API routes use the new names. **`npm run db:migrate`** runs **`prisma migrate deploy`**. **Breaking:** refresh Power BI / any native SQL; run **`migrate deploy`** on each database; **`prisma generate`** (or **`npm install`**) + **`rm -rf .next`** if the app still targets old table names.
- **Investments list error UX (v1.4)** — **`GET /api/allocation-entities`** returns JSON **`{ error }`** on failure; **`/investments`** shows HTTP/Prisma errors and distinguishes empty DB vs filter mismatch.
- **AllocationEntity + main app (v1.3)** — Prisma **`AllocationEntity`** maps to table **`allocation_entity`**; **`entity_type`** column + enum; **`Initiative.allocationEntityId`** / **`EotpRouting.allocationEntityId`** map to DB **`allocation_entity_id`**. Canonical REST under **`/api/allocation-entities`**; **`/api/resources`** and **`/api/initiative-allocation-costs`**; UI primary route **`/investments`**; removed **`/initiatives`** and **`/api/test/*`** (no legacy redirects in dev).
- **Rate.nbrDaysPerYear NOT NULL** — **`rate.nbrDaysPerYear`** is required; **`v_allocation_costs`** uses only the individual rate row for days/year (no fallback to **`rate_standard`** for FTE multipliers). Migration backfills legacy nulls; **`RATES.csv`** / dev **`Rates.csv`** rows without days are skipped at seed. **`dailyRate`** may still **`COALESCE`** to **`rate_standard`** when missing.
- **Products prototype & EOTP polish (v1.2.5)** — Single **year** strip (between product card and EOTP card) drives budget, routing, and **`eotp-main-from-view`**. **`v_eotp_costs`** adds **`cash_out`** and **`total_cost`**; view SQL simplified (**`routed_non_main`** + **`UNION ALL`**); main row uses **`sapEotpName`** as label. API **`GET /api/products/[id]/eotp-main-from-view`**; POST/PATCH **eotp-routing** rejects targeting the **main SAP EOTP** (**`eotp-routing-validation.ts`**). Prototype EOTP table: main remainder row from the view, then exceptions; columns align with **Internal / External / Direct / Total / Cash out**; unified table header styling with initiative and assignment tables; budget/assignment grids use the same **Internal / External / Direct / Total** labels as EOTP.
- **EOTP routing (v1.2.4)** — **`EotpRouting`** model: one row per `(allocation_entity_id, year, eotp)` with **`internalAmount` / `externalAmount` / `directAmount`** (EUR); no percent / no per–cost-type rows. **`v_eotp_routing`** view **removed**; **`v_eotp_costs`** retained for Power BI. APIs: **`/api/products/[id]/eotp-routing`**, **`.../eotp-routing/[routingId]`**; budget API includes **`eotpBreakdown`**. CSV: **`EOTP_ROUTING.csv`** + **`db:seed:routing`**. Prototype: EOTP routing card + main-EOTP code **pill** when `eotp === sapEotpCode`. Shared view SQL: **`scripts/eotp-views.ts`**; **`npm run db:recreate:eotp-costs`** rebuilds **`v_eotp_costs`** only.
- **Products prototype (v1.2.3)** — `src/app/test/products/**` and `src/app/api/test/**`: product list with budget columns; product detail with budget-by-initiative and initiative allocation editor; test APIs read from `v_allocation_costs` and Prisma; allocation responses include `resource.type` for grouping; assignment UI uses €k abbreviation (`formatK`) aligned with initiative list styling.
- **Product model** — `allocation_entity` table + `Initiative.allocation_entity_id`; SAP EOTP split into `sapEotpCode` / `sapEotpName`; optional org/marketing fields (`productFamily`, `division`, `subDivision`, `team`, scores).
- **API** — `GET /api/products`, `GET /api/products/[id]`.
- **Jira sync** — Resolves `allocation_entity_id` from components ↔ `AllocationEntity.name` (case-insensitive).
- **Single production seed** — One `scripts/seed-production.ts` (merged former alternate script): CSV merge rules, `RateStandard` fallback path, `createCostView()` with product join and corrected cost/FTE/`calculated_man_days` logic.
- **Allocations CSV merge** — Duplicate MAT×RI rows: **sum** `quantity` (%); **first positive man-days** in CSV order wins (not summed).
- **`SEED_PROD_RESET`** — Clears planner tables but **preserves** `allocation_entity`.
- **Power BI view** — Extra columns (`allocation_id`, `power_id`, product dimensions, SAP, `effective_days_per_year`); staff FTE columns populated from man-days via implied FTE; direct-cost quantity path uses per-unit days from the individual rate or **1** if absent (see §2.6 — avoids treating missing licence rates as 200 “man-days”).
- **Direct cost without rate row (v1.2.1)** — `createCostView()` in `seed-production.ts` / `seed-dev.ts`: DIRECT_COST quantity and `effective_days_per_year` default to a **unit multiplier of 1** when there is no matching `Rate` for the initiative year, instead of falling back to INTERNAL `RateStandard` (200 days). Dropped unused `rs_dc` join from the prod view.
- **Initiatives Product card (v1.2.2)** — Flat `InitiativeDTO` + `JSON.parse(JSON.stringify)` on the server list; client fetches full **`Product`** via `/api/products/[id]` (or list + name match) on selection so SAP/org fields display reliably despite `dynamic(..., { ssr: false })` (see §6.3). `initiatives-dynamic-shell.tsx` wraps the page client.
- **Migrations** — When altering columns referenced by `v_allocation_costs`, migrations may need `DROP VIEW IF EXISTS v_allocation_costs` first.
- **Repository** — Large or sensitive production CSVs may be gitignored; initiative/assignment exports are excluded from version control by policy.

---

## 12. Project File Structure

```
src/
  app/
    layout.tsx                  ← Root layout (nav sidebar, header)
    page.tsx                    ← Redirect to /investments
    budget-comparison/page.tsx  ← Snapshots + baseline import (Power BI data prep)
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
      health/route.ts           ← GET — liveness/readiness (no DB)
  generated/prisma/             ← Auto-generated Prisma client (do not edit)
  lib/prisma.ts                 ← Prisma singleton with PrismaPg adapter
  lib/auth.ts                   ← getUserFromRequest (X-Auth-Request-Email)
  lib/snapshot.ts               ← takeSnapshot (frozen EOTP breakdown)
  lib/baseline-parser.ts        ← SAP baseline Excel parse
  lib/eotp.ts                   ← computeEotpBreakdown (budget / reporting)
  lib/eotp-routing-validation.ts ← reject routing target = main SAP EOTP
  lib/eotp-definition-resolve.ts ← resolve / pick EotpDefinition for APIs and seeds
  lib/eotp-routing-target-options-query.ts ← load definition rows for target picker
  lib/eotp-target-options.ts    ← build JSON options; exclude main SAP code
  lib/investment-year-summary.ts ← helpers for year-summary / budget UI
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
  backfill-eotp-routing-eotp-definition-ids.ts ← Backfill eotp_definition_id FKs
  convert-eotp-routing-csv.ts   ← Legacy CSV → three-column EUR format
  rebuild-eotp-routing-csv.ts   ← Rebuild EOTP_ROUTING.csv from source export
  recreate-eotp-costs-view.ts    ← Recreate v_eotp_costs only
  datasets/dev/                 ← Dev/test CSV dataset
  datasets/prod-import/         ← Production import dataset (generated from Excel)
```

---

*Last updated: April 2026 — Resource Planner v1.9 (see §11.3 changelog)*
