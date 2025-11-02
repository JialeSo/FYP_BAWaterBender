-- ACRA Companies Schema for Supabase (PostgreSQL)
-- This script ensures id is the first column by dropping and recreating if needed

-- Check if table exists and drop it to ensure correct column order
DROP TABLE IF EXISTS public.acra_companies CASCADE;

-- Create the acra_companies table with id as first column
CREATE TABLE public.acra_companies (
  id bigint PRIMARY KEY,
  uen text UNIQUE NOT NULL,
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
CREATE INDEX idx_acra_id ON public.acra_companies (id);
CREATE INDEX idx_acra_uen ON public.acra_companies (uen);
CREATE INDEX idx_acra_postal_code ON public.acra_companies (postal_code);
CREATE INDEX idx_acra_pa_id ON public.acra_companies (pa_id);
CREATE INDEX idx_acra_sz_id ON public.acra_companies (sz_id);
CREATE INDEX idx_acra_rn_id ON public.acra_companies (rn_id);

-- Update updated_at on each row modification
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_acra_updated_at
BEFORE UPDATE ON public.acra_companies
FOR EACH ROW
EXECUTE PROCEDURE public.set_updated_at();

-- Optional: comments for maintainers
COMMENT ON TABLE public.acra_companies IS 'ACRA companies with PA/SZ/RN mapping for 3-layers analytics';
COMMENT ON COLUMN public.acra_companies.id IS 'Primary key - unique identifier for each company record';
COMMENT ON COLUMN public.acra_companies.uen IS 'Unique Entity Number (ACRA business identifier, upsert target)';
COMMENT ON COLUMN public.acra_companies.amenity_name IS 'Company name (lowercase)';
COMMENT ON COLUMN public.acra_companies.street_name IS 'Street name (lowercase)';
COMMENT ON COLUMN public.acra_companies.building_name IS 'Building name (lowercase)';
COMMENT ON COLUMN public.acra_companies.postal_code IS 'Singapore postal code (6 digits)';
COMMENT ON COLUMN public.acra_companies.latitude IS 'Latitude coordinate (WGS84)';
COMMENT ON COLUMN public.acra_companies.longitude IS 'Longitude coordinate (WGS84)';
COMMENT ON COLUMN public.acra_companies.pa_id IS 'URA Planning Area ID';
COMMENT ON COLUMN public.acra_companies.sz_id IS 'URA Subzone ID';
COMMENT ON COLUMN public.acra_companies.rn_id IS 'Road Network segment ID';
COMMENT ON COLUMN public.acra_companies.planning_area IS 'Planning area name (lowercase)';
COMMENT ON COLUMN public.acra_companies.subzone IS 'Subzone name (lowercase)';
COMMENT ON COLUMN public.acra_companies.updated_at IS 'Timestamp of last update';
