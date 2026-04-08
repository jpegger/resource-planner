/**
 * Recreate v_eotp_costs only (no CSV import).
 *
 * Requires: v_allocation_costs (run `npm run db:view:prod` if missing).
 *
 * Usage: npm run db:recreate:eotp-costs
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createEotpCostsView } from "./eotp-views";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const check = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_allocation_costs'
    ) AS exists
  `;
  if (!check[0]?.exists) {
    console.error(
      "Missing view v_allocation_costs. Create it first, e.g.:\n  npm run db:view:prod\n"
    );
    process.exit(1);
  }

  await createEotpCostsView(prisma);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error("❌ Failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
