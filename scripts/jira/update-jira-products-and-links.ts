import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { createJiraClient, resolveInitiativeJql, resolveProductJql, resolveProjectKeyFromJql } from "./jira-client";
import { readCsvProducts, type CsvProductRow } from "./csv-products";
import { loadJiraFieldCatalog, resolveProductFieldIds } from "./jira-field-resolve";
import { firstComponentName, hasEnablesLinkToAnyProduct, issueTypeName, normalizeSummaryKey } from "./jira-updater-utils";

type CliStep = "products" | "links" | "all";
type CliSample = 3 | 10 | "all";

type ProductCreatePlanItem = {
  csvId: string;
  csvName: string;
  fields: Record<string, unknown>;
  reason: "missing_in_jira";
};

type ProductExistsItem = { csvId: string; csvName: string; jiraKey: string; jiraSummary: string };

type LinkPlanItem = {
  initiativeKey: string;
  initiativeComponent: string;
  productKey: string;
  productSummary: string;
  reason: "component_match";
};

type PlanOutput = {
  meta: {
    generatedAt: string;
    step: CliStep;
    sample: CliSample;
    apply: boolean;
    productJql: string;
    initiativeJql: string;
    enablesLinkType: string;
  };
  products?: {
    toCreate: ProductCreatePlanItem[];
    alreadyExists: ProductExistsItem[];
    invalidRows: Array<{ row: unknown; reason: string }>;
    fieldIds: Record<string, string | undefined>;
  };
  links?: {
    toLink: LinkPlanItem[];
    noComponent: Array<{ initiativeKey: string }>;
    noMatchingProduct: Array<{ initiativeKey: string; component: string }>;
    alreadyLinked: Array<{ initiativeKey: string; reason: string }>;
  };
};

function parseArgs(argv: string[]): {
  step: CliStep;
  sample: CliSample;
  outDir: string;
  apply: boolean;
} {
  const args = new Map<string, string | undefined>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) continue;
    const [k, v] = a.includes("=") ? a.split("=", 2) : [a, argv[i + 1]];
    args.set(k, v);
    if (!a.includes("=") && v && !v.startsWith("--")) i++;
  }

  const stepRaw = (args.get("--step") ?? "all").trim();
  const step: CliStep = stepRaw === "products" || stepRaw === "links" || stepRaw === "all" ? stepRaw : "all";

  const sampleRaw = (args.get("--sample") ?? "3").trim();
  const sample: CliSample = sampleRaw === "all" ? "all" : sampleRaw === "10" ? 10 : 3;

  const outDirRaw = (args.get("--outDir") ?? "scripts/jira/out").trim();
  const outDir = outDirRaw;

  const apply = argv.includes("--apply");

  return { step, sample, outDir, apply };
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function jiraSearchAll(
  client: ReturnType<typeof createJiraClient>,
  jql: string,
  fields: string[]
): Promise<Array<{ key: string; id: string; fields: Record<string, unknown> }>> {
  const out: Array<{ key: string; id: string; fields: Record<string, unknown> }> = [];
  let nextPageToken: string | undefined = undefined;
  const maxResults = 100;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let res: any;
    try {
      res = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
        jql,
        nextPageToken,
        maxResults,
        fields,
      });
    } catch (e) {
      const anyE = e as any;
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

    const issues = (res.issues ?? []) as Array<{ key?: unknown; id?: unknown; fields?: unknown }>;
    for (const it of issues) {
      const key = String(it.key ?? "").trim();
      const id = String(it.id ?? "").trim();
      const f = it.fields && typeof it.fields === "object" ? (it.fields as Record<string, unknown>) : {};
      if (key && id) out.push({ key, id, fields: f });
    }

    nextPageToken = typeof res.nextPageToken === "string" && res.nextPageToken.trim() ? res.nextPageToken.trim() : undefined;
    if (issues.length === 0 || !nextPageToken) break;
  }

  return out;
}

function buildProductCreateFields(args: {
  projectKey: string;
  summary: string;
  fieldIds: Record<string, string | undefined>;
  csv: CsvProductRow;
}): Record<string, unknown> {
  const f: Record<string, unknown> = {
    project: { key: args.projectKey },
    issuetype: { name: "Product" },
    summary: args.summary,
  };

  const setIf = (fieldId: string | undefined, value: unknown) => {
    if (!fieldId) return;
    if (value == null) return;
    if (typeof value === "string" && !value.trim()) return;
    f[fieldId] = value;
  };

  // Keep these aligned with the DB sync mapping intent.
  setIf(args.fieldIds.productFamily, args.csv.productFamily);
  setIf(args.fieldIds.division, args.csv.division);
  setIf(args.fieldIds.subDivision, args.csv.subDivision);
  setIf(args.fieldIds.team, args.csv.team);

  // The Jira custom field is a single field; the DB sync splits into code/name.
  // For Jira write-back we set a best-effort display string.
  const sapProgFin = [args.csv.sapEotpCode, args.csv.sapEotpName].filter(Boolean).join(" - ").trim();
  setIf(args.fieldIds.sapProgFin, sapProgFin || null);

  setIf(args.fieldIds.attractiveness, args.csv.attractiveness);
  setIf(args.fieldIds.competitiveness, args.csv.competitiveness);

  // If the field is a select list, Jira expects `{ value }`. If it's plain text, it accepts a string.
  // We keep it conservative and allow the instance to decide.
  setIf(args.fieldIds.typeProduct, "Product");

  return f;
}

