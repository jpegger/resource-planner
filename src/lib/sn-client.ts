/**
 * ServiceNow ITBM Table API — OAuth client credentials (design §7.1 / §10a).
 * Requires: SN_INSTANCE_URL, SN_CLIENT_ID, SN_CLIENT_SECRET
 */
export async function fetchServicenowTimesheetRecords(year: number): Promise<Record<string, unknown>[]> {
  const base = process.env["SN_INSTANCE_URL"]?.replace(/\/$/, "");
  const clientId = process.env["SN_CLIENT_ID"];
  const clientSecret = process.env["SN_CLIENT_SECRET"];
  if (!base?.trim() || !clientId?.trim() || !clientSecret?.trim()) {
    throw new Error("SN_INSTANCE_URL, SN_CLIENT_ID, and SN_CLIENT_SECRET are required for API sync");
  }

  const tokenRes = await fetch(`${base}/oauth_token.do`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
    }),
  });
  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new Error(`SN OAuth token failed (${tokenRes.status}): ${tokenText.slice(0, 500)}`);
  }
  const tokenJson = JSON.parse(tokenText) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error("SN OAuth response missing access_token");
  }

  const from = `${year}-01-01`;
  const sysparmQuery = `week_starts_on>=${from}^category=Project/Project Task^stateINProcessed,Approved`;
  const sysparmFields = [
    "user",
    "top_task.top_program",
    "top_task.top_task",
    "top_task.short_description",
    "task",
    "task.short_description",
    "week_starts_on",
    "category",
    "total",
    "state",
    "top_task.top_program_eotp",
  ].join(",");

  const url = new URL(`${base}/api/now/table/pm_project_task_time_card`);
  url.searchParams.set("sysparm_limit", "50000");
  url.searchParams.set("sysparm_query", sysparmQuery);
  url.searchParams.set("sysparm_fields", sysparmFields);

  const tableRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const tableText = await tableRes.text();
  if (!tableRes.ok) {
    throw new Error(`SN table API failed (${tableRes.status}): ${tableText.slice(0, 800)}`);
  }
  const tableJson = JSON.parse(tableText) as { result?: Record<string, unknown>[] };
  return Array.isArray(tableJson.result) ? tableJson.result : [];
}
