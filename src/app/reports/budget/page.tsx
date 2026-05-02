"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  type TooltipProps,
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

type Level = "division" | "team" | "product" | "initiative";

type RollupRow = {
  key: string;
  label: string;
  internal: number;
  external: number;
  direct: number;
  total: number;
};

type ApiResponse = {
  rows: RollupRow[];
  meta: {
    year: number;
    level: Level;
    division: string | null;
    team: string | null;
    productName: string | null;
    initiativeTypes: string[];
  };
};

function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return [y - 1, y, y + 1];
}

function nextLevel(level: Level): Level | null {
  if (level === "division") return "team";
  if (level === "team") return "product";
  if (level === "product") return "initiative";
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

function CustomTooltip(props: TooltipProps<number, string>) {
  const active = (props as unknown as { active?: boolean }).active;
  const payload = (props as unknown as { payload?: unknown[] }).payload;
  const label = (props as unknown as { label?: unknown }).label;
  if (!active || !payload?.length) return null;
  const items = (payload as Array<Record<string, unknown>>)
    .filter((p) => typeof p.value === "number" && p.value !== 0)
    .map((p) => ({
      name: String(p.name ?? p.dataKey ?? ""),
      value: Number(p.value ?? 0),
      color: typeof p.color === "string" ? p.color : undefined,
    }));
  const total = items.reduce((acc: number, it: { value: number }) => acc + it.value, 0);
  return (
    <div className="bg-popover text-popover-foreground rounded-md border p-2 shadow-md">
      <div className="text-sm font-medium">{String(label ?? "")}</div>
      <div className="mt-1 space-y-1 text-sm">
        {items.map((it: { name: string; value: number; color?: string }) => (
          <div key={String(it.name)} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: it.color ?? "transparent" }}
              />
              <span>{String(it.name)}</span>
            </div>
            <span className="font-medium tabular-nums">{formatEuro(it.value)}</span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t pt-1">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold tabular-nums">{formatEuro(total)}</span>
        </div>
      </div>
    </div>
  );
}

export default function BudgetRechartsPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [level, setLevel] = useState<Level>("division");
  const [division, setDivision] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [productName, setProductName] = useState<string | null>(null);

  // Start simple: single initiative type selector (can be expanded to multi later).
  const [initiativeType, setInitiativeType] = useState<string>("__ALL__");

  const [includeInternal, setIncludeInternal] = useState(true);
  const [includeExternal, setIncludeExternal] = useState(true);
  const [includeDirect, setIncludeDirect] = useState(true);

  const [rows, setRows] = useState<RollupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => yearOptions(), []);

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
          setLevel("initiative");
        },
      });
    }
    return parts;
  }, [division, team, productName]);

  const fetchRollup = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("year", String(year));
      sp.set("level", level);
      if (division) sp.set("division", division);
      if (team) sp.set("team", team);
      if (productName) sp.set("productName", productName);
      if (initiativeType !== "__ALL__") sp.set("initiativeTypes", initiativeType);

      const response = await fetch(`/api/reports/budget-rollup?${sp.toString()}`);
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorBody.error ?? `HTTP ${response.status}`);
      }
      const apiResponse = (await response.json()) as ApiResponse;
      setRows(Array.isArray(apiResponse.rows) ? apiResponse.rows : []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [year, level, division, team, productName, initiativeType]);

  useEffect(() => {
    void fetchRollup();
  }, [fetchRollup]);

  function onClickRow(r: RollupRow) {
    const next = nextLevel(level);
    if (!next) return;

    if (level === "division") {
      setDivision(r.key);
      setTeam(null);
      setProductName(null);
    } else if (level === "team") {
      setTeam(r.key);
      setProductName(null);
    } else if (level === "product") {
      setProductName(r.key);
    }

    setLevel(next);
  }

  const stackedRows = useMemo(() => {
    return rows.map((r) => ({
      ...r,
      internalShown: includeInternal ? r.internal : 0,
      externalShown: includeExternal ? r.external : 0,
      directShown: includeDirect ? r.direct : 0,
      totalShown:
        (includeInternal ? r.internal : 0) +
        (includeExternal ? r.external : 0) +
        (includeDirect ? r.direct : 0),
    }));
  }, [rows, includeInternal, includeExternal, includeDirect]);

  const handleChartClick = useCallback(
    (e: unknown) => {
      const chartEvent = e as { activePayload?: { payload?: RollupRow }[] } | null;
      const picked = chartEvent?.activePayload?.[0]?.payload;
      if (picked) onClickRow(picked);
    },
    // onClickRow uses current drilldown state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [level, division, team, productName]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">Budget overview (Recharts test)</CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              Drilldown: Division → Team → Product → Initiative (click a row to drill down)
            </div>
          </div>
          <Button variant="outline" onClick={fetchRollup} disabled={loading}>
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

            <div className="md:col-span-4">
              <Label>Initiative type</Label>
              <Select
                value={initiativeType}
                onValueChange={(v) => {
                  if (v !== null) setInitiativeType(v);
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL__">All types</SelectItem>
                  <SelectItem value="RUN">RUN</SelectItem>
                  <SelectItem value="EVOLUTION">EVOLUTION</SelectItem>
                  <SelectItem value="ROLLOUT">ROLLOUT</SelectItem>
                  <SelectItem value="PROJET">PROJET</SelectItem>
                  <SelectItem value="NOUVEAU_SERVICE">NOUVEAU_SERVICE</SelectItem>
                  <SelectItem value="ANALYSE">ANALYSE</SelectItem>
                  <SelectItem value="EVOLUTION_TECHNIQUE">EVOLUTION_TECHNIQUE</SelectItem>
                  <SelectItem value="PRODUCT_ACTIVATION">PRODUCT_ACTIVATION</SelectItem>
                  <SelectItem value="DECOMMISSIONNEMENT">DECOMMISSIONNEMENT</SelectItem>
                  <SelectItem value="LEGAL">LEGAL</SelectItem>
                  <SelectItem value="Unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-5">
              <Label>Cost components</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="text-sm">Internal</div>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-medium",
                      includeInternal ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                    )}
                    onClick={() => setIncludeInternal((v) => !v)}
                  >
                    {includeInternal ? "On" : "Off"}
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="text-sm">External</div>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-medium",
                      includeExternal ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                    )}
                    onClick={() => setIncludeExternal((v) => !v)}
                  >
                    {includeExternal ? "On" : "Off"}
                  </button>
                </div>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="text-sm">Direct</div>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-medium",
                      includeDirect ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                    )}
                    onClick={() => setIncludeDirect((v) => !v)}
                  >
                    {includeDirect ? "On" : "Off"}
                  </button>
                </div>
              </div>
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

          <div className="h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stackedRows}
                margin={{ top: 8, right: 16, left: 8, bottom: 40 }}
                onClick={handleChartClick}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={70}
                />
                <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip content={<CustomTooltip />} />
                {includeInternal ? <Bar dataKey="internalShown" name="Internal" stackId="a" fill="#2563eb" /> : null}
                {includeExternal ? <Bar dataKey="externalShown" name="External" stackId="a" fill="#f97316" /> : null}
                {includeDirect ? <Bar dataKey="directShown" name="Direct" stackId="a" fill="#16a34a" /> : null}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Internal</th>
                  <th className="px-3 py-2">External</th>
                  <th className="px-3 py-2">Direct</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                      Loading…
                    </td>
                  </tr>
                ) : stackedRows.length ? (
                  stackedRows.map((r) => (
                    <tr
                      key={r.key}
                      className="hover:bg-muted/30 cursor-pointer border-t"
                      onClick={() => onClickRow(r)}
                    >
                      <td className="px-3 py-2">{r.label}</td>
                      <td className="px-3 py-2">{formatEuro(r.internalShown)}</td>
                      <td className="px-3 py-2">{formatEuro(r.externalShown)}</td>
                      <td className="px-3 py-2">{formatEuro(r.directShown)}</td>
                      <td className="px-3 py-2 font-medium">{formatEuro(r.totalShown)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-3 text-muted-foreground" colSpan={5}>
                      No data
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

