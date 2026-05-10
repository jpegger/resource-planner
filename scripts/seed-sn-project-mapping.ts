/**
 * Upserts `sn_project_mapping` from `SN_PROJECT_MAPPING.csv`.
 *
 *   npm run db:seed:sn-projects
 *
 * Columns: sn_project_nr, sn_project_name (optional), initiative_id (Jira key, optional), year (optional), notes
 *
 * Rows match on (sn_project_nr, year) where year may be empty → null.
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

const FILENAME = "SN_PROJECT_MAPPING.csv";

async function main(): Promise<void> {
  const csvPath = resolveDatasetCsvPath(FILENAME);
  if (!fs.existsSync(csvPath)) {
    console.error(`Missing ${FILENAME}: ${csvPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");

  console.log(`Seeding sn_project_mapping from ${path.relative(process.cwd(), csvPath)} (${rows.length} rows)…`);

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const snProjectNr = (row["sn_project_nr"] ?? "").trim();
    if (!snProjectNr) {
      skipped++;
      continue;
    }
    const snProjectName = (row["sn_project_name"] ?? "").trim() || null;
    const initiativeIdRaw = (row["initiative_id"] ?? "").trim();
    const initiativeId = initiativeIdRaw || null;
    const yearRaw = (row["year"] ?? "").trim();
    const year =
      yearRaw === "" ? null : Number.isFinite(Number.parseInt(yearRaw, 10)) ? Number.parseInt(yearRaw, 10) : null;
    if (yearRaw !== "" && year === null) {
      console.warn(`  ⚠ Bad year for ${snProjectNr} — skipped`);
      skipped++;
      continue;
    }
    const notes = (row["notes"] ?? "").trim() || null;

    if (initiativeId) {
      const ini = await prisma.initiative.findUnique({
        where: { id: initiativeId },
        select: { id: true },
      });
      if (!ini) {
        console.warn(`  ⚠ Unknown initiative_id ${initiativeId} for ${snProjectNr} — skipped`);
        skipped++;
        continue;
      }
    }

    const existing = await prisma.snProjectMapping.findFirst({
      where: { snProjectNr, year },
    });

    if (existing) {
      await prisma.snProjectMapping.update({
        where: { id: existing.id },
        data: { snProjectName, initiativeId, notes },
      });
    } else {
      await prisma.snProjectMapping.create({
        data: { snProjectNr, snProjectName, initiativeId, year, notes },
      });
    }
    upserted++;
  }

  console.log(`Done. ${upserted} upserted/updated, ${skipped} skipped.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
