import { useMemo } from "react";

export function useInvestmentIdParam(investmentId: string) {
  return useMemo(() => decodeURIComponent(investmentId.trim()), [investmentId]);
}
