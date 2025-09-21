-- Create road_network table for storing GeoJSON LineString data
-- This script should be run in Supabase SQL editor before running the upload script

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS road_network (
    id SERIAL PRIMARY KEY,
    rd_name VARCHAR(255),
    mntnc_agency_txt VARCHAR(255),
    rd_typ_cd VARCHAR(100),
    lvl_of_rd VARCHAR(100),
    unique_id VARCHAR(50) UNIQUE,
    inc_crc VARCHAR(50),
    fmel_upd_d VARCHAR(20),
    feature_id VARCHAR(20) UNIQUE,
    geometry GEOMETRY(LINESTRING, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_road_network_geometry ON road_network USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_road_network_rd_name ON road_network (rd_name);
CREATE INDEX IF NOT EXISTS idx_road_network_unique_id ON road_network (unique_id);
CREATE INDEX IF NOT EXISTS idx_road_network_feature_id ON road_network (feature_id);

-- Enable Row Level Security (optional)
-- ALTER TABLE road_network ENABLE ROW LEVEL SECURITY;

-- Create a policy to allow all operations (adjust as needed)
-- CREATE POLICY "Allow all operations on road_network" ON road_network FOR ALL USING (true);
