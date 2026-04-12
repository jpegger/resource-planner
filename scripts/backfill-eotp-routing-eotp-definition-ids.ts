/**
 * Sets `eotp_routing.eotp_definition_id` for all rows from `eotp` + `eopLabel`.
 *
 * Use when routing was seeded before `eotp_definition` existed, or labels failed to match.
 * Requires: `npm run db:seed:eotp` first.
 *
 * Usage: `npm run db:backfill:eotp-routing-fks`
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

import { backfillEotpRoutingDefinitionIds } from "../src/lib/eotp-definition-resolve";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const { processed, linked } = await backfillEotpRoutingDefinitionIds(prisma);
  console.log(
    `Done. Updated ${processed} eotp_routing row(s); ${linked} non-null eotp_definition_id.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
