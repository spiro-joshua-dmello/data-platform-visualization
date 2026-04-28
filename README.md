# Kepler-lite — Setup Guide

Upload GeoJSON and CSV files, generate vector tiles, and visualize them on an interactive map.

## Architecture

```
data-visualization-plat/
├── docker-compose.yml                  ← orchestrates all services
├── postgres/
│   ├── martin.yaml                     ← Martin tile server config
│   └── migrations/
│       └── 001_init.sql                ← database schema (run separately)
├── kepler-backend/
│   └── upload-service/
│       ├── Dockerfile
│       └── src/server.ts               ← Bun/Hono REST API
└── kepler-lite/
    ├── Dockerfile
    └── src/                            ← Vite/React frontend
```

| Service        | URL                       | Description                          |
|----------------|---------------------------|--------------------------------------|
| Frontend       | http://localhost:5173     | React map UI                         |
| Upload API     | http://localhost:8787     | File upload & processing             |
| Martin tiles   | http://localhost:3000     | Vector tile server                   |
| PostGIS        | localhost:15432           | PostgreSQL + PostGIS database        |

---

## Prerequisites

Install these before anything else.

**Docker Desktop** — runs all services as containers.
Download from https://www.docker.com/products/docker-desktop and make sure it is running before proceeding.

**Bun** — JavaScript runtime used by the upload API and frontend.

```bash
curl -fsSL https://bun.sh/install | bash
```

Verify both are installed:

```bash
docker --version
bun --version
```

---

## File placement

The files generated alongside this guide need to be placed in the right locations before running anything.

| File | Where it goes |
|------|---------------|
| `docker-compose.yml` | project root (`data-visualization-plat/`) |
| `001_init.sql` | `postgres/migrations/001_init.sql` |
| `upload-service.Dockerfile` | `kepler-backend/upload-service/Dockerfile` |
| `frontend.Dockerfile` | `kepler-lite/Dockerfile` |

---

## Starting the project

Migrations must be run before starting the app for the first time. See [Running migrations](#running-migrations) below.

**Step 1 — start the database:**

```bash
docker compose up -d db
```

**Step 2 — run migrations:**

```bash
docker compose run --rm migrate
```

**Step 3 — start the rest of the stack:**

```bash
docker compose up --build
```

This starts Martin, the upload API, and the frontend. The `--build` flag is needed on the first run (or after code changes). Subsequent starts are faster:

```bash
docker compose up
```

Once all services are up, open **http://localhost:5173** in your browser.

> The first build takes a few minutes because Docker builds the upload service and frontend images.

---

## Verifying everything is running

Check that all containers are healthy:

```bash
docker compose ps
```

You should see `db`, `martin`, `upload-service`, and `frontend` all running.

Spot-check individual services:

```bash
# Martin tile catalog — should list points, lines, polygons
open http://localhost:3000/catalog

# Upload API health — should return JSON with dbOk: true
open http://localhost:8787/health

# Frontend
open http://localhost:5173
```

---

## Stopping the project

```bash
docker compose down
```

This stops and removes the containers but keeps the database volume (`pg_data`), so your data is preserved on the next start.

To stop and wipe all data (full reset):

```bash
docker compose down -v
```

---

## Running migrations

The `migrate` service is decoupled from the main stack and must be run explicitly. It is not started by `docker compose up`.

### Running migrations

Make sure the database is running first:

```bash
docker compose up -d db
```

Then run migrations:

```bash
docker compose run --rm migrate
```

`--rm` removes the container automatically when done. You'll see psql output confirming each statement. The command exits with code `0` on success.

**Verify the migration ran:**

```bash
docker exec -it kegler-postgis psql -U postgres -d kepler -c "\dt"
```

You should see `datasets`, `points`, `lines`, and `polygons` listed.

### Re-running migrations

The migration script uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout, so it is safe to run multiple times — it will not destroy or duplicate existing data:

```bash
docker compose run --rm migrate
```

### Adding a new migration

Create a new file in `postgres/migrations/` — for example `002_add_column.sql` — then update the `migrate` service command in `docker-compose.yml` to chain both files:

```yaml
command: >
  sh -c "psql -h db -U postgres -d kepler -f /migrations/001_init.sql &&
         psql -h db -U postgres -d kepler -f /migrations/002_add_column.sql"
```

Then apply it:

```bash
docker compose run --rm migrate
```

---

## Troubleshooting

**Port already in use**

If any port conflicts with something already running on your machine:

```bash
# Find what is using a port (example: 15432)
lsof -i :15432
kill -9 <PID>
```

The ports used are `15432` (PostGIS), `3000` (Martin), `8787` (upload API), and `5173` (frontend).

**Migrations did not run**

If you see `relation "points" does not exist` errors from the upload service, migrations haven't been applied yet. Run them:

```bash
docker compose up -d db
docker compose run --rm migrate
```

**Martin not listing tables**

```bash
docker compose logs martin
```

Martin requires the PostGIS tables to exist before it starts. If it started before migrations completed, restart it:

```bash
docker compose restart martin
```

**Upload service cannot connect to the database**

```bash
docker compose logs upload-service
```

Make sure the `db` container is healthy:

```bash
docker compose ps db
```

**Frontend is blank or shows fetch errors**

The frontend talks to the upload API on `http://localhost:8787` and tiles on `http://localhost:3000`. Both must be running. Check:

```bash
docker compose ps
docker compose logs upload-service
docker compose logs martin
```

**Full reset**

If something is badly broken, wipe everything and start fresh:

```bash
docker compose down -v
docker compose up --build
```
