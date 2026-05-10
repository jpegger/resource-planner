"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ArReportLine, ArReportResponse } from "@/lib/ar-report-types";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

const AR_PAGE_LIMIT = 200;

const NO_INVOICE_MATCH_HINT =
  "No SAP client revenue row matched on SO + product label + year. If the invoice has several positions, only the last one may be stored (revenue import unique key per invoice).";

function MatchStatusBadge({ line }: { line: ArReportLine }) {
  if (!line.sapSoNumber?.trim()) {
    return (
      <Badge variant="outline" title="AR line has no SAP SO number — cannot match ZCOMM Document de vente.">
        No SO
      </Badge>
    );
  }
  if (line.matchCount === 0) {
    return (
      <Badge variant="secondary" title={NO_INVOICE_MATCH_HINT}>
        No match
      </Badge>
    );
  }
  return <Badge variant="default">Matched</Badge>;
}

type Level = "division" | "team" | "product";

type RevenueRow = {
  key: string;
  label: string;
  estimatedRevenue: number;
  plannedRevenue: number;
};

type ApiResponse = {
  rows: RevenueRow[];
  meta: {
    year: number;
    level: Level;
    division: string | null;
    team: string | null;
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

function RevenueTooltip(props: TooltipProps<number, string>) {
  const active = (props as unknown as { active?: boolean }).active;
  const payload = (props as unknown as { payload?: Array<{ name?: string; value?: number; color?: string }> })
    .payload;
  const label = (props as unknown as { label?: unknown }).label;
  if (!active || !payload?.length) return null;
  const est = payload.find((p) => p.name === "Estimated");
  const plan = payload.find((p) => p.name === "Planned (AR)");
  const ev = Number(est?.value ?? 0);
  const pv = Number(plan?.value ?? 0);
  return (
    <div className="bg-popover text-popover-foreground rounded-md border p-2 shadow-md text-sm">
      <div className="font-medium">{String(label ?? "")}</div>
      <div className="mt-2 space-y-1">
        <div className="flex justify-between gap-6 tabular-nums">
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#2563eb]" />
            Estimated
          </span>
          <span className="font-medium">{formatEuro(ev)}</span>
        </div>
        <div className="flex justify-between gap-6 tabular-nums">
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#f97316]" />
            Planned (AR)
          </span>
          <span className="font-medium">{formatEuro(pv)}</span>
        </div>
        <div className="text-muted-foreground flex justify-between gap-6 border-t pt-1 tabular-nums">
          <span>Δ (planned − est.)</span>
          <span className="font-medium text-foreground">{formatEuro(pv - ev)}</span>
        </div>
      </div>
    </div>
  );
}

export default function RevenuReportPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [level, setLevel] = useState<Level>("division");
  const [division, setDivision] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);

  const [initiativeType, setInitiativeType] = useState<string>("__ALL__");

  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [arDialogOpen, setArDialogOpen] = useState(false);
  const [arDetailRow, setArDetailRow] = useState<RevenueRow | null>(null);
  const [arData, setArData] = useState<ArReportResponse | null>(null);
  const [arLoading, setArLoading] = useState(false);
  const [arError, setArError] = useState<string | null>(null);
  const [arOffset, setArOffset] = useState(0);
  const [invoicePopoverLineId, setInvoicePopoverLineId] = useState<string | null>(null);

  const years = useMemo(() => yearOptions(), []);

  const breadcrumb = useMemo(() => {
    const parts: { label: string; onClick: () => void }[] = [
      {
        label: "Division",
        onClick: () => {
          setLevel("division");
          setDivision(null);
          setTeam(null);
        },
      },
    ];
    if (division) {
      parts.push({
        label: division,
        onClick: () => {
          setLevel("team");
          setTeam(null);
        },
      });
    }
    if (team) {
      parts.push({
        label: team,
        onClick: () => {
          setLevel("product");
        },
      });
    }
    return parts;
  }, [division, team]);

  const fetchRollup = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("year", String(year));
      sp.set("level", level);
      if (division) sp.set("division", division);
      if (team) sp.set("team", team);
      if (initiativeType !== "__ALL__") sp.set("initiativeTypes", initiativeType);

      const response = await fetch(`/api/reports/revenue-rollup?${sp.toString()}`, {
        cache: "no-store",
      });
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
  }, [year, level, division, team, initiativeType]);

  useEffect(() => {
    void fetchRollup();
  }, [fetchRollup]);

  const fetchArLines = useCallback(
    async (row: RevenueRow, offset: number) => {
      setArLoading(true);
      setArError(null);
      try {
        const sp = new URLSearchParams();
        sp.set("year", String(year));
        sp.set("limit", String(AR_PAGE_LIMIT));
        sp.set("offset", String(offset));
        if (division) sp.set("division", division);
        if (team) sp.set("team", team);
        sp.set("allocationProductName", row.key);

        const res = await fetch(`/api/reports/ar?${sp.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as ArReportResponse;
        setArData(json);
        setArOffset(offset);
      } catch (e) {
        setArData(null);
        setArError(e instanceof Error ? e.message : "Failed to load AR lines");
      } finally {
        setArLoading(false);
      }
    },
    [year, division, team]
  );

  const openPlannedArDetail = useCallback(
    (row: RevenueRow) => {
      setArDetailRow(row);
      setArDialogOpen(true);
      void fetchArLines(row, 0);
    },
    [fetchArLines]
  );

  function onClickRow(r: RevenueRow) {
    const next = nextLevel(level);
    if (!next) return;

    if (level === "division") {
      setDivision(r.key);
      setTeam(null);
    } else if (level === "team") {
      setTeam(r.key);
    }

    setLevel(next);
  }

  const handleChartClick = useCallback(
    (e: unknown) => {
      const chartEvent = e as { activePayload?: { payload?: RevenueRow }[] } | null;
      const picked = chartEvent?.activePayload?.[0]?.payload;
      if (!picked) return;
      if (level === "product") {
        openPlannedArDetail(picked);
        return;
      }
      onClickRow(picked);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [level, division, team, openPlannedArDetail]
  );

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        chartLabel: r.label.length > 28 ? `${r.label.slice(0, 28)}…` : r.label,
      })),
    [rows]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="text-sm">
        <Link href="/reports" className="text-primary underline">
          Reports
        </Link>
        <span className="text-muted-foreground"> / Revenue (estimated vs AR)</span>
      </div>

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">Revenue — estimated vs planned (AR)</CardTitle>
            <div className="text-muted-foreground mt-1 text-sm">
              Drilldown: Division → Team → Product (same path as budget overview). Estimated revenue comes from{" "}
              <code className="text-xs">initiative_revenue</code> via planning initiatives; planned revenue sums{" "}
              <code className="text-xs">ar_entry</code> by allocation entity org (Salesforce AR). Initiative type
              filters estimated totals only. At product level, click the planned revenue cell or the chart bar to
              list matching AR lines.
            </div>
          </div>
          <Button variant="outline" onClick={fetchRollup} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-4">
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

            <div className="md:col-span-8">
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

          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 16, left: 8, bottom: 56 }}
                onClick={handleChartClick}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="chartLabel" interval={0} angle={-28} textAnchor="end" height={72} />
                <YAxis tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip content={<RevenueTooltip />} />
                <Legend />
                <Bar dataKey="estimatedRevenue" name="Estimated" fill="#2563eb" />
                <Bar dataKey="plannedRevenue" name="Planned (AR)" fill="#f97316" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2">Label</th>
                  <th className="px-3 py-2">Estimated revenue</th>
                  <th
                    className="px-3 py-2"
                    title={
                      level === "product"
                        ? "Click a cell below to open all AR lines for this product (same year and path filters)."
                        : undefined
                    }
                  >
                    Planned revenue (AR)
                    {level === "product" ? (
                      <span className="text-muted-foreground ml-1 font-normal">(click)</span>
                    ) : null}
                  </th>
                  <th className="px-3 py-2">Δ (planned − est.)</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="text-muted-foreground px-3 py-3" colSpan={4}>
                      Loading…
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((r) => {
                    const delta = r.plannedRevenue - r.estimatedRevenue;
                    const drillDown = level !== "product";
                    const atProduct = level === "product";
                    return (
                      <tr
                        key={r.key}
                        className={cn("border-t", drillDown ? "hover:bg-muted/30 cursor-pointer" : "")}
                        onClick={() => {
                          if (drillDown) onClickRow(r);
                        }}
                      >
                        <td className="px-3 py-2">{r.label}</td>
                        <td className="px-3 py-2 tabular-nums">{formatEuro(r.estimatedRevenue)}</td>
                        <td
                          className={cn(
                            "px-3 py-2 tabular-nums",
                            atProduct &&
                              "text-primary hover:bg-muted/50 cursor-pointer underline decoration-dotted underline-offset-2"
                          )}
                          onClick={(e) => {
                            if (!atProduct) return;
                            e.stopPropagation();
                            openPlannedArDetail(r);
                          }}
                        >
                          {formatEuro(r.plannedRevenue)}
                        </td>
                        <td className="px-3 py-2 tabular-nums font-medium">{formatEuro(delta)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="text-muted-foreground px-3 py-3" colSpan={4}>
                      No data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={arDialogOpen}
        onOpenChange={(open) => {
          setArDialogOpen(open);
          if (!open) {
            setArDetailRow(null);
            setArData(null);
            setArError(null);
            setArOffset(0);
            setInvoicePopoverLineId(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[min(85vh,900px)] max-w-[calc(100vw-2rem)] flex-col gap-3 sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              AR lines — {arDetailRow?.label ?? "Product"}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap gap-x-3 gap-y-1">
              <span>
                Year {year}
                {division ? ` · Division ${division}` : ""}
                {team ? ` · Team ${team}` : ""}
              </span>
              {arData ? (
                <span className="text-foreground font-medium tabular-nums">
                  {arData.summary.lineCount} lines · {formatEuro(arData.summary.totalEur)} planned (AR)
                </span>
              ) : null}
            </DialogDescription>
            {arData ? (
              <p className="text-muted-foreground text-xs">
                SAP invoice match:{" "}
                <span className="text-foreground font-medium tabular-nums">
                  {arData.summary.matchedLineCount}
                </span>{" "}
                lines with ≥1 matched revenue position ·{" "}
                <span className="text-foreground font-medium tabular-nums">
                  {formatEuro(arData.summary.matchedTotalEur)}
                </span>{" "}
                realized (sum of matched amounts)
              </p>
            ) : null}
          </DialogHeader>

          {arError ? <div className="text-sm text-red-600">{arError}</div> : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm">
            <div className="text-muted-foreground">
              {arData ? (
                <>
                  Showing{" "}
                  <span className="text-foreground font-medium tabular-nums">
                    {arData.meta.total ? arOffset + 1 : 0}–
                    {Math.min(arOffset + AR_PAGE_LIMIT, arData.meta.total)}
                  </span>{" "}
                  of <span className="text-foreground font-medium">{arData.meta.total}</span>
                </>
              ) : (
                " "
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={arLoading || !arDetailRow || arOffset === 0}
                onClick={() => arDetailRow && void fetchArLines(arDetailRow, Math.max(0, arOffset - AR_PAGE_LIMIT))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  arLoading ||
                  !arData ||
                  !arDetailRow ||
                  arOffset + AR_PAGE_LIMIT >= arData.meta.total
                }
                onClick={() =>
                  arDetailRow && void fetchArLines(arDetailRow, arOffset + AR_PAGE_LIMIT)
                }
              >
                Next
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto rounded-md border">
            <table className="w-max min-w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="whitespace-nowrap px-2 py-2">Contract</th>
                  <th className="whitespace-nowrap px-2 py-2">Line</th>
                  <th className="whitespace-nowrap px-2 py-2">Status</th>
                  <th className="whitespace-nowrap px-2 py-2">Signed</th>
                  <th className="whitespace-nowrap px-2 py-2">Client</th>
                  <th className="whitespace-nowrap px-2 py-2">SF product</th>
                  <th className="whitespace-nowrap px-2 py-2">EUR (AR)</th>
                  <th className="whitespace-nowrap px-2 py-2">Inv #</th>
                  <th className="whitespace-nowrap px-2 py-2">Realized (SAP)</th>
                  <th className="whitespace-nowrap px-2 py-2">Match</th>
                  <th className="whitespace-nowrap px-2 py-2">Product</th>
                  <th className="whitespace-nowrap px-2 py-2">SAP EOTP</th>
                  <th className="min-w-[180px] px-2 py-2">Warning</th>
                </tr>
              </thead>
              <tbody>
                {arLoading ? (
                  <tr>
                    <td className="text-muted-foreground px-2 py-4" colSpan={13}>
                      Loading…
                    </td>
                  </tr>
                ) : arData?.lines.length ? (
                  arData.lines.map((line) => (
                    <tr key={line.id} className="border-t">
                      <td className="whitespace-nowrap px-2 py-1.5">{line.contractNumber}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{line.lineItemNumber}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{line.documentStatus}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{line.signedDate ?? "—"}</td>
                      <td className="max-w-[160px] truncate px-2 py-1.5" title={line.clientName ?? ""}>
                        {line.clientName ?? "—"}
                      </td>
                      <td className="max-w-[200px] truncate px-2 py-1.5" title={line.sfProductName}>
                        {line.sfProductName}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{formatEuro(line.amountEur)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {line.matchCount > 0 ? (
                          <Popover
                            open={invoicePopoverLineId === line.id}
                            onOpenChange={(open) => {
                              setInvoicePopoverLineId(open ? line.id : null);
                            }}
                          >
                            <PopoverTrigger
                              className={cn(
                                buttonVariants({ variant: "link", size: "sm" }),
                                "h-auto min-h-0 px-1 py-0 font-medium tabular-nums"
                              )}
                            >
                              {line.matchCount}
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-[min(22rem,calc(100vw-2rem))] max-h-72 overflow-y-auto p-3"
                              align="start"
                              side="left"
                              positionMethod="fixed"
                            >
                              <div className="text-xs font-medium">Matched SAP revenue positions</div>
                              <ul className="mt-2 space-y-2 text-xs">
                                {line.matchedInvoices.map((inv, idx) => (
                                  <li key={`${inv.invoiceNr}-${inv.year}-${inv.month}-${idx}`} className="border-b pb-2 last:border-0">
                                    <div className="font-medium tabular-nums">{formatEuro(inv.amountEur)}</div>
                                    <div className="text-muted-foreground">
                                      Invoice {inv.invoiceNr} · {String(inv.month).padStart(2, "0")}/{inv.year}
                                    </div>
                                    {inv.eotp ? (
                                      <div className="text-muted-foreground truncate" title={inv.eotp}>
                                        EOTP {inv.eotp}
                                      </div>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <span className="text-muted-foreground tabular-nums">0</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                        {formatEuro(line.matchedAmountEur)}
                      </td>
                      <td className="px-2 py-1.5">
                        <MatchStatusBadge line={line} />
                      </td>
                      <td className="max-w-[160px] truncate px-2 py-1.5" title={line.allocationEntityName ?? ""}>
                        {line.allocationEntityName ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{line.sapEotpCode ?? "—"}</td>
                      <td
                        className="max-w-[240px] truncate px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200"
                        title={line.importWarning ?? ""}
                      >
                        {line.importWarning ?? "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="text-muted-foreground px-2 py-4" colSpan={13}>
                      {arDialogOpen && !arLoading ? "No AR lines for this slice." : " "}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
