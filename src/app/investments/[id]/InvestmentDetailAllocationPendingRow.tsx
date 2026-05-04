"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { InvestmentDetailResourceCombobox } from "@/app/investments/[id]/InvestmentDetailResourceCombobox";
import {
  ALLOCATION_COST_CELL_INSET,
  UNDER_GROUP_INDENT,
} from "@/app/investments/[id]/InvestmentDetailAllocationEditor";
import { ALLOCATION_ASSIGNMENT_COL } from "@/app/investments/[id]/investment-detail-layout";
import { RESOURCE_GROUP_LABEL, type ResourceGroupKey } from "@/app/investments/[id]/investment-detail-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ResourceOption } from "@/lib/investment-types";
import { cn } from "@/lib/utils";

/** One line of label text — spacer in other columns keeps inputs aligned with the resource column. */
const FIELD_LABEL_SLOT = "min-h-[1.25rem] shrink-0";

export function InvestmentDetailAllocationPendingRow({
  resourceGroupKey,
  filteredResources,
  isConfirming,
  onSave,
  onDiscard,
}: {
  resourceGroupKey: ResourceGroupKey;
  filteredResources: ResourceOption[];
  isConfirming: boolean;
  onSave: (payload: { resourceId: string; qtyInput: string; daysInput: string }) => void | Promise<void>;
  onDiscard: () => void;
}) {
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [qty, setQty] = useState("");
  const [days, setDays] = useState("");

  const isStaff = resourceGroupKey !== "DIRECT_COST";
  const saveDisabled = !selectedResourceId.trim() || isConfirming;

  return (
    <TableRow className={UNDER_GROUP_INDENT}>
      <TableCell className={cn(ALLOCATION_ASSIGNMENT_COL, "align-top")}>
        <div className="flex flex-col gap-1.5">
          <div className={FIELD_LABEL_SLOT} aria-hidden />
          <InputGroup className="h-8 min-w-0 w-full shadow-none">
            <InputGroupInput
              type="number"
              step={isStaff ? "0.1" : "0.01"}
              min={0}
              className="h-8 min-w-0"
              disabled={isConfirming}
              title={
                isStaff
                  ? "FTE % (50 = 50% of capacity; matches DB decimal × 100)"
                  : "Quantity in units (direct cost)"
              }
              value={qty}
              placeholder={isStaff ? "e.g. 50" : "Units"}
              onChange={(e) => setQty(e.target.value)}
            />
            <InputGroupAddon
              align="inline-end"
              className="tabular-nums"
              title={isStaff ? "Percent of FTE capacity" : "Units (direct cost)"}
            >
              {isStaff ? "%" : "u."}
            </InputGroupAddon>
          </InputGroup>
        </div>
      </TableCell>
      <TableCell className={cn(ALLOCATION_ASSIGNMENT_COL, "align-top")}>
        <div className="flex flex-col gap-1.5">
          <div className={FIELD_LABEL_SLOT} aria-hidden />
          <Input
            type="number"
            step="0.1"
            min={0}
            className="h-8 w-full min-w-0"
            disabled={isConfirming}
            value={days}
            placeholder="Days"
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
      </TableCell>
      <TableCell className="min-w-[200px] align-top">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span
            className={cn(
              FIELD_LABEL_SLOT,
              "text-muted-foreground flex items-end text-xs font-medium leading-none"
            )}
          >
            {RESOURCE_GROUP_LABEL[resourceGroupKey]}
          </span>
          {filteredResources.length === 0 ? (
            <p className="text-muted-foreground text-sm">No resources of this type.</p>
          ) : (
            <InvestmentDetailResourceCombobox
              value={selectedResourceId}
              resources={filteredResources}
              disabled={isConfirming}
              onSelect={(resourceId) => setSelectedResourceId(resourceId)}
            />
          )}
        </div>
      </TableCell>
      <TableCell
        className={cn(
          "text-muted-foreground min-w-[7rem] align-top text-right text-sm tabular-nums",
          ALLOCATION_COST_CELL_INSET
        )}
      >
        <div className="flex flex-col gap-1.5">
          <div className={FIELD_LABEL_SLOT} aria-hidden />
          <span className="block h-8 leading-8">—</span>
        </div>
      </TableCell>
      <TableCell className="w-36 align-top">
        <div className="flex flex-col gap-1.5">
          <div className={FIELD_LABEL_SLOT} aria-hidden />
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              disabled={saveDisabled}
              onClick={() =>
                void onSave({
                  resourceId: selectedResourceId,
                  qtyInput: qty,
                  daysInput: days,
                })
              }
            >
              {isConfirming ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isConfirming}
              onClick={onDiscard}
            >
              Discard
            </Button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
