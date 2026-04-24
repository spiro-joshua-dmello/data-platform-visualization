-- postgres/initdb/001_init.sql
-- Runs automatically on first `docker compose up` via /docker-entrypoint-initdb.d

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Datasets registry
CREATE TABLE IF NOT EXISTS datasets (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  kind       text        NOT NULL,
  table_name text        NOT NULL,
  project_id text        NOT NULL DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Point features
CREATE TABLE IF NOT EXISTS points (
  id         uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid                     NOT NULL,
  project_id text                     NOT NULL DEFAULT 'default',
  geom       geometry(Point, 4326)    NOT NULL,
  props      jsonb                    NOT NULL DEFAULT '{}'
);

-- Line features
CREATE TABLE IF NOT EXISTS lines (
  id         uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid                        NOT NULL,
  project_id text                        NOT NULL DEFAULT 'default',
  geom       geometry(LineString, 4326)  NOT NULL,
  props      jsonb                       NOT NULL DEFAULT '{}'
);

-- Polygon features (generic geometry to support Polygon + MultiPolygon)
CREATE TABLE IF NOT EXISTS polygons (
  id         uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid                     NOT NULL,
  project_id text                     NOT NULL DEFAULT 'default',
  geom       geometry(Geometry, 4326) NOT NULL,
  props      jsonb                    NOT NULL DEFAULT '{}'
);

-- Spatial indexes
CREATE INDEX IF NOT EXISTS points_geom_idx   ON points   USING GIST(geom);
CREATE INDEX IF NOT EXISTS lines_geom_idx    ON lines    USING GIST(geom);
CREATE INDEX IF NOT EXISTS polygons_geom_idx ON polygons USING GIST(geom);

-- Dataset lookup indexes
CREATE INDEX IF NOT EXISTS points_dataset_idx   ON points(dataset_id);
CREATE INDEX IF NOT EXISTS lines_dataset_idx    ON lines(dataset_id);
CREATE INDEX IF NOT EXISTS polygons_dataset_idx ON polygons(dataset_id);

-- Project-scoped indexes
CREATE INDEX IF NOT EXISTS points_project_idx   ON points(project_id);
CREATE INDEX IF NOT EXISTS lines_project_idx    ON lines(project_id);
CREATE INDEX IF NOT EXISTS polygons_project_idx ON polygons(project_id);
CREATE INDEX IF NOT EXISTS datasets_project_idx ON datasets(project_id);