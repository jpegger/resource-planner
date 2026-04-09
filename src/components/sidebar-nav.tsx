"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, LayoutDashboard, Users } from "lucide-react";

import { cn } from "@/lib/utils";

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside
      className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-white/10 py-3"
      style={{ backgroundColor: "var(--sidebar-dark)" }}
    >
      <Link
        href="/investments"
        title="Investments / portfolio"
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10",
          pathname.startsWith("/investments") && "bg-white/15"
        )}
      >
        <LayoutDashboard className="size-5" aria-hidden />
      </Link>
      <Link
        href="/resources"
        title="Resources"
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10",
          pathname.startsWith("/resources") && "bg-white/15"
        )}
      >
        <Users className="size-5" aria-hidden />
      </Link>
      <span
        title="Report"
        className="flex h-10 w-10 cursor-default items-center justify-center rounded-md text-white"
      >
        <BarChart3 className="size-5" aria-hidden />
      </span>
    </aside>
  );
}
