import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const entities = await prisma.allocationEntity.findMany({
      orderBy: [{ productFamily: "asc" }, { name: "asc" }],
    });
    return Response.json(entities);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[GET /api/allocation-entities]", message);
    return Response.json(
      { error: message },
      { status: 500 }
    );
  }
}
