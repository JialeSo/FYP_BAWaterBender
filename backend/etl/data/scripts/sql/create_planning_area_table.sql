-- Create the planning_area table for Singapore planning areas with PostGIS geometry support
CREATE TABLE planning_area (
    id BIGSERIAL PRIMARY KEY,
    pln_area_n VARCHAR(100) NOT NULL,  -- Planning area name (e.g., "BEDOK", "BOON LAY")
    area_id VARCHAR(20) NOT NULL,      -- Area ID from GeoJSON (e.g., "PA_01", "PA_02")
    geom GEOMETRY(GEOMETRY, 4326),     -- PostGIS geometry column for polygons/multipolygons
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_planning_area_pln_area_n ON planning_area (pln_area_n);
CREATE INDEX idx_planning_area_area_id ON planning_area (area_id);
CREATE UNIQUE INDEX idx_planning_area_area_id_unique ON planning_area (area_id);

-- Create spatial index for geometry column (PostGIS)
CREATE INDEX idx_planning_area_geom ON planning_area USING GIST (geom);

-- Add comments for documentation
COMMENT ON TABLE planning_area IS 'Singapore planning areas with their boundaries';
COMMENT ON COLUMN planning_area.pln_area_n IS 'Official planning area name';
COMMENT ON COLUMN planning_area.area_id IS 'Unique identifier for the planning area';
COMMENT ON COLUMN planning_area.geom IS 'Geometry boundaries of the planning area (SRID 4326)';