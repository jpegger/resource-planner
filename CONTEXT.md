# Resource Planner — Application Design Document

**Paradigm · Brussels Capital Region · v1.1 · April 2026**

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

To enable capacity reporting in Power BI regardless of how the allocation was entered, the view exposes a single `calculated_man_days` column:

```
If DIRECT_COST        → 0 (not applicable)
If manDays > 0        → use manDays directly
If quantity > 0 (FTE) → quantity × nbrDaysPerYear
```

This means Power BI can always `SUM(calculated_man_days)` across a team or initiative without needing to know how each allocation was entered.

### 2.7 FTE % in the Power BI View

FTE % is exposed in two columns for Internal and External resources only (0 for Direct Costs):

```
fte_decimal = quantity        (e.g. 0.5)  — only when FTE method used, else 0
fte_percent = quantity × 100  (e.g. 50)   — only when FTE method used, else 0
```

When the man-days method is used, these columns are 0 — Power BI should derive FTE % from `calculated_man_days / nbrDaysPerYear × 100` if needed.

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

Five models. All IDs are preserved from the source systems (PowerApps/Jira) to maintain traceability. Cost is never stored — always computed at query time.

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

### 4.3 RateStandard

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

### 4.4 Initiative

Synced from Jira via the `/api/jira/sync` route. The `jiraKey` (RI-xxx) is the natural primary key used across all relations. `powerId` (INI-xxx) is mostly null in practice and kept for reference only. The `year` field is critical — it drives rate resolution for all allocations on this initiative.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK. jira_key: RI-xxx |
| `powerId` | String? | | INI-xxx. Unique. Mostly null in current data. |
| `summary` | String | ✓ | Initiative title from Jira |
| `status` | String | ✓ | Kept as String — Jira values vary (Done, In Progress, RFP, etc.) |
| `year` | Int | ✓ | Planning year. CRITICAL — drives all rate resolution. |
| `components` | String? | | Jira components field = Product (CRM, BOS, IRISBOX, etc.) |
| `productGroup` | String? | | Higher grouping (SALES, SMART ADMIN, eCITIZEN, etc.) |
| `initiativeType` | String? | | Run, Evolution, Rollout, Projet, Analyse, etc. |
| `allocations` | Allocation[] | | Relation — all resource assignments for this initiative |
| `createdOn` | DateTime | ✓ | |
| `modifiedOn` | DateTime | ✓ | |

### 4.5 Allocation

One row per resource × initiative assignment. The `manDays` and `quantity` fields are mutually exclusive in practice. Cost is never stored — derived at query time using the initiative's year to resolve the applicable rate. Direct Costs use `quantity` as unit count, not FTE %.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | String | ✓ | PK. ASS-{hash} — generated from resourceId + initiativeId + values |
| `externalId` | String? | | Unique. Original external ID from PowerApps system. |
| `initiativeId` | String | ✓ | FK → Initiative.id (RI-xxx) |
| `resourceId` | String | ✓ | FK → Resource.id (MAT-xxx) |
| `manDays` | Float? | | Man-day billing method. Takes precedence over quantity if > 0. |
| `quantity` | Float? | | FTE decimal for Internal/External (0.5 = 50%). Units for Direct Costs. |
| `createdOn` | DateTime | ✓ | |
| `modifiedOn` | DateTime | ✓ | |

### 4.6 Entity Relationship Summary

