"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

type SnapshotOpt = { id: string; name: string; year: number; takenAt: string };
type Level = "division" | "team" | "product" | "eotp";
type Row = {
  key: string;
  label: string;
  internal: number;
  external: number;
  direct: number;
  cashOut: number;
  total: number;
};

type ApiResp =
  | { snapshots: SnapshotOpt[] }
  | {
      snapshots: SnapshotOpt[];
      snapshotId: string;
      rows: Row[];
      meta: { level: Level; division: string | null; team: string | null; productName: string | null };
    };

function nextLevel(level: Level): Level | null {
  if (level === "division") return "team";
  if (level === "team") return "product";
  if (level === "product") return "eotp";
  return null;
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

export default function ReportsSnapshotPage() {
  const [snapshotId, setSnapshotId] = useState<string | "__NONE__">("__NONE__");
  const [snapshots, setSnapshots] = useState<SnapshotOpt[]>([]);
  const [level, setLevel] = useState<Level>("division");
  const [division, setDivision] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [productName, setProductName] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => snapshots.find((s) => s.id === snapshotId) ?? null,
    [snapshots, snapshotId]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (snapshotId !== "__NONE__") sp.set("snapshotId", snapshotId);
      sp.set("level", level);
      if (division) sp.set("division", division);
      if (team) sp.set("team", team);
      if (productName) sp.set("productName", productName);

      const res = await fetch(`/api/reports/snapshot?${sp.toString()}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ApiResp;
      setSnapshots(data.snapshots ?? []);
      if ("rows" in data) {
        setRows(data.rows ?? []);
      } else {
        setRows([]);
      }
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [snapshotId, level, division, team, productName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function onClickRow(r: Row) {
    const n = nextLevel(level);
    if (!n) return;
    if (level === "division") {
      setDivision(r.key);
      setLevel(n);
      setTeam(null);
      setProductName(null);
      return;
    }
    if (level === "team") {
      setTeam(r.key);
      setLevel(n);
      setProductName(null);
      return;
    }
    if (level === "product") {
      setProductName(r.key);
      setLevel(n);
      return;
    }
  }

  const breadcrumb = useMemo(() => {
    const parts: { label: string; onClick: () => void }[] = [
      {
        label: "Division",
        onClick: () => {
          setLevel("division");
          setDivision(null);
          setTeam(null);
          setProductName(null);
        },
      },
    ];
    if (division) {
      parts.push({
        label: division,
        onClick: () => {
          setLevel("team");
          setTeam(null);
          setProductName(null);
        },
      });
    }
    if (team) {
      parts.push({
        label: team,
        onClick: () => {
          setLevel("product");
          setProductName(null);
        },
      });
    }
    if (productName) {
      parts.push({
        label: productName,
        onClick: () => {
          setLevel("eotp");
        },
      });
    }
    return parts;
  }, [division, team, productName]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">Snapshot</CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              Frozen snapshot rows from `v_snapshot_detail` (click bar/row to drill down).
            </div>
          </div>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-12">
              <Label>Snapshot</Label>
              <Select
                value={snapshotId}
                onValueChange={(v) => {
                  setSnapshotId(v as string);
                  setLevel("division");
                  setDivision(null);
                  setTeam(null);
                  setProductName(null);
                }}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder="Pick a snapshot…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">Pick a snapshot…</SelectItem>
                  {snapshots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.year} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected ? (
                <div className="text-muted-foreground mt-2 text-xs">
                  Taken: {new Date(selected.takenAt).toLocaleString()}
                </div>
              ) : null}
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
                  disabled={snapshotId === "__NONE__"}
                >
                  {b.label}
                </button>
              </div>
            ))}
            <div className="ml-auto text-muted-foreground">
              Level: <span className="font-medium text-foreground">{level}</span>
            </div>
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          {snapshotId === "__NONE__" ? (
            <div className="text-muted-foreground text-sm">Select a snapshot to see breakdowns.</div>
          ) : (
            <>
              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" interval={0} angle={-30} textAnchor="end" height={80} />
                    <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                    <Tooltip formatter={(v: unknown) => formatEuro(Number(v ?? 0))} />
                    <Bar dataKey="internal" name="Internal" stackId="a" fill="#2563eb" />
                    <Bar dataKey="external" name="External" stackId="a" fill="#f97316" />
                    <Bar dataKey="direct" name="Direct" stackId="a" fill="#16a34a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <Card className={PANEL_CARD_CLASS}>
                <CardHeader>
                  <CardTitle className="text-base">Rows</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-3 py-2">Label</th>
                        <th className="px-3 py-2">Internal</th>
                        <th className="px-3 py-2">External</th>
                        <th className="px-3 py-2">Direct</th>
                        <th className="px-3 py-2">Total</th>
                        <th className="px-3 py-2">Cash Out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                            Loading…
                          </td>
                        </tr>
                      ) : rows.length ? (
                        rows.map((r) => (
                          <tr
                            key={r.key}
                            className="hover:bg-muted/30 cursor-pointer border-t"
                            onClick={() => onClickRow(r)}
                          >
                            <td className="px-3 py-2">{r.label}</td>
                            <td className="px-3 py-2">{formatEuro(r.internal)}</td>
                            <td className="px-3 py-2">{formatEuro(r.external)}</td>
                            <td className="px-3 py-2">{formatEuro(r.direct)}</td>
                            <td className="px-3 py-2 font-medium">{formatEuro(r.total)}</td>
                            <td className="px-3 py-2">{formatEuro(r.cashOut)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                            No data
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

