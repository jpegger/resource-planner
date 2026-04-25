import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";

export default function ReportsHomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Link
            href="/reports/budget"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">Budget overview</div>
            <div className="text-muted-foreground mt-1 text-sm">
              Division → Team → Product → Initiative drilldown (Recharts)
            </div>
          </Link>
          <Link
            href="/reports/eotp-products"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">EOTP costs (by product)</div>
            <div className="text-muted-foreground mt-1 text-sm">
              Product → routed EOTPs (incl. main) + routing detail
            </div>
          </Link>
          <Link
            href="/reports/eotp-lines"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">EOTP costs (by EOTP)</div>
            <div className="text-muted-foreground mt-1 text-sm">
              EOTP → contributing products
            </div>
          </Link>
          <Link
            href="/reports/baseline"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">Baseline</div>
            <div className="text-muted-foreground mt-1 text-sm">
              Budget baseline drilldowns from imported Excel
            </div>
          </Link>
          <Link
            href="/reports/snapshot"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">Snapshot</div>
            <div className="text-muted-foreground mt-1 text-sm">
              Frozen planning snapshot drilldowns
            </div>
          </Link>
          <Link
            href="/reports/comparison"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">Snapshot vs baseline</div>
            <div className="text-muted-foreground mt-1 text-sm">
              Gap drilldown by division → subdivision → team → owner → EOTP
            </div>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

