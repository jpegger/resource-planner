import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Create a rate row for a resource. Id: RATE-{resourceId}-{year} (matches seed convention). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: resourceId } = await ctx.params;

  const resource = await prisma.resource.findUnique({ where: { id: resourceId }, select: { id: true } });
  if (!resource) {
    return Response.json({ error: "Resource not found" }, { status: 404 });
  }

  let body: { year?: unknown; dailyRate?: unknown; nbrDaysPerYear?: unknown };
  try {
    body = (await request.json()) as { year?: unknown; dailyRate?: unknown; nbrDaysPerYear?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const year = Number(body.year);
  const dailyRate = Number(body.dailyRate);
  const nbrDaysPerYear = Number(body.nbrDaysPerYear);

  if (!Number.isInteger(year)) {
    return Response.json({ error: "year must be an integer" }, { status: 400 });
  }
  if (!Number.isFinite(dailyRate)) {
    return Response.json({ error: "dailyRate must be a finite number" }, { status: 400 });
  }
  if (!Number.isFinite(nbrDaysPerYear)) {
    return Response.json({ error: "nbrDaysPerYear must be a finite number" }, { status: 400 });
  }

  const id = `RATE-${resourceId}-${year}`;

  const existing = await prisma.rate.findFirst({
    where: { resourceId, year },
    select: { id: true },
  });
  if (existing) {
    return Response.json({ error: `A rate for year ${year} already exists` }, { status: 409 });
  }

  const now = new Date();
  try {
    const created = await prisma.rate.create({
      data: {
        id,
        resourceId,
        year,
        dailyRate,
        nbrDaysPerYear,
        createdOn: now,
        modifiedOn: now,
      },
    });
    return Response.json(created);
  } catch {
    return Response.json({ error: "Could not create rate (id conflict?)" }, { status: 409 });
  }
}
