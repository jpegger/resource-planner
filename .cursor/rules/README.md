# Resource Planner — Cursor Rules

Drop the `.cursor/` folder at the root of the repository alongside `package.json`.

## Files

| File | Scope | Always on? |
|---|---|---|
| `00-persona.mdc` | All files | Yes |
| `05-clean-code.mdc` | `**/*.{ts,tsx,js,jsx}` | No — triggered by glob |
| `10-nextjs-app-router.mdc` | `src/app/**` | No — triggered by glob |
| `20-server-client-boundaries.mdc` | `src/app/**/*.tsx`, `src/components/**/*.tsx` | No |
| `30-typescript-quality.mdc` | `**/*.ts`, `**/*.tsx` | No |
| `40-api-routes.mdc` | `src/app/api/**/*.ts` | No |
| `50-prisma-data-access.mdc` | `src/lib/**`, `src/app/api/**`, `scripts/**` | No |
| `60-business-logic.mdc` | `src/lib/**`, `src/app/api/**`, `scripts/**` | No |
| `70-powerbi-sql.mdc` | `scripts/**`, `prisma/**` | No |
| `80-styling.mdc` | `src/app/**/*.tsx`, `src/components/**/*.tsx` | No |
| `90-dev-workflow.mdc` | WSL, env, seeds, migrations (reference — no glob) | No |

## Design Principles

- `00-persona.mdc` is the only `alwaysApply: true` file — it sets the AI's behaviour globally.
- All other files are scoped by `globs` so Cursor only loads relevant rules for the file
  being edited. This keeps context usage low and rules precise.
- `60-business-logic.mdc` is the most critical file — always read it before touching
  any cost, rate, allocation, or EOTP code.

## Sources

Rules are derived from:
- cursorrules.org best practices (Jun 2025)
- LogRocket Cursor + Next.js guide (Sep 2025)
- Builder.io Cursor setup guide (Mar 2026)
- awesome-cursorrules / PatrickJS (community)
- CONTEXT.md — Resource Planner design document (Paradigm, Apr 2026)
