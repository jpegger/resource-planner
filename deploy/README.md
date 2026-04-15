# Deploying Resource Planner (Docker / Kubernetes / OpenShift)

The app is a **Next.js standalone** Node server. The production image is built by the **`Dockerfile`** at the repository root.

## What runs where

| Component | Notes |
|-----------|--------|
| **App container** | `node server.js` (from Next standalone). Listens on **`PORT`** (default **8080**). |
| **PostgreSQL** | Not included in the app image. Provide a managed DB or run Postgres separately. |
| **Migrations** | Run **`prisma migrate deploy`** against the target database **before** or as part of rollout — not automatically on every pod start. From a machine with this repo: `DATABASE_URL=... npm run db:migrate`. |
| **Heavy seeds** | `npm run db:seed:prod` and similar are **operational** scripts; run from CI or an admin job when needed, not as the default container command. |

## Health checks

- **`GET /api/health`** — returns `200` and `{ "ok": true }`. Use for **liveness** and **readiness** (no DB call — DB outages should not kill the pod).

## Local image without a registry

Build and tag locally:

```bash
docker build -t resource-planner:local .
```

Run against a Postgres you already have (example):

```bash
docker run --rm -p 3000:8080 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public" \
  resource-planner:local
```

Open `http://localhost:3000` (host port mapped to container **8080**).

### Compose: DB only (default)

```bash
docker compose up -d
```

This starts **`db`** only (`resource-planner-db` on port **5432**), same as `npm run db:up`.

### Compose: app + DB (full stack, no registry)

```bash
docker compose --profile app up -d --build
```

App is at `http://localhost:3000`. Apply migrations once the DB is up:

```bash
DATABASE_URL="postgresql://admin:admin@localhost:5432/resource_planner?schema=public" npm run db:migrate
```

## When you get a container registry

Typical flow:

1. **Build** in CI: `docker build -t <registry>/<project>/resource-planner:<git-sha> .`
2. **Push** to the registry.
3. **Deploy** the same tag to dev/stage/prod with environment-specific **Secrets** (e.g. `DATABASE_URL`).

OpenShift: use **ImageStream** + **BuildConfig** (Docker strategy) or build in CI and **`oc import-image`** / push to the internal registry.

## OpenShift-oriented defaults

The image runs as **non-root** (`uid 1001`). **`PORT`** defaults to **8080** (common on OpenShift). Set **`DATABASE_URL`** from a **Secret**.

Example probes (adjust path/port to your Route/Service):

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 8080
readinessProbe:
  httpGet:
    path: /api/health
    port: 8080
```

See `deploy/kubernetes/` for minimal sample manifests.
