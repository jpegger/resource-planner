import { type Version3Client } from "jira.js";

export type JiraFieldMeta = { id: string; name: string };

function normalizeFieldLabel(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toFieldCatalog(rows: unknown): JiraFieldMeta[] {
  if (!Array.isArray(rows)) return [];
  const out: JiraFieldMeta[] = [];
  for (const row of rows) {
    if (row && typeof row === "object" && "id" in row && "name" in row) {
      const id = String((row as { id: unknown }).id);
      const name = String((row as { name: unknown }).name);
      if (id && name) out.push({ id, name });
    }
  }
  return out;
}

function findFieldIdByExactNames(fields: JiraFieldMeta[], candidates: string[]): string | undefined {
  const byNorm = new Map<string, string>();
  for (const f of fields) byNorm.set(normalizeFieldLabel(f.name), f.id);
  for (const c of candidates) {
    const id = byNorm.get(normalizeFieldLabel(c));
    if (id) return id;
  }
  return undefined;
}

function findFieldIdByRegex(fields: JiraFieldMeta[], re: RegExp): string | undefined {
  for (const f of fields) if (re.test(f.name)) return f.id;
  return undefined;
}

function tryResolveFieldFromNameOrId(
  fields: JiraFieldMeta[],
  raw: string | undefined,
  excludeIds: Set<string>
): string | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  if (/^customfield_\d+$/i.test(s)) {
    if (excludeIds.has(s)) return undefined;
    return s;
  }
  const id = findFieldIdByExactNames(fields, [s]);
  if (!id || excludeIds.has(id)) return undefined;
  return id;
}

export type ProductFieldIds = {
  productFamily?: string;
  division?: string;
  subDivision?: string;
  team?: string;
  sapProgFin?: string;
  attractiveness?: string;
  competitiveness?: string;
  typeProduct?: string;
};

/** Custom fields used by the Service Pulse board export. */
export type ServicePulseFieldIds = {
  team?: string;
  statutService?: string;
  visionProduit?: string;
  segmentClient1?: string;
  segmentClient2?: string;
  segmentClient3?: string;
  axeLo1?: string;
  axeLo2?: string;
  axeLo3?: string;
  nbClientsActifs?: string;
  kpiNom?: string;
  kpiValeur?: string;
  kpiTendance?: string;
  tag?: string;
  year?: string;
  riType?: string;
};

export async function loadJiraFieldCatalog(client: Version3Client): Promise<JiraFieldMeta[]> {
  try {
    const rows = await client.issueFields.getFields();
    return toFieldCatalog(rows as unknown);
  } catch {
    return [];
  }
}

export function resolveProductFieldIds(fields: JiraFieldMeta[], env: ProductFieldIds): ProductFieldIds {
  const exclude = new Set<string>();
  const resolve = (explicit: string | undefined, candidates: string[], regex?: RegExp) => {
    const fromEnv = tryResolveFieldFromNameOrId(fields, explicit, exclude);
    if (fromEnv) return fromEnv;
    const id = findFieldIdByExactNames(fields, candidates) ?? (regex ? findFieldIdByRegex(fields, regex) : undefined);
    if (id) exclude.add(id);
    return id;
  };

  const productFamily = resolve(env.productFamily, ["(RI) ProductFamily", "(RI) Product Family", "ProductFamily"]);
  const division = resolve(env.division, ["(RI) DIVISION", "(RI) Division", "Division"]);
  const subDivision = resolve(env.subDivision, ["(RI) SubDivision", "(RI) Sub Division", "SubDivision", "Sub-division"]);
  const team = resolve(env.team, ["(RI) TEAM", "(RI) Team", "Team"]);
  const sapProgFin = resolve(
    env.sapProgFin,
    [
      "(RI) SAP PROG. FIN.",
      "(RI) SAP PROG FIN",
      "(RI) SAP PROGR. FIN.",
      "(RI) SAP PROGR FIN",
      "(RI) SAP PROGRAM FIN",
      "SAP PROG. FIN.",
    ],
    /\bsap\b.*\bprog(r|ram)?\b.*\bfin\b/i
  );
  const attractiveness = resolve(env.attractiveness, ["(RI) Attractiveness", "Attractiveness"]);
  const competitiveness = resolve(env.competitiveness, ["(RI) Competitiveness", "Competitiveness"]);
  const typeProduct = resolve(env.typeProduct, ["(RI) Type Product", "(RI) Type product", "Type Product"], /\btype\b.*\bproduct\b/i);

  return { productFamily, division, subDivision, team, sapProgFin, attractiveness, competitiveness, typeProduct };
}

