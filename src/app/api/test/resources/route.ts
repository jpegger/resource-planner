import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Minimal resource list for allocation pickers (id + display name). */
export async function GET() {
  const rows = await prisma.resource.findMany({
    select: { id: true, fullName: true, type: true },
    orderBy: { fullName: "asc" },
  });
  return Response.json(rows);
}
