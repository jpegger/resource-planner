/**
 * Export Jira Products + tagged Initiatives to a simple 3-sheet workbook
 * (Services, Initiatives, KPI_Specifiques) — no budget columns, no template copy.
 *
 * Usage:
 *   dotenv -e .env -- tsx scripts/jira/export-service-pulse-xlsx.ts
 *   dotenv -e .env -- tsx scripts/jira/export-service-pulse-xlsx.ts --out scripts/jira/out/Service_Pulse.xlsx
 *
 * Env:
 *   JIRA_HOST / JIRA_BASE_URL, JIRA_EMAIL, JIRA_TOKEN / JIRA_API_TOKEN
 *   JIRA_PRODUCT_JQL (default: issuetype = Product)
 *   JIRA_SERVICE_PULSE_PRODUCT_FILTER_ID (default: 19625 = Paradigm Product Registry)
 *   JIRA_SERVICE_PULSE_INITIATIVE_FILTER_ID (default: 19810 = Paradigm Product Yearly Roadmap Reporting)
 *   JIRA_SERVICE_PULSE_INITIATIVE_JQL (optional raw JQL override for initiatives)
 *   JIRA_LINK_TYPE / JIRA_ENABLES_LINK_TYPE (default: Enables)
 */
import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import ExcelJS from "exceljs";

// Override shell/Cursor env so a stale JIRA_TOKEN does not win over .env
dotenv.config({ path: path.resolve(__dirname, "../../.env"), override: true });

import { createJiraClient, resolveProductJql } from "./jira-client";
import { loadJiraFieldCatalog, resolveServicePulseFieldIds } from "./jira-field-resolve";
import {
  assigneeDisplayName,
  dateToQuarter,
  firstEnablesLinkedProduct,
  INITIATIVE_FILTER_TAGS,
  mapInitiativeStatus,
  parseCategorieFromRiType,
  pickExcelTag,
  readMultiSelectValues,
  readNumberField,
  readScalarField,
  statusName,
  stripJiraKeyFromSummary,
  type InitiativePulseRow,
  type ServicePulseRow,
} from "./service-pulse-mapping";

type JiraIssue = { key: string; id: string; fields: Record<string, unknown> };

function parseArgs(argv: string[]): { out: string } {
  const args = new Map<string, string | undefined>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) continue;
    const [k, v] = a.includes("=") ? a.split("=", 2) : [a, argv[i + 1]];
    args.set(k, v);
    if (!a.includes("=") && v && !v.startsWith("--")) i++;
  }
  const root = path.resolve(__dirname, "../..");
  const stamp = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  })();
  const out =
    args.get("--out")?.trim() ||
    path.join(root, "scripts/jira/out", `Service_Pulse_Board_${stamp}.xlsx`);
  return { out };
}

async function jiraSearchAll(
  client: ReturnType<typeof createJiraClient>,
  jql: string,
  fields: string[]
): Promise<JiraIssue[]> {
  const out: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  const maxResults = 100;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let res: {
      issues?: Array<{ key?: unknown; id?: unknown; fields?: unknown }>;
      nextPageToken?: string;
    };
    try {
      res = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
        jql,
        nextPageToken,
        maxResults,
        fields,
      });
    } catch (e) {
      const anyE = e as { response?: { status?: number; statusText?: string; data?: unknown }; message?: string };
      const status = anyE?.response?.status;
      const statusText = anyE?.response?.statusText;
      const data = anyE?.response?.data;
      const body =
        typeof data === "string"
          ? data.slice(0, 800)
          : data && typeof data === "object"
            ? JSON.stringify(data).slice(0, 800)
            : null;
      const extra = [status ? `status=${status}` : null, statusText ? `statusText=${statusText}` : null, body ? `body=${body}` : null]
        .filter(Boolean)
        .join(" ");
      throw new Error(`Jira search failed (${jql}). ${extra || (e instanceof Error ? e.message : String(e))}`);
    }

    const issues = res.issues ?? [];
    for (const it of issues) {
      const key = String(it.key ?? "").trim();
      const id = String(it.id ?? "").trim();
      const f = it.fields && typeof it.fields === "object" ? (it.fields as Record<string, unknown>) : {};
      if (key && id) out.push({ key, id, fields: f });
    }

    nextPageToken =
      typeof res.nextPageToken === "string" && res.nextPageToken.trim() ? res.nextPageToken.trim() : undefined;
    if (issues.length === 0 || !nextPageToken) break;
  }

  return out;
}

