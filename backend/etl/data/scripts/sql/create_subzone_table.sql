-- SQL script to create subzone table with PostGIS geometry support
-- Run this in your Supabase SQL editor before uploading data

-- Drop table if it exists
DROP TABLE IF EXISTS subzone CASCADE;

-- Create the subzone table
CREATE TABLE subzone (
    sz_id INTEGER PRIMARY KEY,    -- Unique subzone identifier (primary key)
    subzone_n VARCHAR(255) NOT NULL,
    pa_id INTEGER,                     -- Planning area ID (foreign key reference)
    pln_area_n VARCHAR(255) NOT NULL,
    area NUMERIC(10, 4),               -- Area in square kilometers
    population INTEGER,                -- Population count
    population_density NUMERIC(10, 2), -- Population density (people per sq km)
    geom GEOMETRY(GEOMETRY, 4326) NOT NULL, -- Supports both Polygon and MultiPolygon
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_subzone_geom ON subzone USING GIST (geom);
CREATE INDEX idx_subzone_name ON subzone (subzone_n);
CREATE INDEX idx_subzone_pa_id ON subzone (pa_id);
CREATE INDEX idx_subzone_planning_area ON subzone (pln_area_n);

-- Add comments for documentation
COMMENT ON TABLE subzone IS 'Singapore subzone boundaries with PostGIS geometry data';
COMMENT ON COLUMN subzone.sz_id IS 'Unique subzone identifier (primary key)';
COMMENT ON COLUMN subzone.subzone_n IS 'Subzone name';
COMMENT ON COLUMN subzone.pa_id IS 'Planning area ID reference';
COMMENT ON COLUMN subzone.pln_area_n IS 'Planning area name that this subzone belongs to';
COMMENT ON COLUMN subzone.area IS 'Area in square kilometers';
COMMENT ON COLUMN subzone.population IS 'Population count';
COMMENT ON COLUMN subzone.population_density IS 'Population density (people per sq km)';
COMMENT ON COLUMN subzone.geom IS 'PostGIS geometry data in EPSG:4326 coordinate system';

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_subzone_updated_at 
    BEFORE UPDATE ON subzone 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
