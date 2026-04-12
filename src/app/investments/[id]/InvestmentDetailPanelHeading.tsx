import type { LucideIcon } from "lucide-react";

/** Matches the “Budget overview” strip: muted icon + semibold title. */
export function InvestmentDetailPanelHeading({
  icon: Icon,
  title,
  className,
}: {
  icon: LucideIcon;
  title: string;
  className?: string;
}) {
  return (
    <div className={className ?? "flex min-w-0 items-center gap-2"}>
      <Icon className="text-muted-foreground size-5 shrink-0 stroke-[1.5]" aria-hidden />
      <span className="text-foreground text-base font-semibold leading-tight">{title}</span>
    </div>
  );
}