export function resolveServicePulseFieldIds(
  fields: JiraFieldMeta[],
  env: Partial<ServicePulseFieldIds> = {}
): ServicePulseFieldIds {
  const exclude = new Set<string>();
  const resolve = (explicit: string | undefined, candidates: string[], regex?: RegExp) => {
    const fromEnv = tryResolveFieldFromNameOrId(fields, explicit, exclude);
    if (fromEnv) {
      exclude.add(fromEnv);
      return fromEnv;
    }
    const id = findFieldIdByExactNames(fields, candidates) ?? (regex ? findFieldIdByRegex(fields, regex) : undefined);
    if (id) exclude.add(id);
    return id;
  };

  return {
    team: resolve(env.team, ["(RI) TEAM", "(RI) Team", "Team"]),
    statutService: resolve(env.statutService, ["(RI) Statut Service", "Statut Service"]),
    visionProduit: resolve(env.visionProduit, ["(RI) Vision Produit", "Vision Produit"]),
    segmentClient1: resolve(env.segmentClient1, ["(RI) Segment Client 1", "Segment Client 1"]),
    segmentClient2: resolve(env.segmentClient2, ["(RI) Segment Client 2", "Segment Client 2"]),
    segmentClient3: resolve(env.segmentClient3, ["(RI) Segment Client 3", "Segment Client 3"]),
    axeLo1: resolve(
      env.axeLo1,
      [
        "(RI) Axe stratégique 1 – Lettre d'orientation",
        "(RI) Axe stratégique 1 - Lettre d'orientation",
        "(RI) Axe strategique 1 – Lettre d'orientation",
      ],
      /axe\s*strat[eé]gique\s*1/i
    ),
    axeLo2: resolve(
      env.axeLo2,
      [
        "(RI) Axe stratégique 2 – Lettre d'orientation",
        "(RI) Axe stratégique 2 - Lettre d'orientation",
        "(RI) Axe strategique 2 – Lettre d'orientation",
      ],
      /axe\s*strat[eé]gique\s*2/i
    ),
    axeLo3: resolve(
      env.axeLo3,
      [
        "(RI) Axe stratégique 3 – Lettre d'orientation",
        "(RI) Axe stratégique 3 - Lettre d'orientation",
        "(RI) Axe strategique 3 – Lettre d'orientation",
      ],
      /axe\s*strat[eé]gique\s*3/i
    ),
    nbClientsActifs: resolve(
      env.nbClientsActifs,
      ["(RI) Nombre de clients actifs", "Nombre de clients actifs"],
      /nombre\s*de\s*clients\s*actifs/i
    ),
    kpiNom: resolve(env.kpiNom, ["(RI) KPI Nom", "KPI Nom"]),
    kpiValeur: resolve(env.kpiValeur, ["(RI) KPI Valeur", "KPI Valeur"]),
    kpiTendance: resolve(env.kpiTendance, ["(RI) KPI Tendance", "KPI Tendance"]),
    tag: resolve(env.tag, ["Tag", "(RI) Tag"], /^tag$/i),
    year: resolve(env.year, ["(RI) Year", "Year", "Année", "Annee"], /\(\s*ri\s*\)\s*year\b/i),
    riType: resolve(env.riType, ["(RI) Type", "(RI) type", "Initiative Type"], /\(\s*ri\s*\)\s*type\b/i),
  };
}

