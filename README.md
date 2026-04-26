# Resource Planner

Internal resource-planning tool for Brussels Capital Region (Paradigm).

- **Primary UI routes**: `/investments`, `/investments/[id]`
- **ORM**: Prisma 7 (generated client in `src/generated/prisma`) + **`@prisma/adapter-pg`** (PrismaPg)
- **Reporting**: Power BI connects to **PostgreSQL views** (never raw tables): `v_allocation_costs`, `v_eotp_costs`, `v_revenues`, `v_snapshot_detail`, `v_baseline_detail`, `dim_year`, `dim_eotp`

For the full design doc and business rules, see `CONTEXT.md`.

---

## Prerequisites

- Node.js **20** (Prisma/tooling effectively requires **≥ 20.19** — run `nvm use` if you use NVM; see `.nvmrc`)
- Docker (for local Postgres) or access to the company PostgreSQL cluster

---

## Quick start (local DB)

```bash
nvm use
npm install
npm run db:up
npm run db:migrate
npm run db:seed:prod
npm run dev
```

App runs on `http://localhost:3000`.

---

## Docker (production image, no registry required)

Build a local image and run the **Next.js standalone** server (listens on **8080** in the container):

```bash
npm run docker:build
```

**Database host from inside the app container**

- **`127.0.0.1` inside the container is not your host** — use the Postgres **container name** on a **shared Docker network** (recommended), or `host.docker.internal` (Docker Desktop; on Linux add `--add-host=host.docker.internal:host-gateway`).

Example when Postgres is the container `resource-planner-db` on network `rp`:

```bash
docker run --rm -p 3000:8080 --network rp \
  -e DATABASE_URL="postgresql://admin:admin@resource-planner-db:5432/resource_planner?schema=public" \
  resource-planner:local
```

- **`GET /api/health`** — JSON probe for Kubernetes/OpenShift (`200` when the process is up).
- **Migrations**: run `npm run db:migrate` with the same `DATABASE_URL` your container uses (CI, init Job, or shell) — not automatically on every container start.

**After you change application code**, rebuild the image (the image embeds the built app):

```bash
docker build -t resource-planner:local .
# or
npm run docker:build
```

Use `docker build --no-cache` only if you suspect stale layers. Changing **only** `DATABASE_URL` or other `-e` values does **not** require a rebuild — restart the container with the new env.

**Compose**

- **Postgres only** (default): `npm run db:up` / `docker compose up -d` — container `resource-planner-db` on port **5432**.
- **App + Postgres** (build from this repo, no registry): `npm run docker:up` — app on `http://localhost:3000` (rebuilds with `--build`).

See **`deploy/README.md`** for Kubernetes/OpenShift notes and **`deploy/kubernetes/deployment.yaml`** for a minimal example.

---

## Environment variables

Create `.env` (never commit it):

```env
DATABASE_URL=postgresql://admin:admin@localhost:5432/resource_planner?schema=public

# Optional (only needed for Jira sync)
JIRA_HOST=https://your-company.atlassian.net
JIRA_EMAIL=your.email@company.be
JIRA_TOKEN=your_api_token_from_jira_profile
JIRA_FILTER_ID=12345

# Optional overrides
# Use a raw JQL instead of a saved filter:
# JIRA_JQL=project = RI AND status in (Done, "In Progress", RFP, "Selected for Development") ORDER BY component, summary ASC
#
# JQL for syncing Product work items into AllocationEntity:
# JIRA_PRODUCT_JQL=issuetype = Product
```

Notes:
- `src/generated/prisma/` is gitignored. It is generated on `npm install` via `postinstall` (`prisma generate`).
- After schema changes: run `npx prisma migrate dev`, `npx prisma generate`, then `rm -rf .next` and restart the dev server.

---

## Database lifecycle

```bash
npm run db:up
npm run db:down
```

Open Prisma Studio:

```bash
npx prisma studio
```

---

## Seeding

### Full seed (recommended order)

This order matches how foreign keys / views depend on each other:

```bash
npm run db:migrate
npm run db:seed:eotp          # EOTP catalog
npm run db:seed:products      # allocation_entity master data (PRODUCTS.csv)
npm run db:seed:prod          # resources/rates/initiatives/allocations + recreate planner views
npm run db:seed:routing       # optional (EOTP routing exceptions)
npm run db:seed:revenues      # optional (initiative revenue lines)
```

### Seed datasets (where CSVs live)

- **Production import dataset** (generated from Excel, imported on demand): `scripts/datasets/prod-import/`
- **Dev/test dataset**: `scripts/datasets/dev/`

The production seed (`npm run db:seed:prod`) reads from `scripts/datasets/prod-import/` by default.

If you need to import from a different directory, set `SEED_DATASET_DIR=/absolute/or/relative/path`.

### Seed flags (production seed)

```bash
# Upsert (default)
npm run db:seed:prod

# Full reload (clears planner tables; preserves allocation_entity)
SEED_PROD_RESET=1 npm run db:seed:prod

# Views only (no CSV import): v_allocation_costs, v_eotp_costs, v_revenues, snapshot/baseline views, dim_* tables
SEED_VIEW_ONLY=1 npm run db:seed:prod
```

