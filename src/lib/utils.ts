import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Distinct non-empty trimmed strings, sorted for filter dropdowns. */
export function distinctSortedStrings(values: (string | null | undefined)[]): string[] {
  const trimmed = values
    .map((v) => v?.trim())
    .filter((v): v is string => v !== undefined && v !== "");
  return [...new Set(trimmed)].sort((a, b) => a.localeCompare(b));
}

/** Distinct finite numbers, sorted for year pickers and similar. */
export function distinctSortedNumbers(values: number[], order: "asc" | "desc" = "asc"): number[] {
  const nums = values.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return [...new Set(nums)].sort((a, b) => (order === "desc" ? b - a : a - b));
}
