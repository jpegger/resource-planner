import { describe, expect, it } from "vitest";

function outwardLinkedProductKeys(fields: Record<string, unknown>): string[] {
  const links = fields["issuelinks"];
  if (!Array.isArray(links) || links.length === 0) return [];

  const keys: string[] = [];
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const outward = (link as { outwardIssue?: unknown }).outwardIssue;
    if (!outward || typeof outward !== "object") continue;

    const outwardKey =
      "key" in outward ? String((outward as { key?: unknown }).key ?? "").trim().toUpperCase() : "";
    if (!outwardKey) continue;

    const outwardFields =
      "fields" in outward && typeof (outward as { fields?: unknown }).fields === "object" && (outward as { fields?: unknown }).fields
        ? ((outward as { fields?: unknown }).fields as Record<string, unknown>)
        : null;

    const issueTypeName =
      outwardFields &&
      typeof outwardFields.issuetype === "object" &&
      outwardFields.issuetype !== null &&
      "name" in (outwardFields.issuetype as Record<string, unknown>)
        ? String((outwardFields.issuetype as { name?: unknown }).name)
        : null;

    if (issueTypeName !== "Product") continue;
    keys.push(outwardKey);
  }

  return Array.from(new Set(keys));
}

describe("outwardLinkedProductKeys", () => {
  it("returns only outward issues of issuetype Product", () => {
    const fields = {
      issuelinks: [
        {
          outwardIssue: { key: "PRD-1", fields: { issuetype: { name: "Product" } } },
        },
        {
          outwardIssue: { key: "PRJ-2", fields: { issuetype: { name: "Project" } } },
        },
        {
          inwardIssue: { key: "PRD-3", fields: { issuetype: { name: "Product" } } },
        },
      ],
    };

    expect(outwardLinkedProductKeys(fields)).toEqual(["PRD-1"]);
  });

  it("deduplicates keys and normalizes case", () => {
    const fields = {
      issuelinks: [
        { outwardIssue: { key: "prd-1", fields: { issuetype: { name: "Product" } } } },
        { outwardIssue: { key: "PRD-1", fields: { issuetype: { name: "Product" } } } },
      ],
    };
    expect(outwardLinkedProductKeys(fields)).toEqual(["PRD-1"]);
  });
});

