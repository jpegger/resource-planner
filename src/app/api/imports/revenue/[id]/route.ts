import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!id?.trim()) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  try {
    await prisma.revenueImport.delete({ where: { id: id.trim() } });
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[DELETE /api/imports/revenue/[id]]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
