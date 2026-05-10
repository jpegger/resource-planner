import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const rows = await prisma.snProgrammeMapping.findMany({
    orderBy: { snProgrammeName: "asc" },
    include: {
      allocationEntity: { select: { id: true, name: true, sapEotpCode: true } },
    },
  });
  return Response.json(rows);
}

type PostBody = {
  snProgrammeName?: string;
  snProgrammeEotp?: string | null;
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

  const snProgrammeName = body.snProgrammeName?.trim() ?? "";
  if (!snProgrammeName) {
    return Response.json({ error: "snProgrammeName is required" }, { status: 400 });
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
    const row = await prisma.snProgrammeMapping.create({
      data: {
        snProgrammeName,
        snProgrammeEotp: body.snProgrammeEotp?.trim() || null,
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
      return Response.json({ error: "A mapping for this programme name already exists" }, { status: 409 });
    }
    console.error("[POST /api/mappings/sn-programmes]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
