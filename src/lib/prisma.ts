import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

function isCompletePrismaClient(client: PrismaClient): boolean {
  const c = client as {
    eotpRouting?: unknown;
    initiativeRevenue?: unknown;
  };
  return typeof c.eotpRouting !== "undefined" && typeof c.initiativeRevenue !== "undefined";
}

function getPrisma(): PrismaClient {
  let client = globalForPrisma.prisma;
  if (client && isCompletePrismaClient(client)) {
    return client;
  }
  if (client) {
    globalForPrisma.prisma = undefined;
  }
  client = createClient();
  if (!isCompletePrismaClient(client)) {
    throw new Error(
      "Prisma Client is out of date (missing delegates). Run `npx prisma generate`, then restart the dev server."
    );
  }
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = getPrisma();
