import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Lightweight list for pickers (e.g. SN project → initiative mapping). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const take = Math.min(500, Math.max(1, Number.parseInt(searchParams.get("take") ?? "200", 10) || 200));

  const where =
    q.length === 0
      ? undefined
      : {
          OR: [
            { id: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { summary: { contains: q, mode: Prisma.QueryMode.insensitive } },
          ],
        };

  const rows = await prisma.initiative.findMany({
    where,
    select: { id: true, summary: true, year: true },
    orderBy: [{ year: "desc" }, { id: "asc" }],
    take,
  });
  return Response.json(rows);
}
