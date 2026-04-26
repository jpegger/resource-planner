"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function JiraHeaderSync() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedDialogOpen, setSeedDialogOpen] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const syncJira = async () => {
    setSyncing(true);
    setStatus(null);
    try {
      const response = await fetch("/api/jira/sync");
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        upserted?: number;
        created?: number;
        changed?: number;
        unchanged?: number;
        updated?: number;
        skipped?: number;
        fetched?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? response.statusText);
      }
      const created = payload.created ?? 0;
      const changed = payload.changed ?? payload.updated ?? 0;
      const unchanged = payload.unchanged ?? 0;
      const skipped = payload.skipped ?? 0;
      const fetched = payload.fetched ?? 0;
      router.refresh();
      setStatus({
        kind: "ok",
        text: `Jira sync complete — ${changed} changed, ${unchanged} unchanged, ${created} new${skipped ? `, ${skipped} skipped` : ""} (${fetched} fetched).`,
      });
    } catch (e) {
      setStatus({
        kind: "err",
        text: e instanceof Error ? e.message : "Sync failed",
      });
    } finally {
      setSyncing(false);
    }
  };

  const generateProdDataAuto = async () => {
    setGenerating(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/prod-data-auto/generate", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; outDir?: string };
      if (!response.ok) throw new Error(payload.error ?? response.statusText);
      router.refresh();
      setStatus({
        kind: "ok",
        text: `Generated prod import CSVs → ${payload.outDir ?? "scripts/datasets/prod-import"}.`,
      });
    } catch (e) {
      setStatus({
        kind: "err",
        text: e instanceof Error ? e.message : "Generation failed",
      });
    } finally {
      setGenerating(false);
    }
  };

  const seedProdResetDb = async () => {
    setSeeding(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/db/seed-prod-reset", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? response.statusText);
      router.refresh();
      setStatus({ kind: "ok", text: "DB reset + re-seed complete." });
      setSeedDialogOpen(false);
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : "Seed failed" });
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="flex min-w-0 max-w-full items-center justify-end gap-2 sm:gap-3">
      {status ? (
        <span
          className={cn(
            "min-w-0 max-w-[min(55vw,20rem)] truncate text-right text-xs sm:max-w-md",
            status.kind === "ok" && "text-white/90",
            status.kind === "err" && "text-red-200"
          )}
          aria-live="polite"
          title={status.text}
        >
          {status.text}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20"
        disabled={syncing}
        onClick={syncJira}
        title="Sync products + initiatives from Jira"
      >
        {syncing ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        <span className="ml-1.5">Jira sync</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20"
        disabled={generating}
        onClick={generateProdDataAuto}
        title="Generate scripts/datasets/prod-import CSVs from Excel"
      >
        {generating ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        <span className="ml-1.5">Generate CSVs</span>
      </Button>

      <Dialog open={seedDialogOpen} onOpenChange={setSeedDialogOpen}>
        <DialogTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 shrink-0 border-red-200/30 bg-red-500/15 text-white hover:bg-red-500/25"
              disabled={seeding}
              title="Reset and re-seed the database (dangerous)"
            />
          }
        >
          {seeding ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          <span className="ml-1.5">Generate + re-seed</span>
        </DialogTrigger>

        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate CSVs + reset and re-seed database?</DialogTitle>
            <div className="text-muted-foreground text-sm">
              This will regenerate <span className="font-mono">scripts/datasets/prod-import</span>, then run{" "}
              <span className="font-mono">SEED_PROD_RESET=1</span> and re-import data.
              <span className="block mt-2 font-medium text-red-600">
                Warning: this deletes planner data before re-import.
              </span>
            </div>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" type="button" disabled={seeding} onClick={() => setSeedDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={seeding}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={seedProdResetDb}
            >
              {seeding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              <span className={cn(seeding ? "ml-2" : "")}>Confirm generate + reset + re-seed</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
