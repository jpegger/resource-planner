import "dotenv/config";

import { Version3Client } from "jira.js";

function requireEnv(name: string): string {
  const v =
    process.env[name] ??
    Object.entries(process.env).find(([k]) => k.trim() === name)?.[1];
  if (!v?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return v.trim();
}

export function jiraHost(): string {
  const raw =
    (process.env.JIRA_HOST ?? Object.entries(process.env).find(([k]) => k.trim() === "JIRA_HOST")?.[1])?.trim() ||
    (process.env.JIRA_BASE_URL ?? Object.entries(process.env).find(([k]) => k.trim() === "JIRA_BASE_URL")?.[1])?.trim();
  if (!raw) throw new Error("Missing required environment variable: JIRA_HOST (or JIRA_BASE_URL)");
  return raw.replace(/\/+$/, "");
}

export function jiraEmail(): string {
  return requireEnv("JIRA_EMAIL");
}

export function jiraToken(): string {
  const raw =
    (process.env.JIRA_TOKEN ?? Object.entries(process.env).find(([k]) => k.trim() === "JIRA_TOKEN")?.[1])?.trim() ||
    (process.env.JIRA_API_TOKEN ?? Object.entries(process.env).find(([k]) => k.trim() === "JIRA_API_TOKEN")?.[1])?.trim();
  if (!raw) throw new Error("Missing required environment variable: JIRA_TOKEN (or JIRA_API_TOKEN)");
  return raw;
}

export function createJiraClient(): Version3Client {
  return new Version3Client({
    host: jiraHost(),
    authentication: {
      basic: {
        email: jiraEmail(),
        apiToken: jiraToken(),
      },
    },
  });
}

export function resolveInitiativeJql(): string {
  const jiraJql = process.env.JIRA_JQL?.trim();
  if (jiraJql) return jiraJql;
  const filterId = requireEnv("JIRA_FILTER_ID").replace(/\D/g, "");
  if (!filterId) throw new Error("JIRA_FILTER_ID must contain a numeric saved filter id");
  return `filter = ${filterId}`;
}

export function resolveProductJql(): string {
  return (process.env.JIRA_PRODUCT_JQL?.trim() || "issuetype = Product").trim();
}

export function resolveProjectKeyFromJql(jql: string): string | null {
  // Best-effort: parse `project = RI` or `project = \"RI\"`.
  const m = jql.match(/\bproject\s*=\s*\"?([A-Z][A-Z0-9_]+)\"?/i);
  return m?.[1]?.trim() ? m[1].trim().toUpperCase() : null;
}

