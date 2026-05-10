/**
 * Upserts `sf_master_product_mapping` only, from `SF_MASTER_PRODUCT_MAPPING.csv`.
 *
 * Usage:
 *   npm run db:seed:sf-master-products
 *
 * CSV resolution (same order as `seed-production.ts`):
 *   `SEED_DATASET_DIR/SF_MASTER_PRODUCT_MAPPING.csv` if set and file exists,
 *   else `scripts/datasets/prod-import/…`,
 *   else `scripts/datasets/dev/…`.
 *
 * Requires `allocation_entity` rows (run `npm run db:seed:products` first).
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";
import Papa from "papaparse";

import { resolveDatasetCsvPath } from "./seed-dataset-helpers";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

const FILENAME = "SF_MASTER_PRODUCT_MAPPING.csv";

async function main(): Promise<void> {
  const csvPath = resolveDatasetCsvPath(FILENAME);
  if (!fs.existsSync(csvPath)) {
    console.error(`Missing ${FILENAME}: ${csvPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");

  console.log(`Seeding sf_master_product_mapping from ${path.relative(process.cwd(), csvPath)} (${rows.length} CSV rows)…`);

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const sfMasterProductName = (row["sf_master_product_name"] ?? "").trim();
    const allocationEntityId = (row["allocation_entity_id"] ?? "").trim();
    const sfMasterProductKey = (row["sf_master_product_key"] ?? "").trim() || null;
    const notes = (row["notes"] ?? "").trim() || null;

    if (!sfMasterProductName || !allocationEntityId) {
      skipped++;
      continue;
    }

    const ae = await prisma.allocationEntity.findUnique({
      where: { id: allocationEntityId },
      select: { id: true },
    });
    if (!ae) {
      console.warn(`  ⚠ Unknown allocation_entity_id ${allocationEntityId} for "${sfMasterProductName}" — skipped`);
      skipped++;
      continue;
    }

    await prisma.sfMasterProductMapping.upsert({
      where: { sfMasterProductName },
      create: {
        sfMasterProductName,
        allocationEntityId,
        sfMasterProductKey,
        notes,
      },
      update: {
        allocationEntityId,
        sfMasterProductKey,
        notes,
      },
    });
    upserted++;
  }

  console.log(`Done. ${upserted} upserted, ${skipped} skipped.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
