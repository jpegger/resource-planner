"use client";

import { useRouter } from "next/navigation";
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
  total: number; // total on main EOTP
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

type ApiResp =
  | { products: ProductOpt[] }
  | {
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

export default function ReportsEotpProductsPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const years = useMemo(() => yearOptions(), []);

  const navigateToProduct = useCallback(
    (productId: string) => {
      const sp = new URLSearchParams();
      sp.set("year", String(year));
      router.push(`/reports/eotp-products/${encodeURIComponent(productId)}?${sp.toString()}`);
    },
    [router, year]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("year", String(year));
      const res = await fetch(`/api/reports/eotp?${sp.toString()}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ApiResp;
      const list = "products" in data ? data.products : [];
      setProducts(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const chartRows = useMemo(() => products.slice(0, 25), [products]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">EOTP costs (by product)</CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              Overview shows the <span className="font-medium">main EOTP</span> and the{" "}
              <span className="font-medium">total amount on the main EOTP</span>.
            </div>
          </div>
          <Button variant="outline" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-3">
              <Label>Year</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
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
            <div className="md:col-span-9" />
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartRows}
                margin={{ top: 8, right: 16, left: 8, bottom: 60 }}
                onClick={(e) => {
                  const picked = (e as { activePayload?: { payload?: ProductOpt }[] } | null)
                    ?.activePayload?.[0]?.payload;
                  if (picked?.productId) navigateToProduct(picked.productId);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="productName" interval={0} angle={-30} textAnchor="end" height={80} />
                <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip formatter={(v: unknown) => formatEuro(Number(v ?? 0))} />
                <Bar dataKey="total" name="Main EOTP total" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <Card className={PANEL_CARD_CLASS}>
            <CardHeader>
              <CardTitle className="text-base">Products (click for details)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Main EOTP</th>
                    <th className="px-3 py-2 text-right">Main total</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                        Loading…
                      </td>
                    </tr>
                  ) : products.length ? (
                    products.map((p) => (
                      <tr
                        key={p.productId}
                        className={cn("hover:bg-muted/30 cursor-pointer border-t")}
                        onClick={() => navigateToProduct(p.productId)}
                      >
                        <td className="px-3 py-2">{p.productName}</td>
                        <td className="px-3 py-2">
                          <div className="font-mono">{p.mainEotp}</div>
                          {p.mainEopLabel ? (
                            <div className="text-muted-foreground text-xs">{p.mainEopLabel}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{formatEuro(p.total)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                        No data
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}

