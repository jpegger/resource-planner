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

The production seed (`npm run db:seed:prod`) reads from `scripts/datasets/prod-import/` by default.\nIf you need to import from a different directory, set `SEED_DATASET_DIR=/absolute/or/relative/path`.

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
