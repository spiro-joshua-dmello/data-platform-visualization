docker exec -i kepler-postgis psql -U postgres -d postgres -c "
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS datasets (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  table_name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

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
  geom geometry(MultiPolygon, 4326) NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS points_geom_idx   ON points   USING GIST(geom);
CREATE INDEX IF NOT EXISTS lines_geom_idx    ON lines    USING GIST(geom);
CREATE INDEX IF NOT EXISTS polygons_geom_idx ON polygons USING GIST(geom);

CREATE INDEX IF NOT EXISTS points_dataset_idx   ON points(dataset_id);
CREATE INDEX IF NOT EXISTS lines_dataset_idx    ON lines(dataset_id);
CREATE INDEX IF NOT EXISTS polygons_dataset_idx ON polygons(dataset_id);
"