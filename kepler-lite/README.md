# Kepler-lite — Data Visualization Platform

Upload GeoJSON / CSV files, generate vector tiles, and visualize them on an interactive map.

## Architecture

```
data-visualization-plat/
├── postgres/               # Docker — PostGIS database + Martin tile server
├── kepler-backend/
│   └── upload-service/     # Bun — REST API for file upload & processing
└── kepler-lite/            # Vite/React — Frontend map application
```

| Service        | URL                          | Description                        |
|----------------|------------------------------|------------------------------------|
| Frontend       | http://localhost:5173        | React map UI                       |
| Upload API     | http://localhost:8787        | File upload & processing           |
| Martin tiles   | http://localhost:3000        | Vector tile server                 |
| PostGIS        | localhost:15432              | PostgreSQL + PostGIS database      |

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Bun](https://bun.sh) — `curl -fsSL https://bun.sh/install | bash`
- Node.js 18+

---

## Setup (first time only)

### 1. Install frontend dependencies

```bash
cd kepler-lite
bun install
```

### 2. Install backend dependencies

```bash
cd kepler-backend/upload-service
bun install
```

### 3. Start the database and tile server

```bash
cd postgres
docker compose up -d
```

Wait a few seconds for Postgres to initialize, then verify Martin is running:

```bash
open http://localhost:3000/catalog
```

You should see `points`, `lines`, and `polygons` listed.

### 4. Initialize the database schema (first time only)

If the tables don't exist yet, run:

```bash
docker exec -it kepler-postgis psql -U postgres -d kepler -c "
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL,
  geom geometry(LineString, 4326) NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS polygons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL,
  geom geometry(Geometry, 4326) NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS datasets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  kind       text NOT NULL,
  table_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS points_geom_idx      ON points   USING GIST(geom);
CREATE INDEX IF NOT EXISTS lines_geom_idx       ON lines    USING GIST(geom);
CREATE INDEX IF NOT EXISTS polygons_geom_idx    ON polygons USING GIST(geom);
CREATE INDEX IF NOT EXISTS points_dataset_idx   ON points(dataset_id);
CREATE INDEX IF NOT EXISTS lines_dataset_idx    ON lines(dataset_id);
CREATE INDEX IF NOT EXISTS polygons_dataset_idx ON polygons(dataset_id);
"
```

> **Note:** The `polygons.geom` column uses the generic `geometry(Geometry, 4326)` type (not `Polygon`) to support both Polygon and MultiPolygon uploads.

> **Note:** The `datasets` table is required for the Dataset Catalog panel. If you see an HTTP 500 on the catalog, this table is missing — run the command above.

---

## Running the project

Open **3 terminal tabs** and run one command in each:

### Tab 1 — Database & tile server

```bash
cd ~/data-visualization-plat/postgres
docker compose up -d
```

### Tab 2 — Upload API

```bash
cd ~/data-visualization-plat/kepler-backend/upload-service
bun run src/server.ts
```

Expected output:
```
DATABASE_URL = postgres://postgres:postgres@127.0.0.1:15432/kepler
Upload service running → http://localhost:8787
```

### Tab 3 — Frontend

```bash
cd ~/data-visualization-plat/kepler-lite
bun dev
```

Expected output:
```
  VITE v6.x.x  ready in Xms
  ➜  Local:   http://localhost:5173/
```

Then open **http://localhost:5173** in your browser.

---

## Stopping the project

```bash
# Stop Docker services
cd ~/data-visualization-plat/postgres
docker compose down

# Stop the Bun processes with Ctrl+C in their respective terminals
```

---

## Troubleshooting

**Port 15432 already in use**
```bash
lsof -i :15432        # find the PID
kill -9 <PID>
```

**Martin not showing tables at localhost:3000/catalog**
```bash
cd postgres
docker compose logs martin   # check for errors
docker compose restart martin
```

**Martin fails with `postgis_lib_version() does not exist`**

PostGIS extension is not enabled in the `kepler` database. Run:
```bash
docker exec -it kepler-postgis psql -U postgres -d kepler -c "CREATE EXTENSION IF NOT EXISTS postgis;"
docker compose restart martin
```

**Martin config file not loading (`No such file or directory`)**

Make sure `postgres/docker-compose.yml` has the volume mount for `martin.yaml`:
```yaml
  martin:
    volumes:
      - ./martin.yaml:/config.yaml
    command: ["--config", "/config.yaml"]
```

Then force recreate the container:
```bash
docker compose up -d --force-recreate martin
```

**Dataset Catalog shows HTTP 500**

The `datasets` table is missing. Run the schema initialization command from Setup step 4 above.

**Tiles not loading in the map (MapLibre `Failed to fetch` errors)**

Martin tile URLs must go through the Vite proxy to avoid CORS issues. Tile URLs should use `/martin/` prefix (e.g. `/martin/points/{z}/{x}/{y}`), not `http://localhost:3000` directly. Check that `vite.config.ts` has the proxy configured:
```ts
server: {
  proxy: {
    "/martin": {
      target: "http://localhost:3000",
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/martin/, ""),
    },
  },
},
```

**`relation "points" does not exist`**

Run the database schema initialization command from Setup step 4 above.

**Upload service can't connect to database**

Make sure Docker is running and the DB container is healthy:
```bash
docker ps | grep kepler-postgis
```

**Polygon upload fails with `Geometry type (MultiPolygon) does not match column type (Polygon)`**

The `polygons` table was created with a strict `geometry(Polygon, 4326)` type. Migrate it to the generic type:
```bash
docker exec -it kepler-postgis psql -U postgres -d kepler -c "
ALTER TABLE polygons ALTER COLUMN geom TYPE geometry(Geometry, 4326) USING ST_Force2D(geom);
"
```

**Features disappearing at low zoom levels**

Martin must load `martin.yaml` (not auto-detect) to use the correct tile buffer settings. Verify Martin is using the config file:
```bash
docker compose logs martin | grep "Using /config.yaml"
```

If the line is missing, the volume mount is not working — see the "Martin config file not loading" section above.