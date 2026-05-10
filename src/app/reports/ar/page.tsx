"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";

import { FileDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ArReportResponse } from "@/lib/ar-report-types";
import { exportArReportToXlsx } from "@/lib/export-ar-report-xlsx";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

const PAGE_LIMIT = 200;

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

function ChartTooltipEuro(props: TooltipProps<number, string>) {
  const active = (props as unknown as { active?: boolean }).active;
  const payload = (props as unknown as { payload?: Array<{ name?: string; value?: number; color?: string }> })
    .payload;
  const label = (props as unknown as { label?: unknown }).label;
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-md border p-2 shadow-md text-sm">
      <div className="font-medium">{String(label ?? "")}</div>
      <div className="mt-1 tabular-nums font-medium">{formatEuro(Number(payload[0]?.value ?? 0))}</div>
    </div>
  );
}

function buildSearchParams(state: FilterState, offset: number): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("year", String(state.year));
  sp.set("limit", String(PAGE_LIMIT));
  sp.set("offset", String(offset));
  if (state.status.trim()) sp.set("status", state.status.trim());
  if (state.division.trim()) sp.set("division", state.division.trim());
  if (state.subdivision.trim()) sp.set("subdivision", state.subdivision.trim());
  if (state.team.trim()) sp.set("team", state.team.trim());
  if (state.productId.trim()) sp.set("productId", state.productId.trim());
  if (state.mapped === "mapped") sp.set("mapped", "true");
  if (state.mapped === "unmapped") sp.set("mapped", "false");
  if (state.warningsOnly) sp.set("warningsOnly", "true");
  if (state.client.trim()) sp.set("client", state.client.trim());
  if (state.masterProduct.trim()) sp.set("masterProduct", state.masterProduct.trim());
  if (state.contractNumber.trim()) sp.set("contractNumber", state.contractNumber.trim());
  if (state.counterpartReference.trim()) sp.set("counterpartReference", state.counterpartReference.trim());
  if (state.signedFrom.trim()) sp.set("signedFrom", state.signedFrom.trim());
  if (state.signedTo.trim()) sp.set("signedTo", state.signedTo.trim());
  if (state.importId.trim()) sp.set("importId", state.importId.trim());
  return sp;
}

function filtersLabel(state: FilterState): string {
  const parts: string[] = [];
  if (state.status.trim()) parts.push(`status=${state.status.trim()}`);
  if (state.division.trim()) parts.push(`division=${state.division.trim()}`);
  if (state.subdivision.trim()) parts.push(`subdivision=${state.subdivision.trim()}`);
  if (state.team.trim()) parts.push(`team=${state.team.trim()}`);
  if (state.productId.trim()) parts.push(`productId=${state.productId.trim()}`);
  if (state.mapped === "mapped") parts.push("mapped");
  if (state.mapped === "unmapped") parts.push("unmapped");
  if (state.warningsOnly) parts.push("warningsOnly");
  if (state.client.trim()) parts.push(`client~${state.client.trim()}`);
  if (state.masterProduct.trim()) parts.push(`masterProduct~${state.masterProduct.trim()}`);
  if (state.contractNumber.trim()) parts.push(`contract~${state.contractNumber.trim()}`);
  if (state.counterpartReference.trim()) parts.push(`counterpart=${state.counterpartReference.trim()}`);
  if (state.signedFrom.trim()) parts.push(`signedFrom=${state.signedFrom.trim()}`);
  if (state.signedTo.trim()) parts.push(`signedTo=${state.signedTo.trim()}`);
  if (state.importId.trim()) parts.push(`importId=${state.importId.trim()}`);
  return parts.join("; ") || "All rows for year";
}

type FilterState = {
  year: number;
  status: string;
  division: string;
  subdivision: string;
  team: string;
  productId: string;
  mapped: "all" | "mapped" | "unmapped";
  warningsOnly: boolean;
  client: string;
  masterProduct: string;
  contractNumber: string;
  counterpartReference: string;
  signedFrom: string;
  signedTo: string;
  importId: string;
};

const initialFilters = (): FilterState => ({
  year: new Date().getFullYear(),
  status: "",
  division: "",
  subdivision: "",
  team: "",
  productId: "",
  mapped: "all",
  warningsOnly: false,
  client: "",
  masterProduct: "",
  contractNumber: "",
  counterpartReference: "",
  signedFrom: "",
  signedTo: "",
  importId: "",
});

