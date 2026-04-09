# Baseline migration: rename legacy tables/columns + single clean history

**Status:** Implemented — single migration `20260405120000_baseline`, table `allocation_entity`, columns `allocation_entity_id` on `initiative` and `eotp_routing`.

This document plans a **one-shot** schema baseline: drop the stacked migration history, add a **single** migration that matches the **target** Prisma schema, and update all **raw SQL** so names stay consistent. **`scripts/data-prod/*.csv` file layouts stay unchanged** — seeds already map CSV columns to Prisma fields, not to physical table names.

---

## Goals

1. **Rename** misleading physical names to match the domain:
   - Table `product` → **`allocation_entity`**
   - Column `initiative."productId"` → **`allocation_entity_id`** (FK to `allocation_entity.id`)
   - Column `eotp_routing."productId"` → **`allocation_entity_id`**
2. **Remove** Prisma `@map(...)` on those pieces where the DB name now matches the intended name (optional: keep `@map` only where you still want different Prisma vs SQL spelling).
3. **Replace** the long `prisma/migrations/*` chain with **one** initial migration (clean git history, easier reviews).
4. **Keep** seeding from **`scripts/data-prod/`** CSVs (same headers and merge rules as today).

Non-goals (unless you explicitly add them later):

- Renaming **every** column to `snake_case` project-wide (large diff; can be phase 2).
- Changing **Power BI** connection strings / saved queries (you must refresh those after deploy).

---

## Target naming (physical PostgreSQL)

| Current | Target |
|--------|--------|
| `"product"` | `"allocation_entity"` |
| `initiative."productId"` | `initiative."allocation_entity_id"` |
| `eotp_routing."productId"` | `eotp_routing."allocation_entity_id"` |

**Unchanged** table names (already clear or standard): `resource`, `rate`, `rate_standard`, `initiative`, `allocation`, `eotp_routing`.

**Enums** (already in schema): `AllocationEntityType`, `ProductFamily` (if applied), etc. — generated in the single baseline migration.

**Views** (not tables): `v_allocation_costs`, `v_eotp_costs` — **dropped before** any table rename, then **recreated** from updated SQL in `seed-production.ts` / `scripts/eotp-views.ts` / `recreate-eotp-costs-view.ts` using the new table/column names.

---

## Prisma schema edits (summary)

- `model AllocationEntity` → `@@map("allocation_entity")` (remove `@@map("product")`).
- `Initiative.allocationEntityId` → `@map("allocation_entity_id")` (remove `@map("productId")`).
- `EotpRouting.allocationEntityId` → `@map("allocation_entity_id")` (remove `@map("productId")`).
- Regenerate client: `npx prisma generate`.

---

## Code / SQL inventory to update (grep-driven)

After renaming, search and fix **raw SQL** and comments:

| Area | What to fix |
|------|-------------|
| `scripts/seed-production.ts` | `createCostView()` — `FROM product` → `allocation_entity`; `i."productId"` → `i."allocation_entity_id"`; `LEFT JOIN product p` → `LEFT JOIN allocation_entity ...` |
| `scripts/eotp-views.ts` | Same table/column names in CTEs joining catalog + initiatives + `eotp_routing` |
| `scripts/rebuild-eotp-routing-csv.ts`, `scripts/convert-eotp-routing-csv.ts` | `FROM product`, `i."productId"` |
| `src/app/api/allocation-entities/with-budget/route.ts` | `FROM product pr`, `i."productId"` |
| `prisma/migrations/*` | **Replaced** by new baseline — old files deleted |

**No change** to CSV column names: `PRODUCTS.csv` still has `productFamily`, etc.; `seed-products.ts` continues to map rows into `AllocationEntity` fields.

---

## Single baseline migration: procedure

### A. Development (empty or disposable DB)

1. **Optional:** `pg_dump` if you need to preserve data from an existing dev DB.
2. **Delete** the folder contents of `prisma/migrations/` (or remove the directory and recreate), **except** you will add **one** new migration.
3. Update `schema.prisma` with target `@@map` / `@map` as above (and any enum/table definitions you already have).
4. Generate SQL for a full schema:
   - **Option 1:** `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/YYYYMMDD000000_baseline/migration.sql`
   - **Option 2:** `npx prisma migrate dev --name baseline` against an **empty** database (creates migration from schema).
5. Run `npx prisma migrate deploy` (or `migrate dev`) on the empty DB → verify tables and FKs.
6. Run seeds: `db:seed:products`, `db:seed:prod` (or your usual order) → confirm **`data-prod`** loads.
7. Run `npm run db:recreate:eotp-costs` (or full prod seed path) so views exist.

### B. Production (existing data)

**Squashing migrations does not move data by itself.** Choose one:

1. **Greenfield:** drop DB, run baseline migration, re-seed from `data-prod` (you said you’re OK with clean schema — often acceptable for internal tools).
2. **Keep data:** write a **one-off** SQL script (or use `prisma migrate diff` from old → new schema) that:
   - `DROP VIEW IF EXISTS` dependent views,
   - `ALTER TABLE ... RENAME` / `RENAME COLUMN`,
   - recreate FK constraints if needed,
   - then deploy the **same** final schema as dev.

For (2), the **easiest** path is often: **dump** → restore to staging → run rename migration → validate → production maintenance window.

---

## Seed compatibility checklist (`data-prod`)

| CSV / script | Notes |
|--------------|--------|
| `PRODUCTS.csv` | Still `id,name,productFamily,...` — maps to `AllocationEntity` fields only |
| `RATES.csv`, `RESSOURCES.csv`, `JIRA.csv`, `Assignement.csv`, etc. | Unchanged; FKs still `MAT-*`, `RI-*`, `PRD-*` |
| `EOTP_ROUTING.csv` | Still `productName` → resolved by **name** to `allocation_entity.id` in code |
| `seed-production.ts` | Only **view SQL** and any literal `product` / `productId` strings change |

---

## Post-deploy

- **Power BI:** refresh credentials if needed; update any native SQL that referenced `product` or `"productId"`.
- **Docs:** `CONTEXT.md` §4 / §5 / §12 — replace old physical names with `allocation_entity` / `allocation_entity_id`.
- **CI:** run `npx prisma migrate deploy` + seed smoke test on a fresh Postgres instance.

---

## Risks

- **Missed raw SQL** → runtime errors on API routes or seed. Mitigation: repo-wide grep for `product`, `"productId"`, `FROM product`, `JOIN product`.
- **View dependency order** — always drop `v_eotp_costs` / `v_allocation_costs` before altering underlying tables.

---

## Suggested order of implementation (when you execute)

1. Update `schema.prisma` maps and enums.
2. Add single baseline migration SQL (diff from empty).
3. Update all raw SQL files listed above + any grep hits.
4. `prisma generate` → `tsc` → run seeds against empty DB.
5. Update `CONTEXT.md` and optional changelog.
6. Remove old migration folders after the new baseline is merged and verified.

This plan keeps **CSV contracts stable** while aligning **database identifiers** with **AllocationEntity** naming for long-term maintenance.
