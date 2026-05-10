import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { TimesheetRow } from "@/lib/sn-timesheet-parser";
import {
  parseTimesheetHours,
  resolveTimesheetAllocationEntityId,
  resolveTimesheetInitiativeId,
  resolveTimesheetResourceId,
} from "@/lib/timesheet-import-resolve";

type EntryRow = {
  snUser: string;
  snProgrammeName: string | null;
  snProjectNr: string | null;
  snProjectLabel: string | null;
  snTaskNr: string | null;
  snTaskLabel: string | null;
  weekStartsOn: Date;
  year: number;
  month: number;
  hours: Prisma.Decimal;
  state: string;
  allocationEntityId: string | null;
  initiativeId: string | null;
  resourceId: string | null;
  importWarning: string | null;
};

export async function persistTimesheetRows(params: {
  fileName: string;
  importYear: number;
  importedBy: string;
  rows: TimesheetRow[];
}): Promise<{
  import: { id: string; fileName: string; year: number; rowCount: number; warnCount: number };
  skippedAfterFilter: number;
  warnCount: number;
}> {
  const { fileName, importYear, importedBy, rows } = params;
  const toInsert: EntryRow[] = [];
  let warnCount = 0;
  let skippedAfterFilter = 0;

  for (const row of rows) {
    const { year: y, month, day } = row.weekStartsOn;
    if (y !== importYear) {
      skippedAfterFilter++;
      continue;
    }

    const hours = parseTimesheetHours(row.hours);
    if (!hours) {
      skippedAfterFilter++;
      continue;
    }

    const { allocationEntityId, importWarning } = await resolveTimesheetAllocationEntityId(
      row.snProgrammeName,
      row.snProgrammeEotp
    );
    if (importWarning) warnCount++;

    const initiativeId = await resolveTimesheetInitiativeId(row.snProjectNr, y);
    const resourceId = await resolveTimesheetResourceId(row.snUser);
    const weekStartsOn = new Date(Date.UTC(y, month - 1, day));

    toInsert.push({
      snUser: row.snUser,
      snProgrammeName: row.snProgrammeName,
      snProjectNr: row.snProjectNr,
      snProjectLabel: row.snProjectLabel,
      snTaskNr: row.snTaskNr,
      snTaskLabel: row.snTaskLabel,
      weekStartsOn,
      year: y,
      month,
      hours,
      state: row.state,
      allocationEntityId,
      initiativeId,
      resourceId,
      importWarning,
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const imp = await tx.timesheetImport.create({
      data: {
        fileName,
        year: importYear,
        importedBy,
        rowCount: toInsert.length,
        warnCount,
      },
    });
    if (toInsert.length > 0) {
      await tx.timesheetEntry.createMany({
        data: toInsert.map((d) => ({ ...d, importId: imp.id })),
      });
    }
    return imp;
  });

  return {
    import: {
      id: created.id,
      fileName: created.fileName,
      year: created.year,
      rowCount: created.rowCount,
      warnCount: created.warnCount,
    },
    skippedAfterFilter,
    warnCount,
  };
}
