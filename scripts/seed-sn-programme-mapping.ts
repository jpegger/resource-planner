/**
 * Upserts `sn_programme_mapping` from `SN_PROGRAMME_MAPPING.csv`.
 *
 *   npm run db:seed:sn-programmes
 *
 * Columns: sn_programme_name, sn_programme_eotp (optional), allocation_entity_id (optional), notes
 *
 * Path: resolveDatasetCsvPath (see seed-dataset-helpers.ts).
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

const FILENAME = "SN_PROGRAMME_MAPPING.csv";

async function main(): Promise<void> {
  const csvPath = resolveDatasetCsvPath(FILENAME);
  if (!fs.existsSync(csvPath)) {
    console.error(`Missing ${FILENAME}: ${csvPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");

  console.log(`Seeding sn_programme_mapping from ${path.relative(process.cwd(), csvPath)} (${rows.length} rows)…`);

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const snProgrammeName = (row["sn_programme_name"] ?? "").trim();
    if (!snProgrammeName) {
      skipped++;
      continue;
    }
    const snProgrammeEotp = (row["sn_programme_eotp"] ?? "").trim() || null;
    const allocationEntityIdRaw = (row["allocation_entity_id"] ?? "").trim();
    const allocationEntityId = allocationEntityIdRaw || null;
    const notes = (row["notes"] ?? "").trim() || null;

    if (allocationEntityId) {
      const ae = await prisma.allocationEntity.findUnique({
        where: { id: allocationEntityId },
        select: { id: true },
      });
      if (!ae) {
        console.warn(`  ⚠ Unknown allocation_entity_id ${allocationEntityId} for "${snProgrammeName}" — skipped`);
        skipped++;
        continue;
      }
    }

    await prisma.snProgrammeMapping.upsert({
      where: { snProgrammeName },
      create: {
        snProgrammeName,
        snProgrammeEotp,
        allocationEntityId,
        notes,
      },
      update: {
        snProgrammeEotp,
        allocationEntityId,
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