export default function ArReportPage() {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ArReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => yearOptions(), []);

  const fetchPage = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const sp = buildSearchParams(filtersRef.current, nextOffset);
      const res = await fetch(`/api/reports/ar?${sp.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ArReportResponse;
      setData(json);
      setOffset(nextOffset);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage(0);
  }, [fetchPage]);

  const onApply = useCallback(() => {
    void fetchPage(0);
  }, [fetchPage]);

  const byStatusChart = useMemo(() => {
    const rows = data?.summary.byStatus ?? [];
    return rows.map((r) => ({ label: r.status, value: r.sumEur }));
  }, [data]);

  const topClientsChart = useMemo(() => {
    const rows = data?.summary.topClients ?? [];
    return rows.map((r) => ({ label: r.client.length > 24 ? `${r.client.slice(0, 24)}…` : r.client, value: r.sumEur }));
  }, [data]);

  const topProductsChart = useMemo(() => {
    const rows = data?.summary.topProducts ?? [];
    return rows.map((r) => ({
      label: r.productName.length > 22 ? `${r.productName.slice(0, 22)}…` : r.productName,
      value: r.sumEur,
    }));
  }, [data]);

  const exportXlsx = useCallback(async () => {
    setExporting(true);
    try {
      const all: ArReportResponse["lines"] = [];
      let off = 0;
      const cap = 2000;
      let summary = data?.summary;
      const f = filtersRef.current;
      for (;;) {
        const sp = buildSearchParams(f, off);
        sp.set("limit", String(cap));
        sp.set("offset", String(off));
        const res = await fetch(`/api/reports/ar?${sp.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as ArReportResponse;
        if (!summary) summary = json.summary;
        all.push(...json.lines);
        if (json.lines.length < cap) break;
        off += cap;
        if (off > 100_000) break;
      }
      if (!summary) return;
      await exportArReportToXlsx(all, summary, {
        year: f.year,
        filtersLabel: filtersLabel(f),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [data?.summary]);

  const total = data?.meta.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + PAGE_LIMIT < total;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="text-sm">
        <Link href="/reports" className="text-primary underline">
          Reports
        </Link>
        <span className="text-muted-foreground"> / Salesforce AR</span>
      </div>

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">Salesforce AR (planned revenue)</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              Filtered lines from <code className="text-xs">ar_entry</code> with product / org columns from{" "}
              <code className="text-xs">allocation_entity</code>. Separate from invoiced revenue on Comparison. For a
              line-by-line breakdown of SAP invoices per AR row, open{" "}
              <Link href="/reports/ar-invoicing" className="text-primary underline">
                AR invoicing follow-up
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void fetchPage(offset)} disabled={loading}>
              Refresh
            </Button>
            <Button variant="default" size="sm" onClick={() => void exportXlsx()} disabled={exporting || !data}>
              <FileDown className="mr-1.5 h-4 w-4" />
              {exporting ? "Exporting…" : "Export Excel"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-2">
              <Label>Year</Label>
              <Select
                value={String(filters.year)}
                onValueChange={(v) => setFilters((f) => ({ ...f, year: Number(v) }))}
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
            <div className="md:col-span-4">
              <Label>Status (comma-separated)</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Signed,Approved"
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Mapped</Label>
              <Select
                value={filters.mapped}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, mapped: v as FilterState["mapped"] }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="mapped">Mapped only</SelectItem>
                  <SelectItem value="unmapped">Unmapped only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 flex items-end pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.warningsOnly}
                  onChange={(e) => setFilters((f) => ({ ...f, warningsOnly: e.target.checked }))}
                />
                Warnings only
              </label>
            </div>
            <div className="md:col-span-2 flex items-end">
              <Button type="button" className="w-full" onClick={onApply} disabled={loading}>
                Apply filters
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-3">
              <Label>Division</Label>
              <Input
                className="mt-1"
                value={filters.division}
                onChange={(e) => setFilters((f) => ({ ...f, division: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Subdivision</Label>
              <Input
                className="mt-1"
                value={filters.subdivision}
                onChange={(e) => setFilters((f) => ({ ...f, subdivision: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Team</Label>
              <Input
                className="mt-1"
                value={filters.team}
                onChange={(e) => setFilters((f) => ({ ...f, team: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Product ID</Label>
              <Input
                className="mt-1"
                placeholder="allocation_entity id"
                value={filters.productId}
                onChange={(e) => setFilters((f) => ({ ...f, productId: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-4">
              <Label>Client (contains)</Label>
              <Input
                className="mt-1"
                value={filters.client}
                onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))}
              />
            </div>
            <div className="md:col-span-4">
              <Label>Master product (contains)</Label>
              <Input
                className="mt-1"
                value={filters.masterProduct}
                onChange={(e) => setFilters((f) => ({ ...f, masterProduct: e.target.value }))}
              />
            </div>
            <div className="md:col-span-4">
              <Label>Contract (contains)</Label>
              <Input
                className="mt-1"
                value={filters.contractNumber}
                onChange={(e) => setFilters((f) => ({ ...f, contractNumber: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-3">
              <Label>Counterpart ref (exact)</Label>
              <Input
                className="mt-1"
                value={filters.counterpartReference}
                onChange={(e) => setFilters((f) => ({ ...f, counterpartReference: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Signed from</Label>
              <Input
                className="mt-1"
                type="date"
                value={filters.signedFrom}
                onChange={(e) => setFilters((f) => ({ ...f, signedFrom: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Signed to</Label>
              <Input
                className="mt-1"
                type="date"
                value={filters.signedTo}
                onChange={(e) => setFilters((f) => ({ ...f, signedTo: e.target.value }))}
              />
            </div>
            <div className="md:col-span-3">
              <Label>Import ID</Label>
              <Input
                className="mt-1"
                value={filters.importId}
                onChange={(e) => setFilters((f) => ({ ...f, importId: e.target.value }))}
              />
            </div>
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          {data ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">Lines (filtered)</div>
                <div className="text-lg font-semibold tabular-nums">{data.summary.lineCount}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">Total EUR</div>
                <div className="text-lg font-semibold tabular-nums">{formatEuro(data.summary.totalEur)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">Mapped</div>
                <div className="text-lg font-semibold tabular-nums">{data.summary.mappedCount}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">Warnings</div>
                <div className="text-lg font-semibold tabular-nums">{data.summary.warningCount}</div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium">By status (EUR)</CardTitle>
              </CardHeader>
              <CardContent className="min-h-[260px] min-w-0 pt-0">
                <div className="h-[240px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byStatusChart} margin={{ top: 8, right: 8, left: 8, bottom: 48 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" interval={0} angle={-25} textAnchor="end" height={56} />
                      <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} width={44} />
                      <Tooltip content={<ChartTooltipEuro />} />
                      <Bar dataKey="value" name="EUR" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium">Top clients (EUR)</CardTitle>
              </CardHeader>
              <CardContent className="min-h-[260px] min-w-0 pt-0">
                <div className="h-[240px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topClientsChart} margin={{ top: 8, right: 8, left: 8, bottom: 56 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" interval={0} angle={-30} textAnchor="end" height={64} />
                      <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} width={44} />
                      <Tooltip content={<ChartTooltipEuro />} />
                      <Bar dataKey="value" name="EUR" fill="#16a34a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium">Top products (EUR)</CardTitle>
              </CardHeader>
              <CardContent className="min-h-[260px] min-w-0 pt-0">
                <div className="h-[240px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topProductsChart} margin={{ top: 8, right: 8, left: 8, bottom: 56 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" interval={0} angle={-30} textAnchor="end" height={64} />
                      <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} width={44} />
                      <Tooltip content={<ChartTooltipEuro />} />
                      <Bar dataKey="value" name="EUR" fill="#f97316" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="text-muted-foreground">
              Showing{" "}
              <span className="text-foreground font-medium">
                {total ? offset + 1 : 0}–{Math.min(offset + PAGE_LIMIT, total)}
              </span>{" "}
              of <span className="text-foreground font-medium">{total}</span>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canPrev || loading}
                onClick={() => void fetchPage(Math.max(0, offset - PAGE_LIMIT))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canNext || loading}
                onClick={() => void fetchPage(offset + PAGE_LIMIT)}
              >
                Next
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-max min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="whitespace-nowrap px-2 py-2">Contract</th>
                  <th className="whitespace-nowrap px-2 py-2">Line</th>
                  <th className="whitespace-nowrap px-2 py-2">Status</th>
                  <th className="whitespace-nowrap px-2 py-2">Signed</th>
                  <th className="whitespace-nowrap px-2 py-2">Client</th>
                  <th className="whitespace-nowrap px-2 py-2">SF product</th>
                  <th className="whitespace-nowrap px-2 py-2">EUR</th>
                  <th className="whitespace-nowrap px-2 py-2">Product</th>
                  <th className="whitespace-nowrap px-2 py-2">Div / Sub / Team</th>
                  <th className="whitespace-nowrap px-2 py-2">SAP EOTP</th>
                  <th className="min-w-[200px] px-2 py-2">Warning</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="text-muted-foreground px-2 py-3" colSpan={11}>
                      Loading…
                    </td>
                  </tr>
                ) : data?.lines.length ? (
                  data.lines.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="whitespace-nowrap px-2 py-1.5">{r.contractNumber}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{r.lineItemNumber}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{r.documentStatus}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{r.signedDate ?? "—"}</td>
                      <td className="max-w-[200px] truncate px-2 py-1.5" title={r.clientName ?? ""}>
                        {r.clientName ?? "—"}
                      </td>
                      <td className="max-w-[220px] truncate px-2 py-1.5" title={r.sfProductName}>
                        {r.sfProductName}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{formatEuro(r.amountEur)}</td>
                      <td className="max-w-[180px] truncate px-2 py-1.5" title={r.allocationEntityName ?? ""}>
                        {r.allocationEntityName ?? "—"}
                      </td>
                      <td className="max-w-[200px] truncate px-2 py-1.5" title={`${r.division ?? ""} / ${r.subDivision ?? ""} / ${r.team ?? ""}`}>
                        {[r.division, r.subDivision, r.team].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{r.sapEotpCode ?? "—"}</td>
                      <td className="max-w-[320px] truncate px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200" title={r.importWarning ?? ""}>
                        {r.importWarning ?? "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="text-muted-foreground px-2 py-3" colSpan={11}>
                      No rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
