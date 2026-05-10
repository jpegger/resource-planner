/**
 * Upserts `sap_designation_mapping` only, from `SAP_DESIGNATION_MAPPING.csv`.
 *
 * Usage:
 *   npm run db:seed:sap-designations
 *
 * CSV resolution (same order as `seed-production.ts`):
 *   `SEED_DATASET_DIR/SAP_DESIGNATION_MAPPING.csv` if set and file exists,
 *   else `scripts/datasets/prod-import/…`,
 *   else `scripts/datasets/dev/…`.
 *
 * Rows without `allocation_entity_id` are skipped (pending manual review).
 * Regenerate the CSV from revenue warnings:
 *   `npx dotenv -e .env -- npx tsx scripts/build-sap-designation-mapping-csv.ts`
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

const FILENAME = "SAP_DESIGNATION_MAPPING.csv";

async function main(): Promise<void> {
  const csvPath = resolveDatasetCsvPath(FILENAME);
  if (!fs.existsSync(csvPath)) {
    console.error(`Missing ${FILENAME}: ${csvPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");

  console.log(
    `Seeding sap_designation_mapping from ${path.relative(process.cwd(), csvPath)} (${rows.length} CSV rows)…`
  );

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const sapDesignation = (row["sap_designation"] ?? "").trim();
    const allocationEntityId = (row["allocation_entity_id"] ?? "").trim();
    const sfProductName = (row["sf_product_name"] ?? "").trim() || null;
    const notes = (row["notes"] ?? "").trim() || null;

    if (!sapDesignation || !allocationEntityId) {
      skipped++;
      continue;
    }

    const ae = await prisma.allocationEntity.findUnique({
      where: { id: allocationEntityId },
      select: { id: true },
    });
    if (!ae) {
      console.warn(`  ⚠ Unknown allocation_entity_id ${allocationEntityId} for "${sapDesignation}" — skipped`);
      skipped++;
      continue;
    }

    await prisma.sapDesignationMapping.upsert({
      where: { sapDesignation },
      create: {
        sapDesignation,
        allocationEntityId,
        sfProductName,
        notes,
      },
      update: {
        allocationEntityId,
        sfProductName,
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
