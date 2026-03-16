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
  geom geometry(Polygon, 4326) NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS points_geom_idx   ON points   USING GIST(geom);
CREATE INDEX IF NOT EXISTS lines_geom_idx    ON lines    USING GIST(geom);
CREATE INDEX IF NOT EXISTS polygons_geom_idx ON polygons USING GIST(geom);
CREATE INDEX IF NOT EXISTS points_dataset_idx   ON points(dataset_id);
CREATE INDEX IF NOT EXISTS lines_dataset_idx    ON lines(dataset_id);
CREATE INDEX IF NOT EXISTS polygons_dataset_idx ON polygons(dataset_id);
"
```

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

## Troubleshooting

**Port 15432 already in use**
```bash
lsof -i :15432        # find the PID
kill -9 <PID>
```

**Martin not showing tables at localhost:3000/catalog**
```bash
docker compose logs martin   # check for errors
docker compose restart martin
```

**Upload service can't connect to database**

Make sure Docker is running and the DB container is healthy:
```bash
docker ps | grep kepler-postgis
```

**`relation "points" does not exist`**

Run the database schema initialization command from the Setup section above.
