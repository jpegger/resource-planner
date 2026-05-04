"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { EotpTargetOption } from "@/lib/eotp-target-options";
import { cn } from "@/lib/utils";

export type { EotpTargetOption };

function findMatchingOption(
  options: EotpTargetOption[],
  eotp: string,
  eopLabel: string
): EotpTargetOption | undefined {
  const c = eotp.trim().toLowerCase();
  const l = (eopLabel ?? "").trim();
  const candidates = options.filter((o) => o.code.toLowerCase() === c);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const byLabel = candidates.find((o) => o.label === l);
  return byLabel ?? candidates[0];
}

/** Searchable combobox: code, SAP label, team/owner, division. */
export function InvestmentDetailEotpTargetCombobox({
  valueEotp,
  valueLabel,
  options,
  onSelect,
  disabled,
  loading,
  placeholder = "Select EOTP target",
}: {
  valueEotp: string;
  valueLabel: string;
  options: EotpTargetOption[];
  onSelect: (code: string, label: string) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = useMemo(
    () => findMatchingOption(options, valueEotp, valueLabel),
    [options, valueEotp, valueLabel]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? options
      : options.filter((o) => {
          const pf = (o.productFamily ?? "").toLowerCase();
          return (
            o.code.toLowerCase().includes(q) ||
            o.label.toLowerCase().includes(q) ||
            o.entityName.toLowerCase().includes(q) ||
            (pf && pf.includes(q))
          );
        });
    return [...base].sort((a, b) => {
      const laRaw = (a.label || "").trim();
      const lbRaw = (b.label || "").trim();
      const aEmpty = !laRaw;
      const bEmpty = !lbRaw;
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      const la = laRaw.toLowerCase();
      const lb = lbRaw.toLowerCase();
      const byLabel = la.localeCompare(lb, undefined, { sensitivity: "base" });
      if (byLabel !== 0) return byLabel;
      return a.code.localeCompare(b.code, undefined, { sensitivity: "base" });
    });
  }, [options, search]);

  const hasDisplayValue =
    Boolean(selected) || Boolean(valueEotp.trim());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled || loading}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-8 min-w-[200px] max-w-[280px] justify-between px-2 font-normal"
        )}
        role="combobox"
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-1 text-left text-xs">
          {loading ? (
            <span className="text-muted-foreground">Loading targets…</span>
          ) : hasDisplayValue ? (
            <>
              <span className="min-w-0 truncate font-medium text-foreground">
                {selected?.label || valueLabel || "—"}
              </span>
              <span className="text-muted-foreground shrink-0">·</span>
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                {selected?.code ?? valueEotp.trim()}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <ChevronsUpDown className="ml-1 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(100vw-2rem,380px)] p-0"
        align="start"
        side="bottom"
        collisionAvoidance={{ side: "none", fallbackAxisSide: "none" }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by label, code, team, or division…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {filtered.length === 0 ? (
              <CommandEmpty>No matching EOTP target.</CommandEmpty>
            ) : (
              filtered.map((o) => {
                const isPicked = selected?.rowId === o.rowId;
                return (
                  <CommandItem
                    key={o.rowId}
                    value={o.rowId}
                    className="flex flex-col items-start gap-0.5 py-2"
                    onSelect={() => {
                      onSelect(o.code, o.label);
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    <div className="flex w-full items-start gap-2">
                      <Check
                        className={cn("mt-0.5 size-4 shrink-0", isPicked ? "opacity-100" : "opacity-0")}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-foreground text-xs font-medium leading-snug">
                          {o.label || "—"}
                        </div>
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
                          <span className="font-mono tabular-nums">{o.code}</span>
                          <span className="truncate opacity-90">{o.entityName}</span>
                        </div>
                      </div>
                    </div>
                  </CommandItem>
                );
              })
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
