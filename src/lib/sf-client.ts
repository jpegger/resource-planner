/**
 * Salesforce REST query — OAuth client credentials (design §7.5b / §10b).
 * Requires: SF_INSTANCE_URL, SF_CLIENT_ID, SF_CLIENT_SECRET
 */

let cachedToken: { token: string; expiresAtMs: number } | null = null;

export async function fetchSfAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 30_000) {
    return cachedToken.token;
  }

  const inst = process.env["SF_INSTANCE_URL"]?.replace(/\/$/, "");
  const clientId = process.env["SF_CLIENT_ID"];
  const clientSecret = process.env["SF_CLIENT_SECRET"];

  if (!inst?.trim() || !clientId?.trim() || !clientSecret?.trim()) {
    throw new Error("SF_INSTANCE_URL, SF_CLIENT_ID, and SF_CLIENT_SECRET are required for API sync");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
  });

  const res = await fetch(`${inst}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SF OAuth token failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error("SF OAuth response missing access_token");
  }
  const ttlSec = typeof json.expires_in === "number" ? json.expires_in : 3600;
  cachedToken = { token: json.access_token, expiresAtMs: now + ttlSec * 1000 };
  return json.access_token;
}

export async function sfQueryAll<T extends Record<string, unknown>>(soql: string): Promise<T[]> {
  const inst = process.env["SF_INSTANCE_URL"]?.replace(/\/$/, "");
  if (!inst) throw new Error("SF_INSTANCE_URL is not set");

  const token = await fetchSfAccessToken();
  const out: T[] = [];
  let nextUrl: string | null =
    `${inst}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`SF query failed (${res.status}): ${text.slice(0, 800)}`);
    }
    const json = JSON.parse(text) as { records?: T[]; nextRecordsUrl?: string };
    if (Array.isArray(json.records)) out.push(...json.records);
    nextUrl =
      json.nextRecordsUrl != null && json.nextRecordsUrl !== ""
        ? `${inst}${json.nextRecordsUrl}`
        : null;
  }

  return out;
}

/** SOQL for AR lines (design §3.5b) — confirm object/field API names when Connected App is live. */
export function buildArLineSoql(year: number): string {
  const y = Math.trunc(Number(year));
  if (!Number.isFinite(y) || y < 1990 || y > 2100) throw new Error("Invalid year for SOQL");
  return [
    "SELECT Id,Name,Contract_Name__c,Document_Status__c,Signed_Date__c,Counterpart_Reference__c,",
    "(SELECT Line_Item_Number__c,Unique_AR_ID__c,Description,Quantity,UnitPrice,TotalPrice,",
    "WBS__c,SAP_Product_Code__c,SAP_SO_Number__c,EndDate,Document_Status__c,",
    "PricebookEntry.Name,PricebookEntry.Product2.Name,PricebookEntry.Product2.ProductCode ",
    "FROM CallForResourcesLineItems__r WHERE Document_Status__c IN ('Signed','Approved','Submitted','Presented')) ",
    "FROM CallForResources__c ",
    `WHERE CALENDAR_YEAR(Signed_Date__c) = ${y}`,
  ].join("");
}
