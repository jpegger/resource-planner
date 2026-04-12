import { Label } from "@/components/ui/label";

export function InvestmentDetailFieldReadonly({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <div className="bg-muted/40 border-input rounded-md border px-2.5 py-1.5 text-sm">{value || "—"}</div>
    </div>
  );
}
