import request from "supertest";

import { loadCsv } from "../fixtures/load-csv";

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

export const ENTITY_WITH_EXCEPTIONS = "PRD-CRM";
export const ENTITY_MAIN_EOTP = "7D0043001";

export const KNOWN_INITIATIVE_ID = "RI-306";
export const KNOWN_RESOURCE_ID = "MAT-0000041";

export const TEST_YEAR = 2099;
export const VALID_EOTP = "7D9999999";

type JiraRow = { Key: string };
type AssignmentRow = { InitiativeId: string };

function normalizeCsvId(id: string): string {
  return id.replace(/\s/g, "").trim();
}

/**
 * Deterministically pick an initiative that exists in JIRA.csv but has no Assignement.csv rows.
 * This is more stable than hardcoding an ID like RI-9999.
 */
export function initiativeIdWithNoAllocations(): string {
  const jiraRows = loadCsv<JiraRow>("../../scripts/datasets/dev/JIRA.csv");
  const assignmentRows = loadCsv<AssignmentRow>("../../scripts/datasets/dev/Assignement.csv");

  const assignedIds = new Set(
    assignmentRows
      .map((r) => normalizeCsvId(r.InitiativeId ?? ""))
      .filter(Boolean)
  );

  for (const r of jiraRows) {
    const id = normalizeCsvId(r.Key ?? "");
    if (!id) continue;
    if (!assignedIds.has(id)) return id;
  }

  // Fallback: if the dataset ever becomes “fully assigned”, keep behaviour explicit.
  return "RI-NO-ALLOCS-NOT-FOUND";
}

export function http() {
  return request(BASE);
}

