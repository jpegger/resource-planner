export const runtime = "nodejs";

/** Safe import-mode flags for the UI (no secrets). */
export async function GET() {
  const sn = process.env["SN_IMPORT_MODE"]?.trim().toLowerCase();
  const sf = process.env["SF_IMPORT_MODE"]?.trim().toLowerCase();
  return Response.json({
    snImportMode: sn === "api" ? "api" : "csv",
    sfImportMode: sf === "api" ? "api" : "csv",
  });
}
