import { runBuildBucket } from "@/app/investments/[id]/investment-detail-helpers";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function InitiativeRunBuildPill({
  initiativeType,
  className,
}: {
  initiativeType: string | null | undefined;
  className?: string;
}) {
  const bucket = runBuildBucket(initiativeType);
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 rounded-md px-1.5 text-[10px] font-medium",
        bucket === "Run"
          ? "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100"
          : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100",
        className
      )}
    >
      {bucket}
    </Badge>
  );
}
