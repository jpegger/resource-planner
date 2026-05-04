import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  groupAllocationsByResourceType,
  patchAllocation,
  quantityFromAssignmentFieldString,
} from "@/app/investments/[id]/investment-detail-helpers";
import type {
  AllocationCostBreakdown,
  AllocationDTO,
  BudgetInitiative,
  PendingAllocationDraft,
  ResourceGroupKey,
} from "@/app/investments/[id]/investment-detail-types";

function newPendingDraftId() {
  return crypto.randomUUID();
}

export function useInitiativeAllocations(selectedYear: number) {
  const [selectedInitiative, setSelectedInitiative] = useState<BudgetInitiative | null>(null);
  const [allocations, setAllocations] = useState<AllocationDTO[]>([]);
  const [allocLoading, setAllocLoading] = useState(false);
  const [costByAllocId, setCostByAllocId] = useState<Record<string, AllocationCostBreakdown>>({});
  /** Client-only rows at the top until the user saves (POST + PATCH). */
  const [pendingAllocationDrafts, setPendingAllocationDrafts] = useState<PendingAllocationDraft[]>([]);
  const [confirmingPendingDraftId, setConfirmingPendingDraftId] = useState<string | null>(null);
  const confirmInFlightRef = useRef(false);

  useEffect(() => {
    setSelectedInitiative(null);
    setAllocations([]);
    setCostByAllocId({});
    setPendingAllocationDrafts([]);
    setConfirmingPendingDraftId(null);
    confirmInFlightRef.current = false;
  }, [selectedYear]);

  const loadCostsForInitiative = useCallback(async (jiraKey: string) => {
    const res = await fetch(
      `/api/initiative-allocation-costs?initiativeId=${encodeURIComponent(jiraKey)}`
    );
    if (!res.ok) {
      setCostByAllocId({});
      return;
    }
    const rows = (await res.json()) as Array<{
      allocation_id: string;
      internal_cost: number;
      external_cost: number;
      direct_cost: number;
      computed_cost: number;
    }>;
    const map: Record<string, AllocationCostBreakdown> = {};
    for (const r of rows) {
      map[r.allocation_id] = {
        internal: r.internal_cost,
        external: r.external_cost,
        direct: r.direct_cost,
        total: r.computed_cost,
      };
    }
    setCostByAllocId(map);
  }, []);

  const handleSelectInitiative = useCallback(
    async (ini: BudgetInitiative) => {
      setSelectedInitiative(ini);
      setPendingAllocationDrafts([]);
      setConfirmingPendingDraftId(null);
      confirmInFlightRef.current = false;
      setAllocLoading(true);
      setAllocations([]);
      setCostByAllocId({});
      try {
        const allocRes = await fetch(
          `/api/allocations?initiativeId=${encodeURIComponent(ini.jira_key)}`
        );
        if (!allocRes.ok) throw new Error("allocations");
        const list = (await allocRes.json()) as AllocationDTO[];
        setAllocations(Array.isArray(list) ? list : []);
        await loadCostsForInitiative(ini.jira_key);
      } catch {
        setAllocations([]);
      } finally {
        setAllocLoading(false);
      }
    },
    [loadCostsForInitiative]
  );

  const refreshCosts = useCallback(() => {
    if (selectedInitiative) void loadCostsForInitiative(selectedInitiative.jira_key);
  }, [selectedInitiative, loadCostsForInitiative]);

  const allocationTotals = useMemo(() => {
    let internal = 0;
    let external = 0;
    let direct = 0;
    let total = 0;
    for (const row of allocations) {
      const c = costByAllocId[row.id];
      if (c) {
        internal += c.internal;
        external += c.external;
        direct += c.direct;
        total += c.total;
      }
    }
    return { internal, external, direct, total };
  }, [allocations, costByAllocId]);

  const allocationGroupsWithRows = useMemo(
    () => groupAllocationsByResourceType(allocations).filter((g) => g.rows.length > 0),
    [allocations]
  );

  const allocationTotalsByGroup = useMemo(() => {
    const sums: Record<ResourceGroupKey, number> = {
      INTERNAL: 0,
      EXTERNAL: 0,
      DIRECT_COST: 0,
    };
    for (const row of allocations) {
      const c = costByAllocId[row.id];
      if (!c) continue;
      const t = row.resource.type;
      const key: ResourceGroupKey =
        t === "EXTERNAL" || t === "DIRECT_COST" ? t : "INTERNAL";
      if (key === "INTERNAL") sums.INTERNAL += c.internal;
      else if (key === "EXTERNAL") sums.EXTERNAL += c.external;
      else sums.DIRECT_COST += c.direct;
    }
    return sums;
  }, [allocations, costByAllocId]);

  const addAllocationDraft = useCallback((resourceGroupKey: ResourceGroupKey) => {
    if (!selectedInitiative) return;
    setPendingAllocationDrafts((prev) => [
      { clientId: newPendingDraftId(), resourceGroupKey },
      ...prev,
    ]);
  }, [selectedInitiative]);

  const removePendingAllocationDraft = useCallback((clientId: string) => {
    setPendingAllocationDrafts((prev) => prev.filter((d) => d.clientId !== clientId));
  }, []);

  const discardPendingAllocationDrafts = useCallback(() => {
    setPendingAllocationDrafts([]);
  }, []);

  const confirmPendingAllocationDraft = useCallback(
    async (
      clientId: string,
      resourceGroupKey: ResourceGroupKey,
      payload: { resourceId: string; qtyInput: string; daysInput: string }
    ) => {
      if (!selectedInitiative || confirmInFlightRef.current) return;
      const { resourceId, qtyInput, daysInput } = payload;
      if (!resourceId.trim()) {
        alert("Choose a resource.");
        return;
      }
      confirmInFlightRef.current = true;
      setConfirmingPendingDraftId(clientId);
      try {
        const res = await fetch("/api/allocations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            initiativeId: selectedInitiative.jira_key,
            resourceId: resourceId.trim(),
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          alert((j as { error?: string }).error ?? "Could not create allocation");
          return;
        }
        const created = (await res.json()) as AllocationDTO;
        const rt = created.resource.type;
        const key: ResourceGroupKey =
          rt === "EXTERNAL" || rt === "DIRECT_COST" ? rt : "INTERNAL";
        if (key !== resourceGroupKey) {
          alert("Resource type does not match the selected category.");
          return;
        }
        const n = qtyInput.trim() === "" ? null : parseFloat(qtyInput);
        if (n !== null && Number.isNaN(n)) {
          alert("Invalid FTE % / units.");
          return;
        }
        const quantity = quantityFromAssignmentFieldString(rt, n);
        const manDaysParsed = daysInput.trim() === "" ? null : parseFloat(daysInput);
        if (manDaysParsed !== null && Number.isNaN(manDaysParsed)) {
          alert("Invalid man days.");
          return;
        }
        let updated: AllocationDTO;
        try {
          updated = await patchAllocation(created.id, {
            quantity,
            manDays: manDaysParsed,
          });
        } catch (patchErr) {
          await fetch(`/api/allocations/${encodeURIComponent(created.id)}`, { method: "DELETE" }).catch(
            () => undefined
          );
          throw patchErr;
        }
        setPendingAllocationDrafts((prev) => prev.filter((d) => d.clientId !== clientId));
        setAllocations((prev) => [...prev, updated]);
        void loadCostsForInitiative(selectedInitiative.jira_key);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Could not save allocation");
      } finally {
        confirmInFlightRef.current = false;
        setConfirmingPendingDraftId(null);
      }
    },
    [selectedInitiative, loadCostsForInitiative]
  );

  const onPatchedAllocation = useCallback((u: AllocationDTO) => {
    setAllocations((prev) => prev.map((a) => (a.id === u.id ? u : a)));
  }, []);

  const onDeletedAllocation = useCallback((id: string) => {
    setAllocations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return {
    selectedInitiative,
    allocations,
    allocLoading,
    costByAllocId,
    handleSelectInitiative,
    refreshCosts,
    addAllocationDraft,
    pendingAllocationDrafts,
    removePendingAllocationDraft,
    discardPendingAllocationDrafts,
    confirmPendingAllocationDraft,
    confirmingPendingDraftId,
    allocationTotals,
    allocationGroupsWithRows,
    allocationTotalsByGroup,
    onPatchedAllocation,
    onDeletedAllocation,
  };
}
