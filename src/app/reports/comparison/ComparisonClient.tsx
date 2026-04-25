"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

import { ComparisonKpis } from "./ComparisonKpis";
import type { ComparisonRow } from "./ComparisonTable";
import { ComparisonTable } from "./ComparisonTable";
import { OwnershipNav } from "./OwnershipNav";

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

export default function ComparisonClient({
  snapshots,
  baselines,
}: {
  snapshots: SnapshotOpt[];
  baselines: BaselineOpt[];
}) {
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [snapshotId, setSnapshotId] = useState<string>("");
  const [baselineId, setBaselineId] = useState<string>("");
  const [division, setDivision] = useState<string>("");
  const [subdivision, setSubdivision] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [owner, setOwner] = useState<string>("");

  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (snapshotId && !snapshotsForYear.some((s) => s.id === snapshotId)) setSnapshotId("");
    if (baselineId && !baselinesForYear.some((b) => b.id === baselineId)) setBaselineId("");
  }, [snapshotId, baselineId, snapshotsForYear, baselinesForYear]);

  const refresh = useCallback(async () => {
    if (!snapshotId || !baselineId) {
      setRows([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        snapshotId,
        baselineId,
        ...(division && { division }),
        ...(subdivision && { subdivision }),
        ...(team && { team }),
        ...(owner && { owner }),
      });

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
  }, [year, snapshotId, baselineId, division, subdivision, team, owner]);

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
    const catchoutTotal = rows.reduce((acc, r) => acc + (r.snapCatchout ?? 0), 0);
    const gap = baselineTotal - catchoutTotal;
    const coveragePct = baselineTotal > 0 ? (catchoutTotal / baselineTotal) * 100 : null;
    return { baselineTotal, catchoutTotal, gap, coveragePct };
  }, [rows]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <CardTitle className="truncate">Snapshot vs baseline comparison</CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              Navigate gap (baseline − catchout) by ownership hierarchy.
            </div>
          </div>
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-2">
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
                <SelectTrigger className="mt-1">
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

            <div className="md:col-span-5">
              <Label>Snapshot</Label>
              <Select value={snapshotId} onValueChange={(v) => setSnapshotId(v ?? "")}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select snapshot…" />
                </SelectTrigger>
                <SelectContent>
                  {snapshotsForYear.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-5">
              <Label>Baseline</Label>
              <Select value={baselineId} onValueChange={(v) => setBaselineId(v ?? "")}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select baseline…" />
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
            catchoutTotal={kpis.catchoutTotal}
            gap={kpis.gap}
            coveragePct={kpis.coveragePct}
          />

          <ComparisonTable rows={rows} loading={loading} />
        </CardContent>
      </Card>
    </div>
  );
}

