# Resource Planner — Application Design Document

**Paradigm · Brussels Capital Region · v1.2.2 · April 2026**

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Core Business Logic](#2-core-business-logic)
3. [Technology Stack](#3-technology-stack)
4. [Database Schema](#4-database-schema)
5. [Power BI Cost View](#5-power-bi-cost-view-v_allocation_costs)
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

This value converts between FTE % and man-days. It varies by resource type and year:

| Resource Type | Standard Days/Year | Source |
|---|---|---|
| INTERNAL | 200 | RateStandard table — confirmed value |
| EXTERNAL | 220 | RateStandard table — confirmed value |
| DIRECT_COST | 1.0 | Rate table — always 1.0 (unit cost model, not days) |

Individual resources can override the standard days/year value via their own Rate row (the `nbrDaysPerYear` field on the Rate model). This is rare but supported.

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

- **INTERNAL / EXTERNAL** — If `manDays` > 0: raw man-days. If FTE (`quantity` > 0): `quantity × nbrDaysPerYear` (individual rate or standard).
- **DIRECT_COST** — Man-days path uses `manDays` directly. Quantity path uses `quantity ×` per-unit days from the **individual** `Rate` row when `nbrDaysPerYear` > 0 (usually **1.0** for licences). If there is **no rate row** for `(resource, initiative year)` or `nbrDaysPerYear` is missing, the multiplier defaults to **1** — it must **not** fall back to INTERNAL `RateStandard` (200 days), or a single licence is reported as 200 “man-days”.

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

---

## 3. Technology Stack

### 3.1 Chosen Stack

| Component | Choice |
|---|---|
| Frontend | Next.js 14 (App Router, TypeScript, Tailwind CSS) |
| UI Components | shadcn/ui + cmdk (combobox search) |
| ORM | Prisma 7 with @prisma/adapter-pg (PostgreSQL adapter) |
| Database | PostgreSQL — company-hosted cluster (dev: Docker local) |
| Reporting | Power BI Desktop connected directly to PostgreSQL view |
| Jira Sync | jira.js (Version3Client) — official TypeScript Jira client |
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

Six models (plus **Product** for SAP / reporting). All IDs are preserved from the source systems (PowerApps/Jira) where applicable. Cost is never stored — always computed at query time.

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
| `nbrDaysPerYear` | Float? | | Working days. 1.0 for Direct Costs. NULL = use RateStandard value. |
| `createdOn` | DateTime | ✓ | |
| `modifiedOn` | DateTime | ✓ | |

### 4.3 Product

Canonical product catalog (Jira **Components** ↔ `Product`). Seeded from `scripts/data-prod/PRODUCTS.csv` via `npm run db:seed:products` (prod seed also upserts products when the file exists). `Initiative.productId` links here for reporting and Jira sync.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK (e.g. `PRD-xxx` from CSV) |
| `name` | String | ✓ | Unique — must match Jira Components value for resolution |
| `productFamily` | String? | | Grouping (SALES, WORKPLACE, …) |
| `division` / `subDivision` / `team` | String? | | Org metadata |
| `sapEotpCode` / `sapEotpName` | String? | | SAP EOTP split (code vs label) |
| `attractiveness` / `competitiveness` | Float? | | Optional marketing-matrix scores |
| `initiatives` | Initiative[] | | Reverse relation |

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
| `components` | String? | | Jira components field (product name; used to resolve `productId`) |
| `productId` | String? | | FK → `Product.id` — set by Jira sync from first matching component, or by seed |
| `productGroup` | String? | | Higher grouping (SALES, SMART ADMIN, eCITIZEN, etc.) |
| `initiativeType` | String? | | Run, Evolution, Rollout, Projet, Analyse, etc. |
| `allocations` | Allocation[] | | Relation — all resource assignments for this initiative |
| `product` | Product? | | Optional relation when `productId` set |
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

### 4.7 Entity Relationship Summary

```
Product (1) ───── (N) Initiative    [productId optional]
Resource (1) ──── (N) Rate          [resourceId + year — unique]
Resource (1) ──── (N) Allocation   [resourceId]
Initiative (1) ── (N) Allocation    [initiativeId]
RateStandard     ── (no FK)       [joined by type + year at query time]
```

---

## 5. Power BI Cost View (v_allocation_costs)

A PostgreSQL view created by the seed script. Power BI connects to this single view — never to individual tables. The app itself uses Prisma on the raw tables. The view is recreated each time the seed script runs, or on demand via:

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
| `product_name` | `LEFT JOIN product` — `COALESCE(name,'Unassigned')` |
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
| `effective_days_per_year` | Staff: individual `Rate`, then `RateStandard` for type/year. **DIRECT_COST:** individual `Rate.nbrDaysPerYear`, else **1** (not INTERNAL 200). |
| `computed_cost` | Total cost — all types |
| `internal_cost` | Cost if INTERNAL, else 0 |
| `external_cost` | Cost if EXTERNAL, else 0 |
| `direct_cost` | Cost if DIRECT_COST, else 0 |
| `fte_decimal` / `fte_percent` | See §2.7 — FTE from % or implied from man-days (staff only) |
| `calculated_man_days` | See §2.6 — unified man-days / direct-cost quantity path |

**Cost safeguards (implementation):** Staff FTE cost uses `nbrDaysPerYear` from the individual rate or type standard. Direct-cost quantity uses `COALESCE(individual nbrDaysPerYear when > 0, 1)` — never INTERNAL’s 200-day standard when the rate row is missing.

**Key guarantee:** `internal_cost + external_cost + direct_cost = computed_cost` for every row.

---

## 6. Application Architecture

### 6.1 Data Flow

```
Jira API  →  /api/jira/sync  →  Initiative table (upsert by jira_key)
Excel CSVs  →  seed-production.ts  →  Resources, rates, initiatives, allocations (+ view); products seeded first
Browser  →  Next.js API routes  →  Prisma  →  PostgreSQL
Power BI  →  PostgreSQL direct connection  →  v_allocation_costs view
```

### 6.2 API Routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/jira/sync` | GET | Fetch all initiatives from Jira filter, upsert to DB |
| `/api/allocations` | GET, POST | GET by initiativeId. POST creates new allocation. |
| `/api/allocations/[id]` | PATCH, DELETE | Update or delete one allocation. Auto-save on change. |
| `/api/resources/[id]` | GET, PATCH, DELETE | Read, update or delete a resource |
| `/api/rates` | GET, POST | GET by resourceId. POST creates new rate. |
| `/api/rates/[id]` | PATCH, DELETE | Update or delete one rate row |
| `/api/products` | GET | List all products (ordered by family, name) |
| `/api/products/[id]` | GET, PATCH, DELETE | One product by id; PATCH updates catalog fields |

### 6.3 Initiatives page — server props, dynamic client, and product catalog

The initiatives UI is loaded with **`next/dynamic`** and **`ssr: false`** (`initiatives-dynamic-shell.tsx`) so the heavy client bundle does not participate in SSR/hydration (avoids dev-only Turbopack placeholder drift against the real client bundle).

**Trade-off:** props passed from the React Server Component into that dynamic client boundary are not fully reliable for **nested objects** or, in practice, for **some extra scalar fields** on large DTO arrays — `productName` / `productTeam` tended to arrive, while org/SAP/marketing fields on the same initiative sometimes did not.

**Mitigations (implemented):**

1. **`InitiativeDTO` is flat** — catalog fields (`productFamily`, `division`, `subDivision`, `sapEotpCode`, `sapEotpName`, `attractiveness`, `competitiveness`) live as top-level nullable scalars next to `productId`, `productName`, `productTeam` — not nested under a `productDetails` object.
2. **Stable wire shape** — `initiatives/page.tsx` runs `JSON.parse(JSON.stringify(initiatives))` before passing the list to the shell so every row is a plain object with a consistent JSON-serializable shape.
3. **Authoritative catalog on selection** — when the user selects an initiative, the client loads the full **`Product`** row via **`GET /api/products/[id]`** when `productId` is set; if `productId` is missing on the client but `productName` is present, it falls back to **`GET /api/products`** and matches by name (case-insensitive). The Product detail card merges this response with the DTO so SAP EOTP and org fields always reflect the database.

---

## 7. Application Screens

### 7.1 Initiatives (/initiatives) — Complete

Master-detail layout. Left panel: scrollable filtered list of all initiatives. Right panel: read-only details + editable allocation grid.

- **Product card** — Title shows linked catalog **product name** (or “No product linked”). Body shows **product family, division, sub-division, team, SAP EOTP code/name, attractiveness, competitiveness** — sourced from the **`Product`** row via the API when an initiative is selected (see §6.3). Table columns **Product** and **Team** still come from the initiative list DTO for fast filtering.
- **Filters** — Text search (case-insensitive contains on key/summary/product/group), Year dropdown, Product dropdown, Team dropdown, Reset button
- **Jira Refresh** — Button calls `/api/jira/sync` — upserts latest initiatives from Jira
- **Allocation grid** — Assignment ID, Percent (numeric input), Man Days (numeric input), Resource (combobox), Delete button
- **Resource combobox** — Uses cmdk with `shouldFilter=false` and custom case-insensitive contains filter across 600+ resources
- **Auto-save** — `PATCH /api/allocations/[id]` with 450ms debounce on input change
- **New row** — `POST /api/allocations` — defaults to first available resource, 0 quantity

### 7.2 Resources (/resources) — In Progress

Same master-detail pattern as initiatives.

- **Left panel** — List with columns: Name, Function, Cell, Direction, Type (colored badge — blue/amber/green per type). Filters: text search, Cell, Direction, Type dropdowns.
- **Right panel top** — Resource details with Edit/Delete buttons. Fields toggle between read-only and editable inputs on Edit click.
- **Right panel bottom** — Daily Rates table — Nbr of days/year, Daily Rate, Year (2022–2027 dropdown), Delete. New rate via + New button.

### 7.3 Report — Planned

To be defined. Likely a link to Power BI Service or an embedded report. No in-app charts planned — Power BI handles all analytics.

---

## 8. Jira Sync

| | |
|---|---|
| Library | jira.js (Version3Client) — preferred over raw fetch calls |
| Auth method | Basic auth: email + API token (not password) |
| Source | Single JQL filter ID covering all relevant initiatives |
| Pagination | 100 results per page, loop with startAt until all fetched (~1,200 initiatives) |
| Strategy | Upsert — create new, update existing matched by jira_key |
| Product link | After upsert, `productId` is set when a Jira **component** string (split on comma) **case-insensitively matches** `Product.name` (first match wins) |

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
| `seed.ts` | `npm run db:seed` | `scripts/data/*.csv` | Dev seed from PowerApps exports (MAT/RI/ASS IDs intact) |
| `seed-products.ts` | `npm run db:seed:products` | `scripts/data-prod/PRODUCTS.csv` | Upsert `Product` rows only (SAP fields, scores) |
| `seed-production.ts` | `npm run db:seed:prod` | `scripts/data-prod/*.csv` | Prod migration: resources, standards, rates, initiatives, allocations, **`v_allocation_costs`** |

**Order for a full prod load:** run migrations, then **`db:seed:products`** (or ensure `PRODUCTS.csv` is present so the prod seed can upsert products), then **`db:seed:prod`**. The prod script upserts products from `PRODUCTS.csv` when that file exists.

### 9.1 Production Seed — Run Modes

```bash
# Full reload: clears planner tables (allocations, rates, initiatives, resources — NOT products), then import
SEED_PROD_RESET=1 npm run db:seed:prod

# Upsert only (leave existing rows not touched by CSV logic)
npm run db:seed:prod

# Recreate Power BI view only — no CSV import
SEED_VIEW_ONLY=1 npm run db:seed:prod
```

### 9.2 Production Seed Notes

- **Files** — `JIRA.csv`, `RESSOURCES.csv`, `RateStandard.csv`, `RATES.csv`, `Assignement.csv`; optional **`PRODUCTS.csv`** for product master data. `RateStandard.csv` can be omitted if a standard file is bundled next to the script (`resolveRateStandardPath` fallback).
- **ID-based linking** — `InitiativeId` (RI-xxx), `RessourceId` (MAT-xxx), etc.
- **Duplicate assignment rows** — CSV can list the same resource×initiative twice (e.g. % line + man-days line). The seed **merges** into one DB row: **percent values are summed**; **man-days** — **first line with a positive man-days value wins** (CSV order), not the sum. This matches business rules for split Excel exports.
- **Allocation IDs** — Deterministic `ASS-{hash(resourceId|initiativeId)}` after merge (one row per pair).
- **Number format** — Swiss apostrophe thousands separator (`1'100`) stripped before parsing.
- **Percent & ManDays** — Trailing `%`; values divided by 100 for storage (`34%` → `0.34` FTE decimal; large “%” man-days columns → man-days).
- **Rate row IDs** — Deterministic `RATE-{resourceId}-{year}` (CSV `RateId` not trusted as unique).
- **RESSOURCES blank rows** — Rows without an ID are skipped.
- **`SEED_PROD_RESET`** — Truncates allocation/rate/initiative/resource (and related) but **does not** delete **`Product`** — product master survives full reloads.
- **View** — `createCostView()` in `seed-production.ts` defines `v_allocation_costs` (product join, SAP columns, cost/FTE formulas). Migrations that alter columns depended on by the view may need **`DROP VIEW IF EXISTS v_allocation_costs`** before column changes — apply before `migrate deploy` if Prisma reports dependency errors.

**Manual truncate (rare)** — If you need a clean slate including products, truncate `product` explicitly or use SQL; default reset keeps products.

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
cd ~/projects/resource-planner && cursor .
npm run dev   # → http://localhost:3000
```

### 10.2 Make Postgres Survive Reboots

```bash
docker update --restart always resource-planner-db
```

Combined with Docker Desktop set to start on Windows login, this means no manual DB startup ever needed.

### 10.3 Environment Variables (.env)

```env
DATABASE_URL=postgresql://admin:admin@localhost:5432/resource_planner?schema=public
```

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

1. **Complete Resources screen** (`/resources`) — API routes + UI per Section 7.2
2. **Apply be.brussels colour scheme** globally (sidebar `#1a2f4e`, primary `#185FA5`, background `#f4f6f8`)
3. **Discover Jira custom field IDs** then finish field mapping in Jira sync (`year`, `initiativeType`, etc.)
4. **Validate Power BI reports** against `v_allocation_costs` on local Docker Postgres (refresh model after view changes)
5. **Production deployment** — Dockerfile + K8s manifests with DevOps team

### 11.3 Changelog — v1.2 (April 2026)

Consolidated documentation of major changes since the initial design doc:

- **Product model** — `Product` table + `Initiative.productId`; SAP EOTP split into `sapEotpCode` / `sapEotpName`; optional org/marketing fields (`productFamily`, `division`, `subDivision`, `team`, scores).
- **API** — `GET /api/products`, `GET /api/products/[id]`.
- **Jira sync** — Resolves `productId` from components ↔ `Product.name` (case-insensitive).
- **Single production seed** — One `scripts/seed-production.ts` (merged former alternate script): CSV merge rules, `RateStandard` fallback path, `createCostView()` with product join and corrected cost/FTE/`calculated_man_days` logic.
- **Allocations CSV merge** — Duplicate MAT×RI rows: **sum** `quantity` (%); **first positive man-days** in CSV order wins (not summed).
- **`SEED_PROD_RESET`** — Clears planner tables but **preserves** `product`.
- **Power BI view** — Extra columns (`allocation_id`, `power_id`, product dimensions, SAP, `effective_days_per_year`); staff FTE columns populated from man-days via implied FTE; direct-cost quantity path uses per-unit days from the individual rate or **1** if absent (see §2.6 — avoids treating missing licence rates as 200 “man-days”).
- **Direct cost without rate row (v1.2.1)** — `createCostView()` in `seed-production.ts` / `seed.ts`: DIRECT_COST quantity and `effective_days_per_year` default to a **unit multiplier of 1** when there is no matching `Rate` for the initiative year, instead of falling back to INTERNAL `RateStandard` (200 days). Dropped unused `rs_dc` join from the prod view.
- **Initiatives Product card (v1.2.2)** — Flat `InitiativeDTO` + `JSON.parse(JSON.stringify)` on the server list; client fetches full **`Product`** via `/api/products/[id]` (or list + name match) on selection so SAP/org fields display reliably despite `dynamic(..., { ssr: false })` (see §6.3). `initiatives-dynamic-shell.tsx` wraps the page client.
- **Migrations** — When altering columns referenced by `v_allocation_costs`, migrations may need `DROP VIEW IF EXISTS v_allocation_costs` first.
- **Repository** — Large or sensitive production CSVs may be gitignored; initiative/assignment exports are excluded from version control by policy.

---

## 12. Project File Structure

```
src/
  app/
    layout.tsx                  ← Root layout (nav sidebar, header)
    initiatives/page.tsx              ← Server: loads initiatives + products → DTO list
    initiatives/initiatives-dynamic-shell.tsx  ← dynamic(ssr:false) wrapper for initiatives UI
    initiatives/initiatives-client.tsx ← Client: filters, Product card + API catalog fetch, allocations
    resources/page.tsx          ← Resources screen (in progress)
    api/
      jira/sync/route.ts        ← Jira sync (in progress)
      allocations/route.ts      ← GET by initiative, POST
      allocations/[id]/route.ts ← PATCH, DELETE
      resources/[id]/route.ts   ← GET, PATCH, DELETE
      rates/route.ts            ← GET by resource, POST
      rates/[id]/route.ts       ← PATCH, DELETE
  generated/prisma/             ← Auto-generated Prisma client (do not edit)
  lib/prisma.ts                 ← Prisma singleton with PrismaPg adapter
prisma/
  schema.prisma                 ← Database schema (source of truth)
  migrations/                   ← Migration history
  config.ts                     ← Prisma 7 config (datasource URL)
scripts/
  seed.ts                       ← Dev seed from PowerApps CSV exports
  seed-products.ts              ← Upsert Product rows from PRODUCTS.csv
  seed-production.ts            ← Prod seed + v_allocation_costs definition
  data/                         ← PowerApps CSV files (dev)
  data-prod/                    ← Excel CSV files (production migration)
```

---

*Last updated: April 2026 — Resource Planner v1.2.2 (see §11.3 changelog)*
