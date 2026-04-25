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

type EotpOpt = { eotp: string; eopLabel: string | null; total: number };
type ProductRow = { productId: string; productName: string; total: number };
type FiltersResp = { divisions: string[]; subDivisions: string[]; teams: string[] };

type ApiResp =
  | { eotps: EotpOpt[]; filters: FiltersResp }
  | {
      eotps: EotpOpt[];
      filters: FiltersResp;
      eotp: string;
      products: ProductRow[];
      applied?: { division?: string; subDivision?: string; team?: string };
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

export default function ReportsEotpLinesPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [eotp, setEotp] = useState<string | "__NONE__">("__NONE__");
  const [division, setDivision] = useState<string | "__ALL__">("__ALL__");
  const [subDivision, setSubDivision] = useState<string | "__ALL__">("__ALL__");
  const [team, setTeam] = useState<string | "__ALL__">("__ALL__");
  const [eotps, setEotps] = useState<EotpOpt[]>([]);
  const [filters, setFilters] = useState<FiltersResp>({
    divisions: [],
    subDivisions: [],
    teams: [],
  });
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => yearOptions(), []);
  const selected = useMemo(() => eotps.find((x) => x.eotp === eotp) ?? null, [eotps, eotp]);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("year", String(year));
      if (division !== "__ALL__") sp.set("division", division);
      if (subDivision !== "__ALL__") sp.set("subDivision", subDivision);
      if (team !== "__ALL__") sp.set("team", team);
      const res = await fetch(`/api/reports/eotp-lines?${sp.toString()}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ApiResp;
      setEotps(data.eotps ?? []);
      setFilters("filters" in data ? data.filters : { divisions: [], subDivisions: [], teams: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoadingList(false);
    }
  }, [year, division, subDivision, team]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const refreshDetails = useCallback(async () => {
    if (eotp === "__NONE__") {
      setProducts([]);
      return;
    }

    setLoadingDetails(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("year", String(year));
      if (division !== "__ALL__") sp.set("division", division);
      if (subDivision !== "__ALL__") sp.set("subDivision", subDivision);
      if (team !== "__ALL__") sp.set("team", team);
      sp.set("eotp", eotp);
      const res = await fetch(`/api/reports/eotp-lines?${sp.toString()}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ApiResp;
      if ("products" in data) setProducts(data.products ?? []);
      else setProducts([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoadingDetails(false);
    }
  }, [year, division, subDivision, team, eotp]);

  useEffect(() => {
    void refreshDetails();
  }, [refreshDetails]);

  const chartRows = useMemo(() => eotps.slice(0, 25), [eotps]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">EOTP costs (by EOTP)</CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              Click an EOTP line to see where routing comes from as{" "}
              <span className="font-medium">Product → Value</span>.
            </div>
          </div>
          <Button variant="outline" onClick={refreshList} disabled={loadingList}>
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
            <div className="md:col-span-3">
              <Label>Division</Label>
              <Select value={division} onValueChange={(v) => setDivision(v as typeof division)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL__">All</SelectItem>
                  {filters.divisions.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label>Sub-division</Label>
              <Select
                value={subDivision}
                onValueChange={(v) => setSubDivision(v as typeof subDivision)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL__">All</SelectItem>
                  {filters.subDivisions.map((sd) => (
                    <SelectItem key={sd} value={sd}>
                      {sd}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label>Team</Label>
              <Select value={team} onValueChange={(v) => setTeam(v as typeof team)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL__">All</SelectItem>
                  {filters.teams.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartRows}
                margin={{ top: 8, right: 16, left: 8, bottom: 60 }}
                onClick={(e) => {
                  const picked = (e as { activePayload?: { payload?: EotpOpt }[] } | null)
                    ?.activePayload?.[0]?.payload;
                  if (picked?.eotp) {
                    setEotp(picked.eotp);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="eotp" interval={0} angle={-30} textAnchor="end" height={80} />
                <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip
                  formatter={(v: unknown) => formatEuro(Number(v ?? 0))}
                  labelFormatter={(l: unknown) => String(l ?? "")}
                />
                <Bar dataKey="total" name="Total" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <Card className={PANEL_CARD_CLASS}>
            <CardHeader>
              <CardTitle className="text-base">EOTPs (click for details)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2">EOTP</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingList ? (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={3}>
                        Loading…
                      </td>
                    </tr>
                  ) : eotps.length ? (
                    eotps.map((r) => (
                      <Fragment key={r.eotp}>
                        <tr
                          className={cn(
                            "hover:bg-muted/30 cursor-pointer border-t",
                            eotp === r.eotp && "bg-muted/20"
                          )}
                          onClick={() => setEotp((prev) => (prev === r.eotp ? "__NONE__" : r.eotp))}
                        >
                          <td className="px-3 py-2 font-mono">{r.eotp}</td>
                          <td className="px-3 py-2">{r.eopLabel ?? ""}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatEuro(r.total)}</td>
                        </tr>
                        {eotp === r.eotp ? (
                          <tr className="border-t bg-muted/10">
                            <td colSpan={3} className="px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-medium">
                                  Product → Amount summary
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setEotp("__NONE__");
                                  }}
                                >
                                  Close
                                </Button>
                              </div>
                              <div className="text-muted-foreground mt-1 text-sm">
                                <span className="font-mono">{selected?.eotp ?? r.eotp}</span>{" "}
                                {selected?.eopLabel ? `— ${selected.eopLabel}` : ""}
                              </div>

                              <div className="mt-3 overflow-x-auto rounded-md border bg-background">
                                <table className="w-full text-sm">
                                  <thead className="bg-muted/50">
                                    <tr className="text-left">
                                      <th className="px-3 py-2">Product</th>
                                      <th className="px-3 py-2 text-right">Value</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {loadingDetails ? (
                                      <tr>
                                        <td
                                          className="px-3 py-3 text-muted-foreground"
                                          colSpan={2}
                                        >
                                          Loading…
                                        </td>
                                      </tr>
                                    ) : products.length ? (
                                      products.map((p) => (
                                        <tr key={p.productId} className="border-t">
                                          <td className="px-3 py-2">{p.productName}</td>
                                          <td className="px-3 py-2 text-right font-medium">
                                            {formatEuro(p.total)}
                                          </td>
                                        </tr>
                                      ))
                                    ) : (
                                      <tr>
                                        <td
                                          className="px-3 py-3 text-muted-foreground"
                                          colSpan={2}
                                        >
                                          No products for this selection.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
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

