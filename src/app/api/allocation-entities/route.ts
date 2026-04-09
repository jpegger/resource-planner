import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const entities = await prisma.allocationEntity.findMany({
    orderBy: [{ productFamily: "asc" }, { name: "asc" }],
  });
  return Response.json(entities);
}
