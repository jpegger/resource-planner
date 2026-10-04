<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

- The image Node satisfies `package.json` `engines` (`>=20.19`). `npm ci` regenerates the Prisma client in `postinstall`.
- Postgres is Docker Compose (`npm run db:up`): container `resource-planner-db`, `admin` / `admin` / `resource_planner` on `127.0.0.1:5432`. Cloud Agent startup starts Docker, creates `.env` when missing, runs `npm run db:migrate`, and seeds only when `resource` is empty. Do not re-run `npm run db:seed:prod` on a populated database — allocation rows are additive. Without prod-import CSVs, that seed falls back to `scripts/datasets/dev`.
- Dev server: `npm run dev` on port 3000. Liveness: `GET /api/health`. Primary UI: `/investments`.
- `npm test` needs Postgres. `npx tsc --noEmit` and `npm run build` are the type and production checks. `npm run lint` currently fails on existing repository issues.
- Jira credentials and `PROD_IMPORT_XLSX_PATH` are optional.
