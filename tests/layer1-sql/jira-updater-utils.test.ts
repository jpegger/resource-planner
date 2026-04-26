import { describe, expect, it } from "vitest";

import { readCsvProducts } from "@/../scripts/jira/csv-products";
import { firstComponentName, hasEnablesLinkToAnyProduct, normalizeSummaryKey } from "@/../scripts/jira/jira-updater-utils";

describe("csv-products", () => {
  it("parses PRODUCTS.csv-like content and normalizes values", () => {
    const tmp = "/tmp/jira-updater-products.csv";
    const csv = [
      "id,name,productFamily,division,subDivision,team,sapEotpCode,sapEotpName,attractiveness,competitiveness",
      'PRD-1,  Foo  ,FAM,DIV, SUB ,TEAM,7D0032001,ESM, 1.5 ,',
    ].join("\n");
    require("node:fs").writeFileSync(tmp, csv, "utf8");

    const { products, invalidRows } = readCsvProducts(tmp);
    expect(invalidRows).toEqual([]);
    expect(products).toEqual([
      {
        id: "PRD-1",
        name: "Foo",
        productFamily: "FAM",
        division: "DIV",
        subDivision: "SUB",
        team: "TEAM",
        sapEotpCode: "7D0032001",
        sapEotpName: "ESM",
        attractiveness: 1.5,
        competitiveness: null,
      },
    ]);
  });
});

describe("jira-updater-utils", () => {
  it("normalizes summary keys by trimming and collapsing whitespace", () => {
    expect(normalizeSummaryKey("  A   B  ")).toBe("A B");
  });

  it("extracts first component name", () => {
    expect(firstComponentName({ components: [{ name: "X" }, { name: "Y" }] })).toBe("X");
    expect(firstComponentName({ components: [] })).toBeNull();
  });

  it("detects enables link to a Product in either direction", () => {
    const fields = {
      issuelinks: [
        {
          type: { name: "Enables" },
          outwardIssue: { key: "PRD-1", fields: { issuetype: { name: "Product" } } },
        },
      ],
    };
    expect(hasEnablesLinkToAnyProduct(fields, "Enables")).toBe(true);
    expect(hasEnablesLinkToAnyProduct(fields, "enables")).toBe(true);
    expect(hasEnablesLinkToAnyProduct(fields, "Blocks")).toBe(false);
  });
});

