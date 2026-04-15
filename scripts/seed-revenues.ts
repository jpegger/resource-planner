/**
 * Seed InitiativeRevenue from scripts/data-prod/REVENU.csv (one row per CSV line; type = Mission).
 * Idempotent: delete-then-insert for affected initiatives.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { RevenueType, PrismaClient } from "../src/generated/prisma/client";
import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

const DATA_DIR = path.join(__dirname, "data-prod");

function parseRevenue(raw: string): number {
  if (!raw || raw.trim() === "" || raw.trim() === "-") return 0;
  const cleaned = raw.replace(/['\u2019\s€]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

type ValidRow = { initiativeId: string; amount: number };

async function main(): Promise<void> {
  const filePath = path.join(DATA_DIR, "REVENU.csv");
  if (!fs.existsSync(filePath)) {
    console.error(`Missing: ${path.join("scripts/data-prod", "REVENU.csv")}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, { encoding: "utf-8" });
  const cleaned = content.replace(/^\uFEFF/, "");
  const rawLines = cleaned.split(/\r?\n/);
  const headerIdx = rawLines.findIndex((l) => /^Initiative\s*,/i.test(l.trim()));
  const csvText = headerIdx >= 0 ? rawLines.slice(headerIdx).join("\n") : cleaned;

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = (parsed.data ?? []).filter((r) => !!r && typeof r === "object");
  if (rows.length === 0) {
    console.log("No revenue rows found (CSV empty). Done.");
    return;
  }

  const validRows: ValidRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    const dup = (row["Duplicates"] ?? "").trim();
    if (dup !== "1") {
      skipped++;
      continue;
    }

    const jiraKey = (row["Colonne1"] ?? "").trim();
    if (!jiraKey || jiraKey === "#N/A" || !jiraKey.startsWith("RI-")) {
      skipped++;
      continue;
    }

    const initiative = await prisma.initiative.findUnique({ where: { id: jiraKey } });
    if (!initiative) {
      console.warn(`[REVENUE] Initiative not found for ${jiraKey}, skipping`);
      skipped++;
      continue;
    }

    const amount = parseRevenue(row["Estimated Revenues"] ?? "");
    validRows.push({ initiativeId: initiative.id, amount });
  }

  if (validRows.length === 0) {
    console.log("  No valid revenue rows to insert.\n");
    return;
  }

  const initiativeIds = [...new Set(validRows.map((r) => r.initiativeId))];

  await prisma.initiativeRevenue.deleteMany({
    where: { initiativeId: { in: initiativeIds } },
  });

  await prisma.initiativeRevenue.createMany({
    data: validRows.map((row, i) => ({
      id: `REV-${row.initiativeId}-${i}`,
      initiativeId: row.initiativeId,
      type: RevenueType.Mission,
      amount: row.amount,
      comment: null,
    })),
  });

  console.log(
    `  ✓ Initiatives revenue: ${validRows.length} rows inserted (${initiativeIds.length} initiatives), ${skipped} skipped\n`
  );
}

main()
  .catch((e) => {
    console.error("❌ seed-revenues failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
