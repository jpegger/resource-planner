import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function InvestmentDetailYearFilter({
  selectedYear,
  yearOptions,
  onSelectYear,
}: {
  selectedYear: number;
  yearOptions: number[];
  onSelectYear: (year: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label className="text-muted-foreground shrink-0 text-xs">Year</Label>
      <div className="flex flex-wrap gap-1.5">
        {yearOptions.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => onSelectYear(y)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs",
              selectedYear === y
                ? "border-primary bg-primary/10"
                : "border-border bg-background"
            )}
          >
            {y}
          </button>
        ))}
      </div>
    </div>
  );
}
