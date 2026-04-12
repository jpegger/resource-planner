import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    await prisma.allocationSnapshot.delete({ where: { id: id.trim() } });
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: string }).code) : "";
    if (code === "P2025") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    throw e;
  }

  return Response.json({ deleted: true });
}
