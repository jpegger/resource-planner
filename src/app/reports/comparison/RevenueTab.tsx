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

export function RevenueTab() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState("");
  const [productId, setProductId] = useState("");
  const [data, setData] = useState<{
    summary: {
      plannedTotal: number;
      realizedTotal: number;
      gap: number;
      coveragePct: number | null;
    };
    planned: Array<{
      productName: string | null;
      clientName: string | null;
      amountEur: number;
    }>;
    realized: Array<{
      month: number;
      productName: string | null;
      clientName: string | null;
      amountEur: number;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ year: String(year) });
      if (month.trim()) p.set("month", month.trim());
      if (productId.trim()) p.set("productId", productId.trim());
      const res = await fetch(`/api/reports/revenue?${p.toString()}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? res.statusText);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year, month, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
      <CardHeader>
        <CardTitle>Revenue</CardTitle>
        <div className="text-muted-foreground text-sm">
          Planned AR (<code className="text-xs">v_planned_revenue</code>) vs invoiced (
          <code className="text-xs">v_realized_revenue</code>).
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
            <Label>Month (realized only)</Label>
            <Input type="number" min={1} max={12} placeholder="All" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label>Product ID (allocation entity)</Label>
            <Input
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder="Optional — planned + realized"
            />
          </div>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}

        {data?.summary ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Planned AR" value={data.summary.plannedTotal} />
            <Kpi label="Realized" value={data.summary.realizedTotal} />
            <Kpi label="Gap" value={data.summary.gap} />
            <div className="rounded-md border bg-neutral-50 px-3 py-2">
              <div className="text-muted-foreground text-xs">Coverage</div>
              <div className="text-lg font-semibold tabular-nums">
                {data.summary.coveragePct == null
                  ? "—"
                  : `${data.summary.coveragePct.toFixed(1)} %`}
              </div>
            </div>
          </div>
        ) : null}

        <div className="text-sm font-medium">Planned AR</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">EUR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.planned ?? []).slice(0, 200).map((r, i) => (
              <TableRow key={`p-${i}`}>
                <TableCell className="max-w-[240px] truncate">{r.productName ?? "—"}</TableCell>
                <TableCell className="max-w-[200px] truncate">{r.clientName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.amountEur.toLocaleString("fr-BE", { maximumFractionDigits: 0 })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="text-sm font-medium">Realized (invoiced)</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>M</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">EUR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.realized ?? []).slice(0, 200).map((r, i) => (
              <TableRow key={`r-${i}`}>
                <TableCell>{r.month}</TableCell>
                <TableCell className="max-w-[200px] truncate">{r.productName ?? "—"}</TableCell>
                <TableCell className="max-w-[180px] truncate">{r.clientName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.amountEur.toLocaleString("fr-BE", { maximumFractionDigits: 0 })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
