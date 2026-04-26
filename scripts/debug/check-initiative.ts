import "dotenv/config";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: tsx scripts/debug/check-initiative.ts <RI-XXXX>");

  const initiative = await prisma.initiative.findUnique({
    where: { id },
    select: { id: true, summary: true, year: true },
  });

  const allocationCount = await prisma.allocation.count({ where: { initiativeId: id } });

  console.log(
    JSON.stringify(
      {
        id,
        initiativeExists: !!initiative,
        initiative,
        allocationCount,
      },
      null,
      2
    )
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

