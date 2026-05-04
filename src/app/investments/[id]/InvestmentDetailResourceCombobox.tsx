"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

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
import type { ResourceOption } from "@/lib/investment-types";
import { cn } from "@/lib/utils";

type ScrollSnap = {
  winX: number;
  winY: number;
  chain: { node: HTMLElement; top: number; left: number }[];
};

function snapshotScrollAround(anchor: HTMLElement | null): ScrollSnap {
  const chain: ScrollSnap["chain"] = [];
  let n: Element | null = anchor;
  while (n instanceof HTMLElement) {
    const st = getComputedStyle(n);
    const scrollY =
      n.scrollHeight > n.clientHeight + 1 && /^(auto|scroll|overlay)$/.test(st.overflowY);
    const scrollX =
      n.scrollWidth > n.clientWidth + 1 && /^(auto|scroll|overlay)$/.test(st.overflowX);
    if (scrollY || scrollX) {
      chain.push({ node: n, top: n.scrollTop, left: n.scrollLeft });
    }
    n = n.parentElement;
  }
  return {
    winX: typeof window !== "undefined" ? window.scrollX : 0,
    winY: typeof window !== "undefined" ? window.scrollY : 0,
    chain,
  };
}

function restoreScrollSnap(snap: ScrollSnap) {
  for (const { node, top, left } of snap.chain) {
    node.scrollTop = top;
    node.scrollLeft = left;
  }
  if (typeof window !== "undefined") {
    window.scrollTo(snap.winX, snap.winY);
  }
}

export function InvestmentDetailResourceCombobox({
  value,
  resources,
  onSelect,
  disabled = false,
}: {
  value: string;
  resources: ResourceOption[];
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const commandRootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (!open || disabled) return;
    const snap = snapshotScrollAround(triggerRef.current);

    const focusSearchAndFreezeScroll = () => {
      const input = commandRootRef.current?.querySelector<HTMLElement>('[data-slot="command-input"]');
      input?.focus({ preventScroll: true });
      restoreScrollSnap(snap);
    };

    focusSearchAndFreezeScroll();
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      focusSearchAndFreezeScroll();
      innerRaf = requestAnimationFrame(() => restoreScrollSnap(snap));
    });
    const t = window.setTimeout(() => restoreScrollSnap(snap), 0);

    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
      window.clearTimeout(t);
    };
  }, [open, disabled]);

  const filtered = useMemo(() => {
    if (!search.trim()) return resources;
    const q = search.trim().toLowerCase();
    return resources.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [resources, search]);

  const selected = resources.find((r) => r.id === value);

  return (
    <Popover open={open && !disabled} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger
        ref={triggerRef}
        disabled={disabled}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "w-full min-w-[200px] justify-between font-normal"
        )}
        role="combobox"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button === 0) {
            event.preventDefault();
          }
        }}
      >
        <span className="truncate">{selected?.fullName ?? "Select a resource"}</span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        side="bottom"
        positionMethod="fixed"
        collisionAvoidance={{ side: "none", fallbackAxisSide: "none" }}
        initialFocus={false}
      >
        <div ref={commandRootRef}>
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search resource..." value={search} onValueChange={setSearch} />
            <CommandList>
              {filtered.length === 0 ? (
                <CommandEmpty>No resource found.</CommandEmpty>
              ) : (
                filtered.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={r.id}
                    onSelect={() => {
                      onSelect(r.id);
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 size-4", value === r.id ? "opacity-100" : "opacity-0")} />
                    {r.fullName}
                  </CommandItem>
                ))
              )}
            </CommandList>
          </Command>
        </div>
      </PopoverContent>
    </Popover>
  );
}
