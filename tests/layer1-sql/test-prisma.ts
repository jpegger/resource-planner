import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is required for layer-1 SQL tests");
}

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
