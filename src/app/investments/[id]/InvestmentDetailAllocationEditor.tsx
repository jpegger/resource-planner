"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { InvestmentDetailResourceCombobox } from "@/app/investments/[id]/InvestmentDetailResourceCombobox";
import {
  FINANCIALS_PILL,
} from "@/app/investments/[id]/investment-detail-layout";
import {
  costAmountForResourceType,
  formatK,
  patchAllocation,
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

export function InvestmentDetailAllocationEditor({
  row,
  resources,
  costBreakdown,
  onPatched,
  onDeleted,
  onCostsStale,
}: {
  row: AllocationDTO;
  resources: ResourceOption[];
  costBreakdown: AllocationCostBreakdown | undefined;
  onPatched: (u: AllocationDTO) => void;
  onDeleted: () => void;
  onCostsStale: () => void;
}) {
  const [qty, setQty] = useState<string>(() =>
    row.quantity === null || row.quantity === undefined ? "" : String(row.quantity)
  );
  const [days, setDays] = useState<string>(() =>
    row.manDays === null || row.manDays === undefined ? "" : String(row.manDays)
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setQty(row.quantity === null || row.quantity === undefined ? "" : String(row.quantity));
    setDays(row.manDays === null || row.manDays === undefined ? "" : String(row.manDays));
  }, [row.id, row.quantity, row.manDays]);

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

  return (
    <TableRow>
      <TableCell className="w-28">
        <Input
          type="number"
          step="0.01"
          min={0}
          className="h-8"
          value={qty}
          onChange={(e) => {
            const v = e.target.value;
            setQty(v);
            const n = v === "" ? null : parseFloat(v);
            if (v !== "" && Number.isNaN(n!)) return;
            schedulePatch({ quantity: n });
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
      <TableCell className="min-w-[7rem] align-top text-right">
        <div
          className={cn(
            FINANCIALS_PILL,
            "inline-flex min-w-[6.5rem] justify-end tabular-nums text-[color:var(--primary-blue)]"
          )}
        >
          {typeCost !== undefined ? formatK(typeCost) : "—"}
        </div>
      </TableCell>
      <TableCell className="w-36 align-top">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {saving ? <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" /> : null}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleting}
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
              Delete
            </Button>
          </div>
          {err ? <p className="text-destructive max-w-[140px] text-xs leading-tight">{err}</p> : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
