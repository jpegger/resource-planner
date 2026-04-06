import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(product);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    name?: string;
    productFamily?: string | null;
    division?: string | null;
    subDivision?: string | null;
    team?: string | null;
    sapEotpCode?: string | null;
    sapEotpName?: string | null;
    attractiveness?: number | null;
    competitiveness?: number | null;
  } = {};

  if (typeof body.name === "string") data.name = body.name;
  if ("productFamily" in body)
    data.productFamily =
      body.productFamily === null || body.productFamily === undefined
        ? null
        : String(body.productFamily);
  if ("division" in body)
    data.division =
      body.division === null || body.division === undefined ? null : String(body.division);
  if ("subDivision" in body)
    data.subDivision =
      body.subDivision === null || body.subDivision === undefined ? null : String(body.subDivision);
  if ("team" in body)
    data.team = body.team === null || body.team === undefined ? null : String(body.team);
  if ("sapEotpCode" in body)
    data.sapEotpCode =
      body.sapEotpCode === null || body.sapEotpCode === undefined
        ? null
        : String(body.sapEotpCode);
  if ("sapEotpName" in body)
    data.sapEotpName =
      body.sapEotpName === null || body.sapEotpName === undefined
        ? null
        : String(body.sapEotpName);
  if ("attractiveness" in body) {
    if (body.attractiveness === null || body.attractiveness === undefined) {
      data.attractiveness = null;
    } else {
      const n = Number(body.attractiveness);
      if (Number.isNaN(n)) {
        return Response.json({ error: "attractiveness must be a number" }, { status: 400 });
      }
      data.attractiveness = n;
    }
  }
  if ("competitiveness" in body) {
    if (body.competitiveness === null || body.competitiveness === undefined) {
      data.competitiveness = null;
    } else {
      const n = Number(body.competitiveness);
      if (Number.isNaN(n)) {
        return Response.json({ error: "competitiveness must be a number" }, { status: 400 });
      }
      data.competitiveness = n;
    }
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const product = await prisma.product.update({
      where: { id },
      data,
    });
    return Response.json(product);
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const linked = await prisma.initiative.count({ where: { productId: id } });
  if (linked > 0) {
    return Response.json(
      { error: `Cannot delete: ${linked} initiative(s) reference this product` },
      { status: 409 }
    );
  }
  try {
    await prisma.product.delete({ where: { id } });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ deleted: true });
}
