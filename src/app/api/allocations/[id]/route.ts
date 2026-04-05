import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type PatchBody = {
  quantity?: number | null;
  manDays?: number | null;
  resourceId?: string;
};

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    modifiedOn: Date;
    quantity?: number | null;
    manDays?: number | null;
    resourceId?: string;
  } = { modifiedOn: new Date() };

  if ("quantity" in body) {
    data.quantity = body.quantity === null || body.quantity === undefined ? null : Number(body.quantity);
    if (data.quantity !== null && Number.isNaN(data.quantity)) {
      return Response.json({ error: "quantity must be a number" }, { status: 400 });
    }
  }
  if ("manDays" in body) {
    data.manDays = body.manDays === null || body.manDays === undefined ? null : Number(body.manDays);
    if (data.manDays !== null && Number.isNaN(data.manDays)) {
      return Response.json({ error: "manDays must be a number" }, { status: 400 });
    }
  }
  if (body.resourceId !== undefined) {
    const rid = body.resourceId.trim();
    const res = await prisma.resource.findUnique({ where: { id: rid }, select: { id: true } });
    if (!res) {
      return Response.json({ error: "Resource not found" }, { status: 404 });
    }
    data.resourceId = rid;
  }

  const hasFieldUpdate =
    "quantity" in body || "manDays" in body || body.resourceId !== undefined;
  if (!hasFieldUpdate) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.allocation.update({
      where: { id },
      data,
      include: { resource: { select: { id: true, fullName: true } } },
    });
    return Response.json(updated);
  } catch {
    return Response.json({ error: "Allocation not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await prisma.allocation.delete({ where: { id } });
  } catch {
    return Response.json({ error: "Allocation not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
