"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { formatK } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ComparisonRow = {
  eotp: string;
  label: string;
  snapInternal: number;
  snapExternal: number;
  snapDirect: number;
  snapCatchout: number;
  baselineAmount: number;
  gap: number;
  division: string | null;
  subdivision: string | null;
  team: string | null;
  owner: string | null;
};

function gapClass(gap: number): string {
  if (gap > 0) return "text-green-700";
  if (gap < 0) return "text-red-700";
  return "text-muted-foreground";
}

export function ComparisonTable({
  rows,
  loading,
}: {
  rows: ComparisonRow[];
  loading: boolean;
}) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.snapInternal += r.snapInternal;
      acc.snapExternal += r.snapExternal;
      acc.snapDirect += r.snapDirect;
      acc.snapCatchout += r.snapCatchout;
      acc.baselineAmount += r.baselineAmount;
      acc.gap += r.gap;
      return acc;
    },
    {
      snapInternal: 0,
      snapExternal: 0,
      snapDirect: 0,
      snapCatchout: 0,
      baselineAmount: 0,
      gap: 0,
    }
  );

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: "15%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "11%" }} />
        </colgroup>
        <thead className="bg-muted/50">
          <tr className="text-left">
            <th className="px-3 py-2">EOTP</th>
            <th className="px-3 py-2">Label</th>
            <th className="px-3 py-2 text-right">Internal</th>
            <th className="px-3 py-2 text-right">External</th>
            <th className="px-3 py-2 text-right">Direct</th>
            <th className="px-3 py-2 text-right">Catchout</th>
            <th className="px-3 py-2 text-right">Baseline</th>
            <th className="px-3 py-2 text-right">Gap</th>
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
                <td className="px-3 py-2 font-mono">{r.eotp}</td>
                <td className="px-3 py-2 truncate" title={r.label}>
                  {r.label}
                </td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.snapInternal)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.snapExternal)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.snapDirect)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.snapCatchout)}</td>
                <td className="px-3 py-2 text-right font-medium">{formatK(r.baselineAmount)}</td>
                <td className={cn("px-3 py-2 text-right font-semibold", gapClass(r.gap))}>
                  {formatK(r.gap)}
                </td>
              </tr>
            ))
          ) : (
            <tr className="border-t">
              <td className="px-3 py-3 text-muted-foreground" colSpan={8}>
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
            <td className="px-3 py-2 text-right">{formatK(totals.snapCatchout)}</td>
            <td className="px-3 py-2 text-right">{formatK(totals.baselineAmount)}</td>
            <td className={cn("px-3 py-2 text-right", gapClass(totals.gap))}>{formatK(totals.gap)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

