"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import { PANEL_CARD_CLASS } from "@/lib/panel-card";
import { cn } from "@/lib/utils";

type SnapshotListItem = {
  id: string;
  name: string;
  year: number;
  takenAt: string;
  takenBy: string;
  _count: { rows: number };
};

type BaselineListItem = {
  id: string;
  name: string;
  version: string;
  year: number;
  importedAt: string;
  importedBy: string;
  _count: { rows: number };
};

function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return [y - 1, y, y + 1];
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function BudgetComparisonPage() {
  const [snapshots, setSnapshots] = useState<SnapshotListItem[]>([]);
  const [baselines, setBaselines] = useState<BaselineListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [snapName, setSnapName] = useState("");
  const [snapYear, setSnapYear] = useState(() => new Date().getFullYear());
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapMessage, setSnapMessage] = useState<string | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);

  const [blName, setBlName] = useState("");
  const [blVersion, setBlVersion] = useState("");
  const [blYear, setBlYear] = useState(() => new Date().getFullYear());
  const [blFile, setBlFile] = useState<File | null>(null);
  const [blLoading, setBlLoading] = useState(false);
  const [blWarnings, setBlWarnings] = useState<string[]>([]);
  const [blMessage, setBlMessage] = useState<string | null>(null);
  const [blError, setBlError] = useState<string | null>(null);

  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);
  const [deletingBaselineId, setDeletingBaselineId] = useState<string | null>(null);
  const [pendingDeleteSnapshotId, setPendingDeleteSnapshotId] = useState<string | null>(null);
  const [pendingDeleteBaselineId, setPendingDeleteBaselineId] = useState<string | null>(null);

  const years = useMemo(() => yearOptions(), []);

  const refreshSnapshots = useCallback(async () => {
    const res = await fetch("/api/snapshots");
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as SnapshotListItem[];
    setSnapshots(Array.isArray(data) ? data : []);
  }, []);

  const refreshBaselines = useCallback(async () => {
    const res = await fetch("/api/baselines");
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as BaselineListItem[];
    setBaselines(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all([refreshSnapshots(), refreshBaselines()]);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Failed to load data");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSnapshots, refreshBaselines]);

  async function handleTakeSnapshot() {
    if (!snapName.trim() || !snapYear) return;
    setSnapLoading(true);
    setSnapError(null);
    setSnapMessage(null);
    try {
      const res = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: snapName.trim(), year: snapYear }),
      });
      const data = (await res.json()) as { rowCount?: number; error?: string };
      if (!res.ok) {
        setSnapError(data.error ?? "Snapshot failed");
        return;
      }
      setSnapMessage(`Snapshot saved (${data.rowCount ?? 0} rows).`);
      setSnapName("");
      await refreshSnapshots();
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : "Snapshot failed");
    } finally {
      setSnapLoading(false);
    }
  }

  async function handleImportBaseline() {
    if (!blName.trim() || !blVersion.trim() || !blYear || !blFile) return;
    setBlLoading(true);
    setBlError(null);
    setBlMessage(null);
    setBlWarnings([]);
    try {
      const form = new FormData();
      form.append("name", blName.trim());
      form.append("version", blVersion.trim());
      form.append("year", String(blYear));
      form.append("file", blFile);
      const res = await fetch("/api/baselines", { method: "POST", body: form });
      const data = (await res.json()) as {
        baseline?: { _count?: { rows: number } };
        warnings?: string[];
        error?: string;
      };
      if (!res.ok) {
        setBlError(data.error ?? "Import failed");
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          setBlWarnings(data.warnings);
        }
        return;
      }
      setBlWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      const n = data.baseline?._count?.rows ?? 0;
      setBlMessage(`Imported ${n} baseline row(s).`);
      setBlName("");
      setBlVersion("");
      setBlFile(null);
      await refreshBaselines();
    } catch (e) {
      setBlError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBlLoading(false);
    }
  }

  async function confirmDeleteSnapshot() {
    const id = pendingDeleteSnapshotId;
    if (!id) return;
    setDeletingSnapshotId(id);
    setPendingDeleteSnapshotId(null);
    try {
      const res = await fetch(`/api/snapshots/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setLoadError(j.error ?? "Delete failed");
        return;
      }
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setDeletingSnapshotId(null);
    }
  }

  async function confirmDeleteBaseline() {
    const id = pendingDeleteBaselineId;
    if (!id) return;
    setDeletingBaselineId(id);
    setPendingDeleteBaselineId(null);
    try {
      const res = await fetch(`/api/baselines/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setLoadError(j.error ?? "Delete failed");
        return;
      }
      setBaselines((prev) => prev.filter((b) => b.id !== id));
    } finally {
      setDeletingBaselineId(null);
    }
  }

  const inputClass =
    "border-input bg-background text-foreground placeholder:text-muted-foreground h-9 w-full max-w-full rounded-md border px-3 text-sm";

  return (
    <div className="p-6" style={{ backgroundColor: "var(--page-background)" }}>
      <h1 className="text-foreground mb-6 text-lg font-semibold">Planning vs budget baseline</h1>

      {loadError ? (
        <p className="text-destructive mb-4 max-w-2xl text-sm whitespace-pre-wrap">{loadError}</p>
      ) : null}

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Allocation snapshots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-muted-foreground text-xs font-medium">New snapshot</label>
              <input
                className={inputClass}
                placeholder="e.g. Pre-budget meeting Apr 2026"
                value={snapName}
                onChange={(e) => setSnapName(e.target.value)}
                disabled={snapLoading}
              />
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Year</label>
                  <select
                    className={cn(inputClass, "w-[120px]")}
                    value={snapYear}
                    onChange={(e) => setSnapYear(Number(e.target.value))}
                    disabled={snapLoading}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  disabled={snapLoading || !snapName.trim()}
                  onClick={() => void handleTakeSnapshot()}
                >
                  {snapLoading ? <Loader2 className="size-4 animate-spin" /> : "Take snapshot"}
                </Button>
              </div>
              {snapMessage ? (
                <p className="text-muted-foreground text-sm">{snapMessage}</p>
              ) : null}
              {snapError ? <p className="text-destructive text-sm">{snapError}</p> : null}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Year</th>
                    <th className="px-3 py-2 text-left font-medium">Taken</th>
                    <th className="px-3 py-2 text-left font-medium">By</th>
                    <th className="px-3 py-2 text-right font-medium">Rows</th>
                    <th className="px-3 py-2 text-right font-medium w-12" />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.id} className="border-b border-border">
                      <td className="px-3 py-2.5 font-medium">{s.name}</td>
                      <td className="text-muted-foreground px-3 py-2.5">
                        <span className="bg-muted rounded px-1.5 py-0.5 text-xs">{s.year}</span>
                      </td>
                      <td className="text-muted-foreground px-3 py-2.5 text-xs">
                        {formatWhen(s.takenAt)}
                      </td>
                      <td className="text-muted-foreground max-w-[140px] truncate px-3 py-2.5 text-xs" title={s.takenBy}>
                        {s.takenBy}
                      </td>
                      <td className="text-muted-foreground px-3 py-2.5 text-right text-xs">
                        {s._count.rows}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingSnapshotId === s.id}
                          onClick={() => setPendingDeleteSnapshotId(s.id)}
                          aria-label="Delete snapshot"
                        >
                          {deletingSnapshotId === s.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {snapshots.length === 0 && !loadError ? (
              <p className="text-muted-foreground text-sm">No snapshots yet.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className={cn(PANEL_CARD_CLASS, "min-w-0")}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Budget baselines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-muted-foreground text-xs font-medium">Import baseline</label>
              <input
                className={inputClass}
                placeholder="Name"
                value={blName}
                onChange={(e) => setBlName(e.target.value)}
                disabled={blLoading}
              />
              <input
                className={inputClass}
                placeholder='Version (e.g. "v4")'
                value={blVersion}
                onChange={(e) => setBlVersion(e.target.value)}
                disabled={blLoading}
              />
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs">Year</label>
                  <select
                    className={cn(inputClass, "w-[120px]")}
                    value={blYear}
                    onChange={(e) => setBlYear(Number(e.target.value))}
                    disabled={blLoading}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0 flex-1">
                  <label className="text-muted-foreground mb-1 block text-xs">Excel file</label>
                  <input
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="text-muted-foreground max-w-full text-sm file:mr-2"
                    onChange={(e) => setBlFile(e.target.files?.[0] ?? null)}
                    disabled={blLoading}
                  />
                </div>
                <Button
                  type="button"
                  disabled={blLoading || !blName.trim() || !blVersion.trim() || !blFile}
                  onClick={() => void handleImportBaseline()}
                >
                  {blLoading ? <Loader2 className="size-4 animate-spin" /> : "Import baseline"}
                </Button>
              </div>
              {blMessage ? <p className="text-muted-foreground text-sm">{blMessage}</p> : null}
              {blError ? <p className="text-destructive text-sm">{blError}</p> : null}
              {blWarnings.length > 0 ? (
                <div
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
                  role="status"
                >
                  <p className="font-medium">Warnings</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {blWarnings.slice(0, 5).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  {blWarnings.length > 5 ? (
                    <p className="mt-1 text-xs opacity-90">+{blWarnings.length - 5} more</p>
                  ) : null}
                  {blWarnings.some((w) => w.includes("Non-standard EOTP")) ? (
                    <p className="mt-2 text-xs">
                      Non-standard EOTP codes were imported; check Power BI for unmatched rows.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Ver.</th>
                    <th className="px-3 py-2 text-left font-medium">Year</th>
                    <th className="px-3 py-2 text-left font-medium">Imported</th>
                    <th className="px-3 py-2 text-left font-medium">By</th>
                    <th className="px-3 py-2 text-right font-medium">Rows</th>
                    <th className="px-3 py-2 text-right font-medium w-12" />
                  </tr>
                </thead>
                <tbody>
                  {baselines.map((b) => (
                    <tr key={b.id} className="border-b border-border">
                      <td className="px-3 py-2.5 font-medium">{b.name}</td>
                      <td className="text-muted-foreground px-3 py-2.5">
                        <span className="bg-muted rounded px-1.5 py-0.5 text-xs">{b.version}</span>
                      </td>
                      <td className="text-muted-foreground px-3 py-2.5">
                        <span className="bg-muted rounded px-1.5 py-0.5 text-xs">{b.year}</span>
                      </td>
                      <td className="text-muted-foreground px-3 py-2.5 text-xs">
                        {formatWhen(b.importedAt)}
                      </td>
                      <td className="text-muted-foreground max-w-[120px] truncate px-3 py-2.5 text-xs" title={b.importedBy}>
                        {b.importedBy}
                      </td>
                      <td className="text-muted-foreground px-3 py-2.5 text-right text-xs">
                        {b._count.rows}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingBaselineId === b.id}
                          onClick={() => setPendingDeleteBaselineId(b.id)}
                          aria-label="Delete baseline"
                        >
                          {deletingBaselineId === b.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {baselines.length === 0 && !loadError ? (
              <p className="text-muted-foreground text-sm">No baselines yet.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={pendingDeleteSnapshotId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteSnapshotId(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Delete this snapshot?</DialogTitle>
            <DialogDescription>
              This removes the snapshot and all frozen rows. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setPendingDeleteSnapshotId(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDeleteSnapshot()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeleteBaselineId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteBaselineId(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Delete this baseline?</DialogTitle>
            <DialogDescription>
              This removes the baseline and all imported rows. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setPendingDeleteBaselineId(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDeleteBaseline()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
