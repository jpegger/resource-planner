# Resource Planner

Internal resource-planning tool for Brussels Capital Region (Paradigm).

- **Primary UI routes**: `/investments`, `/investments/[id]`
- **ORM**: Prisma 7 (generated client in `src/generated/prisma`) + **`@prisma/adapter-pg`** (PrismaPg)
- **Reporting**: Power BI connects to **PostgreSQL views** (never raw tables): `v_allocation_costs`, `v_eotp_costs`, `v_revenues`, `v_snapshot_detail`, `v_baseline_detail`, `dim_year`, `dim_eotp`

For the full design doc and business rules, see `CONTEXT.md`.

---

## Prerequisites

- Node.js **20**
- Docker (for local Postgres) or access to the company PostgreSQL cluster

---

## Quick start (local DB)

```bash
npm install
npm run db:up
npm run db:migrate
npm run db:seed:prod
npm run dev
```

App runs on `http://localhost:3000`.

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

### Seed flags (production seed)

```bash
# Upsert (default)
npm run db:seed:prod

# Full reload (clears planner tables; preserves allocation_entity)
SEED_PROD_RESET=1 npm run db:seed:prod

# Views only (no CSV import): v_allocation_costs, v_eotp_costs, v_revenues, snapshot/baseline views, dim_* tables
SEED_VIEW_ONLY=1 npm run db:seed:prod
```

---

## Tests

The test suite includes SQL/view validation tests and **requires a running Postgres** at `DATABASE_URL`:

```bash
npm test
```

If you see `Can't reach database server at 127.0.0.1:5432`, start the DB (`npm run db:up`) or fix `DATABASE_URL`.

---

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
