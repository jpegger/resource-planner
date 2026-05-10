import Papa from "papaparse";

export type TimesheetRow = {
  snUser: string;
  snProgrammeName: string | null;
  snProgrammeEotp: string | null;
  snProjectNr: string | null;
  snProjectLabel: string | null;
  snTaskNr: string | null;
  snTaskLabel: string | null;
  weekStartsOn: { year: number; month: number; day: number };
  hours: string;
  state: string;
};

const CATEGORY_ALLOWED = "Project/Project Task";
const STATES_ALLOWED = new Set(["Processed", "Approved"]);

const COL_USER = "user";
const COL_PROGRAM = "top_task.top_program";
const COL_PROJECT = "top_task.top_task";
const COL_PROJECT_LABEL = "top_task.short_description";
const COL_TASK = "task";
const COL_TASK_LABEL = "task.short_description";
const COL_WEEK = "week_starts_on";
const COL_CATEGORY = "category";
const COL_TOTAL = "total";
const COL_STATE = "state";
const COL_PROGRAMME_EOTP = "top_task.top_program_eotp";

function trimCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Parse DD/MM/YYYY with `/` or `-` separators (SN exports use both). */
export function parseWeekStartDdMmYyyy(raw: string): { year: number; month: number; day: number } | null {
  const s = raw.trim();
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function detectProgrammeEotpColumn(fields: string[]): boolean {
  return fields.includes(COL_PROGRAMME_EOTP);
}

/**
 * Parse SN time card CSV (comma-delimited, header row).
 * Filters category + state per design §7.1.
 */
export function parseSnTimesheetCsv(csvText: string): {
  rows: TimesheetRow[];
  totalInputRows: number;
  skippedByFilter: number;
  hasProgrammeEotpColumn: boolean;
} {
  const cleaned = csvText.replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
  });
  const fields = (parsed.meta.fields ?? []) as string[];
  const hasProgrammeEotpColumn = detectProgrammeEotpColumn(fields);

  let skippedByFilter = 0;
  const rows: TimesheetRow[] = [];

  for (const rec of parsed.data) {
    const category = trimCell(rec[COL_CATEGORY]);
    const state = trimCell(rec[COL_STATE]);
    if (category !== CATEGORY_ALLOWED || !STATES_ALLOWED.has(state)) {
      skippedByFilter++;
      continue;
    }

    const snUser = trimCell(rec[COL_USER]);
    if (!snUser) {
      skippedByFilter++;
      continue;
    }

    const weekRaw = trimCell(rec[COL_WEEK]);
    const weekParts = parseWeekFlexible(weekRaw);
    if (!weekParts) {
      skippedByFilter++;
      continue;
    }

    const totalRaw = trimCell(rec[COL_TOTAL]);
    if (!totalRaw) {
      skippedByFilter++;
      continue;
    }

    rows.push({
      snUser,
      snProgrammeName: trimCell(rec[COL_PROGRAM]) || null,
      snProgrammeEotp: hasProgrammeEotpColumn ? trimCell(rec[COL_PROGRAMME_EOTP]) || null : null,
      snProjectNr: trimCell(rec[COL_PROJECT]) || null,
      snProjectLabel: trimCell(rec[COL_PROJECT_LABEL]) || null,
      snTaskNr: trimCell(rec[COL_TASK]) || null,
      snTaskLabel: trimCell(rec[COL_TASK_LABEL]) || null,
      weekStartsOn: weekParts,
      hours: totalRaw,
      state,
    });
  }

  return {
    rows,
    totalInputRows: parsed.data.length,
    skippedByFilter,
    hasProgrammeEotpColumn,
  };
}

function pick(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function parseWeekFlexible(raw: string): { year: number; month: number; day: number } | null {
  const dd = parseWeekStartDdMmYyyy(raw);
  if (dd) return dd;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const day = Number.parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Map SN Table API `pm_project_task_time_card` rows to the same shape as CSV parsing (§7.1). */
export function mapSnApiRecordsToTimesheetRows(records: Record<string, unknown>[]): {
  rows: TimesheetRow[];
  totalInputRows: number;
  skippedByFilter: number;
  hasProgrammeEotpColumn: boolean;
} {
  let skippedByFilter = 0;
  const rows: TimesheetRow[] = [];
  let hasProgrammeEotpColumn = false;

  for (const rec of records) {
    const category = pick(rec, ["category", "u_category"]);
    const state = pick(rec, ["state", "u_state"]);
    if (category !== CATEGORY_ALLOWED || !STATES_ALLOWED.has(state)) {
      skippedByFilter++;
      continue;
    }

    const snUser = pick(rec, ["user", "u_user", "user.name"]);
    if (!snUser) {
      skippedByFilter++;
      continue;
    }

    const weekRaw = pick(rec, ["week_starts_on", "u_week_starts_on"]);
    const weekParts = parseWeekFlexible(weekRaw);
    if (!weekParts) {
      skippedByFilter++;
      continue;
    }

    const totalRaw = pick(rec, ["total", "u_total"]);
    if (!totalRaw) {
      skippedByFilter++;
      continue;
    }

    const eotp = pick(rec, ["top_task.top_program_eotp", "u_top_task_top_program_eotp"]);
    if (eotp) hasProgrammeEotpColumn = true;

    rows.push({
      snUser,
      snProgrammeName: pick(rec, ["top_task.top_program", "u_top_task_top_program"]) || null,
      snProgrammeEotp: eotp || null,
      snProjectNr: pick(rec, ["top_task.top_task", "u_top_task_top_task"]) || null,
      snProjectLabel: pick(rec, ["top_task.short_description", "u_top_task_short_description"]) || null,
      snTaskNr: pick(rec, ["task", "u_task"]) || null,
      snTaskLabel: pick(rec, ["task.short_description", "u_task_short_description"]) || null,
      weekStartsOn: weekParts,
      hours: totalRaw,
      state,
    });
  }

  return {
    rows,
    totalInputRows: records.length,
    skippedByFilter,
    hasProgrammeEotpColumn,
  };
}

