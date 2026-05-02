"use client";

import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { formatK } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ComparisonRow = {
  eotp: string;
  label: string;
  snapInternal: number;
  snapExternal: number;
  snapDirect: number;
  snapCashOut: number;
  baselineAmount: number;
  gap: number;
  division: string | null;
  subdivision: string | null;
  team: string | null;
  owner: string | null;
};

export type ComparisonSortKey =
  | "eotp"
  | "label"
  | "snapInternal"
  | "snapExternal"
  | "snapDirect"
  | "snapCashOut"
  | "baselineAmount"
  | "gap"
  | "coveragePct";

export type ComparisonSortDir = "asc" | "desc";

function gapClass(gap: number): string {
  if (gap > 0) return "text-green-700";
  if (gap < 0) return "text-red-700";
  return "text-muted-foreground";
}

function coveragePct(r: ComparisonRow): number | null {
  const b = r.baselineAmount ?? 0;
  const c = r.snapCashOut ?? 0;
  if (!Number.isFinite(b) || !Number.isFinite(c) || b <= 0) return null;
  return (c / b) * 100;
}

function formatPct(x: number | null): string {
  if (x == null) return "—";
  // keep stable, compact output
  return `${x.toFixed(1)}%`;
}

export function ComparisonTable({
  rows,
  loading,
  sortKey,
  sortDir,
  onSortChange,
  headerActions,
}: {
  rows: ComparisonRow[];
  loading: boolean;
  sortKey: ComparisonSortKey;
  sortDir: ComparisonSortDir;
  onSortChange: (key: ComparisonSortKey) => void;
  headerActions?: ReactNode;
}) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.snapInternal += r.snapInternal;
      acc.snapExternal += r.snapExternal;
      acc.snapDirect += r.snapDirect;
      acc.snapCashOut += r.snapCashOut;
      acc.baselineAmount += r.baselineAmount;
      acc.gap += r.gap;
      return acc;
    },
    {
      snapInternal: 0,
      snapExternal: 0,
      snapDirect: 0,
      snapCashOut: 0,
      baselineAmount: 0,
      gap: 0,
    }
  );
  const totalsCoverage = totals.baselineAmount > 0 ? (totals.snapCashOut / totals.baselineAmount) * 100 : null;

  const sortGlyph = (key: ComparisonSortKey): string => {
    if (key !== sortKey) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  const thButtonClass =
    "w-full select-none text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const thButtonRightClass =
    "w-full select-none text-right font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div className="overflow-hidden rounded-md border">
      {headerActions ? (
        <div className="flex items-center justify-end gap-2 border-b bg-muted/50 px-3 py-2">
          {headerActions}
        </div>
      ) : null}
      <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: "20%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
        </colgroup>
        <thead className="bg-muted/50">
          <tr className="text-left">
            
          <th className="px-3 py-2">
              <button
                type="button"
                className={thButtonClass}
              >
                Subdivision
              </button>
            </th>

            <th className="px-3 py-2">
              <button
                type="button"
                className={thButtonClass}
              >
                Team
              </button>
            </th>
            
            <th className="px-3 py-2">
              <button
                type="button"
                className={thButtonClass}
                onClick={() => onSortChange("eotp")}
                aria-sort={sortKey === "eotp" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              >
                EOTP{sortGlyph("eotp")}
              </button>
            </th>
            
            <th className="px-3 py-2">
              <button
                type="button"
                className={thButtonClass}
                onClick={() => onSortChange("label")}
                aria-sort={sortKey === "label" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              >
                Label{sortGlyph("label")}
              </button>
            </th>
            <th className="px-3 py-2 text-right">
              <button
                type="button"
                className={thButtonRightClass}
                onClick={() => onSortChange("snapInternal")}
                aria-sort={
                  sortKey === "snapInternal" ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                }
              >
                Internal{sortGlyph("snapInternal")}
              </button>
            </th>
            <th className="px-3 py-2 text-right">
              <button
                type="button"
                className={thButtonRightClass}
                onClick={() => onSortChange("snapExternal")}
                aria-sort={
                  sortKey === "snapExternal" ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                }
              >
                External{sortGlyph("snapExternal")}
              </button>
            </th>
            <th className="px-3 py-2 text-right">
              <button
                type="button"
                className={thButtonRightClass}
                onClick={() => onSortChange("snapDirect")}
                aria-sort={
                  sortKey === "snapDirect" ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                }
              >
                Direct{sortGlyph("snapDirect")}
              </button>
            </th>
            <th className="px-3 py-2 text-right">
              <button
                type="button"
                className={thButtonRightClass}
                onClick={() => onSortChange("snapCashOut")}
                aria-sort={
                  sortKey === "snapCashOut" ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                }
              >
                Cash Out{sortGlyph("snapCashOut")}
              </button>
            </th>
            <th className="px-3 py-2 text-right">
              <button
                type="button"
                className={thButtonRightClass}
                onClick={() => onSortChange("baselineAmount")}
                aria-sort={
                  sortKey === "baselineAmount" ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                }
              >
                Baseline{sortGlyph("baselineAmount")}
              </button>
            </th>
            <th className="px-3 py-2 text-right">
              <button
                type="button"
                className={thButtonRightClass}
                onClick={() => onSortChange("coveragePct")}
                aria-sort={
                  sortKey === "coveragePct" ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                }
              >
                Coverage{sortGlyph("coveragePct")}
              </button>
            </th>
            <th className="px-3 py-2 text-right">
              <button
                type="button"
                className={thButtonRightClass}
                onClick={() => onSortChange("gap")}
                aria-sort={sortKey === "gap" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              >
                Gap{sortGlyph("gap")}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">
                    <Skeleton className="h-4 w-[120px]" />
                  </td>
                  <td className="px-3 py-2">
                    <Skeleton className="h-4 w-[220px]" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Skeleton className="ml-auto h-4 w-[70px]" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Skeleton className="ml-auto h-4 w-[70px]" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Skeleton className="ml-auto h-4 w-[70px]" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Skeleton className="ml-auto h-4 w-[70px]" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Skeleton className="ml-auto h-4 w-[70px]" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Skeleton className="ml-auto h-4 w-[70px]" />
                  </td>
                </tr>
              ))}
            </>
          ) : rows.length ? (
            rows.map((r) => (
              <tr key={r.eotp} className="border-t">
                <td className="px-3 py-2 truncate" title={r.subdivision ?? undefined}>
                  {r.subdivision}
                </td>
                <td className="px-3 py-2 truncate" title={r.team ?? undefined}>
                  {r.team}
                </td>
                <td className="px-3 py-2 font-mono">{r.eotp}</td>
                
                <td className="px-3 py-2 truncate" title={r.label}>
                  {r.label}
                </td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.snapInternal)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.snapExternal)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.snapDirect)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.snapCashOut)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.baselineAmount)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {formatPct(coveragePct(r))}
                </td>
                <td className={cn("px-3 py-2 text-right font-semibold", gapClass(r.gap))}>
                  {formatK(r.gap)}
                </td>
              </tr>
            ))
          ) : (
            <tr className="border-t">
              <td className="px-3 py-3 text-muted-foreground" colSpan={9}>
                No rows.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot className="bg-muted/50">
          <tr className="border-t font-semibold">
            <td className="px-3 py-2" colSpan={2}>
              Total
            </td>
            <td className="px-3 py-2 text-right">{formatK(totals.snapInternal)}</td>
            <td className="px-3 py-2 text-right">{formatK(totals.snapExternal)}</td>
            <td className="px-3 py-2 text-right">{formatK(totals.snapDirect)}</td>
            <td className="px-3 py-2 text-right">{formatK(totals.snapCashOut)}</td>
            <td className="px-3 py-2 text-right">{formatK(totals.baselineAmount)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatPct(totalsCoverage)}</td>
            <td className={cn("px-3 py-2 text-right", gapClass(totals.gap))}>{formatK(totals.gap)}</td>
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}

