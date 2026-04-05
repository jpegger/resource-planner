"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function JiraHeaderSync() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const sync = async () => {
    setSyncing(true);
    setStatus(null);
    try {
      const res = await fetch("/api/jira/sync");
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        upserted?: number;
        created?: number;
        changed?: number;
        unchanged?: number;
        updated?: number;
        skipped?: number;
        fetched?: number;
      };
      if (!res.ok) {
        throw new Error(data.error ?? res.statusText);
      }
      const created = data.created ?? 0;
      const changed = data.changed ?? data.updated ?? 0;
      const unchanged = data.unchanged ?? 0;
      const skipped = data.skipped ?? 0;
      const fetched = data.fetched ?? 0;
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
        onClick={sync}
        title="Sync initiatives from Jira"
      >
        {syncing ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        <span className="ml-1.5">Jira update</span>
      </Button>
    </div>
  );
}
