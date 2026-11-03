import { describe, expect, it } from "vitest";

import {
  dateToQuarter,
  firstEnablesLinkedProduct,
  mapInitiativeStatus,
  parseCategorieFromRiType,
  pickExcelTag,
  stripJiraKeyFromSummary,
} from "@/../scripts/jira/service-pulse-mapping";

describe("service-pulse-mapping", () => {
  it("strips jira key from summary", () => {
    expect(stripJiraKeyFromSummary("RI-2496 VPN - RUN", "RI-2496")).toBe("VPN - RUN");
    expect(stripJiraKeyFromSummary("RI-2496 VPN - RUN")).toBe("VPN - RUN");
    expect(stripJiraKeyFromSummary("VPN - RUN", "RI-2496")).toBe("VPN - RUN");
  });

  it("parses categorie from (RI) Type", () => {
    expect(parseCategorieFromRiType("BUILD PARADIGM / Evolution")).toBe("BUILD PARADIGM");
    expect(parseCategorieFromRiType("RUN")).toBe("RUN");
    expect(parseCategorieFromRiType("Run")).toBe("RUN");
    expect(parseCategorieFromRiType("Evolution")).toBe("Evolution");
    expect(parseCategorieFromRiType(null)).toBeNull();
  });

  it("maps dates to quarters (UTC month)", () => {
    expect(dateToQuarter("2026-01-15")).toBe("Q1");
    expect(dateToQuarter("2026-04-01")).toBe("Q2");
    expect(dateToQuarter("2026-07-20")).toBe("Q3");
    expect(dateToQuarter("2026-12-31")).toBe("Q4");
    expect(dateToQuarter(null)).toBeNull();
  });

  it("maps initiative statuses", () => {
    expect(mapInitiativeStatus("Done")).toBe("Livré");
    expect(mapInitiativeStatus("In Progress")).toBe("En cours");
    expect(mapInitiativeStatus("Selected for Development")).toBe("Non démarré");
    expect(mapInitiativeStatus("Blocked")).toBe("À risque");
    expect(mapInitiativeStatus("Custom")).toBe("Custom");
  });

  it("picks preferred thematic Tag (NIS2/NIS/IA) over Reporting Annuel", () => {
    expect(pickExcelTag(["Reporting Annuel", "NIS2"])).toBe("NIS2");
    expect(pickExcelTag(["Reporting Annuel"])).toBeNull();
    expect(pickExcelTag(["IA", "NIS2"])).toBe("NIS2");
    expect(pickExcelTag(["IA"])).toBe("IA");
    expect(pickExcelTag(["NIS"])).toBe("NIS");
  });

  it("resolves first enables-linked Product (outward preferred)", () => {
    const fields = {
      issuelinks: [
        {
          type: { name: "Enables" },
          inwardIssue: { key: "RI-IN", fields: { issuetype: { name: "Product" }, summary: "Inward" } },
          outwardIssue: { key: "RI-OUT", fields: { issuetype: { name: "Product" }, summary: "Outward" } },
        },
      ],
    };
    expect(firstEnablesLinkedProduct(fields, "Enables")).toEqual({ key: "RI-OUT", summary: "Outward" });
  });
});
