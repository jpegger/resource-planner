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

type BaselineOpt = {
  id: string;
  name: string;
  version: string;
  year: number;
  importedAt: string;
};

type ByEotpRow = { eotp: string; eopLabel: string | null; amount: number };
type ByCelluleRow = { cellule: string | null; amount: number };

type ApiResp =
  | { baselines: BaselineOpt[] }
  | { baselines: BaselineOpt[]; baselineId: string; byEotp: ByEotpRow[]; byCellule: ByCelluleRow[] };

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

export default function ReportsBaselinePage() {
  const [baselines, setBaselines] = useState<BaselineOpt[]>([]);
  const [baselineId, setBaselineId] = useState<string | "__NONE__">("__NONE__");
  const [byEotp, setByEotp] = useState<ByEotpRow[]>([]);
  const [byCellule, setByCellule] = useState<ByCelluleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => baselines.find((b) => b.id === baselineId) ?? null,
    [baselines, baselineId]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (baselineId !== "__NONE__") sp.set("baselineId", baselineId);
      const response = await fetch(`/api/reports/baseline?${sp.toString()}`);
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorBody.error ?? `HTTP ${response.status}`);
      }
      const apiResponse = (await response.json()) as ApiResp;
      setBaselines(apiResponse.baselines ?? []);
      if ("byEotp" in apiResponse) {
        setByEotp(apiResponse.byEotp ?? []);
        setByCellule(apiResponse.byCellule ?? []);
      } else {
        setByEotp([]);
        setByCellule([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [baselineId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">Baseline</CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              Imported baseline rows (Excel) from `v_baseline_detail`.
            </div>
          </div>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-12">
              <Label>Baseline</Label>
              <Select value={baselineId} onValueChange={(v) => setBaselineId(v as string)}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder="Pick a baseline…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">Pick a baseline…</SelectItem>
                  {baselines.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.year} — {b.name} v{b.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected ? (
                <div className="text-muted-foreground mt-2 text-xs">
                  Imported: {new Date(selected.importedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          {baselineId === "__NONE__" ? (
            <div className="text-muted-foreground text-sm">Select a baseline to see breakdowns.</div>
          ) : (
            <>
              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byEotp.slice(0, 25)} margin={{ top: 8, right: 16, left: 8, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="eotp" interval={0} angle={-30} textAnchor="end" height={80} />
                    <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                    <Tooltip formatter={(v: unknown) => formatEuro(Number(v ?? 0))} />
                    <Bar dataKey="amount" name="Baseline" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <Card className={PANEL_CARD_CLASS}>
                <CardHeader>
                  <CardTitle className="text-base">By EOTP</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-3 py-2">EOTP</th>
                        <th className="px-3 py-2">Label</th>
                        <th className="px-3 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byEotp.map((r) => (
                        <tr key={r.eotp} className="border-t">
                          <td className="px-3 py-2">{r.eotp}</td>
                          <td className="px-3 py-2">{r.eopLabel ?? ""}</td>
                          <td className="px-3 py-2 font-medium">{formatEuro(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card className={PANEL_CARD_CLASS}>
                <CardHeader>
                  <CardTitle className="text-base">By cellule</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-3 py-2">Cellule</th>
                        <th className="px-3 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byCellule.map((r, idx) => (
                        <tr key={`${r.cellule ?? "null"}-${idx}`} className="border-t">
                          <td className="px-3 py-2">{r.cellule ?? "Unassigned"}</td>
                          <td className="px-3 py-2 font-medium">{formatEuro(r.amount)}</td>
                        </tr>
                      ))}
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

