"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

type Level = "resource" | "detail";

type ResourceRow = {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  direction: string | null;
  cellule: string | null;
  function: string | null;
  internal: number;
  external: number;
  direct: number;
  total: number;
  assignmentPct: number;
  manDays: number;
  buildInternal: number;
  buildExternal: number;
  buildDirect: number;
  totalBuild: number;
  buildAssignmentPct: number;
  buildManDays: number;
};

type DetailRow = {
  productName: string;
  jiraKey: string;
  summary: string;
  initiativeType: string | null;
  internal: number;
  external: number;
  direct: number;
  total: number;
  assignmentPct: number;
  manDays: number;
  buildInternal: number;
  buildExternal: number;
  buildDirect: number;
  totalBuild: number;
  buildAssignmentPct: number;
  buildManDays: number;
};

type DetailWithResource = DetailRow & { resourceId: string };

type FilterOptions = {
  productFamilies: string[];
  products: string[];
  directions: string[];
  cellules: string[];
  functions: string[];
  initiativeTypes: string[];
};

type ApiResponse = {
  rows: ResourceRow[] | DetailRow[];
  details?: DetailWithResource[];
  filterOptions: FilterOptions;
  meta: { year: number; level: Level; resourceId: string | null };
};

type ShownDetail = DetailRow & {
  internalShown: number;
  externalShown: number;
  directShown: number;
  totalShown: number;
  assignmentPctShown: number;
  manDaysShown: number;
};

const ALL = "__ALL__";

function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return [y - 1, y, y + 1];
}

function formatEuro(n: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)} €`;
  }
}

function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  })}%`;
}

function formatMd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function matchesName(name: string, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  const hay = name.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function Toggle({
  label,
  on,
  onToggle,
  hideLabel = false,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  hideLabel?: boolean;
}) {
  return (
    <div className="flex h-8 w-full items-center justify-between rounded-md border px-2 py-1">
      {hideLabel ? <span className="sr-only">{label}</span> : <div className="text-xs">{label}</div>}
      <button
        type="button"
        className={cn(
          "rounded-md px-2 py-0.5 text-xs font-medium",
          hideLabel && "ml-auto",
          on ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
        )}
        onClick={onToggle}
        aria-pressed={on}
        aria-label={label}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel?: string;
}) {
  return (
    <div className="min-w-0 w-full">
      <Label className="text-xs">{label}</Label>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v !== null) onChange(v);
        }}
      >
        <SelectTrigger className="mt-1 h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type CostParts = {
  internal: number;
  external: number;
  direct: number;
  buildInternal: number;
  buildExternal: number;
  buildDirect: number;
  assignmentPct: number;
  manDays: number;
  buildAssignmentPct: number;
  buildManDays: number;
};

function applyCostFilters(
  r: CostParts,
  opts: {
    includeInternal: boolean;
    includeExternal: boolean;
    includeDirect: boolean;
    includeRun: boolean;
    includeBuild: boolean;
  }
) {
  const runInternal = r.internal - r.buildInternal;
  const runExternal = r.external - r.buildExternal;
  const runDirect = r.direct - r.buildDirect;
  const pick = (runAmt: number, buildAmt: number) =>
    (opts.includeRun ? runAmt : 0) + (opts.includeBuild ? buildAmt : 0);

  const internalShown = opts.includeInternal ? pick(runInternal, r.buildInternal) : 0;
  const externalShown = opts.includeExternal ? pick(runExternal, r.buildExternal) : 0;
  const directShown = opts.includeDirect ? pick(runDirect, r.buildDirect) : 0;
  const totalShown = internalShown + externalShown + directShown;

  // Assignment % / man-days follow Run/Build only (not cost-component toggles).
  const assignmentPctShown = pick(
    r.assignmentPct - r.buildAssignmentPct,
    r.buildAssignmentPct
  );
  const manDaysShown = pick(r.manDays - r.buildManDays, r.buildManDays);

  return {
    internalShown,
    externalShown,
    directShown,
    totalShown,
    assignmentPctShown,
    manDaysShown,
  };
}

export default function ResourceAssignmentsReportPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [nameSearch, setNameSearch] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [level, setLevel] = useState<Level>("resource");
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [selectedResourceName, setSelectedResourceName] = useState<string | null>(null);

  const [initiativeType, setInitiativeType] = useState(ALL);
  const [productFamily, setProductFamily] = useState(ALL);
  const [productName, setProductName] = useState(ALL);
  const [direction, setDirection] = useState(ALL);
  const [cellule, setCellule] = useState(ALL);
  const [functionName, setFunctionName] = useState(ALL);

  const [includeInternal, setIncludeInternal] = useState(true);
  const [includeExternal, setIncludeExternal] = useState(true);
  const [includeDirect, setIncludeDirect] = useState(true);
  const [includeRun, setIncludeRun] = useState(true);
  const [includeBuild, setIncludeBuild] = useState(true);
  const [includeResInternal, setIncludeResInternal] = useState(true);
  const [includeResExternal, setIncludeResExternal] = useState(true);
  const [includeResDirect, setIncludeResDirect] = useState(true);

  const [resourceRows, setResourceRows] = useState<ResourceRow[]>([]);
  const [detailRows, setDetailRows] = useState<DetailRow[]>([]);
  const [overviewDetails, setOverviewDetails] = useState<DetailWithResource[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    productFamilies: [],
    products: [],
    directions: [],
    cellules: [],
    functions: [],
    initiativeTypes: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => yearOptions(), []);

  const resourceTypesParam = useMemo(() => {
    const types: string[] = [];
    if (includeResInternal) types.push("INTERNAL");
    if (includeResExternal) types.push("EXTERNAL");
    if (includeResDirect) types.push("DIRECT_COST");
    return types;
  }, [includeResInternal, includeResExternal, includeResDirect]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("year", String(year));
      sp.set("level", level);
      if (level === "detail" && selectedResourceId) sp.set("resourceId", selectedResourceId);
      if (level === "resource" && showDetails) sp.set("includeDetails", "1");
      if (initiativeType !== ALL) sp.set("initiativeTypes", initiativeType);
      if (productFamily !== ALL) sp.set("productFamily", productFamily);
      if (productName !== ALL) sp.set("productName", productName);
      if (direction !== ALL) sp.set("direction", direction);
      if (cellule !== ALL) sp.set("cellule", cellule);
      if (functionName !== ALL) sp.set("functionName", functionName);
      if (resourceTypesParam.length && resourceTypesParam.length < 3) {
        sp.set("resourceTypes", resourceTypesParam.join(","));
      }
      if (resourceTypesParam.length === 0) {
        setResourceRows([]);
        setDetailRows([]);
        setOverviewDetails([]);
        setLoading(false);
        return;
      }

      const response = await fetch(`/api/reports/resource-assignments?${sp.toString()}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const data = (await response.json()) as ApiResponse;
      setFilterOptions(data.filterOptions);
      if (level === "detail") {
        setDetailRows(data.rows as DetailRow[]);
        setOverviewDetails([]);
      } else {
        setResourceRows(data.rows as ResourceRow[]);
        setOverviewDetails(Array.isArray(data.details) ? data.details : []);
      }
    } catch (e) {
      setResourceRows([]);
      setDetailRows([]);
      setOverviewDetails([]);
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [
    year,
    level,
    selectedResourceId,
    showDetails,
    initiativeType,
    productFamily,
    productName,
    direction,
    cellule,
    functionName,
    resourceTypesParam,
  ]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const filterOpts = {
    includeInternal,
    includeExternal,
    includeDirect,
    includeRun,
    includeBuild,
  };

  const stackedResources = useMemo(() => {
    return resourceRows
      .filter((r) => matchesName(r.resourceName, nameSearch))
      .map((r) => {
        const shown = applyCostFilters(r, filterOpts);
        return { ...r, ...shown };
      })
      .filter((r) => r.totalShown !== 0);
  }, [resourceRows, nameSearch, includeInternal, includeExternal, includeDirect, includeRun, includeBuild]);

  const stackedDetails = useMemo(() => {
    return detailRows
      .map((r) => {
        const shown = applyCostFilters(r, filterOpts);
        return { ...r, ...shown };
      })
      .filter((r) => r.totalShown !== 0);
  }, [detailRows, includeInternal, includeExternal, includeDirect, includeRun, includeBuild]);

  function groupDetailsByProduct(items: ShownDetail[]) {
    const map = new Map<string, ShownDetail[]>();
    for (const row of items) {
      if (row.totalShown === 0) continue;
      const arr = map.get(row.productName) ?? [];
      arr.push(row);
      map.set(row.productName, arr);
    }
    return [...map.entries()]
      .map(([productName, groupItems]) => ({
        productName,
        items: groupItems,
        totalShown: groupItems.reduce((a, i) => a + i.totalShown, 0),
        manDaysShown: groupItems.reduce((a, i) => a + i.manDaysShown, 0),
        assignmentPctShown: groupItems.reduce((a, i) => a + i.assignmentPctShown, 0),
      }))
      .filter((g) => g.totalShown !== 0);
  }

  const detailsByProduct = useMemo(
    () => groupDetailsByProduct(stackedDetails),
    [stackedDetails]
  );

  const overviewDetailsByResource = useMemo(() => {
    const map = new Map<string, ShownDetail[]>();
    for (const row of overviewDetails) {
      const shown = applyCostFilters(row, filterOpts);
      if (shown.totalShown === 0) continue;
      const arr = map.get(row.resourceId) ?? [];
      arr.push({ ...row, ...shown });
      map.set(row.resourceId, arr);
    }
    const grouped = new Map<string, ReturnType<typeof groupDetailsByProduct>>();
    for (const [resourceId, items] of map) {
      const products = groupDetailsByProduct(items);
      if (products.length) grouped.set(resourceId, products);
    }
    return grouped;
  }, [
    overviewDetails,
    includeInternal,
    includeExternal,
    includeDirect,
    includeRun,
    includeBuild,
  ]);

  const chartData = useMemo(() => {
    if (level === "detail") {
      return detailsByProduct.map((p) => ({
        label: p.productName,
        totalShown: p.totalShown,
      }));
    }
    return stackedResources
      .slice()
      .sort((a, b) => b.totalShown - a.totalShown)
      .slice(0, 25)
      .map((r) => ({
        label: r.resourceName,
        totalShown: r.totalShown,
        assignmentPctShown: r.assignmentPctShown,
      }));
  }, [level, stackedResources, detailsByProduct]);

  function openResource(r: ResourceRow) {
    if (showDetails) return;
    setSelectedResourceId(r.resourceId);
    setSelectedResourceName(r.resourceName);
    setLevel("detail");
  }

  function backToResources() {
    setLevel("resource");
    setSelectedResourceId(null);
    setSelectedResourceName(null);
  }

  function toggleDetails() {
    setShowDetails((v) => {
      const next = !v;
      if (next) {
        setLevel("resource");
        setSelectedResourceId(null);
        setSelectedResourceName(null);
      }
      return next;
    });
  }

  const breadcrumb = useMemo(() => {
    const parts: { label: string; onClick: () => void }[] = [
      {
        label: "Resources",
        onClick: backToResources,
      },
    ];
    if (selectedResourceName) {
      parts.push({
        label: selectedResourceName,
        onClick: () => {
          setLevel("detail");
        },
      });
    }
    return parts;
  }, [selectedResourceName]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">Resource assignments</CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              Resources → initiatives by product. Turn on Details for a full inline overview, or click a
              resource to drill down.
            </div>
          </div>
          <Button variant="outline" onClick={fetchData} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex w-full max-w-3xl flex-col gap-3">
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
              <div className="min-w-0 w-full">
                <Label htmlFor="resource-name-search" className="text-xs">
                  Name
                </Label>
                <Input
                  id="resource-name-search"
                  className="mt-1 h-8 w-full text-xs"
                  value={nameSearch}
                  onChange={(e) => setNameSearch(e.target.value)}
                  placeholder="First or last name…"
                />
              </div>
              <div className="min-w-0 w-full">
                <Label className="text-xs">Year</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger className="mt-1 h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 w-full">
                <Label className="text-xs">Details</Label>
                <div className="mt-1">
                  <Toggle
                    label="Details"
                    hideLabel
                    on={showDetails}
                    onToggle={toggleDetails}
                  />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs">Cost components</Label>
              <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Toggle label="Internal" on={includeInternal} onToggle={() => setIncludeInternal((v) => !v)} />
                <Toggle label="External" on={includeExternal} onToggle={() => setIncludeExternal((v) => !v)} />
                <Toggle label="Direct" on={includeDirect} onToggle={() => setIncludeDirect((v) => !v)} />
              </div>
            </div>

            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
              <div className="min-w-0 w-full">
                <Label className="text-xs">Run</Label>
                <div className="mt-1">
                  <Toggle
                    label="Run"
                    hideLabel
                    on={includeRun}
                    onToggle={() => setIncludeRun((v) => !v)}
                  />
                </div>
              </div>
              <div className="min-w-0 w-full">
                <Label className="text-xs">Build</Label>
                <div className="mt-1">
                  <Toggle
                    label="Build"
                    hideLabel
                    on={includeBuild}
                    onToggle={() => setIncludeBuild((v) => !v)}
                  />
                </div>
              </div>
              <FilterSelect
                label="Initiative type"
                value={initiativeType}
                onChange={setInitiativeType}
                options={filterOptions.initiativeTypes}
                allLabel="All types"
              />
            </div>

            <div>
              <Label className="text-xs">Resource type</Label>
              <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Toggle
                  label="Internal"
                  on={includeResInternal}
                  onToggle={() => setIncludeResInternal((v) => !v)}
                />
                <Toggle
                  label="External"
                  on={includeResExternal}
                  onToggle={() => setIncludeResExternal((v) => !v)}
                />
                <Toggle
                  label="Direct"
                  on={includeResDirect}
                  onToggle={() => setIncludeResDirect((v) => !v)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FilterSelect
                label="Product group"
                value={productFamily}
                onChange={setProductFamily}
                options={filterOptions.productFamilies}
              />
              <FilterSelect
                label="Product"
                value={productName}
                onChange={setProductName}
                options={filterOptions.products}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FilterSelect
                label="Direction"
                value={direction}
                onChange={setDirection}
                options={filterOptions.directions}
              />
              <FilterSelect
                label="Cell"
                value={cellule}
                onChange={setCellule}
                options={filterOptions.cellules}
              />
              <FilterSelect
                label="Function"
                value={functionName}
                onChange={setFunctionName}
                options={filterOptions.functions}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="text-muted-foreground">Path:</div>
            {breadcrumb.map((b, idx) => (
              <div key={`${b.label}-${idx}`} className="flex items-center gap-2">
                {idx > 0 ? <span className="text-muted-foreground">/</span> : null}
                <button
                  type="button"
                  onClick={b.onClick}
                  className="hover:underline underline-offset-4"
                >
                  {b.label}
                </button>
              </div>
            ))}
            <div className="text-muted-foreground ml-auto">
              Level: <span className="text-foreground font-medium">{level}</span>
            </div>
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" interval={0} angle={-35} textAnchor="end" height={80} />
                <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  formatter={(value) => formatEuro(Number(value ?? 0))}
                  labelFormatter={(l) => String(l)}
                />
                <Bar dataKey="totalShown" name="Total" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {level === "resource" ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2">Resource</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Internal</th>
                    <th className="px-3 py-2">External</th>
                    <th className="px-3 py-2">Direct</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="px-3 py-2">Assignment %</th>
                    {showDetails ? <th className="px-3 py-2">Man-days</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        className="text-muted-foreground px-3 py-3"
                        colSpan={showDetails ? 8 : 7}
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : stackedResources.length ? (
                    stackedResources.map((r) => {
                      const productGroups =
                        showDetails ? overviewDetailsByResource.get(r.resourceId) ?? [] : [];
                      return (
                        <Fragment key={r.resourceId}>
                          <tr
                            className={cn(
                              "border-t",
                              showDetails ? "bg-muted/20" : "hover:bg-muted/30 cursor-pointer"
                            )}
                            onClick={() => openResource(r)}
                          >
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="font-medium">{r.resourceName}</span>
                                {r.cellule?.trim() ? (
                                  <span className="text-muted-foreground text-xs">{r.cellule}</span>
                                ) : null}
                                {r.function?.trim() ? (
                                  <span className="text-muted-foreground text-xs">{r.function}</span>
                                ) : null}
                              </div>
                              <div className="text-muted-foreground text-xs">{r.resourceId}</div>
                            </td>
                            <td className="px-3 py-2 text-xs">{r.resourceType}</td>
                            <td className="px-3 py-2">{formatEuro(r.internalShown)}</td>
                            <td className="px-3 py-2">{formatEuro(r.externalShown)}</td>
                            <td className="px-3 py-2">{formatEuro(r.directShown)}</td>
                            <td className="px-3 py-2 font-medium">{formatEuro(r.totalShown)}</td>
                            <td className="px-3 py-2 tabular-nums">
                              {r.resourceType === "DIRECT_COST" && r.assignmentPctShown === 0
                                ? "—"
                                : formatPct(r.assignmentPctShown)}
                            </td>
                            {showDetails ? (
                              <td className="px-3 py-2 font-medium">{formatMd(r.manDaysShown)}</td>
                            ) : null}
                          </tr>
                          {showDetails
                            ? productGroups.map((group) => (
                                <Fragment key={`${r.resourceId}-${group.productName}`}>
                                  <tr className="bg-muted/10 border-t">
                                    <td className="text-muted-foreground px-3 py-1.5 pl-8 text-xs" colSpan={2}>
                                      {group.productName}
                                    </td>
                                    <td className="px-3 py-1.5" colSpan={3} />
                                    <td className="px-3 py-1.5 text-xs font-medium">
                                      {formatEuro(group.totalShown)}
                                    </td>
                                    <td className="px-3 py-1.5 text-xs tabular-nums">
                                      {formatPct(group.assignmentPctShown)}
                                    </td>
                                    <td className="px-3 py-1.5 text-xs font-medium">
                                      {formatMd(group.manDaysShown)}
                                    </td>
                                  </tr>
                                  {group.items.map((ini) => (
                                    <tr
                                      key={`${r.resourceId}-${ini.jiraKey}-${ini.productName}`}
                                      className="border-t"
                                    >
                                      <td className="px-3 py-1.5 pl-12" colSpan={2}>
                                        <span className="font-mono text-xs">{ini.jiraKey}</span>
                                        <span className="text-muted-foreground ml-2 text-xs">
                                          {ini.summary}
                                        </span>
                                        {ini.initiativeType?.trim() ? (
                                          <span className="text-muted-foreground ml-2 text-xs">
                                            ({ini.initiativeType})
                                          </span>
                                        ) : null}
                                      </td>
                                      <td className="px-3 py-1.5 text-xs">
                                        {formatEuro(ini.internalShown)}
                                      </td>
                                      <td className="px-3 py-1.5 text-xs">
                                        {formatEuro(ini.externalShown)}
                                      </td>
                                      <td className="px-3 py-1.5 text-xs">
                                        {formatEuro(ini.directShown)}
                                      </td>
                                      <td className="px-3 py-1.5 text-xs">
                                        {formatEuro(ini.totalShown)}
                                      </td>
                                      <td className="px-3 py-1.5 text-xs tabular-nums">
                                        {formatPct(ini.assignmentPctShown)}
                                      </td>
                                      <td className="px-3 py-1.5 text-xs">
                                        {formatMd(ini.manDaysShown)}
                                      </td>
                                    </tr>
                                  ))}
                                </Fragment>
                              ))
                            : null}
                        </Fragment>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        className="text-muted-foreground px-3 py-3"
                        colSpan={showDetails ? 8 : 7}
                      >
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2">Initiative</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">EUR</th>
                    <th className="px-3 py-2">Man-days</th>
                    <th className="px-3 py-2">Assignment %</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="text-muted-foreground px-3 py-3" colSpan={5}>
                        Loading…
                      </td>
                    </tr>
                  ) : detailsByProduct.length ? (
                    detailsByProduct.map((group) => (
                      <Fragment key={group.productName}>
                        <tr className="bg-muted/30 border-t">
                          <td className="px-3 py-2 font-medium" colSpan={2}>
                            {group.productName}
                          </td>
                          <td className="px-3 py-2 font-medium">{formatEuro(group.totalShown)}</td>
                          <td className="px-3 py-2 font-medium">{formatMd(group.manDaysShown)}</td>
                          <td className="px-3 py-2 font-medium tabular-nums">
                            {formatPct(group.assignmentPctShown)}
                          </td>
                        </tr>
                        {group.items.map((ini) => (
                          <tr key={`${ini.jiraKey}-${ini.productName}`} className="border-t">
                            <td className="px-3 py-2 pl-6">
                              <span className="font-mono text-xs">{ini.jiraKey}</span>
                              <span className="text-muted-foreground ml-2">{ini.summary}</span>
                            </td>
                            <td className="text-muted-foreground px-3 py-2 text-xs">
                              {ini.initiativeType?.trim() || "—"}
                            </td>
                            <td className="px-3 py-2">{formatEuro(ini.totalShown)}</td>
                            <td className="px-3 py-2">{formatMd(ini.manDaysShown)}</td>
                            <td className="px-3 py-2 tabular-nums">
                              {formatPct(ini.assignmentPctShown)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))
                  ) : (
                    <tr>
                      <td className="text-muted-foreground px-3 py-3" colSpan={5}>
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
