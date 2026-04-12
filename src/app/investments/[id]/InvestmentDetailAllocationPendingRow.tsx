"use client";

import { InvestmentDetailResourceCombobox } from "@/app/investments/[id]/InvestmentDetailResourceCombobox";
import {
  ALLOCATION_COST_CELL_INSET,
  UNDER_GROUP_INDENT,
} from "@/app/investments/[id]/InvestmentDetailAllocationEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ResourceOption } from "@/lib/investment-types";
import { cn } from "@/lib/utils";

export function InvestmentDetailAllocationPendingRow({
  resources,
  isConfirming,
  onSelectResource,
  onDiscard,
}: {
  resources: ResourceOption[];
  isConfirming: boolean;
  onSelectResource: (resourceId: string) => void;
  onDiscard: () => void;
}) {
  return (
    <TableRow className={UNDER_GROUP_INDENT}>
      <TableCell className="w-28">
        <Input type="text" className="h-8" disabled value="" placeholder="—" readOnly />
      </TableCell>
      <TableCell className="w-28">
        <Input type="text" className="h-8" disabled value="" placeholder="—" readOnly />
      </TableCell>
      <TableCell className="min-w-[200px]">
        <InvestmentDetailResourceCombobox
          value=""
          resources={resources}
          disabled={isConfirming}
          onSelect={(resourceId) => {
            void onSelectResource(resourceId);
          }}
        />
      </TableCell>
      <TableCell
        className={cn(
          "text-muted-foreground min-w-[7rem] align-top text-right text-sm tabular-nums",
          ALLOCATION_COST_CELL_INSET
        )}
      >
        —
      </TableCell>
      <TableCell className="w-36 align-top">
        <Button type="button" variant="outline" size="sm" disabled={isConfirming} onClick={onDiscard}>
          Discard
        </Button>
      </TableCell>
    </TableRow>
  );
}
