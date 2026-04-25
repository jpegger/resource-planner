import "dotenv/config";
import { getSalesforceConnection } from "../src/lib/salesforce";

function padRight(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

async function describe(): Promise<void> {
  const t0 = Date.now();
  const conn = await getSalesforceConnection();
  void t0;

  for (const objectName of [
    "Call_For_Resources__c",
    "Call_For_Resources_Line_Item__c",
  ] as const) {
    const t1 = Date.now();
    const meta = await conn.describe(objectName);
    void t1;
    console.log(`\n=== ${objectName} ===`);

    const fields = [...meta.fields].sort((a, b) => {
      const al = (a.label ?? "").toLowerCase();
      const bl = (b.label ?? "").toLowerCase();
      if (al !== bl) return al < bl ? -1 : 1;
      const an = (a.name ?? "").toLowerCase();
      const bn = (b.name ?? "").toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });

    const labelWidth = Math.min(
      60,
      Math.max(20, ...fields.map((f) => (f.label ?? "").length))
    );

    for (const f of fields) {
      const label = f.label ?? "";
      const name = f.name ?? "";
      const type = f.type ?? "unknown";
      console.log(`${padRight(label, labelWidth)}  ${name}  (${type})`);
    }
  }
}

describe().catch((err: unknown) => {
  console.error(err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});