function resolveEnablesLinkType(): string {
  return (
    process.env.JIRA_ENABLES_LINK_TYPE?.trim() ||
    process.env.JIRA_LINK_TYPE?.trim() ||
    "Enables"
  ).trim();
}

/** Default saved filters */
const DEFAULT_PRODUCT_FILTER_ID = "19625"; // Paradigm Product Registry
const DEFAULT_INITIATIVE_FILTER_ID = "19810"; // Paradigm Product Yearly Roadmap Reporting

function buildProductJql(): string {
  const override = process.env.JIRA_SERVICE_PULSE_PRODUCT_JQL?.trim();
  if (override) return override;
  const filterId = (process.env.JIRA_SERVICE_PULSE_PRODUCT_FILTER_ID ?? DEFAULT_PRODUCT_FILTER_ID).replace(
    /\D/g,
    ""
  );
  if (filterId) return `filter = ${filterId}`;
  return resolveProductJql();
}

function buildInitiativeJql(tagFieldId: string | undefined): string {
  const override = process.env.JIRA_SERVICE_PULSE_INITIATIVE_JQL?.trim();
  if (override) return override;

  const filterId = (process.env.JIRA_SERVICE_PULSE_INITIATIVE_FILTER_ID ?? DEFAULT_INITIATIVE_FILTER_ID)
    .replace(/\D/g, "");
  if (filterId) return `filter = ${filterId}`;

  // Fallback: Tag multiselect Reporting Annuel and/or IA / NIS / NIS2
  const list = INITIATIVE_FILTER_TAGS.map((t) => `"${t}"`).join(", ");
  if (tagFieldId && /^customfield_(\d+)$/i.test(tagFieldId)) {
    const n = tagFieldId.replace(/^customfield_/i, "");
    return `issuetype = Initiative AND cf[${n}] in (${list})`;
  }
  return `issuetype = Initiative AND Tag in (${list})`;
}

/** Strip characters illegal in Excel/OOXML shared strings (control chars except tab/LF/CR). */
function sanitizeCellValue(v: string | number | null | undefined): string | number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // eslint-disable-next-line no-control-regex
  const cleaned = String(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\uFFFE|\uFFFF/g, "")
    .trim();
  return cleaned.length ? cleaned : null;
}

/** Plain sheet (no Excel Table) — avoids Excel "repair/corrupt" dialogs from ExcelJS tables. */
function addDataSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
): void {
  const ws = wb.addWorksheet(sheetName);
  const headerRow = ws.getRow(1);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
  });
  headerRow.commit();

  rows.forEach((vals, rIdx) => {
    const row = ws.getRow(rIdx + 2);
    headers.forEach((_, cIdx) => {
      row.getCell(cIdx + 1).value = sanitizeCellValue(vals[cIdx]);
    });
    row.commit();
  });

  headers.forEach((h, i) => {
    ws.getColumn(i + 1).width = Math.min(40, Math.max(12, h.length + 2));
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: headers.length },
  };
}

/** Three data sheets only — no template copy (avoids CF/formula corruption). */
function buildOutputWorkbook(
  serviceRows: ServicePulseRow[],
  initiativeRows: InitiativePulseRow[]
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "resource-planner";
  wb.created = new Date();

  addDataSheet(wb, "Services", [...SERVICE_HEADERS], serviceRows.map(serviceRowToArray));
  addDataSheet(wb, "Initiatives", [...INITIATIVE_HEADERS], initiativeRows.map(initiativeRowToArray));
  addDataSheet(wb, "KPI_Specifiques", [...KPI_HEADERS], []);

  return wb;
}

