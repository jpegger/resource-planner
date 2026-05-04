/** Shared layout tokens for investment detail panels (budget, allocations, EOTP). */

export const FINANCIALS_4COL =
  "grid grid-cols-[4.75rem_4.75rem_4.75rem_3.75rem] items-baseline justify-items-end gap-x-2 text-xs tabular-nums sm:gap-x-3";

export const FINANCIALS_PILL =
  "rounded-lg border border-[color:var(--primary-blue)]/20 bg-[color:var(--primary-blue)]/[0.06] px-2.5 py-1.5 font-bold text-foreground shadow-sm dark:border-[color:var(--primary-blue)]/30 dark:bg-[color:var(--primary-blue)]/[0.12]";

/** Equal width for FTE % / units and Man days (wider than w-28 for % / u. suffix). */
export const ALLOCATION_ASSIGNMENT_COL = "w-36 min-w-0 max-w-36";

export const TABLE_HEAD_CLASS =
  "text-muted-foreground text-xs font-medium uppercase tracking-wider";
export const TABLE_HEAD_TOTAL_CLASS =
  "text-xs font-medium uppercase tracking-wider text-[color:var(--primary-blue)]";
export const TABLE_HEAD_ROW_BG = "";
