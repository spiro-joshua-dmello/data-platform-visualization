# Kepler-lite — Setup Guide

Upload GeoJSON and CSV files, generate vector tiles, and visualize them on an interactive map.

## Architecture

```
data-visualization-plat/
├── docker-compose.yml                  ← orchestrates all services
├── postgres/
│   ├── martin.yaml                     ← Martin tile server config
│   └── migrations/
│       └── 001_init.sql                ← database schema (runs automatically)
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

From the project root, run:

```bash
docker compose up --build
```

This single command does everything in order:

1. Starts PostGIS and waits until it is healthy
2. Runs `001_init.sql` — creates the PostGIS extension, all tables, and all indexes — then exits
3. Starts Martin (tile server) once migrations complete
4. Builds and starts the upload API
5. Builds and starts the frontend

Once all services are up, open **http://localhost:5173** in your browser.

> The first run takes a few minutes because Docker builds the upload service and frontend images. Subsequent starts are much faster.

---

## Verifying everything is running

Check that all containers are healthy:

```bash
docker compose ps
```

You should see `db`, `martin`, `upload-service`, and `frontend` all running (the `migrate` container will show as `Exited (0)` — that is expected).

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

## Re-running migrations

The migration script (`001_init.sql`) runs automatically on first boot when the `pg_data` volume is empty. It uses `CREATE TABLE IF NOT EXISTS` throughout, so it is safe to run again manually without destroying data:

```bash
docker compose run --rm migrate
```

---

## Updating the schema

To add a new migration, create a new file in `postgres/migrations/` — for example `002_add_column.sql` — and update the `migrate` service command in `docker-compose.yml` to reference it, or chain both files:

```yaml
command: >
  sh -c "psql -h db -U postgres -d kepler -f /migrations/001_init.sql &&
         psql -h db -U postgres -d kepler -f /migrations/002_add_column.sql"
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

If you see `relation "points" does not exist` errors from the upload service, the migrate container may have failed. Check its logs:

```bash
docker compose logs migrate
```

Then re-run manually:

```bash
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