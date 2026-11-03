import { describe, expect, it } from "vitest";

import { parseSapClientInvoiceCsv } from "@/lib/sap-revenue-parser";

function padCols(labels: Record<number, string>, len = 68): string[] {
  const a = Array.from({ length: len }, (_, i) => labels[i] ?? "");
  return a;
}

describe("parseSapClientInvoiceCsv ext_doc_ref", () => {
  it("uses Référence client for AR when Secteurs d'activité is 12 and col 40 is empty", () => {
    const header = padCols({
      0: "Type document vente",
      2: "Secteurs d'activité",
      4: "Document de vente",
      6: "Nom",
      20: "Article",
      23: "Désignation poste",
      31: "Elément d'OTP",
      35: "Référence client",
      40: "Numéro externe de document de vente",
      41: "Facture",
      45: "Valeur nette",
      48: "Poste",
      58: "Exercice comptable",
      59: "Date de la pièce",
    });
    const data = padCols({
      0: "ZCS",
      2: "12",
      4: "0001103333",
      6: "Test Client",
      20: "17072",
      23: "Some UC",
      31: "8/R/B/0014/001",
      35: "AR-007794",
      40: "",
      41: "90912813",
      45: "100,00",
      48: "10",
      58: "2025",
      59: "15/01/2025",
    });
    const csv = `${header.join(";")}\n${data.join(";")}`;
    const { rows } = parseSapClientInvoiceCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.extDocRef).toBe("AR-007794");
  });

  it("keeps col 40 for non–sector-12 when Référence client differs", () => {
    const header = padCols({
      0: "Type document vente",
      2: "Secteurs d'activité",
      4: "Document de vente",
      6: "Nom",
      20: "Article",
      23: "Désignation poste",
      31: "Elément d'OTP",
      35: "Référence client",
      40: "Numéro externe de document de vente",
      41: "Facture",
      45: "Valeur nette",
      48: "Poste",
      58: "Exercice comptable",
      59: "Date de la pièce",
    });
    const data = padCols({
      0: "ZCS",
      2: "11",
      4: "0001103333",
      6: "Test Client",
      20: "17072",
      23: "CRM UC",
      31: "8/R/B/0014/001",
      35: "OTHER-REF",
      40: "AR-001100",
      41: "90912814",
      45: "200,00",
      48: "10",
      58: "2025",
      59: "15/01/2025",
    });
    const csv = `${header.join(";")}\n${data.join(";")}`;
    const { rows } = parseSapClientInvoiceCsv(csv);
    expect(rows[0]?.extDocRef).toBe("AR-001100");
  });

  it("for sector 12 falls back to col 40 when Référence client is empty", () => {
    const header = padCols({
      0: "Type document vente",
      2: "Secteurs d'activité",
      4: "Document de vente",
      6: "Nom",
      20: "Article",
      23: "Désignation poste",
      31: "Elément d'OTP",
      35: "Référence client",
      40: "Numéro externe de document de vente",
      41: "Facture",
      45: "Valeur nette",
      48: "Poste",
      58: "Exercice comptable",
      59: "Date de la pièce",
    });
    const data = padCols({
      0: "ZCS",
      2: "12",
      4: "0001103333",
      6: "Test Client",
      20: "17072",
      23: "Body line",
      31: "8/R/B/0014/001",
      35: "",
      40: "AR-009999",
      41: "90912815",
      45: "50,00",
      48: "10",
      58: "2025",
      59: "15/01/2025",
    });
    const csv = `${header.join(";")}\n${data.join(";")}`;
    const { rows } = parseSapClientInvoiceCsv(csv);
    expect(rows[0]?.extDocRef).toBe("AR-009999");
  });
});