const SERVICE_HEADERS = [
  "ID_Service",
  "Jira_Key",
  "Business_Line",
  "Owner",
  "Statut_Service",
  "Vision_Produit",
  "Segment_Client_1",
  "Segment_Client_2",
  "Segment_Client_3",
  "Axes_LO_1",
  "Axes_LO_2",
  "Axes_LO_3",
  "Nb_Clients_Actifs",
  "KPI_Spe_Libelle",
  "KPI_Spe_Data_YTD",
  "KPI_Spe_Data_Y-1",
  "Usage_Evolution_Pct",
] as const;

const INITIATIVE_HEADERS = [
  "ID_Service",
  "Libelle_Initiative",
  "Categorie",
  "Annee",
  "Quarter_Debut",
  "Quarter_Fin",
  "Statut",
  "Tags",
  "Description",
] as const;

const KPI_HEADERS = [
  "ID_Service",
  "Ordre",
  "Nom_KPI",
  "Valeur",
  "Unite",
  "Cible",
  "Tendance",
  "Categorie_KPI",
  "Commentaire",
] as const;

function serviceRowToArray(r: ServicePulseRow): Array<string | number | null> {
  return [
    r.ID_Service,
    r.Jira_Key,
    r.Business_Line,
    r.Owner,
    r.Statut_Service,
    r.Vision_Produit,
    r.Segment_Client_1,
    r.Segment_Client_2,
    r.Segment_Client_3,
    r.Axes_LO_1,
    r.Axes_LO_2,
    r.Axes_LO_3,
    r.Nb_Clients_Actifs,
    r.KPI_Spe_Libelle,
    r.KPI_Spe_Data_YTD,
    r["KPI_Spe_Data_Y-1"],
    r.Usage_Evolution_Pct,
  ];
}

function initiativeRowToArray(r: InitiativePulseRow): Array<string | number | null> {
  return [
    r.ID_Service,
    r.Libelle_Initiative,
    r.Categorie,
    r.Annee,
    r.Quarter_Debut,
    r.Quarter_Fin,
    r.Statut,
    r.Tags,
    r.Description,
  ];
}

