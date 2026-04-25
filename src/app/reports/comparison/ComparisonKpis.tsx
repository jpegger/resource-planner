"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

import { formatK } from "@/lib/format";

export function ComparisonKpis({
  baselineTotal,
  catchoutTotal,
  gap,
  coveragePct,
}: {
  baselineTotal: number;
  catchoutTotal: number;
  gap: number;
  coveragePct: number | null;
}) {
  const gapClass =
    gap > 0 ? "text-green-700" : gap < 0 ? "text-red-700" : "text-muted-foreground";

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Baseline</CardTitle>
        </CardHeader>
        <CardContent className="text-lg font-semibold">{formatK(baselineTotal)}</CardContent>
      </Card>

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Catchout</CardTitle>
        </CardHeader>
        <CardContent className="text-lg font-semibold">{formatK(catchoutTotal)}</CardContent>
      </Card>

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Gap</CardTitle>
        </CardHeader>
        <CardContent className={cn("text-lg font-semibold", gapClass)}>{formatK(gap)}</CardContent>
      </Card>

      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Coverage</CardTitle>
        </CardHeader>
        <CardContent className="text-lg font-semibold">
          {coveragePct === null ? "—" : `${coveragePct.toFixed(1)}%`}
        </CardContent>
      </Card>
    </div>
  );
}

