CREATE EXTENSION IF NOT EXISTS postgis;

-- metadata registry
CREATE TABLE IF NOT EXISTS datasets (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,          -- geojson | csv-points
  table_name text NOT NULL,
  created_at timestamptz DEFAULT now()
);
