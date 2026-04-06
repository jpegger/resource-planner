"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

export type ResourceRateDTO = {
  id: string;
  year: number;
  dailyRate: number;
  nbrDaysPerYear: number | null;
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

function FieldReadonly({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <div className="rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-sm">{value || "—"}</div>
    </div>
  );
}

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

export function ResourcesPageClient({ resources }: Props) {
  const [search, setSearch] = useState("");
  const [cellFilter, setCellFilter] = useState<string>(ALL);
  const [directionFilter, setDirectionFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cellules = useMemo(() => {
    const s = new Set<string>();
    for (const r of resources) {
      if (r.cellule?.trim()) s.add(r.cellule.trim());
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [resources]);

  const directions = useMemo(() => {
    const s = new Set<string>();
    for (const r of resources) {
      if (r.direction?.trim()) s.add(r.direction.trim());
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [resources]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resources.filter((r) => {
      if (typeFilter !== ALL && r.type !== typeFilter) return false;
      if (cellFilter !== ALL && (r.cellule?.trim() ?? "") !== cellFilter) return false;
      if (directionFilter !== ALL && (r.direction?.trim() ?? "") !== directionFilter) return false;
      if (!q) return true;
      const hay = [
        r.id,
        r.fullName,
        r.function ?? "",
        r.cellule ?? "",
        r.direction ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [resources, search, cellFilter, directionFilter, typeFilter]);

  const selected = useMemo(
    () => (selectedId ? resources.find((r) => r.id === selectedId) ?? null : null),
    [resources, selectedId]
  );

  const resetFilters = () => {
    setSearch("");
    setCellFilter(ALL);
    setDirectionFilter(ALL);
    setTypeFilter(ALL);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-200/80 bg-white px-4 py-3">
        <h1 className="font-heading text-lg font-semibold">Resources</h1>
        <p className="text-muted-foreground text-sm">People and direct-cost items available for allocation.</p>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[min(520px,42vw)] shrink-0 flex-col border-r">
          <div className="flex flex-col gap-2 border-b border-neutral-200/80 bg-white p-3">
            <Input
              placeholder="Search name, id, function…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
            <div className="flex flex-wrap gap-2">
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? ALL)}>
                <SelectTrigger size="sm" className="w-[130px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All types</SelectItem>
                  <SelectItem value="INTERNAL">Internal</SelectItem>
                  <SelectItem value="EXTERNAL">External</SelectItem>
                  <SelectItem value="DIRECT_COST">Direct cost</SelectItem>
                </SelectContent>
              </Select>
              <Select value={cellFilter} onValueChange={(v) => setCellFilter(v ?? ALL)}>
                <SelectTrigger size="sm" className="min-w-[120px] max-w-[160px]">
                  <SelectValue placeholder="Cell" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All cells</SelectItem>
                  {cellules.map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className="line-clamp-1">{c}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={directionFilter} onValueChange={(v) => setDirectionFilter(v ?? ALL)}>
                <SelectTrigger size="sm" className="min-w-[120px] max-w-[180px]">
                  <SelectValue placeholder="Direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All directions</SelectItem>
                  {directions.map((d) => (
                    <SelectItem key={d} value={d}>
                      <span className="line-clamp-1">{d}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={resetFilters}>
              <RotateCcw className="size-4" />
              Reset filters
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <Table>
              <TableHeader>
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
                      <span className="line-clamp-2" title={r.fullName}>
                        {r.fullName}
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

        <main className="min-w-0 flex-1 overflow-auto p-4">
          {!selected ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              Choose a resource from the list.
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-mono">
                  {selected.id}
                </Badge>
                <span className="text-sm font-medium">{selected.fullName}</span>
                <Badge variant="outline" className={cn("text-xs font-normal", typeBadgeClass(selected.type))}>
                  {typeLabel(selected.type)}
                </Badge>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <FieldReadonly label="Function" value={selected.function ?? ""} />
                    <FieldReadonly label="Cell" value={selected.cellule ?? ""} />
                    <FieldReadonly label="Direction" value={selected.direction ?? ""} />
                    <FieldReadonly
                      label="First / last name"
                      value={[selected.firstName, selected.lastName].filter(Boolean).join(" ")}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Daily rates by year</CardTitle>
                </CardHeader>
                <CardContent>
                  {selected.rates.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No rate rows for this resource.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-24">Year</TableHead>
                          <TableHead>Daily rate (EUR)</TableHead>
                          <TableHead>Days / year</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.rates.map((rate) => (
                          <TableRow key={rate.id}>
                            <TableCell>{rate.year}</TableCell>
                            <TableCell>{rate.dailyRate}</TableCell>
                            <TableCell>{rate.nbrDaysPerYear ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
