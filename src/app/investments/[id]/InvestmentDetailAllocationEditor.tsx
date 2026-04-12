"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { InvestmentDetailResourceCombobox } from "@/app/investments/[id]/InvestmentDetailResourceCombobox";
import {
  assignmentFieldStringFromQuantity,
  costAmountForResourceType,
  formatK,
  patchAllocation,
  quantityFromAssignmentFieldString,
} from "@/app/investments/[id]/investment-detail-helpers";
import type {
  AllocationCostBreakdown,
  AllocationDTO,
} from "@/app/investments/[id]/investment-detail-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ResourceOption } from "@/lib/investment-types";
import { cn } from "@/lib/utils";

/** Left inset for allocation rows under group headers (group label row stays flush left). */
export const UNDER_GROUP_INDENT = "[&_td:first-child]:pl-10";

/** Same inset on the cost column so amounts sit toward the center, not on the table edge. */
export const ALLOCATION_COST_CELL_INSET = "pr-34";

/** Slightly less right padding than row costs so the group subtotal sits a bit further right. */
export const GROUP_SUBTOTAL_COST_INSET = "pr-12";

export function InvestmentDetailAllocationEditor({
  row,
  resources,
  costBreakdown,
  editing,
  onPatched,
  onDeleted,
  onCostsStale,
}: {
  row: AllocationDTO;
  resources: ResourceOption[];
  costBreakdown: AllocationCostBreakdown | undefined;
  editing: boolean;
  onPatched: (u: AllocationDTO) => void;
  onDeleted: () => void;
  onCostsStale: () => void;
}) {
  const [qty, setQty] = useState<string>(() =>
    assignmentFieldStringFromQuantity(row.resource.type, row.quantity)
  );
  const [days, setDays] = useState<string>(() =>
    row.manDays === null || row.manDays === undefined ? "" : String(row.manDays)
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setQty(assignmentFieldStringFromQuantity(row.resource.type, row.quantity));
    setDays(row.manDays === null || row.manDays === undefined ? "" : String(row.manDays));
  }, [row.id, row.quantity, row.manDays, row.resource.type, row.resourceId]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const schedulePatch = (patch: Record<string, unknown>) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void (async () => {
        setSaving(true);
        setErr(null);
        try {
          const updated = await patchAllocation(row.id, patch);
          onPatched(updated);
          onCostsStale();
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Save failed");
        } finally {
          setSaving(false);
        }
      })();
    }, 450);
  };

  const typeCost = costAmountForResourceType(row.resource.type, costBreakdown);
  const resType = row.resource.type;
  const isStaff = resType === "INTERNAL" || resType === "EXTERNAL";

  const qtyDisplay = assignmentFieldStringFromQuantity(row.resource.type, row.quantity);
  const daysDisplay =
    row.manDays === null || row.manDays === undefined ? "—" : String(row.manDays);

  if (!editing) {
    return (
      <TableRow className={cn("hover:bg-muted/30", UNDER_GROUP_INDENT)}>
        <TableCell className="text-foreground w-28 text-sm tabular-nums">{qtyDisplay}</TableCell>
        <TableCell className="text-foreground w-28 text-sm tabular-nums">{daysDisplay}</TableCell>
        <TableCell className="text-foreground min-w-[200px] text-sm">{row.resource.fullName}</TableCell>
        <TableCell
          className={cn(
            "text-foreground min-w-[7rem] text-right text-sm font-normal tabular-nums",
            ALLOCATION_COST_CELL_INSET
          )}
        >
          {typeCost !== undefined ? formatK(typeCost) : "—"}
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className={UNDER_GROUP_INDENT}>
      <TableCell className="w-28">
        <Input
          type="number"
          step={isStaff ? "0.1" : "0.01"}
          min={0}
          className="h-8"
          title={
            isStaff
              ? "FTE % (50 = 50% of capacity; matches DB decimal × 100)"
              : "Quantity in units (direct cost)"
          }
          value={qty}
          onChange={(e) => {
            const v = e.target.value;
            setQty(v);
            const n = v === "" ? null : parseFloat(v);
            if (v !== "" && Number.isNaN(n!)) return;
            schedulePatch({
              quantity: quantityFromAssignmentFieldString(resType, n),
            });
          }}
        />
      </TableCell>
      <TableCell className="w-28">
        <Input
          type="number"
          step="0.1"
          min={0}
          className="h-8"
          value={days}
          onChange={(e) => {
            const v = e.target.value;
            setDays(v);
            const n = v === "" ? null : parseFloat(v);
            if (v !== "" && Number.isNaN(n!)) return;
            schedulePatch({ manDays: n });
          }}
        />
      </TableCell>
      <TableCell className="min-w-[200px]">
        <InvestmentDetailResourceCombobox
          value={row.resourceId}
          resources={resources}
          onSelect={async (resourceId) => {
            setSaving(true);
            setErr(null);
            try {
              const updated = await patchAllocation(row.id, { resourceId });
              onPatched(updated);
              onCostsStale();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Save failed");
            } finally {
              setSaving(false);
            }
          }}
        />
      </TableCell>
      <TableCell className="text-foreground min-w-[7rem] align-top text-right text-sm tabular-nums">
        {typeCost !== undefined ? formatK(typeCost) : "—"}
      </TableCell>
      <TableCell className="w-36 align-top">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {saving ? <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" /> : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleting}
              aria-label="Delete allocation"
              onClick={async () => {
                setDeleting(true);
                setErr(null);
                try {
                  const res = await fetch(`/api/allocations/${encodeURIComponent(row.id)}`, {
                    method: "DELETE",
                  });
                  if (!res.ok) throw new Error("Delete failed");
                  onDeleted();
                  onCostsStale();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Delete failed");
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          </div>
          {err ? <p className="text-destructive max-w-[140px] text-xs leading-tight">{err}</p> : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
