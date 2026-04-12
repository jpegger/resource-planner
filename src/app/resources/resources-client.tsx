"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";

import { InvestmentDetailFieldReadonly } from "@/app/investments/[id]/InvestmentDetailFieldReadonly";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { RESOURCE_DIRECTION_VALUES, isResourceDirection } from "@/lib/resource-direction";
import { resourceFullNameFromParts } from "@/lib/resource-display-name";
import { cn, distinctSortedStrings } from "@/lib/utils";

export type ResourceRateDTO = {
  id: string;
  year: number;
  dailyRate: number;
  nbrDaysPerYear: number;
};

export type ResourceRowDTO = {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  function: string | null;
  cellule: string | null;
  direction: string | null;
  type: "INTERNAL" | "EXTERNAL" | "DIRECT_COST";
  rates: ResourceRateDTO[];
};

type Props = {
  resources: ResourceRowDTO[];
};

const ALL = "all";

function typeBadgeClass(t: ResourceRowDTO["type"]) {
  switch (t) {
    case "INTERNAL":
      return "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-50";
    case "EXTERNAL":
      return "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50";
    default:
      return "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-50";
  }
}

function typeLabel(t: ResourceRowDTO["type"]) {
  switch (t) {
    case "INTERNAL":
      return "Internal";
    case "EXTERNAL":
      return "External";
    default:
      return "Direct cost";
  }
}

function mapApiResourceToRow(r: {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  function: string | null;
  cellule: string | null;
  direction: string | null;
  type: ResourceRowDTO["type"];
  rates: Array<{ id: string; year: number; dailyRate: number; nbrDaysPerYear: number }>;
}): ResourceRowDTO {
  return {
    id: r.id,
    fullName: r.fullName,
    firstName: r.firstName,
    lastName: r.lastName,
    function: r.function,
    cellule: r.cellule,
    direction: r.direction,
    type: r.type,
    rates: r.rates.map((rate) => ({
      id: rate.id,
      year: rate.year,
      dailyRate: rate.dailyRate,
      nbrDaysPerYear: rate.nbrDaysPerYear,
    })),
  };
}

type DetailDraft = {
  /** Cached computed display name (Prénom + Nom); kept in sync when first/last change. */
  fullName: string;
  firstName: string;
  lastName: string;
  function: string;
  cellule: string;
  direction: string;
  type: ResourceRowDTO["type"];
};

function recomputeDraftFullName(d: DetailDraft): DetailDraft {
  return {
    ...d,
    fullName: resourceFullNameFromParts(d.firstName, d.lastName),
  };
}

function DetailFieldInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </div>
  );
}

