/**
 * Upserts canonical EOTP rows from `scripts/datasets/dev/EOTP-Budget-Owner.csv`.
 *
 * Columns: Division, Budget Owner, Director, SubDivision, Team, Prog Fin (SAP code), Prog Fin lib (label).
 *
 * Usage: `npm run db:seed:eotp`
 *
 * Optional reset:
 * - `SEED_PROD_RESET=1 npm run db:seed:eotp`
 *   Clears the `eotp_definition` table first (and nulls optional FKs) before re-importing from CSV.
 *
 * Run after `npm run db:migrate` and before `npm run db:seed:products` so allocation entities
 * can resolve `eotp_definition_id` (or run `npm run db:seed:products` which re-links FKs).
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import fs from "fs";
import path from "path";
import Papa from "papaparse";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

const DATA_DIR = path.join(__dirname, "datasets", "dev");
const FILE = "EOTP-Budget-Owner.csv";

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

function nullable(raw: string): string | null {
  const t = raw.trim();
  return t === "" ? null : t;
}

async function main(): Promise<void> {
  const filePath = path.join(DATA_DIR, FILE);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing: ${path.relative(process.cwd(), filePath)}`);
    process.exit(1);
  }

  if (process.env["SEED_PROD_RESET"] === "1") {
    console.log(
      "SEED_PROD_RESET=1 — clearing eotp_definition (and nulling optional FKs) before seeding…",
    );

    await prisma.$transaction(async (tx) => {
      await tx.allocationEntity.updateMany({
        data: { eotpDefinitionId: null },
      });
      await tx.eotpRouting.updateMany({
        data: { eotpDefinitionId: null },
      });
      await tx.eotpDefinition.deleteMany({});
    });
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const cleaned = raw.replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
  });

  const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");
  let upserted = 0;
  const seen = new Map<string, string>(); // code → label (for warnings only)

  for (const row of rows) {
    const division = nullable(trimStr(row["Division"]));
    const budgetOwner = nullable(trimStr(row["Budget Owner"]));
    const director = nullable(trimStr(row["Director"]));
    const subDivision = nullable(trimStr(row["SubDivision"]));
    const team = nullable(trimStr(row["Team"]));
    const code = trimStr(row["Prog Fin"]);
    let label = trimStr(row["Prog Fin lib"]);

    if (!code) continue;
    if (!label) label = code;

    const codeKey = code.toLowerCase();
    const prev = seen.get(codeKey);
    if (prev && prev !== label) {
      console.warn(
        `Warning: multiple labels for SAP code ${code}. Using last value: "${label}" (previous: "${prev}")`,
      );
    }
    seen.set(codeKey, label);

    const existing = await prisma.eotpDefinition.findFirst({
      where: { sapEotpCode: { equals: code, mode: "insensitive" } },
      select: { id: true },
    });

    if (!existing) {
      await prisma.eotpDefinition.create({
        data: {
          sapEotpCode: code,
          label,
          division,
          budgetOwner,
          director,
          subDivision,
          team,
        },
      });
      upserted++;
      continue;
    }

    await prisma.eotpDefinition.update({
      where: { id: existing.id },
      data: {
        sapEotpCode: code,
        label,
        division,
        budgetOwner,
        director,
        subDivision,
        team,
      },
    });
    upserted++;
  }

  console.log(`Done. ${upserted} EOTP definition row(s) upserted from ${FILE}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
