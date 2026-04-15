import { NextResponse } from "next/server";

/** Liveness/readiness probe — no database check (DB failures should not kill the pod). */
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
