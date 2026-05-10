"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

type Row = {
  year: number;
  month: number;
  costType: string;
  allocationEntityId: string | null;
  productName: string | null;
  eotp: string | null;
  division: string | null;
  subdivision: string | null;
  team: string | null;
  owner: string | null;
  amountEur: number;
  hours: number | null;
  importWarning: string | null;
};

export function RealizedCostsTab() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState<string>("");
  const [division, setDivision] = useState("");
  const [subdivision, setSubdivision] = useState("");
  const [team, setTeam] = useState("");
  const [owner, setOwner] = useState("");
  const [productId, setProductId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<{
    internal: number;
    external: number;
    direct: number;
    grand: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ year: String(year) });
      if (month.trim()) p.set("month", month.trim());
      if (division.trim()) p.set("division", division.trim());
      if (subdivision.trim()) p.set("subdivision", subdivision.trim());
      if (team.trim()) p.set("team", team.trim());
      if (owner.trim()) p.set("owner", owner.trim());
      if (productId.trim()) p.set("productId", productId.trim());
      const res = await fetch(`/api/reports/realized-costs?${p.toString()}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? res.statusText);
      }
      const data = (await res.json()) as { rows: Row[]; totals: typeof totals };
      setRows(data.rows ?? []);
      setTotals(data.totals ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [year, month, division, subdivision, team, owner, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
      <CardHeader>
        <CardTitle>Realized costs</CardTitle>
        <div className="text-muted-foreground text-sm">
          SAP VIM + ServiceNow timesheets via <code className="text-xs">v_realized_costs</code>.
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>Year</Label>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(Number.parseInt(e.target.value, 10) || year)}
            />
          </div>
          <div className="space-y-1">
            <Label>Month (optional)</Label>
            <Input
              type="number"
              min={1}
              max={12}
              placeholder="All"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label>Product ID (allocation entity)</Label>
            <Input
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="Filter by planning product id"
            />
          </div>
          <div className="space-y-1">
            <Label>Division (VIM / mapped rows)</Label>
            <Input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="e.g. CRPS" />
          </div>
          <div className="space-y-1">
            <Label>Subdivision</Label>
            <Input value={subdivision} onChange={(e) => setSubdivision(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Team</Label>
            <Input value={team} onChange={(e) => setTeam(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Owner</Label>
            <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
          </div>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>

        {error ? <div className="text-sm text-red-600">{error}</div> : null}

        {totals ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Internal" value={totals.internal} />
            <Kpi label="External" value={totals.external} />
            <Kpi label="Direct" value={totals.direct} />
            <Kpi label="Total" value={totals.grand} />
          </div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Y</TableHead>
              <TableHead>M</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>EOTP</TableHead>
              <TableHead className="text-right">EUR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 500).map((r, i) => (
              <TableRow key={`${r.year}-${r.month}-${r.costType}-${r.eotp}-${i}`}>
                <TableCell>{r.year}</TableCell>
                <TableCell>{r.month}</TableCell>
                <TableCell>{r.costType}</TableCell>
                <TableCell className="max-w-[200px] truncate">{r.productName ?? "—"}</TableCell>
                <TableCell className="max-w-[220px] truncate text-xs">{r.eotp ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.amountEur.toLocaleString("fr-BE", { maximumFractionDigits: 0 })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length > 500 ? (
          <div className="text-muted-foreground text-xs">Showing first 500 rows.</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-neutral-50 px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-lg font-semibold tabular-nums">
        {value.toLocaleString("fr-BE", { maximumFractionDigits: 0 })}
      </div>
    </div>
  );
}
