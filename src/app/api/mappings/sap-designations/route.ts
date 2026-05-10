import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const rows = await prisma.sapDesignationMapping.findMany({
    orderBy: { sapDesignation: "asc" },
    include: {
      allocationEntity: { select: { id: true, name: true, sapEotpCode: true } },
    },
  });
  return Response.json(rows);
}

type PostBody = {
  sapDesignation?: string;
  sfProductName?: string | null;
  allocationEntityId?: string | null;
  notes?: string | null;
};

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sapDesignation = body.sapDesignation?.trim() ?? "";
  if (!sapDesignation) {
    return Response.json({ error: "sapDesignation is required" }, { status: 400 });
  }

  if (body.allocationEntityId?.trim()) {
    const ae = await prisma.allocationEntity.findUnique({
      where: { id: body.allocationEntityId.trim() },
      select: { id: true },
    });
    if (!ae) {
      return Response.json({ error: "allocationEntityId not found" }, { status: 400 });
    }
  }

  try {
    const row = await prisma.sapDesignationMapping.create({
      data: {
        sapDesignation,
        sfProductName: body.sfProductName?.trim() || null,
        allocationEntityId: body.allocationEntityId?.trim() || null,
        notes: body.notes?.trim() || null,
      },
      include: {
        allocationEntity: { select: { id: true, name: true, sapEotpCode: true } },
      },
    });
    return Response.json(row, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("Unique constraint")) {
      return Response.json({ error: "A mapping for this SAP designation already exists" }, { status: 409 });
    }
    console.error("[POST /api/mappings/sap-designations]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