async function main(): Promise<void> {
  const { out } = parseArgs(process.argv.slice(2));

  const client = createJiraClient();
  try {
    const me = await client.myself.getCurrentUser();
    console.log(`Authenticated as ${me.displayName ?? me.accountId ?? "unknown"}`);
  } catch (e) {
    const anyE = e as { response?: { status?: number }; message?: string };
    throw new Error(
      `Jira authentication failed (HTTP ${anyE.response?.status ?? "?"}). Check JIRA_HOST / JIRA_EMAIL / JIRA_TOKEN. ${anyE.message ?? ""}`
    );
  }

  const catalog = await loadJiraFieldCatalog(client);
  if (catalog.filter((f) => f.id.startsWith("customfield_")).length === 0) {
    console.warn("Warning: field catalog has no custom fields — mappings may be empty.");
  }
  const fieldIds = resolveServicePulseFieldIds(catalog, {
    team: process.env.JIRA_FIELD_TEAM,
    statutService: process.env.JIRA_FIELD_STATUT_SERVICE,
    visionProduit: process.env.JIRA_FIELD_VISION_PRODUIT,
    segmentClient1: process.env.JIRA_FIELD_SEGMENT_CLIENT_1,
    segmentClient2: process.env.JIRA_FIELD_SEGMENT_CLIENT_2,
    segmentClient3: process.env.JIRA_FIELD_SEGMENT_CLIENT_3,
    axeLo1: process.env.JIRA_FIELD_AXE_LO_1,
    axeLo2: process.env.JIRA_FIELD_AXE_LO_2,
    axeLo3: process.env.JIRA_FIELD_AXE_LO_3,
    nbClientsActifs: process.env.JIRA_FIELD_NB_CLIENTS_ACTIFS,
    kpiNom: process.env.JIRA_FIELD_KPI_NOM,
    kpiValeur: process.env.JIRA_FIELD_KPI_VALEUR,
    kpiTendance: process.env.JIRA_FIELD_KPI_TENDANCE,
    tag: process.env.JIRA_FIELD_TAG,
    year: process.env.JIRA_FIELD_YEAR,
    riType: process.env.JIRA_FIELD_INITIATIVE_TYPE ?? process.env.JIRA_FIELD_RI_TYPE,
  });

  const productJql = buildProductJql();
  const initiativeJql = buildInitiativeJql(fieldIds.tag);
  const enablesType = resolveEnablesLinkType();

  const productFields = [
    "summary",
    "assignee",
    "status",
    "issuetype",
    fieldIds.team,
    fieldIds.statutService,
    fieldIds.visionProduit,
    fieldIds.segmentClient1,
    fieldIds.segmentClient2,
    fieldIds.segmentClient3,
    fieldIds.axeLo1,
    fieldIds.axeLo2,
    fieldIds.axeLo3,
    fieldIds.nbClientsActifs,
    fieldIds.kpiNom,
    fieldIds.kpiValeur,
    fieldIds.kpiTendance,
  ].filter((x): x is string => Boolean(x));

  const initiativeFields = [
    "summary",
    "description",
    "status",
    "issuetype",
    "issuelinks",
    "duedate",
    "customfield_10015", // common start date — also resolve below
    fieldIds.tag,
    fieldIds.year,
    fieldIds.riType,
  ].filter((x): x is string => Boolean(x));

  // Start date: try catalog names
  const startDateId =
    catalog.find((f) => /^(start date|date de début|date de debut)$/i.test(f.name.trim()))?.id ||
    catalog.find((f) => /\bstart\s*date\b/i.test(f.name))?.id;
  if (startDateId && !initiativeFields.includes(startDateId)) initiativeFields.push(startDateId);

  console.log("Product JQL (Paradigm Product Registry):", productJql);
  console.log("Initiative JQL:", initiativeJql);
  console.log("Resolved fields:", fieldIds);
  if (startDateId) console.log("Start date field:", startDateId);

  // 1) Services from Paradigm Product Registry filter
  const products = await jiraSearchAll(client, productJql, productFields);
  console.log(`Products (from registry filter): ${products.length}`);
  if (products.length === 0) {
    console.warn("No Products returned by the Product Registry filter.");
  }

  const unresolved = Object.entries(fieldIds)
    .filter(([, id]) => !id)
    .map(([k]) => k);
  if (unresolved.length) {
    console.warn(`Unresolved Service Pulse fields: ${unresolved.join(", ")}`);
  }

  const productSummaryByKey = new Map<string, string>();
  const registryProductKeys = new Set<string>();
  const serviceRows: ServicePulseRow[] = [];
  for (const p of products) {
    const summary = readScalarField(p.fields, "summary") ?? p.key;
    productSummaryByKey.set(p.key, summary);
    registryProductKeys.add(p.key);
    serviceRows.push({
      ID_Service: summary,
      Jira_Key: p.key,
      Business_Line: readScalarField(p.fields, fieldIds.team),
      Owner: assigneeDisplayName(p.fields),
      Statut_Service: readScalarField(p.fields, fieldIds.statutService),
      Vision_Produit: readScalarField(p.fields, fieldIds.visionProduit),
      Segment_Client_1: readScalarField(p.fields, fieldIds.segmentClient1),
      Segment_Client_2: readScalarField(p.fields, fieldIds.segmentClient2),
      Segment_Client_3: readScalarField(p.fields, fieldIds.segmentClient3),
      Axes_LO_1: readScalarField(p.fields, fieldIds.axeLo1),
      Axes_LO_2: readScalarField(p.fields, fieldIds.axeLo2),
      Axes_LO_3: readScalarField(p.fields, fieldIds.axeLo3),
      Nb_Clients_Actifs: readNumberField(p.fields, fieldIds.nbClientsActifs),
      KPI_Spe_Libelle: readScalarField(p.fields, fieldIds.kpiNom),
      KPI_Spe_Data_YTD: readNumberField(p.fields, fieldIds.kpiValeur),
      "KPI_Spe_Data_Y-1": null,
      Usage_Evolution_Pct: readScalarField(p.fields, fieldIds.kpiTendance),
    });
  }
  serviceRows.sort((a, b) => a.ID_Service.localeCompare(b.ID_Service, "fr"));

  // 2) Initiatives from Yearly Roadmap filter; keep those linked to a registry Product
  const initiatives = await jiraSearchAll(client, initiativeJql, initiativeFields);
  console.log(`Initiatives (from roadmap filter): ${initiatives.length}`);

  const skippedNoLink: string[] = [];
  const skippedOutsideRegistry: string[] = [];
  const multiLink: string[] = [];
  const initiativeRows: InitiativePulseRow[] = [];

  for (const it of initiatives) {
    const linked = firstEnablesLinkedProduct(it.fields, enablesType);
    if (!linked) {
      skippedNoLink.push(it.key);
      continue;
    }
    const links = it.fields.issuelinks;
    if (Array.isArray(links)) {
      let n = 0;
      for (const link of links) {
        if (!link || typeof link !== "object") continue;
        const typeName =
          (link as { type?: { name?: string } }).type?.name?.trim().toLowerCase() ?? "";
        if (typeName !== enablesType.toLowerCase()) continue;
        for (const side of ["outwardIssue", "inwardIssue"] as const) {
          const issue = (link as Record<string, unknown>)[side];
          if (!issue || typeof issue !== "object") continue;
          const f = (issue as { fields?: Record<string, unknown> }).fields;
          if (f && (f.issuetype as { name?: string } | undefined)?.name === "Product") n++;
        }
      }
      if (n > 1) multiLink.push(it.key);
    }

    if (!registryProductKeys.has(linked.key)) {
      skippedOutsideRegistry.push(it.key);
      continue;
    }

    const idService =
      linked.summary?.trim() || productSummaryByKey.get(linked.key) || linked.key;

    const summary = readScalarField(it.fields, "summary") ?? it.key;
    const yearRaw = readScalarField(it.fields, fieldIds.year);
    const year = yearRaw ? parseInt(yearRaw, 10) : NaN;

    const startRaw = startDateId ? it.fields[startDateId] : null;
    const dueRaw = it.fields.duedate;

    initiativeRows.push({
      ID_Service: idService,
      Libelle_Initiative: stripJiraKeyFromSummary(summary, it.key),
      Categorie: parseCategorieFromRiType(readScalarField(it.fields, fieldIds.riType)),
      Annee: Number.isFinite(year) ? year : null,
      Quarter_Debut: dateToQuarter(startRaw as string | null),
      Quarter_Fin: dateToQuarter(dueRaw as string | null),
      Statut: mapInitiativeStatus(statusName(it.fields)),
      Tags: pickExcelTag(readMultiSelectValues(it.fields, fieldIds.tag)),
      Description: readScalarField(it.fields, "description"),
    });
  }

  initiativeRows.sort((a, b) => {
    const c = a.ID_Service.localeCompare(b.ID_Service, "fr");
    return c !== 0 ? c : a.Libelle_Initiative.localeCompare(b.Libelle_Initiative, "fr");
  });

  console.log(`Services exported: ${serviceRows.length}`);
  console.log(`Initiatives exported: ${initiativeRows.length}`);
  if (skippedNoLink.length) {
    console.log(`Skipped (no enables→Product): ${skippedNoLink.length}`, skippedNoLink.slice(0, 20));
  }
  if (skippedOutsideRegistry.length) {
    console.log(
      `Skipped (Product outside Product Registry): ${skippedOutsideRegistry.length}`,
      skippedOutsideRegistry.slice(0, 20)
    );
  }
  if (multiLink.length) console.log(`Multiple Product links (first used): ${multiLink.length}`, multiLink.slice(0, 20));

  const wb = buildOutputWorkbook(serviceRows, initiativeRows);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await wb.xlsx.writeFile(out);
  console.log(`Wrote ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
