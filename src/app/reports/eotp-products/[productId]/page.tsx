"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

type ProductOpt = {
  productId: string;
  productName: string;
  mainEotp: string;
  mainEopLabel: string | null;
  total: number;
};
type EotpRow = {
  eotp: string;
  eopLabel: string | null;
  isMain: boolean;
  internal: number;
  external: number;
  direct: number;
  cashOut: number;
  total: number;
};
type RoutingRow = {
  id: string;
  eotp: string;
  eopLabel: string | null;
  internalAmount: number;
  externalAmount: number;
  directAmount: number;
  total: number;
  comment: string | null;
};
type InitiativeRow = {
  jiraKey: string;
  summary: string;
  internal: number;
  external: number;
  direct: number;
  total: number;
};

type ApiResp = {
  products: ProductOpt[];
  productId: string;
  eotpRows: EotpRow[];
  routingRows: RoutingRow[];
  initiatives: InitiativeRow[];
};

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

export default function ReportsEotpProductDetailPage() {
  const params = useParams<{ productId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const productId = useMemo(() => decodeURIComponent(params.productId), [params.productId]);
  const [year, setYear] = useState(() => {
    const y = Number(searchParams.get("year"));
    return Number.isFinite(y) && y > 2000 ? y : new Date().getFullYear();
  });

  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [eotpRows, setEotpRows] = useState<EotpRow[]>([]);
  const [routingRows, setRoutingRows] = useState<RoutingRow[]>([]);
  const [initiatives, setInitiatives] = useState<InitiativeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => yearOptions(), []);
  const selectedProduct = useMemo(
    () => products.find((p) => p.productId === productId) ?? null,
    [products, productId]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("year", String(year));
      sp.set("productId", productId);
      const res = await fetch(`/api/reports/eotp?${sp.toString()}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ApiResp;
      setProducts(data.products ?? []);
      setEotpRows(data.eotpRows ?? []);
      setRoutingRows(data.routingRows ?? []);
      setInitiatives(data.initiatives ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [productId, year]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const chartRows = useMemo(
    () =>
      eotpRows.map((r) => ({
        ...r,
        axisLabel: r.eopLabel ? `${r.eotp} — ${r.eopLabel}` : r.eotp,
      })),
    [eotpRows]
  );

  const onChangeYear = useCallback(
    (y: number) => {
      setYear(y);
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("year", String(y));
      router.replace(`/reports/eotp-products/${encodeURIComponent(productId)}?${sp.toString()}`);
    },
    [productId, router, searchParams]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <CardTitle className="truncate">
              {selectedProduct?.productName ?? "Product"} — EOTP routing details
            </CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              <Link href="/reports/eotp-products" className="underline underline-offset-2">
                Back to products
              </Link>{" "}
              <span className="mx-2">·</span>
              <span className="font-mono">{productId}</span>
            </div>
          </div>
          <div className="flex items-end gap-3">
            <div className="grid gap-1">
              <Label>Year</Label>
              <Select value={String(year)} onValueChange={(v) => onChangeYear(Number(v))}>
                <SelectTrigger>
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
            <Button variant="outline" onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 16, left: 8, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="axisLabel"
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={80}
                />
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
              <CardTitle className="text-base">Routing rows (eotp_routing)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2">EOTP</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">Internal</th>
                    <th className="px-3 py-2">External</th>
                    <th className="px-3 py-2">Direct</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="px-3 py-2">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {routingRows.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 font-mono">
                        {r.eotp}
                        {selectedProduct?.mainEotp && r.eotp === selectedProduct.mainEotp ? (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                            MAIN
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{r.eopLabel ?? ""}</td>
                      <td className="px-3 py-2">{formatEuro(r.internalAmount)}</td>
                      <td className="px-3 py-2">{formatEuro(r.externalAmount)}</td>
                      <td className="px-3 py-2">{formatEuro(r.directAmount)}</td>
                      <td className="px-3 py-2 font-medium">{formatEuro(r.total)}</td>
                      <td className="px-3 py-2">{r.comment ?? ""}</td>
                    </tr>
                  ))}
                  {!routingRows.length ? (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={7}>
                        No exception routing rows for this product/year.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className={PANEL_CARD_CLASS}>
            <CardHeader>
              <CardTitle className="text-base">
                Initiatives contributing to this product (v_allocation_costs)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2">Initiative</th>
                    <th className="px-3 py-2">Internal</th>
                    <th className="px-3 py-2">External</th>
                    <th className="px-3 py-2">Direct</th>
                    <th className="px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {initiatives.map((r) => (
                    <tr key={r.jiraKey} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.jiraKey}</div>
                        <div className="text-muted-foreground text-xs">{r.summary}</div>
                      </td>
                      <td className="px-3 py-2">{formatEuro(r.internal)}</td>
                      <td className="px-3 py-2">{formatEuro(r.external)}</td>
                      <td className="px-3 py-2">{formatEuro(r.direct)}</td>
                      <td className="px-3 py-2 font-medium">{formatEuro(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}

