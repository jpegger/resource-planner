import { RevenueType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const REVENUE_TYPES = new Set<string>(Object.values(RevenueType));

type PatchBody = {
  type?: string;
  amount?: number;
  comment?: string | null;
};

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id?.trim()) {
    return Response.json({ error: "Missing revenue id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    type?: RevenueType;
    amount?: number;
    comment?: string | null;
  } = {};

  if ("type" in body && body.type !== undefined) {
    const t = String(body.type).trim();
    if (!REVENUE_TYPES.has(t)) {
      return Response.json({ error: "type must be Mission or Subscription" }, { status: 400 });
    }
    data.type = t as RevenueType;
  }
  if ("amount" in body) {
    const n = body.amount === null || body.amount === undefined ? 0 : Number(body.amount);
    if (Number.isNaN(n)) {
      return Response.json({ error: "amount must be a number" }, { status: 400 });
    }
    data.amount = n;
  }
  if ("comment" in body) {
    data.comment = body.comment === null || body.comment === undefined ? null : String(body.comment);
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.initiativeRevenue.update({
      where: { id: id.trim() },
      data,
    });
    return Response.json(updated);
  } catch {
    return Response.json({ error: "Revenue row not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id?.trim()) {
    return Response.json({ error: "Missing revenue id" }, { status: 400 });
  }

  try {
    await prisma.initiativeRevenue.delete({ where: { id: id.trim() } });
  } catch {
    return Response.json({ error: "Revenue row not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
