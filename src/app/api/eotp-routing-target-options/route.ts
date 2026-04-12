import { buildEotpTargetOptions } from "@/lib/eotp-target-options";
import { loadEotpDefinitionOptionRows } from "@/lib/eotp-routing-target-options-query";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * GET — EOTP routing targets from **`eotp_definition`** only (EOTP-Budget-Owner.csv),
 * excluding the product’s main SAP code when `mainSapEotp` is passed.
 */
export async function GET(request: Request) {
  const mainRaw = new URL(request.url).searchParams.get("mainSapEotp");
  const mainSapEotpCode =
    mainRaw === null || mainRaw.trim() === "" ? null : mainRaw.trim();

  try {
    const definitions = await loadEotpDefinitionOptionRows(prisma);
    const options = buildEotpTargetOptions(definitions, mainSapEotpCode);
    return Response.json(options);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[GET /api/eotp-routing-target-options]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
