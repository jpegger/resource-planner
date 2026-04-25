/**
 * Seed EOTP routing from scripts/datasets/dev/EOTP_ROUTING.csv.
 *
 * CSV columns: productName, eotp, eopLabel, year, internal, external, direct, comment
 * — EUR amounts routed to the target EOTP per cost bucket (exceptions only).
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";

import { backfillEotpRoutingDefinitionIds } from "../src/lib/eotp-definition-resolve";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

const DATA_DIR = path.join(__dirname, "datasets", "dev");

type RoutingRow = {
  productName: string;
  eotp: string;
  eopLabel: string;
  year: string;
  internal: string;
  external: string;
  direct: string;
  comment: string;
};

function parseFloatStrict(raw: string, label: string): number {
  const n = Number.parseFloat(String(raw).replace(",", ".").trim());
  if (Number.isNaN(n)) {
    throw new Error(`Invalid ${label}: "${raw}"`);
  }
  return n;
}

/** Match Jira component spelling: `Plateforme commune`, not `Plateforme Commune`. */
function normalizeEopLabel(label: string): string {
  return label.trim().replace(/Plateforme Commune/gi, "Plateforme commune");
}

async function main(): Promise<void> {
  const filePath = path.join(DATA_DIR, "EOTP_ROUTING.csv");
  if (!fs.existsSync(filePath)) {
    console.error(`Missing: ${path.join("scripts/datasets/dev", "EOTP_ROUTING.csv")}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, { encoding: "utf-8" });
  const cleaned = content.replace(/^\uFEFF/, "");
  const parsed = Papa.parse<RoutingRow>(cleaned, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = (parsed.data ?? []).filter((r) => !!r && typeof r === "object");
  if (rows.length === 0) {
    console.log("No routing rows found (CSV empty). Done.");
    return;
  }

  const entities = await prisma.allocationEntity.findMany({ select: { id: true, name: true } });
  const entityMap = new Map(entities.map((p) => [p.name.trim().toLowerCase(), p.id]));

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const productName = (row.productName ?? "").trim();
    const allocationEntityId = entityMap.get(productName.toLowerCase());
    if (!allocationEntityId) {
      console.warn(`WARN: allocation entity not found — "${productName}" (skipped)`);
      skipped++;
      continue;
    }

    const year = Number.parseInt((row.year ?? "").trim(), 10);
    if (Number.isNaN(year)) {
      console.warn(`WARN: invalid year for "${productName}" (skipped)`);
      skipped++;
      continue;
    }

    const eotp = (row.eotp ?? "").trim();
    if (!eotp) {
      skipped++;
      continue;
    }

    const internalAmount = parseFloatStrict((row.internal ?? "0").trim(), "internal");
    const externalAmount = parseFloatStrict((row.external ?? "0").trim(), "external");
    const directAmount = parseFloatStrict((row.direct ?? "0").trim(), "direct");

    if (internalAmount === 0 && externalAmount === 0 && directAmount === 0) {
      skipped++;
      continue;
    }

    const eopLabel = normalizeEopLabel(row.eopLabel ?? "");
    const comment = (row.comment ?? "").trim();
    const def = await prisma.eotpDefinition.findFirst({
      where: { sapEotpCode: { equals: eotp, mode: "insensitive" } },
      select: { id: true },
    });
    const eotpDefinitionId = def?.id ?? null;

    await prisma.eotpRouting.upsert({
      where: {
        allocationEntityId_year_eotp: {
          allocationEntityId,
          year,
          eotp,
        },
      },
      create: {
        allocationEntityId,
        year,
        eotp,
        eopLabel: eopLabel || null,
        eotpDefinitionId,
        internalAmount,
        externalAmount,
        directAmount,
        comment: comment || null,
      },
      update: {
        eopLabel: eopLabel || null,
        eotpDefinitionId,
        internalAmount,
        externalAmount,
        directAmount,
        comment: comment || null,
      },
    });

    upserted++;
  }

  console.log(`Done. ${upserted} routing rows upserted, ${skipped} skipped.`);

  const bf = await backfillEotpRoutingDefinitionIds(prisma);
  console.log(
    `Backfill eotp_definition_id: ${bf.linked}/${bf.processed} routing rows linked to catalog.`
  );
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
