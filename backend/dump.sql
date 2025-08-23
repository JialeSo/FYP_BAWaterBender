-- dump.sql
-- WARNING: Drops & recreates tables, then seeds data

BEGIN;

-- --- Clean slate -------------------------------------------------------------
DROP TABLE IF EXISTS public.status_logs CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.workshops CASCADE;
DROP TABLE IF EXISTS public.app_users CASCADE;

-- --- Extensions --------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --- Tables -----------------------------------------------------------------
CREATE TABLE public.app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  display_name  text,
  role          text        NOT NULL DEFAULT 'user',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.workshops (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text,
  address    text,
  city       text,
  rating     numeric(2,1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_update      timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  assigned_agent   text,  -- store username for simplicity
  customer_name    text NOT NULL,
  customer_phone   text NOT NULL,
  plate            text NOT NULL,
  vehicle          jsonb,
  breakdown_type   text NOT NULL,
  summary          text,
  location         jsonb,  -- {"addr": "..."}
  preferred_time   text DEFAULT 'asap',
  manual_assignment jsonb, -- {"workshop_name","workshop_phone","notes"}
  workshop_id      uuid REFERENCES public.workshops(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'pending',
  timestamps       jsonb NOT NULL DEFAULT '{"dispatched": null, "onsite": null, "completed": null}'::jsonb
);

CREATE TABLE public.status_logs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id  uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  "by"      text,
  action    text NOT NULL,
  "to"      text,
  note      text
);

-- --- Helpful indexes ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_created_at      ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status          ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_agent  ON public.orders (assigned_agent);
CREATE INDEX IF NOT EXISTS idx_orders_workshop_id     ON public.orders (workshop_id);
CREATE INDEX IF NOT EXISTS idx_status_logs_order_id   ON public.status_logs (order_id);

-- --- updated_at trigger for app_users ---------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_app_users_updated_at ON public.app_users;
CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --- Seed: admin -------------------------------------------------------------
INSERT INTO public.app_users (username, password_hash, display_name, role)
VALUES ('admin', crypt('admin123', gen_salt('bf')), 'Admin', 'admin')
ON CONFLICT (username) DO UPDATE
SET display_name = EXCLUDED.display_name,
    role         = EXCLUDED.role
RETURNING id;

-- --- Seed: sample workshops --------------------------------------------------
INSERT INTO public.workshops (name, phone, address, city, rating) VALUES
  ('Jakarta Battery Specialist', '+62 812-0000-1111', 'Jl. Sudirman No. 10', 'Jakarta', 4.7),
  ('Bandung Auto Service', '+62 811-2222-3333', 'Jl. Asia Afrika No. 25', 'Bandung', 4.5),
  ('Surabaya Car Care', '+62 813-4444-5555', 'Jl. Pemuda No. 88', 'Surabaya', 4.8);

COMMIT;
