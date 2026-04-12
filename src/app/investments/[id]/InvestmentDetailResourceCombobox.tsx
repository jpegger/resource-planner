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
import type { ResourceOption } from "@/lib/investment-types";
import { cn } from "@/lib/utils";

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

  const filtered = useMemo(() => {
    if (!search.trim()) return resources;
    const q = search.trim().toLowerCase();
    return resources.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [resources, search]);

  const selected = resources.find((r) => r.id === value);

  return (
    <Popover open={open && !disabled} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "w-full min-w-[200px] justify-between font-normal"
        )}
        role="combobox"
      >
        <span className="truncate">{selected?.fullName ?? "Select a resource"}</span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
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
      </PopoverContent>
    </Popover>
  );
}
