-- ACRA Companies Schema for Supabase (PostgreSQL)
-- UEN is the primary key (unique business identifier)

-- Drop the existing table
DROP TABLE IF EXISTS acra_companies CASCADE;

-- Create the acra_companies table with uen as primary key
CREATE TABLE acra_companies (
  uen text PRIMARY KEY,  -- Unique Entity Number (business identifier)
  amenity_name text,
  street_name text,
  building_name text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  pa_id integer,
  sz_id integer,
  rn_id integer,
  planning_area text,
  subzone text,
  updated_at timestamptz DEFAULT now()
);

-- Useful indexes for filtering and spatial-join lookups
CREATE INDEX idx_acra_postal_code ON acra_companies (postal_code);
CREATE INDEX idx_acra_pa_id ON acra_companies (pa_id);
CREATE INDEX idx_acra_sz_id ON acra_companies (sz_id);
CREATE INDEX idx_acra_rn_id ON acra_companies (rn_id);

-- Update updated_at on each row modification
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_acra_updated_at
BEFORE UPDATE ON acra_companies
FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Optional: comments for maintainers
COMMENT ON TABLE acra_companies IS 'ACRA companies with PA/SZ/RN mapping for 3-layers analytics';
COMMENT ON COLUMN acra_companies.uen IS 'Unique Entity Number (ACRA business identifier, primary key)';
COMMENT ON COLUMN acra_companies.amenity_name IS 'Company name (lowercase)';
COMMENT ON COLUMN acra_companies.street_name IS 'Street name (lowercase)';
COMMENT ON COLUMN acra_companies.building_name IS 'Building name (lowercase)';
COMMENT ON COLUMN acra_companies.postal_code IS 'Singapore postal code (6 digits)';
COMMENT ON COLUMN acra_companies.latitude IS 'Latitude coordinate (WGS84)';
COMMENT ON COLUMN acra_companies.longitude IS 'Longitude coordinate (WGS84)';
COMMENT ON COLUMN acra_companies.pa_id IS 'URA Planning Area ID';
COMMENT ON COLUMN acra_companies.sz_id IS 'URA Subzone ID';
COMMENT ON COLUMN acra_companies.rn_id IS 'Road Network segment ID';
COMMENT ON COLUMN acra_companies.planning_area IS 'Planning area name (lowercase)';
COMMENT ON COLUMN acra_companies.subzone IS 'Subzone name (lowercase)';
COMMENT ON COLUMN acra_companies.updated_at IS 'Timestamp of last update';