```
Resource (1) ──── (N) Rate          [resourceId + year — unique]
Resource (1) ──── (N) Allocation    [resourceId]
Initiative (1) ── (N) Allocation    [initiativeId]
RateStandard     ── (no FK)         [joined by type + year at query time]
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
| `initiative_year` | Planning year — drove rate resolution |
| `product` | Jira components field |
| `product_group` | Higher product grouping (`&` replaced with `and`, NULL → `Unassigned`) |
| `initiative_type` | Run / Evolution / Rollout / etc. |
| `status` | Initiative status from Jira |
| `resource_name` | Full name of resource |
| `resource_type` | INTERNAL \| EXTERNAL \| DIRECT_COST |
| `cellule` | Resource cell |
| `direction` | Resource direction |
| `effective_rate` | Resolved daily rate (individual or standard fallback) |
| `computed_cost` | Total cost — all types |
| `internal_cost` | Cost if INTERNAL, else 0 |
| `external_cost` | Cost if EXTERNAL, else 0 |
| `direct_cost` | Cost if DIRECT_COST, else 0 |
| `fte_decimal` | FTE as decimal (0.5) — Internal/External FTE method only, else 0 |
| `fte_percent` | FTE as percent (50) — Internal/External FTE method only, else 0 |
| `calculated_man_days` | Unified man-days — direct or derived from FTE. 0 for Direct Costs. |

**Key guarantee:** `internal_cost + external_cost + direct_cost = computed_cost` for every row.

---

## 6. Application Architecture

### 6.1 Data Flow

```
Jira API  →  /api/jira/sync  →  Initiative table (upsert by jira_key)
Excel CSVs  →  seed-production.ts  →  All 5 tables (one-time migration)
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

---

## 7. Application Screens

### 7.1 Initiatives (/initiatives) — Complete

Master-detail layout. Left panel: scrollable filtered list of all initiatives. Right panel: read-only details + editable allocation grid.

- **Filters** — Text search (case-insensitive contains on key/summary/product/group), Year dropdown, Product dropdown, Group dropdown, Reset button
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
| `seed-production.ts` | `npm run db:seed:prod` | `scripts/data-prod/*.csv` | Prod seed from Excel exports using ID fields for linking |

### 9.1 Production Seed — Run Modes

```bash
# Full reload (truncate then import)
SEED_PROD_RESET=1 npm run db:seed:prod

# Upsert only (leave existing data not in CSV untouched)
npm run db:seed:prod

# Recreate view only — no CSV import
SEED_VIEW_ONLY=1 npm run db:seed:prod
```

### 9.2 Production Seed Notes

- **Files required** — `JIRA.csv`, `RESSOURCES.csv`, `RateStandard.csv`, `RATES.csv`, `Assignement.csv` in `scripts/data-prod/`
- **ID-based linking** — All linking uses ID fields directly: `InitiativeId` (RI-xxx) → `initiative.id`, `RessourceId` (MAT-xxx) → `resource.id`. No string matching.
- **Number format** — Swiss apostrophe thousands separator (`1'100`) stripped before parsing
- **Percent & ManDays format** — Both columns carry a trailing `%` sign in the source CSV and are stored on a ×100 scale. Both are divided by 100 before storing: `34%` → `0.34`, `22000%` → `220 man-days`.
- **Rate ID uniqueness** — The CSV `RateId` field is not unique (duplicate IDs assigned to different resources). The seed generates a deterministic ID from `hash(resourceId|year)` instead.
- **RESSOURCES blank rows** — Only 613 of 1,721 rows have an ID. The other 1,108 are blank Excel rows — skipped automatically.
- **Truncate before reseed** — Run this before `SEED_PROD_RESET=1` if needed:

```bash
npx prisma db execute --stdin <<< "
TRUNCATE TABLE allocation, rate, rate_standard, initiative, resource
RESTART IDENTITY CASCADE;
"
```

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
3. **Discover Jira custom field IDs** then build Jira sync route using jira.js
4. **Validate Power BI reports** against `v_allocation_costs` on local Docker Postgres
5. **Production deployment** — Dockerfile + K8s manifests with DevOps team

---

## 12. Project File Structure

```
src/
  app/
    layout.tsx                  ← Root layout (nav sidebar, header)
    initiatives/page.tsx        ← Initiatives master-detail screen (complete)
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
  seed-production.ts            ← Prod seed from Excel exports
  data/                         ← PowerApps CSV files (dev)
  data-prod/                    ← Excel CSV files (production migration)
```

---

*Last updated: April 2026 — Resource Planner v1.1*
