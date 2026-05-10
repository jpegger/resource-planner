"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { FileDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exportComparisonTableToXlsx } from "@/lib/export-comparison-xlsx";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

import { ComparisonKpis } from "./ComparisonKpis";
import type { ComparisonRow } from "./ComparisonTable";
import { ComparisonTable, type ComparisonSortDir, type ComparisonSortKey } from "./ComparisonTable";
import { OwnershipNav } from "./OwnershipNav";
import { RealizedCostsTab } from "./RealizedCostsTab";
import { RevenueTab } from "./RevenueTab";

type SnapshotOpt = {
  id: string;
  name: string;
  year: number;
  takenAt: Date;
  takenBy: string | null;
};

type BaselineOpt = {
  id: string;
  name: string;
  version: string;
  year: number;
  importedAt: Date;
  importedBy: string | null;
};

function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return [y - 1, y, y + 1];
}

const PLANNING_LIVE = "live";

type ReportTab = "planning" | "realized" | "revenue";

export default function ComparisonClient({
  snapshots,
  baselines,
}: {
  snapshots: SnapshotOpt[];
  baselines: BaselineOpt[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [reportTab, setReportTab] = useState<ReportTab>(() => {
    const t = searchParams.get("tab");
    if (t === "realized" || t === "revenue" || t === "planning") return t;
    return "planning";
  });

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "realized" || t === "revenue" || t === "planning") {
      setReportTab(t);
      return;
    }
    setReportTab("planning");
  }, [searchParams]);

  const selectReportTab = useCallback(
    (tab: ReportTab) => {
      setReportTab(tab);
      const p = new URLSearchParams(searchParams.toString());
      if (tab === "planning") p.delete("tab");
      else p.set("tab", tab);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [planningSource, setPlanningSource] = useState<string>(PLANNING_LIVE);
  const [baselineId, setBaselineId] = useState<string>("");
  const [division, setDivision] = useState<string>("");
  const [subdivision, setSubdivision] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [owner, setOwner] = useState<string>("");

  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<ComparisonSortKey>("snapCashOut");
  const [sortDir, setSortDir] = useState<ComparisonSortDir>("desc");

  const years = useMemo(() => yearOptions(), []);

  const snapshotsForYear = useMemo(
    () => snapshots.filter((s) => s.year === year),
    [snapshots, year]
  );
  const baselinesForYear = useMemo(
    () => baselines.filter((b) => b.year === year),
    [baselines, year]
  );

  // Ensure current selection exists for selected year.
  useEffect(() => {
    if (
      planningSource !== PLANNING_LIVE &&
      !snapshotsForYear.some((s) => s.id === planningSource)
    ) {
      setPlanningSource(PLANNING_LIVE);
    }
    if (baselineId && !baselinesForYear.some((b) => b.id === baselineId)) setBaselineId("");
  }, [planningSource, baselineId, snapshotsForYear, baselinesForYear]);

  const refresh = useCallback(async () => {
    if (!baselineId) {
      setRows([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        baselineId,
        ...(division && { division }),
        ...(subdivision && { subdivision }),
        ...(team && { team }),
        ...(owner && { owner }),
      });
      if (planningSource !== PLANNING_LIVE) {
        params.set("snapshotId", planningSource);
      }

      const response = await fetch(`/api/reports/comparison?${params.toString()}`);
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorBody.error ?? `HTTP ${response.status}`);
      }
      const apiRows = (await response.json()) as ComparisonRow[];
      setRows(apiRows ?? []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [year, planningSource, baselineId, division, subdivision, team, owner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredRowsForOptions = useMemo(() => {
    // Options narrowing is based on currently loaded rows, which already reflect current filters.
    return rows;
  }, [rows]);

  const divisions = useMemo(
    () =>
      Array.from(
        new Set(filteredRowsForOptions.map((r) => (r.division ?? "").trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [filteredRowsForOptions]
  );

  const subDivisions = useMemo(() => {
    const scope = filteredRowsForOptions.filter((r) => !division || r.division === division);
    return Array.from(new Set(scope.map((r) => (r.subdivision ?? "").trim()).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b)
    );
  }, [filteredRowsForOptions, division]);

  const teams = useMemo(() => {
    const scope = filteredRowsForOptions.filter(
      (r) =>
        (!division || r.division === division) &&
        (!subdivision || r.subdivision === subdivision)
    );
    return Array.from(new Set(scope.map((r) => (r.team ?? "").trim()).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b)
    );
  }, [filteredRowsForOptions, division, subdivision]);

  const owners = useMemo(() => {
    const scope = filteredRowsForOptions.filter(
      (r) =>
        (!division || r.division === division) &&
        (!subdivision || r.subdivision === subdivision) &&
        (!team || r.team === team)
    );
    return Array.from(new Set(scope.map((r) => (r.owner ?? "").trim()).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b)
    );
  }, [filteredRowsForOptions, division, subdivision, team]);

  const kpis = useMemo(() => {
    const baselineTotal = rows.reduce((acc, r) => acc + (r.baselineAmount ?? 0), 0);
    const cashOutTotal = rows.reduce((acc, r) => acc + (r.snapCashOut ?? 0), 0);
    const gap = baselineTotal - cashOutTotal;
    const coveragePct = baselineTotal > 0 ? (cashOutTotal / baselineTotal) * 100 : null;
    return { baselineTotal, cashOutTotal, gap, coveragePct };
  }, [rows]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const copy = [...rows];

    const cmpString = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
    const cmpNumber = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
    const cov = (r: ComparisonRow): number => {
      const b = r.baselineAmount ?? 0;
      const c = r.snapCashOut ?? 0;
      if (!Number.isFinite(b) || !Number.isFinite(c) || b <= 0) return -1;
      return (c / b) * 100;
    };

    copy.sort((a, b) => {
      let c = 0;
      if (sortKey === "eotp") c = cmpString(a.eotp, b.eotp);
      else if (sortKey === "label") c = cmpString(a.label, b.label);
      else if (sortKey === "snapInternal") c = cmpNumber(a.snapInternal, b.snapInternal);
      else if (sortKey === "snapExternal") c = cmpNumber(a.snapExternal, b.snapExternal);
      else if (sortKey === "snapDirect") c = cmpNumber(a.snapDirect, b.snapDirect);
      else if (sortKey === "snapCashOut") c = cmpNumber(a.snapCashOut, b.snapCashOut);
      else if (sortKey === "baselineAmount") c = cmpNumber(a.baselineAmount, b.baselineAmount);
      else if (sortKey === "gap") c = cmpNumber(a.gap, b.gap);
      else if (sortKey === "coveragePct") c = cmpNumber(cov(a), cov(b));

      if (c !== 0) return c * dir;
      return cmpString(a.eotp, b.eotp);
    });

    return copy;
  }, [rows, sortKey, sortDir]);

  const snapshotLabel =
    planningSource === PLANNING_LIVE
      ? "Current allocations (live)"
      : (snapshots.find((s) => s.id === planningSource)?.name ?? planningSource);
  const baselineRow = baselines.find((b) => b.id === baselineId);
  const baselineLabel = baselineRow
    ? `${baselineRow.name} — ${baselineRow.version}`
    : baselineId
      ? baselineId
      : "—";

  const onExportExcel = useCallback(() => {
    void exportComparisonTableToXlsx(sortedRows, {
      year,
      planningSource: snapshotLabel,
      baseline: baselineLabel,
      division,
      subdivision,
      team,
      owner,
    });
  }, [
    sortedRows,
    year,
    snapshotLabel,
    baselineLabel,
    division,
    subdivision,
    team,
    owner,
  ]);

  const onSortChange = useCallback(
    (key: ComparisonSortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      const numeric: ComparisonSortKey[] = [
        "snapInternal",
        "snapExternal",
        "snapDirect",
        "snapCashOut",
        "baselineAmount",
        "gap",
        "coveragePct",
      ];
      setSortDir(numeric.includes(key) ? "desc" : "asc");
    },
    [sortKey]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={reportTab === "planning" ? "default" : "outline"}
          size="sm"
          onClick={() => selectReportTab("planning")}
        >
          Planning vs baseline
        </Button>
        <Button
          type="button"
          variant={reportTab === "realized" ? "default" : "outline"}
          size="sm"
          onClick={() => selectReportTab("realized")}
        >
          Realized costs
        </Button>
        <Button
          type="button"
          variant={reportTab === "revenue" ? "default" : "outline"}
          size="sm"
          onClick={() => selectReportTab("revenue")}
        >
          Revenue
        </Button>
      </div>

      {reportTab === "realized" ? <RealizedCostsTab /> : null}
      {reportTab === "revenue" ? <RevenueTab /> : null}

      {reportTab === "planning" ? (
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <CardTitle className="truncate">Planning vs baseline comparison</CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              Compare current allocations or a saved snapshot to an imported baseline. Navigate gap
              (baseline − cash out) by ownership hierarchy.
            </div>
          </div>
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-3">
              <Label>Year</Label>
              <Select
                value={String(year)}
                onValueChange={(v) => {
                  const y = Number(v);
                  setYear(y);
                  setDivision("");
                  setSubdivision("");
                  setTeam("");
                  setOwner("");
                }}
              >
                <SelectTrigger className="mt-1 w-full min-w-0">
                  <SelectValue placeholder="Year">
                    {(v) => (v != null && String(v) !== "" ? String(v) : null)}
                  </SelectValue>
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

            <div className="md:col-span-3">
              <Label>Planning</Label>
              <Select value={planningSource} onValueChange={(v) => setPlanningSource(v ?? PLANNING_LIVE)}>
                <SelectTrigger className="mt-1 w-full min-w-0">
                  <SelectValue placeholder="Select planning source…">
                    {(v) => {
                      if (v == null || v === "") return null;
                      if (v === PLANNING_LIVE) return "Current allocations (live)";
                      const s = snapshotsForYear.find((x) => x.id === v);
                      return s ? `Snapshot: ${s.name}` : null;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PLANNING_LIVE}>Current allocations (live)</SelectItem>
                  {snapshotsForYear.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      Snapshot: {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-3">
              <Label>Baseline</Label>
              <Select value={baselineId} onValueChange={(v) => setBaselineId(v ?? "")}>
                <SelectTrigger className="mt-1 w-full min-w-0">
                  <SelectValue placeholder="Select baseline…">
                    {(v) => {
                      if (v == null || v === "") return "Select baseline…";
                      const b = baselinesForYear.find((x) => x.id === v);
                      return b ? `${b.name} — ${b.version}` : "Select baseline…";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {baselinesForYear.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} — {b.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="hidden md:col-span-3 md:block" aria-hidden />
          </div>

          <OwnershipNav
            divisions={divisions}
            subDivisions={subDivisions}
            teams={teams}
            owners={owners}
            division={division}
            subdivision={subdivision}
            team={team}
            owner={owner}
            onChangeDivision={(v) => {
              setDivision(v);
              setSubdivision("");
              setTeam("");
              setOwner("");
            }}
            onChangeSubdivision={(v) => {
              setSubdivision(v);
              setTeam("");
              setOwner("");
            }}
            onChangeTeam={(v) => {
              setTeam(v);
              setOwner("");
            }}
            onChangeOwner={(v) => setOwner(v)}
          />

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          <ComparisonKpis
            baselineTotal={kpis.baselineTotal}
            cashOutTotal={kpis.cashOutTotal}
            gap={kpis.gap}
            coveragePct={kpis.coveragePct}
          />

          <ComparisonTable
            rows={sortedRows}
            loading={loading}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={onSortChange}
            headerActions={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onExportExcel}
                disabled={loading || !baselineId || sortedRows.length === 0}
              >
                <FileDown className="mr-2 h-4 w-4" aria-hidden />
                Export Excel
              </Button>
            }
          />
        </CardContent>
      </Card>
      ) : null}
    </div>
  );
}