export function ResourcesPageClient({ resources: initialResources }: Props) {
  const [resourceRows, setResourceRows] = useState<ResourceRowDTO[]>(initialResources);
  useEffect(() => {
    setResourceRows(initialResources);
  }, [initialResources]);

  const [search, setSearch] = useState("");
  const [cellFilter, setCellFilter] = useState<string>(ALL);
  const [directionFilter, setDirectionFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cellules = useMemo(
    () => distinctSortedStrings(resourceRows.map((r) => r.cellule)),
    [resourceRows]
  );

  const directions = useMemo(
    () => distinctSortedStrings(resourceRows.map((r) => r.direction)),
    [resourceRows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resourceRows.filter((r) => {
      if (typeFilter !== ALL && r.type !== typeFilter) return false;
      if (cellFilter !== ALL && (r.cellule?.trim() ?? "") !== cellFilter) return false;
      if (directionFilter !== ALL && (r.direction?.trim() ?? "") !== directionFilter) return false;
      if (!q) return true;
      const displayName = resourceFullNameFromParts(r.firstName, r.lastName) || r.fullName;
      const hay = [
        r.id,
        displayName,
        r.fullName,
        r.firstName ?? "",
        r.lastName ?? "",
        r.function ?? "",
        r.cellule ?? "",
        r.direction ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [resourceRows, search, cellFilter, directionFilter, typeFilter]);

  const selected = useMemo(
    () => (selectedId ? resourceRows.find((r) => r.id === selectedId) ?? null : null),
    [resourceRows, selectedId]
  );

  const [detailDraft, setDetailDraft] = useState<DetailDraft | null>(null);
  type RateEdit = { dailyRate: string; nbrDaysPerYear: string };
  const [rateEdits, setRateEdits] = useState<Record<string, RateEdit>>({});
  const lastInitForResourceId = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setDetailDraft(null);
      setRateEdits({});
      lastInitForResourceId.current = null;
      return;
    }
    if (lastInitForResourceId.current === selectedId) return;
    lastInitForResourceId.current = selectedId;
    const row = resourceRows.find((r) => r.id === selectedId);
    if (!row) return;
    setDetailDraft(
      recomputeDraftFullName({
        fullName: "",
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? "",
        function: row.function ?? "",
        cellule: row.cellule ?? "",
        direction: row.direction ?? "",
        type: row.type,
      })
    );
    setRateEdits(
      Object.fromEntries(
        row.rates.map((r) => [
          r.id,
          { dailyRate: String(r.dailyRate), nbrDaysPerYear: String(r.nbrDaysPerYear) },
        ])
      )
    );
  }, [selectedId, resourceRows]);

  const [editingDetails, setEditingDetails] = useState(false);
  const [editingRates, setEditingRates] = useState(false);

  useEffect(() => {
    setEditingDetails(false);
    setEditingRates(false);
  }, [selectedId]);

  const [savingDetails, setSavingDetails] = useState(false);
  const [savingRateId, setSavingRateId] = useState<string | null>(null);
  const [deletingRateId, setDeletingRateId] = useState<string | null>(null);
  const [pendingDeleteRateId, setPendingDeleteRateId] = useState<string | null>(null);

  const rateEditsRef = useRef(rateEdits);
  rateEditsRef.current = rateEdits;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const editingRatesRef = useRef(editingRates);
  editingRatesRef.current = editingRates;
  const rateSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});

  useEffect(() => {
    return () => {
      for (const t of Object.values(rateSaveTimersRef.current)) {
        if (t) clearTimeout(t);
      }
    };
  }, []);

  useEffect(() => {
    if (!editingRates) {
      for (const t of Object.values(rateSaveTimersRef.current)) {
        if (t) clearTimeout(t);
      }
      rateSaveTimersRef.current = {};
    }
  }, [editingRates]);
  const [newRateDraft, setNewRateDraft] = useState({ year: "", dailyRate: "", nbrDaysPerYear: "" });
  const [savingNewRate, setSavingNewRate] = useState(false);
  /** Draft row is shown only after clicking "+ Add rate" (not always visible). */
  const [addingNewRate, setAddingNewRate] = useState(false);

  useEffect(() => {
    if (!editingRates) {
      setNewRateDraft({ year: "", dailyRate: "", nbrDaysPerYear: "" });
      setAddingNewRate(false);
      setPendingDeleteRateId(null);
    }
  }, [editingRates]);

  useEffect(() => {
    setNewRateDraft({ year: "", dailyRate: "", nbrDaysPerYear: "" });
    setAddingNewRate(false);
    setPendingDeleteRateId(null);
  }, [selected?.id]);

  useEffect(() => {
    if (!addingNewRate || !editingRates) return;
    const t = window.setTimeout(() => {
      document.getElementById("new-rate-year")?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [addingNewRate, editingRates]);

  const cancelEditDetails = useCallback(() => {
    if (!selected) return;
    setDetailDraft(
      recomputeDraftFullName({
        fullName: "",
        firstName: selected.firstName ?? "",
        lastName: selected.lastName ?? "",
        function: selected.function ?? "",
        cellule: selected.cellule ?? "",
        direction: selected.direction ?? "",
        type: selected.type,
      })
    );
    setEditingDetails(false);
  }, [selected]);

  const cancelEditRates = useCallback(() => {
    if (!selected) return;
    setRateEdits(
      Object.fromEntries(
        selected.rates.map((r) => [
          r.id,
          { dailyRate: String(r.dailyRate), nbrDaysPerYear: String(r.nbrDaysPerYear) },
        ])
      )
    );
    setNewRateDraft({ year: "", dailyRate: "", nbrDaysPerYear: "" });
    setAddingNewRate(false);
    setPendingDeleteRateId(null);
    setEditingRates(false);
  }, [selected]);

  useEffect(() => {
    if (editingRates || !selected) return;
    setRateEdits(
      Object.fromEntries(
        selected.rates.map((r) => [
          r.id,
          { dailyRate: String(r.dailyRate), nbrDaysPerYear: String(r.nbrDaysPerYear) },
        ])
      )
    );
  }, [editingRates, selected]);

  const saveDetails = useCallback(async () => {
    if (!selected || !detailDraft) return;
    const display = resourceFullNameFromParts(detailDraft.firstName, detailDraft.lastName);
    if (!display.trim()) {
      alert("Set at least first name or last name so the display name is not empty.");
      return;
    }
    const dirTrim = detailDraft.direction.trim();
    if (dirTrim && !isResourceDirection(dirTrim)) {
      alert('Direction must be CRPS or PDS (clear the field or pick a value).');
      return;
    }
    setSavingDetails(true);
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: detailDraft.firstName.trim() || null,
          lastName: detailDraft.lastName.trim() || null,
          function: detailDraft.function.trim() || null,
          cellule: detailDraft.cellule.trim() || null,
          direction: dirTrim || null,
          type: detailDraft.type,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(j.error ?? "Could not save resource");
        return;
      }
      const updated = j as Parameters<typeof mapApiResourceToRow>[0];
      const mapped = mapApiResourceToRow(updated);
      setResourceRows((prev) => prev.map((r) => (r.id === mapped.id ? mapped : r)));
      setDetailDraft(
        recomputeDraftFullName({
          fullName: "",
          firstName: mapped.firstName ?? "",
          lastName: mapped.lastName ?? "",
          function: mapped.function ?? "",
          cellule: mapped.cellule ?? "",
          direction: mapped.direction ?? "",
          type: mapped.type,
        })
      );
      setEditingDetails(false);
    } finally {
      setSavingDetails(false);
    }
  }, [selected, detailDraft]);

  const saveRate = useCallback(async (rateId: string) => {
    if (!editingRatesRef.current || !selectedRef.current) return;
    const sel = selectedRef.current;
    const edit = rateEditsRef.current[rateId];
    if (!edit) return;
    const dailyRate = Number(edit.dailyRate.replace(",", "."));
    const nbrDaysPerYear = Number(edit.nbrDaysPerYear.replace(",", "."));
    if (!Number.isFinite(dailyRate) || !Number.isFinite(nbrDaysPerYear)) {
      return;
    }
    const server = sel.rates.find((r) => r.id === rateId);
    if (
      server &&
      dailyRate === server.dailyRate &&
      nbrDaysPerYear === server.nbrDaysPerYear
    ) {
      return;
    }
    setSavingRateId(rateId);
    try {
      const res = await fetch(`/api/rates/${encodeURIComponent(rateId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyRate, nbrDaysPerYear }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        dailyRate?: number;
        nbrDaysPerYear?: number;
      };
      if (!res.ok) {
        alert(j.error ?? "Could not save rate");
        return;
      }
      setResourceRows((prev) =>
        prev.map((r) => {
          if (r.id !== sel.id) return r;
          return {
            ...r,
            rates: r.rates.map((x) =>
              x.id === rateId
                ? {
                    ...x,
                    dailyRate: j.dailyRate ?? dailyRate,
                    nbrDaysPerYear: j.nbrDaysPerYear ?? nbrDaysPerYear,
                  }
                : x
            ),
          };
        })
      );
      setRateEdits((prev) => ({
        ...prev,
        [rateId]: {
          dailyRate: String(j.dailyRate ?? dailyRate),
          nbrDaysPerYear: String(j.nbrDaysPerYear ?? nbrDaysPerYear),
        },
      }));
    } finally {
      setSavingRateId(null);
    }
  }, []);

  const scheduleRateAutoSave = useCallback((rateId: string) => {
    const prev = rateSaveTimersRef.current[rateId];
    if (prev) clearTimeout(prev);
    rateSaveTimersRef.current[rateId] = setTimeout(() => {
      rateSaveTimersRef.current[rateId] = undefined;
      void saveRate(rateId);
    }, 450);
  }, [saveRate]);

  const deleteRate = useCallback(
    async (rateId: string) => {
      if (!editingRates || !selected) return;
      setDeletingRateId(rateId);
      try {
        const res = await fetch(`/api/rates/${encodeURIComponent(rateId)}`, { method: "DELETE" });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          alert(j.error ?? "Could not delete rate");
          return;
        }
        setResourceRows((prev) =>
          prev.map((r) =>
            r.id === selected.id
              ? { ...r, rates: r.rates.filter((x) => x.id !== rateId) }
              : r
          )
        );
        setRateEdits((prev) => {
          const next = { ...prev };
          delete next[rateId];
          return next;
        });
      } finally {
        setDeletingRateId(null);
      }
    },
    [editingRates, selected]
  );

  const saveNewRate = useCallback(async () => {
    if (!editingRates || !selected) return;
    const year = Number.parseInt(String(newRateDraft.year).trim(), 10);
    const dailyRate = Number(String(newRateDraft.dailyRate).replace(",", "."));
    const nbrDaysPerYear = Number(String(newRateDraft.nbrDaysPerYear).replace(",", "."));
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      alert("Enter a valid year.");
      return;
    }
    if (!Number.isFinite(dailyRate) || !Number.isFinite(nbrDaysPerYear)) {
      alert("Daily rate and days per year must be valid numbers.");
      return;
    }
    setSavingNewRate(true);
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(selected.id)}/rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, dailyRate, nbrDaysPerYear }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        year?: number;
        dailyRate?: number;
        nbrDaysPerYear?: number;
      };
      if (!res.ok) {
        alert(j.error ?? "Could not add rate");
        return;
      }
      const created: ResourceRateDTO = {
        id: String(j.id),
        year: j.year ?? year,
        dailyRate: j.dailyRate ?? dailyRate,
        nbrDaysPerYear: j.nbrDaysPerYear ?? nbrDaysPerYear,
      };
      setResourceRows((prev) =>
        prev.map((r) => {
          if (r.id !== selected.id) return r;
          const nextRates = [...r.rates, created].sort((a, b) => b.year - a.year);
          return { ...r, rates: nextRates };
        })
      );
      setRateEdits((prev) => ({
        ...prev,
        [created.id]: {
          dailyRate: String(created.dailyRate),
          nbrDaysPerYear: String(created.nbrDaysPerYear),
        },
      }));
      setNewRateDraft({ year: "", dailyRate: "", nbrDaysPerYear: "" });
      setAddingNewRate(false);
    } finally {
      setSavingNewRate(false);
    }
  }, [editingRates, selected, newRateDraft]);

  const resetFilters = () => {
    setSearch("");
    setCellFilter(ALL);
    setDirectionFilter(ALL);
    setTypeFilter(ALL);
  };

  const pendingDeleteYear = useMemo(() => {
    if (!pendingDeleteRateId || !selected) return null;
    return selected.rates.find((r) => r.id === pendingDeleteRateId)?.year ?? null;
  }, [pendingDeleteRateId, selected]);

  const directionTrim = detailDraft?.direction.trim() ?? "";
  const directionLegacy =
    directionTrim && !isResourceDirection(directionTrim) ? directionTrim : null;
  const directionSelectValue =
    directionTrim === "CRPS" || directionTrim === "PDS" ? directionTrim : "__none__";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-foreground text-lg font-semibold">Resources</h1>
        <p className="text-muted-foreground text-sm">People and direct-cost items available for allocation.</p>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <aside className="bg-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border">
          <div className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-3">
            <Input
              placeholder="Search name, id, function…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 min-w-[min(100%,12rem)] flex-1"
            />
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? ALL)}>
              <SelectTrigger size="sm" className="w-[130px] shrink-0">
                <SelectValue placeholder="all types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>all types</SelectItem>
                <SelectItem value="INTERNAL">Internal</SelectItem>
                <SelectItem value="EXTERNAL">External</SelectItem>
                <SelectItem value="DIRECT_COST">Direct cost</SelectItem>
              </SelectContent>
            </Select>
            <Select value={cellFilter} onValueChange={(v) => setCellFilter(v ?? ALL)}>
              <SelectTrigger size="sm" className="min-w-[120px] max-w-[160px] shrink-0">
                <SelectValue placeholder="all cells" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>all cells</SelectItem>
                {cellules.map((c) => (
                  <SelectItem key={c} value={c}>
                    <span className="line-clamp-1">{c}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={(v) => setDirectionFilter(v ?? ALL)}>
              <SelectTrigger size="sm" className="min-w-[120px] max-w-[180px] shrink-0">
                <SelectValue placeholder="all directions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>all directions</SelectItem>
                {directions.map((d) => (
                  <SelectItem key={d} value={d}>
                    <span className="line-clamp-1">{d}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={resetFilters}>
              <RotateCcw className="size-4" />
              Reset filters
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <Table>
              <TableHeader className="bg-muted/40 [&_tr]:border-border">
                <TableRow>
                  <TableHead className="w-[100px]">ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="max-w-[100px]">Function</TableHead>
                  <TableHead className="w-[88px]">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    className={cn("cursor-pointer", selectedId === r.id && "bg-[#e8f0fa]")}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <TableCell className="font-mono text-xs">{r.id}</TableCell>
                    <TableCell className="max-w-[160px] whitespace-normal">
                      <span
                        className="line-clamp-2"
                        title={resourceFullNameFromParts(r.firstName, r.lastName) || r.fullName}
                      >
                        {resourceFullNameFromParts(r.firstName, r.lastName) || r.fullName}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[100px] truncate text-xs" title={r.function ?? ""}>
                      {r.function ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-xs font-normal", typeBadgeClass(r.type))}>
                        {typeLabel(r.type)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length === 0 ? (
              <p className="text-muted-foreground p-4 text-center text-sm">No resources match.</p>
            ) : null}
          </ScrollArea>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-auto">
          {!selected ? (
            <div
              className={cn(
                PANEL_CARD_CLASS,
                "text-muted-foreground flex h-full min-h-[200px] items-center justify-center rounded-xl p-6 text-sm"
              )}
            >
              Choose a resource from the list.
            </div>
          ) : detailDraft ? (
            <div className="flex min-h-0 flex-col gap-4">
              <Card className={PANEL_CARD_CLASS}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                      {editingDetails && detailDraft ? (
                        <div className="min-w-0 max-w-md flex-1 space-y-1.5">
                          <p className="text-muted-foreground text-xs">Display name</p>
                          <p className="text-base font-medium leading-snug">
                            {resourceFullNameFromParts(detailDraft.firstName, detailDraft.lastName) || "—"}
                          </p>
                        </div>
                      ) : (
                        <CardTitle className="text-base">
                          {resourceFullNameFromParts(selected.firstName, selected.lastName) ||
                            selected.fullName}
                        </CardTitle>
                      )}
                      <div className="flex flex-wrap items-center gap-2 pb-0.5">
                        <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                          {selected.id}
                        </Badge>
                        {editingDetails && detailDraft ? (
                          <Badge
                            variant="outline"
                            className={cn("shrink-0 text-xs font-normal", typeBadgeClass(detailDraft.type))}
                          >
                            {typeLabel(detailDraft.type)}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className={cn("shrink-0 text-xs font-normal", typeBadgeClass(selected.type))}
                          >
                            {typeLabel(selected.type)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {!editingDetails ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!selected) return;
                            setDetailDraft(
                              recomputeDraftFullName({
                                fullName: "",
                                firstName: selected.firstName ?? "",
                                lastName: selected.lastName ?? "",
                                function: selected.function ?? "",
                                cellule: selected.cellule ?? "",
                                direction: selected.direction ?? "",
                                type: selected.type,
                              })
                            );
                            setEditingDetails(true);
                          }}
                        >
                          Edit
                        </Button>
                      ) : (
                        <>
                          <Button type="button" size="sm" variant="outline" onClick={cancelEditDetails}>
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void saveDetails()}
                            disabled={savingDetails}
                          >
                            {savingDetails ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                            Save details
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {!editingDetails ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <InvestmentDetailFieldReadonly label="First name" value={selected.firstName ?? ""} />
                      <InvestmentDetailFieldReadonly label="Last name" value={selected.lastName ?? ""} />
                      <InvestmentDetailFieldReadonly label="Function" value={selected.function ?? ""} />
                      <InvestmentDetailFieldReadonly label="Cell" value={selected.cellule ?? ""} />
                      <InvestmentDetailFieldReadonly label="Direction" value={selected.direction ?? ""} />
                      <InvestmentDetailFieldReadonly label="Type" value={typeLabel(selected.type)} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <DetailFieldInput
                        id="res-firstName"
                        label="First name (Prénom)"
                        value={detailDraft.firstName}
                        onChange={(v) =>
                          setDetailDraft((d) => (d ? recomputeDraftFullName({ ...d, firstName: v }) : d))
                        }
                      />
                      <DetailFieldInput
                        id="res-lastName"
                        label="Last name (Nom)"
                        value={detailDraft.lastName}
                        onChange={(v) =>
                          setDetailDraft((d) => (d ? recomputeDraftFullName({ ...d, lastName: v }) : d))
                        }
                      />
                      <DetailFieldInput
                        id="res-function"
                        label="Function"
                        value={detailDraft.function}
                        onChange={(v) => setDetailDraft((d) => (d ? { ...d, function: v } : d))}
                      />
                      <DetailFieldInput
                        id="res-cellule"
                        label="Cell"
                        value={detailDraft.cellule}
                        onChange={(v) => setDetailDraft((d) => (d ? { ...d, cellule: v } : d))}
                      />
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground text-xs" htmlFor="res-direction">
                          Direction
                        </Label>
                        {directionLegacy ? (
                          <p className="text-muted-foreground text-xs">
                            Imported &quot;{directionLegacy}&quot; is not allowed — choose CRPS or PDS.
                          </p>
                        ) : null}
                        <Select
                          value={directionSelectValue}
                          onValueChange={(v) =>
                            setDetailDraft((d) => {
                              if (!d) return d;
                              if (v === "__none__") return { ...d, direction: "" };
                              if (v === "CRPS" || v === "PDS") return { ...d, direction: v };
                              return d;
                            })
                          }
                        >
                          <SelectTrigger id="res-direction" className="h-9 w-full">
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">—</SelectItem>
                            {RESOURCE_DIRECTION_VALUES.map((dir) => (
                              <SelectItem key={dir} value={dir}>
                                {dir}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-muted-foreground text-xs">Type</Label>
                        <Select
                          value={detailDraft.type}
                          onValueChange={(v) =>
                            setDetailDraft((d) =>
                              d && (v === "INTERNAL" || v === "EXTERNAL" || v === "DIRECT_COST")
                                ? { ...d, type: v }
                                : d
                            )
                          }
                        >
                          <SelectTrigger className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="INTERNAL">Internal</SelectItem>
                            <SelectItem value="EXTERNAL">External</SelectItem>
                            <SelectItem value="DIRECT_COST">Direct cost</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={PANEL_CARD_CLASS}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">Daily rates by year</CardTitle>
                    <div className="flex shrink-0 gap-2">
                      {!editingRates ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!selected) return;
                            setRateEdits(
                              Object.fromEntries(
                                selected.rates.map((r) => [
                                  r.id,
                                  {
                                    dailyRate: String(r.dailyRate),
                                    nbrDaysPerYear: String(r.nbrDaysPerYear),
                                  },
                                ])
                              )
                            );
                            setNewRateDraft({ year: "", dailyRate: "", nbrDaysPerYear: "" });
                            setAddingNewRate(false);
                            setEditingRates(true);
                          }}
                        >
                          Edit rates
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" onClick={cancelEditRates}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {selected.rates.length === 0 && !editingRates ? (
                    <p className="text-muted-foreground text-sm">No rate rows for this resource.</p>
                  ) : (
                    <>
                      <Table>
                        <TableHeader className="bg-muted/40 [&_tr]:border-border">
                          <TableRow>
                            <TableHead className="w-20 text-right">Year</TableHead>
                            <TableHead className="text-right">Daily rate (EUR)</TableHead>
                            <TableHead className="text-right">Days / year</TableHead>
                            {editingRates ? (
                              <TableHead className="w-[120px] min-w-[120px] text-right" />
                            ) : null}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {editingRates && !addingNewRate ? (
                            <TableRow className="hover:bg-transparent">
                              <TableCell className="py-2" />
                              <TableCell className="py-2" />
                              <TableCell className="py-2" />
                              <TableCell className="py-2 text-right">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5"
                                  onClick={() => {
                                    setNewRateDraft({ year: "", dailyRate: "", nbrDaysPerYear: "" });
                                    setAddingNewRate(true);
                                  }}
                                >
                                  <Plus className="size-3.5" />
                                  Add rate
                                </Button>
                              </TableCell>
                            </TableRow>
                          ) : null}
                          {editingRates && addingNewRate ? (
                            <TableRow className="border-border/80 bg-muted/45 hover:bg-muted/45 border-y border-dashed shadow-[inset_0_1px_0_0_hsl(var(--border))]">
                              <TableCell className="py-2.5 text-right align-middle">
                                <div className="flex justify-end">
                                  <Input
                                    id="new-rate-year"
                                    className="h-8 w-[88px] text-right tabular-nums"
                                    inputMode="numeric"
                                    placeholder="Year"
                                    value={newRateDraft.year}
                                    onChange={(e) =>
                                      setNewRateDraft((d) => ({ ...d, year: e.target.value }))
                                    }
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="py-2.5 text-right align-middle">
                                <div className="flex justify-end">
                                  <Input
                                    id="new-rate-daily"
                                    className="h-8 max-w-[140px] text-right tabular-nums"
                                    placeholder="Daily (EUR)"
                                    value={newRateDraft.dailyRate}
                                    onChange={(e) =>
                                      setNewRateDraft((d) => ({ ...d, dailyRate: e.target.value }))
                                    }
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="py-2.5 text-right align-middle">
                                <div className="flex justify-end">
                                  <Input
                                    id="new-rate-days"
                                    className="h-8 max-w-[100px] text-right tabular-nums"
                                    placeholder="Days / yr"
                                    value={newRateDraft.nbrDaysPerYear}
                                    onChange={(e) =>
                                      setNewRateDraft((d) => ({ ...d, nbrDaysPerYear: e.target.value }))
                                    }
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="py-2.5 text-right align-middle">
                                <div className="flex flex-nowrap items-center justify-end gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="text-muted-foreground shrink-0"
                                    disabled={savingNewRate}
                                    onClick={() => {
                                      setNewRateDraft({ year: "", dailyRate: "", nbrDaysPerYear: "" });
                                      setAddingNewRate(false);
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="default"
                                    className="shrink-0"
                                    disabled={savingNewRate}
                                    onClick={() => void saveNewRate()}
                                  >
                                    {savingNewRate ? (
                                      <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                      "Save"
                                    )}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                          {selected.rates.map((rate) => {
                              const edit = rateEdits[rate.id] ?? {
                                dailyRate: String(rate.dailyRate),
                                nbrDaysPerYear: String(rate.nbrDaysPerYear),
                              };
                              return (
                                <TableRow key={rate.id}>
                                  <TableCell className="text-right tabular-nums">{rate.year}</TableCell>
                                  {!editingRates ? (
                                    <>
                                      <TableCell className="text-right tabular-nums">{rate.dailyRate}</TableCell>
                                      <TableCell className="text-right tabular-nums">{rate.nbrDaysPerYear}</TableCell>
                                    </>
                                  ) : (
                                    <>
                                      <TableCell className="text-right align-middle">
                                        <div className="flex justify-end">
                                          <Input
                                            className="h-8 max-w-[140px] text-right tabular-nums"
                                            value={edit.dailyRate}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setRateEdits((prev) => ({
                                                ...prev,
                                                [rate.id]: {
                                                  ...(prev[rate.id] ?? {
                                                    dailyRate: String(rate.dailyRate),
                                                    nbrDaysPerYear: String(rate.nbrDaysPerYear),
                                                  }),
                                                  dailyRate: v,
                                                },
                                              }));
                                              scheduleRateAutoSave(rate.id);
                                            }}
                                          />
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right align-middle">
                                        <div className="flex justify-end">
                                          <Input
                                            className="h-8 max-w-[100px] text-right tabular-nums"
                                            value={edit.nbrDaysPerYear}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setRateEdits((prev) => ({
                                                ...prev,
                                                [rate.id]: {
                                                  ...(prev[rate.id] ?? {
                                                    dailyRate: String(rate.dailyRate),
                                                    nbrDaysPerYear: String(rate.nbrDaysPerYear),
                                                  }),
                                                  nbrDaysPerYear: v,
                                                },
                                              }));
                                              scheduleRateAutoSave(rate.id);
                                            }}
                                          />
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right align-middle">
                                        <div className="flex flex-nowrap items-center justify-end gap-1">
                                          {savingRateId === rate.id ? (
                                            <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                                          ) : null}
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                            disabled={
                                              deletingRateId === rate.id || savingRateId === rate.id
                                            }
                                            onClick={() => setPendingDeleteRateId(rate.id)}
                                            aria-label="Delete rate"
                                          >
                                            {deletingRateId === rate.id ? (
                                              <Loader2 className="size-4 animate-spin" />
                                            ) : (
                                              <Trash2 className="size-4" />
                                            )}
                                          </Button>
                                        </div>
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                              );
                            })}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </main>
      </div>

      <Dialog
        open={pendingDeleteRateId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteRateId(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Delete this rate?</DialogTitle>
            <DialogDescription>
              {pendingDeleteYear != null
                ? `This will remove the ${pendingDeleteYear} rate row for this resource. This cannot be undone.`
                : "This will remove this rate row. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={pendingDeleteRateId != null && deletingRateId === pendingDeleteRateId}
              onClick={() => setPendingDeleteRateId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pendingDeleteRateId != null && deletingRateId === pendingDeleteRateId}
              onClick={() => {
                const id = pendingDeleteRateId;
                if (!id) return;
                void deleteRate(id).finally(() => setPendingDeleteRateId(null));
              }}
            >
              {pendingDeleteRateId != null && deletingRateId === pendingDeleteRateId ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
