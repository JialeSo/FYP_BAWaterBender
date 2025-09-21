-- SQL script to create subzone table with PostGIS geometry support
-- Run this in your Supabase SQL editor before uploading data

-- Drop table if it exists (optional - uncomment if needed)
-- DROP TABLE IF EXISTS subzone CASCADE;

-- Create the subzone table
CREATE TABLE subzone (
    id SERIAL PRIMARY KEY,
    subzone_n VARCHAR(255) NOT NULL,
    pln_area_n VARCHAR(255) NOT NULL,
    subzone_id VARCHAR(50) NOT NULL UNIQUE,
    geom GEOMETRY(POLYGON, 4326) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_subzone_geom ON subzone USING GIST (geom);
CREATE INDEX idx_subzone_name ON subzone (subzone_n);
CREATE INDEX idx_subzone_planning_area ON subzone (pln_area_n);
CREATE INDEX idx_subzone_id ON subzone (subzone_id);

-- Add comments for documentation
COMMENT ON TABLE subzone IS 'Singapore subzone boundaries with PostGIS geometry data';
COMMENT ON COLUMN subzone.subzone_n IS 'Subzone name';
COMMENT ON COLUMN subzone.pln_area_n IS 'Planning area name that this subzone belongs to';
COMMENT ON COLUMN subzone.subzone_id IS 'Unique subzone identifier (e.g., SZ_001)';
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