async function runProductsStep(opts: {
  csvPath: string;
  sample: CliSample;
  apply: boolean;
  outDir: string;
  productJql: string;
}): Promise<PlanOutput["products"]> {
  const client = createJiraClient();

  const { products, invalidRows } = readCsvProducts(opts.csvPath);
  const jiraFields = await loadJiraFieldCatalog(client);
  const fieldIds = resolveProductFieldIds(jiraFields, {
    productFamily: process.env.JIRA_FIELD_PRODUCT_FAMILY,
    division: process.env.JIRA_FIELD_DIVISION,
    subDivision: process.env.JIRA_FIELD_SUB_DIVISION,
    team: process.env.JIRA_FIELD_TEAM,
    sapProgFin: process.env.JIRA_FIELD_SAP_PROG_FIN,
    attractiveness: process.env.JIRA_FIELD_ATTRACTIVENESS,
    competitiveness: process.env.JIRA_FIELD_COMPETITIVENESS,
    typeProduct: process.env.JIRA_FIELD_TYPE_PRODUCT,
  });

  const productIssues = await jiraSearchAll(client, opts.productJql, ["summary", "issuetype"]);
  const bySummary = new Map<string, { key: string; summary: string }>();
  for (const it of productIssues) {
    const sum = it.fields.summary;
    const summary = typeof sum === "string" ? sum : "";
    const k = normalizeSummaryKey(summary);
    if (!k) continue;
    if (!bySummary.has(k)) bySummary.set(k, { key: it.key, summary });
  }

  const initiativeJql = resolveInitiativeJql();
  const projectKey =
    process.env.JIRA_PRODUCT_PROJECT_KEY?.trim() ||
    resolveProjectKeyFromJql(initiativeJql) ||
    process.env.JIRA_PROJECT_KEY?.trim() ||
    null;
  if (!projectKey) throw new Error("Missing JIRA_PRODUCT_PROJECT_KEY (or JIRA_PROJECT_KEY), and could not infer from JIRA_JQL");

  const rows = opts.sample === "all" ? products : products.slice(0, opts.sample);

  const toCreate: ProductCreatePlanItem[] = [];
  const alreadyExists: ProductExistsItem[] = [];

  for (const p of rows) {
    const key = normalizeSummaryKey(p.name);
    const existing = bySummary.get(key);
    if (existing) {
      alreadyExists.push({ csvId: p.id, csvName: p.name, jiraKey: existing.key, jiraSummary: existing.summary });
      continue;
    }
    toCreate.push({
      csvId: p.id,
      csvName: p.name,
      fields: buildProductCreateFields({
        projectKey: projectKey.toUpperCase(),
        summary: p.name,
        fieldIds,
        csv: p,
      }),
      reason: "missing_in_jira",
    });
  }

  if (opts.apply) {
    const batchSize = Number.parseInt(process.env.JIRA_APPLY_BATCH_SIZE ?? "20", 10);
    const size = Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 20;

    const created: Array<{ csvId: string; csvName: string; jiraKey: string }> = [];
    const failed: Array<{ csvId: string; csvName: string; error: string }> = [];

    for (let i = 0; i < toCreate.length; i += size) {
      const batch = toCreate.slice(i, i + size);
      for (const item of batch) {
        try {
          const res = await client.issues.createIssue({ fields: item.fields as any });
          const jiraKey = String((res as { key?: unknown }).key ?? "").trim();
          if (jiraKey) created.push({ csvId: item.csvId, csvName: item.csvName, jiraKey });
          else failed.push({ csvId: item.csvId, csvName: item.csvName, error: "createIssue returned no key" });
        } catch (e) {
          failed.push({ csvId: item.csvId, csvName: item.csvName, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    writeJson(path.join(opts.outDir, "products.apply-results.json"), { created, failed });
  }

  return { toCreate, alreadyExists, invalidRows, fieldIds };
}

async function runLinksStep(opts: {
  sample: CliSample;
  apply: boolean;
  outDir: string;
  productJql: string;
  initiativeJql: string;
  enablesLinkType: string;
}): Promise<PlanOutput["links"]> {
  const client = createJiraClient();

  const products = await jiraSearchAll(client, opts.productJql, ["summary", "issuetype"]);
  const productBySummary = new Map<string, { key: string; summary: string }>();
  for (const p of products) {
    const summary = typeof p.fields.summary === "string" ? p.fields.summary : "";
    const k = normalizeSummaryKey(summary);
    if (k && !productBySummary.has(k)) productBySummary.set(k, { key: p.key, summary });
  }

  const initiatives = await jiraSearchAll(client, opts.initiativeJql, ["key", "issuetype", "components", "issuelinks"]);
  const filtered = initiatives.filter((x) => issueTypeName(x.fields) === "Initiative");
  const rows = opts.sample === "all" ? filtered : filtered.slice(0, opts.sample);

  const toLink: LinkPlanItem[] = [];
  const noComponent: Array<{ initiativeKey: string }> = [];
  const noMatchingProduct: Array<{ initiativeKey: string; component: string }> = [];
  const alreadyLinked: Array<{ initiativeKey: string; reason: string }> = [];

  for (const it of rows) {
    const component = firstComponentName(it.fields);
    if (!component) {
      noComponent.push({ initiativeKey: it.key });
      continue;
    }

    if (hasEnablesLinkToAnyProduct(it.fields, opts.enablesLinkType)) {
      alreadyLinked.push({ initiativeKey: it.key, reason: `already has ${opts.enablesLinkType} link to a Product` });
      continue;
    }

    const target = productBySummary.get(normalizeSummaryKey(component));
    if (!target) {
      noMatchingProduct.push({ initiativeKey: it.key, component });
      continue;
    }

    toLink.push({
      initiativeKey: it.key,
      initiativeComponent: component,
      productKey: target.key,
      productSummary: target.summary,
      reason: "component_match",
    });
  }

  if (opts.apply) {
    const linked: Array<{ initiativeKey: string; productKey: string }> = [];
    const failed: Array<{ initiativeKey: string; productKey: string; error: string }> = [];

    for (const item of toLink) {
      try {
        await client.issueLinks.linkIssues({
          type: { name: opts.enablesLinkType } as any,
          outwardIssue: { key: item.initiativeKey } as any,
          inwardIssue: { key: item.productKey } as any,
        });
        linked.push({ initiativeKey: item.initiativeKey, productKey: item.productKey });
      } catch (e) {
        failed.push({
          initiativeKey: item.initiativeKey,
          productKey: item.productKey,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    writeJson(path.join(opts.outDir, "links.apply-results.json"), { linked, failed });
  }

  return { toLink, noComponent, noMatchingProduct, alreadyLinked };
}

async function main(): Promise<void> {
  const { step, sample, outDir, apply } = parseArgs(process.argv.slice(2));
  const productJql = resolveProductJql();
  const initiativeJql = resolveInitiativeJql();
  const enablesLinkType = (process.env.JIRA_ENABLES_LINK_TYPE?.trim() || "Enables").trim();
  if (process.env.DEBUG_JIRA_UPDATER?.trim() === "1") {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          debug: true,
          proxy: {
            HTTP_PROXY: process.env.HTTP_PROXY ?? null,
            HTTPS_PROXY: process.env.HTTPS_PROXY ?? null,
            NO_PROXY: process.env.NO_PROXY ?? null,
          },
          jiraHostPresent: Boolean(process.env.JIRA_HOST) || Boolean(Object.keys(process.env).find((k) => k.trim() === "JIRA_HOST")),
        },
        null,
        2
      )
    );
  }

  const stampDir = path.join(outDir, nowStamp());
  ensureDir(stampDir);

  const plan: PlanOutput = {
    meta: {
      generatedAt: new Date().toISOString(),
      step,
      sample,
      apply,
      productJql,
      initiativeJql,
      enablesLinkType,
    },
  };

  const csvPath = process.env.PRODUCTS_CSV_PATH?.trim() || "scripts/datasets/dev/PRODUCTS.csv";

  if (step === "products" || step === "all") {
    plan.products = await runProductsStep({ csvPath, sample, apply, outDir: stampDir, productJql });
  }

  if (step === "links" || step === "all") {
    plan.links = await runLinksStep({ sample, apply, outDir: stampDir, productJql, initiativeJql, enablesLinkType });
  }

  writeJson(path.join(stampDir, "plan.json"), plan);

  // Minimal stdout summary to guide review.
  const p = plan.products;
  const l = plan.links;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        outDir: stampDir,
        step,
        sample,
        apply,
        products: p
          ? { toCreate: p.toCreate.length, alreadyExists: p.alreadyExists.length, invalidRows: p.invalidRows.length }
          : undefined,
        links: l
          ? {
              toLink: l.toLink.length,
              alreadyLinked: l.alreadyLinked.length,
              noComponent: l.noComponent.length,
              noMatchingProduct: l.noMatchingProduct.length,
            }
          : undefined,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  // Never dump Jira client error objects (they can include Authorization headers).
  // eslint-disable-next-line no-console
  console.error(`Jira updater failed: ${msg}`);
  process.exitCode = 1;
});

