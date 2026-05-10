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
            href="/reports/revenu"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">Revenue (revenu)</div>
            <div className="text-muted-foreground mt-1 text-sm">
              Estimated vs planned AR revenue per product path — same drilldown and initiative filters as budget
              (stops at product).
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
            href="/reports/ar"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">Salesforce AR (planned revenue)</div>
            <div className="text-muted-foreground mt-1 text-sm">
              Filterable AR lines, charts by status / client / product, Excel export — separate from invoiced
              revenue.
            </div>
          </Link>
          <Link
            href="/reports/ar-invoicing"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">AR invoicing follow-up</div>
            <div className="text-muted-foreground mt-1 text-sm">
              Per AR line: planned amount vs SAP client invoices (document type, invoice n°, désignation, invoiced
              product, division / subdivision / family).
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
          <div className="hover:bg-muted/30 rounded-md border p-4 transition-colors">
            <Link href="/reports/comparison" className="block">
              <div className="font-medium">Comparison & realized data</div>
              <div className="text-muted-foreground mt-1 text-sm">
                Planning snapshot vs baseline gap drilldown; separate tabs for realized costs and for
                planned vs invoiced revenue.
              </div>
            </Link>
            <div className="text-muted-foreground mt-2 text-xs">
              <Link href="/reports/comparison?tab=realized" className="text-primary underline">
                Open realized tab
              </Link>
              {" · "}
              <Link href="/reports/comparison?tab=revenue" className="text-primary underline">
                Open revenue tab
              </Link>
            </div>
          </div>
          <Link
            href="/imports"
            className="hover:bg-muted/30 rounded-md border p-4 transition-colors"
          >
            <div className="font-medium">Realized data — imports</div>
            <div className="text-muted-foreground mt-1 text-sm">
              Upload CSVs or sync APIs, manage SN/SF mappings, and review import history.
            </div>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

