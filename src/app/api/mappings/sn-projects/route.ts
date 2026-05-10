import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const rows = await prisma.snProjectMapping.findMany({
    orderBy: [{ snProjectNr: "asc" }, { year: "asc" }],
    include: {
      initiative: { select: { id: true, summary: true } },
    },
  });
  return Response.json(rows);
}

type PostBody = {
  snProjectNr?: string;
  snProjectName?: string | null;
  initiativeId?: string | null;
  year?: number | null;
  notes?: string | null;
};

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const snProjectNr = body.snProjectNr?.trim() ?? "";
  if (!snProjectNr) {
    return Response.json({ error: "snProjectNr is required" }, { status: 400 });
  }

  if (body.initiativeId?.trim()) {
    const ini = await prisma.initiative.findUnique({
      where: { id: body.initiativeId.trim() },
      select: { id: true },
    });
    if (!ini) {
      return Response.json({ error: "initiativeId not found" }, { status: 400 });
    }
  }

  const year =
    body.year === null || body.year === undefined
      ? null
      : Number.isFinite(Number(body.year))
        ? Math.trunc(Number(body.year))
        : null;
  if (body.year !== null && body.year !== undefined && year === null) {
    return Response.json({ error: "year must be a finite number when provided" }, { status: 400 });
  }

  const row = await prisma.snProjectMapping.create({
    data: {
      snProjectNr,
      snProjectName: body.snProjectName?.trim() || null,
      initiativeId: body.initiativeId?.trim() || null,
      year,
      notes: body.notes?.trim() || null,
    },
    include: {
      initiative: { select: { id: true, summary: true } },
    },
  });
  return Response.json(row, { status: 201 });
}
