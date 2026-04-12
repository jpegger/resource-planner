import { Briefcase } from "lucide-react";

import { InvestmentDetailFieldReadonly } from "@/app/investments/[id]/InvestmentDetailFieldReadonly";
import { InvestmentDetailPanelHeading } from "@/app/investments/[id]/InvestmentDetailPanelHeading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Investment } from "@/lib/investment-types";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";

export function InvestmentDetailSummaryCard({ investment }: { investment: Investment }) {
  return (
    <Card className={PANEL_CARD_CLASS}>
      <CardHeader className="pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <InvestmentDetailPanelHeading icon={Briefcase} title="Investment details" />
          {investment.productFamily ? (
            <Badge variant="secondary">{investment.productFamily}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InvestmentDetailFieldReadonly label="Division" value={investment.division ?? ""} />
        <InvestmentDetailFieldReadonly label="Sub-division" value={investment.subDivision ?? ""} />
        <InvestmentDetailFieldReadonly label="Team" value={investment.team ?? ""} />
        <InvestmentDetailFieldReadonly label="SAP EOTP code" value={investment.sapEotpCode ?? ""} />
        <InvestmentDetailFieldReadonly label="SAP EOTP name" value={investment.sapEotpName ?? ""} />
        {investment.attractiveness != null ? (
          <InvestmentDetailFieldReadonly
            label="Attractiveness"
            value={String(investment.attractiveness)}
          />
        ) : null}
        {investment.competitiveness != null ? (
          <InvestmentDetailFieldReadonly
            label="Competitiveness"
            value={String(investment.competitiveness)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
