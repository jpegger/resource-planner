# Resource Planner — Session 1 Setup Guide

## Stack
- **Next.js 14** (App Router, TypeScript, Tailwind)
- **Prisma ORM** → your company PostgreSQL cluster
- **Power BI** → connects directly to `v_allocation_costs` view

---

## Step 1 — Scaffold the Next.js app

```bash
npx create-next-app@latest resource-planner \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*"

cd resource-planner
```

---

## Step 2 — Install dependencies

```bash
# Prisma
npm install prisma @prisma/client
npx prisma init

# Seed script dependencies
npm install --save-dev ts-node @types/node papaparse
npm install --save-dev @types/papaparse

# UI components (run the shadcn init, accept defaults)
npx shadcn@latest init
npx shadcn@latest add table button input select badge card
```

---

## Step 3 — Configure database connection

Edit `.env`:
```env
DATABASE_URL="postgresql://YOUR_USER:YOUR_PASSWORD@YOUR_HOST:5432/YOUR_DATABASE?schema=public"
```

> Ask your DBA for the connection string. Make sure your machine can reach the cluster (VPN if needed).

---

## Step 4 — Add the Prisma schema

Replace the contents of `prisma/schema.prisma` with the file provided (`schema.prisma`).

---

## Step 5 — Run the migration

```bash
npx prisma migrate dev --name init
```

This creates all tables in your PostgreSQL database.

Check in Prisma Studio:
```bash
npx prisma studio
```

---

## Step 6 — Prepare CSV files for seeding

Create the folder `scripts/data/` and copy your 5 CSV exports there, renaming them exactly:

| Your export file | Rename to |
|---|---|
| `Ressources_2026-03-29.csv` | `Ressources.csv` |
| `Rates_2026-03-29.csv` | `Rates.csv` |
| `RateStandard_2026-03-29.csv` | `RateStandard.csv` |
| `Initiatives_2026-03-29.csv` | `Initiatives.csv` |
| `InitiativeRessourceAssignement_2026-03-29.csv` | `InitiativeRessourceAssignement.csv` |

---

## Step 7 — Copy the seed script

Copy `seed.ts` into `scripts/seed.ts`.

Add this to `tsconfig.json` (under `compilerOptions`):
```json
"ts-node": {
  "compilerOptions": {
    "module": "CommonJS"
  }
}
```

---

## Step 8 — Run the seed

```bash
npx ts-node scripts/seed.ts
```

Expected output:
```
🌱 Starting seed...

Seeding resources...
  ✓ Resources: 585 upserted, 3 skipped        ← 3 dirty type rows skipped

Seeding individual rates...
  ✓ Individual rates: 510 upserted, 13 skipped ← 13 orphaned rows skipped

Seeding standard rates...
  ✓ Standard rates: 10 upserted, 0 skipped

Seeding initiatives...
  ✓ Initiatives: 1165 upserted, 0 skipped

Seeding allocations...
  ✓ Allocations: ~2715 upserted, 0 skipped

Creating v_allocation_costs view...
  ✓ View v_allocation_costs created

✅ Seed complete.
```

---

## Step 9 — Connect Power BI

In Power BI Desktop:
1. **Get Data → PostgreSQL database**
2. Host: `YOUR_HOST`, Database: `YOUR_DATABASE`
3. In Navigator, select `v_allocation_costs`
4. Your existing reports built on the Excel structure should map cleanly —
   the view exposes: `product`, `product_group`, `direction`, `cellule`,
   `resource_type`, `initiative_year`, `computed_cost`

> **Recommended**: ask your DBA to create a read-only `powerbi_reader` role:
> ```sql
> CREATE ROLE powerbi_reader WITH LOGIN PASSWORD 'choose_a_password';
> GRANT USAGE ON SCHEMA public TO powerbi_reader;
> GRANT SELECT ON ALL TABLES IN SCHEMA public TO powerbi_reader;
> ```

### Planning vs budget baseline (snapshots and SAP baselines)

Use this after you have created at least one **allocation snapshot** and one **budget baseline** in the app (`/budget-comparison`), and run `SEED_VIEW_ONLY=1 npm run db:seed:prod` (or a full `db:seed:prod`) so `v_snapshot_detail`, `v_baseline_detail`, `dim_year`, and `dim_eotp` exist.

1. **Get Data → PostgreSQL** — same connection as above.
2. Import these objects: `v_snapshot_detail`, `v_baseline_detail`, `dim_year`, `dim_eotp`.
3. In **Model**, relate:
   - `dim_year[year]` → `v_snapshot_detail[year]` (many-to-one, single direction)
   - `dim_year[year]` → `v_baseline_detail[year]` (many-to-one, single direction)
   - `dim_eotp[eotp]` → `v_snapshot_detail[eotp]` (many-to-one, single direction — `dim_eotp` is the one side)
   - `dim_eotp[eotp]` → `v_baseline_detail[eotp]` (many-to-one, single direction)
4. In table visuals, put **`dim_eotp[eotp]`** (and **`dim_eotp[eop_label]`** if needed) on rows so measures from both fact tables filter per EOTP. Set `year` on both fact-like tables to **Don’t summarize** where Power BI treats them as dimensions.

**Measures** (adjust table names if your model renames the views):

```dax
Planned Catchout = SUM(v_snapshot_detail[catchout])

Baseline Amount = SUM(v_baseline_detail[baseline_amount])

Gap = [Baseline Amount] - [Planned Catchout]
```

Build the report with slicers on `dim_year[year]`, `v_snapshot_detail[snapshot_name]`, and `v_baseline_detail[baseline_name]`; compare **EOTP** lines and gaps in a table. Gap interpretation: baseline is external + direct (catchout) scope; internal amounts on `v_snapshot_detail` are for reference.

---

## Production seed (`scripts/data-prod/`)

Order matters: **allocation entities** (from `PRODUCTS.csv`) must exist before initiatives so Jira `Components` resolve to `allocation_entity_id`.

```bash
# 1. Products first (requires scripts/data-prod/PRODUCTS.csv)
npm run db:seed:products

# 2. Full production seed (resources, rates, initiatives, allocations)
SEED_PROD_RESET=1 npm run db:seed:prod
```

Recreate the Power BI view only (no CSV import): `npm run db:view:prod` or `SEED_VIEW_ONLY=1 npm run db:seed:prod`.

---

## What's Next (Session 2)

Build the Jira sync API route:
- `GET /api/jira/sync` — fetches your filter, upserts initiatives
- Needs: Jira base URL, email, API token (in `.env.local`)
- Prompt for Cursor: *"Create a Next.js App Router API route at app/api/jira/sync/route.ts
  that calls the Jira REST API search endpoint with JQL filter ID [YOUR_FILTER_ID],
  maps the fields [PowerId, jira_key, summary, status, year, components, productGroup,
  initiativeType] and upserts them into the Initiative table using Prisma"*

---

## Cost Formula Reference

| Resource type | Condition | Formula |
|---|---|---|
| `DIRECT_COST` | always | `quantity × rate (initiative year)` |
| `INTERNAL` / `EXTERNAL` | man-days billing | `man_days × effective_rate` |
| `INTERNAL` / `EXTERNAL` | %FTE billing | `quantity × days_per_year × effective_rate` |

**Rate resolution** (always by initiative year, not current year):
1. Individual `Rate` for that resource + initiative year → use it
2. No individual rate → fall back to `RateStandard` for that type + initiative year
