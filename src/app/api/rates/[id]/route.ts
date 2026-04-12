import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: { dailyRate?: unknown; nbrDaysPerYear?: unknown };
  try {
    body = (await request.json()) as { dailyRate?: unknown; nbrDaysPerYear?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: { modifiedOn: Date; dailyRate?: number; nbrDaysPerYear?: number } = {
    modifiedOn: new Date(),
  };

  if ("dailyRate" in body) {
    const n = Number(body.dailyRate);
    if (!Number.isFinite(n)) {
      return Response.json({ error: "dailyRate must be a finite number" }, { status: 400 });
    }
    data.dailyRate = n;
  }
  if ("nbrDaysPerYear" in body) {
    const n = Number(body.nbrDaysPerYear);
    if (!Number.isFinite(n)) {
      return Response.json({ error: "nbrDaysPerYear must be a finite number" }, { status: 400 });
    }
    data.nbrDaysPerYear = n;
  }

  if (data.dailyRate === undefined && data.nbrDaysPerYear === undefined) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.rate.update({
      where: { id },
      data,
    });
    return Response.json(updated);
  } catch {
    return Response.json({ error: "Rate not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await prisma.rate.delete({ where: { id } });
  } catch {
    return Response.json({ error: "Rate not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
