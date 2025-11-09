-- Drop table if it exists
DROP TABLE IF EXISTS planning_area CASCADE;

-- Create the planning_area table for Singapore planning areas with PostGIS geometry support
CREATE TABLE planning_area (
    pa_id INTEGER PRIMARY KEY,       -- Area ID from GeoJSON (primary key)
    pln_area_n VARCHAR(100) NOT NULL,  -- Planning area name (e.g., "BEDOK", "BOON LAY")
    area NUMERIC(10, 4),               -- Area in square kilometers
    population INTEGER,                -- Population count
    population_density NUMERIC(10, 2), -- Population density (people per sq km)
    geom GEOMETRY(GEOMETRY, 4326),     -- PostGIS geometry column for polygons/multipolygons
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_planning_area_pln_area_n ON planning_area (pln_area_n);

-- Create spatial index for geometry column (PostGIS)
CREATE INDEX idx_planning_area_geom ON planning_area USING GIST (geom);

-- Add comments for documentation
COMMENT ON TABLE planning_area IS 'Singapore planning areas with their boundaries';
COMMENT ON COLUMN planning_area.pa_id IS 'Unique identifier for the planning area (primary key)';
COMMENT ON COLUMN planning_area.pln_area_n IS 'Official planning area name';
COMMENT ON COLUMN planning_area.area IS 'Area in square kilometers';
COMMENT ON COLUMN planning_area.population IS 'Population count';
COMMENT ON COLUMN planning_area.population_density IS 'Population density (people per sq km)';
COMMENT ON COLUMN planning_area.geom IS 'Geometry boundaries of the planning area (SRID 4326)';