Notes:
- `SEED_PROD_RESET=1` clears planner tables (allocations, rates, initiatives, resources) and also clears `eotp_routing` so EOTP splits are not left stale between runs. It preserves the `allocation_entity` catalog.

---

## Tests

The test suite includes SQL/view validation tests and **requires a running Postgres** at `DATABASE_URL`:

### Layer 1 (SQL) tests

```bash
npm test
```

If you see `Can't reach database server at 127.0.0.1:5432`, start the DB (`npm run db:up`) or fix `DATABASE_URL`.

Note for Cursor/IDE-run commands: shells may not automatically load your `.env`. If tests fail with `P1001` but your DB is running, run:

```bash
DATABASE_URL=postgresql://admin:admin@localhost:5432/resource_planner?schema=public npm test
```

### Layer 2 (API) tests

Layer 2 tests hit real HTTP routes (no mocks) and require a running Next.js dev server pointed at the same DB.

Terminal 1:

```bash
DATABASE_URL=postgresql://... npm run dev
```

Terminal 2:

```bash
npm run test:api
```

### Layer 3 (UI) smoke tests

Layer 3 tests use Playwright against the same running dev server.

Terminal 2 (while `npm run dev` is running):

```bash
npm run test:ui
```

---

## Jira sync (`GET /api/jira/sync`)

`/api/jira/sync` performs a two-step sync:

1) **Products** (`issuetype = Product`, or `JIRA_PRODUCT_JQL`) → upserts `AllocationEntity`
   - Match order:
     - **`jiraIssueId`**: `AllocationEntity.jiraIssueId === Jira issue id` (most stable)
     - Else **`jiraKey`**: `AllocationEntity.jiraKey === Jira Product key`
     - Else **exact name**: `AllocationEntity.name === Jira Product summary.trim()` (CSV-seeded rows before first sync attaches ids)
   - If a Product is renamed in Jira, the sync updates `AllocationEntity.name` to the new summary **when possible** (if the new name is already taken by another row, it logs a warning and keeps the old name).
   - If not found, creates a new allocation entity with `id = jiraKey` (collision guard falls back to `PRD-JIRA-${jiraKey}`)
   - Sets Jira metadata fields on the allocation entity (`jiraKey`, `jiraIssueId`, `jiraStatus`, timestamps)
   - Sets `AllocationEntity.source = "jira"` only for Jira-created entities (`seed-products.ts` sets `"csv"`)

2) **Initiatives** (`JIRA_JQL` or `JIRA_FILTER_ID`) → upserts `Initiative` and sets `allocationEntityId` using:
   - Preferred mapping: exactly one outward Product issue link (`issuelinks[].outwardIssue` of issuetype `"Product"`)
   - Fallback: first initiative component name → `AllocationEntity.name` match
   - Ambiguity: multiple outward Product links → no silent choice; stored as an ambiguous mapping source

---

## Jira updater script (create Products + link Initiatives)

This repository also includes a **review-first** CLI that helps you update Jira safely:

- Create missing Jira **Product** issues from `scripts/datasets/dev/PRODUCTS.csv`
- Add **Enables** links from Jira **Initiatives** (scoped by `JIRA_JQL` / `JIRA_FILTER_ID`) to their Product
- Defaults to **dry-run** and produces a timestamped `plan.json` you can review before re-running with `--apply`

### Usage

Dry-run (review 3 → 10 → all):

```bash
npx tsx scripts/jira/update-jira-products-and-links.ts --step products --sample 3
npx tsx scripts/jira/update-jira-products-and-links.ts --step products --sample 10

npx tsx scripts/jira/update-jira-products-and-links.ts --step links --sample 3
npx tsx scripts/jira/update-jira-products-and-links.ts --step links --sample 10
```

Apply (only after review):

```bash
npx tsx scripts/jira/update-jira-products-and-links.ts --step all --sample all --apply
```

### Matching rules

- **Product exists check**: Jira Product `summary.trim()` exact match to CSV `name.trim()`
- **Initiative → Product mapping**: first Initiative component name (exact trim) matches Product `summary`
- **Already-linked detection**: skips initiatives that already have an **Enables** link to a Jira issue of issuetype `Product`

## Power BI notes (planning vs baseline)

After creating at least one snapshot and one baseline in the UI (`/budget-comparison`) and ensuring the views exist (run `SEED_VIEW_ONLY=1 npm run db:seed:prod` if needed):

- Import: `v_snapshot_detail`, `v_baseline_detail`, `dim_year`, `dim_eotp`
- Relationships:
  - `dim_year[year]` → `v_snapshot_detail[year]`
  - `dim_year[year]` → `v_baseline_detail[year]`
  - `dim_eotp[eotp]` → `v_snapshot_detail[eotp]`
  - `dim_eotp[eotp]` → `v_baseline_detail[eotp]`

Example measures:

```dax
Planned Catchout = SUM(v_snapshot_detail[catchout])
Baseline Amount = SUM(v_baseline_detail[baseline_amount])
Gap = [Baseline Amount] - [Planned Catchout]
```
