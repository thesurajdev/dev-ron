-- Safe legacy schema alignment for dev-ron
-- Goal: keep existing data, avoid drops, and make schema predictable.
-- Run this in Supabase SQL Editor as one script.

BEGIN;

-- 0) Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 1) Core tables (legacy runtime-compatible)
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_to JSONB NOT NULL DEFAULT '[]'::jsonb,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  source TEXT,
  confidence NUMERIC DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  involved_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value TEXT NOT NULL,
  entity_id UUID,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Add missing columns safely when table already exists
ALTER TABLE entities ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS related_to JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE entities ADD COLUMN IF NOT EXISTS confidence NUMERIC DEFAULT 100;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE entities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE activities ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE activities ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE metrics ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 3) Type alignment without destructive conversion
-- If involved_entities is UUID[] in an existing DB, keep it unchanged for now.
-- Add a companion JSONB column used by newer logic and backfill minimally.
DO $$
DECLARE
  current_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO current_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'activities'
    AND a.attname = 'involved_entities'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF current_type = 'uuid[]' THEN
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS involved_entities_v2 JSONB NOT NULL DEFAULT '[]'::jsonb;
    -- Optional light backfill: convert uuid[] to [{entity_id: "..."}] shape.
    UPDATE activities
    SET involved_entities_v2 = COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('entity_id', x::text, 'role', 'related'))
        FROM unnest(involved_entities) AS x
      ),
      '[]'::jsonb
    )
    WHERE involved_entities_v2 = '[]'::jsonb;
  END IF;
END $$;

-- If metrics.value exists as numeric, keep it; if text, keep it.
-- Current runtime can be adjusted per deployment. No destructive cast here.

-- 4) RLS enabled
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;

-- 5) Drop unsafe allow-all policies if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'entities' AND policyname = 'Allow all'
  ) THEN
    DROP POLICY "Allow all" ON entities;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'activities' AND policyname = 'Allow all'
  ) THEN
    DROP POLICY "Allow all" ON activities;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'metrics' AND policyname = 'Allow all'
  ) THEN
    DROP POLICY "Allow all" ON metrics;
  END IF;
END $$;

-- 6) Safer tenant policy (user_id = auth.uid()::text)
-- Note: for service role backend, RLS is bypassed by default in Supabase.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'entities' AND policyname = 'tenant_isolation_entities'
  ) THEN
    CREATE POLICY tenant_isolation_entities
      ON entities FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'activities' AND policyname = 'tenant_isolation_activities'
  ) THEN
    CREATE POLICY tenant_isolation_activities
      ON activities FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'metrics' AND policyname = 'tenant_isolation_metrics'
  ) THEN
    CREATE POLICY tenant_isolation_metrics
      ON metrics FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;
END $$;

-- 7) Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_entities_user_id ON entities(user_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_data ON entities USING GIN(data);
CREATE INDEX IF NOT EXISTS idx_entities_tags ON entities USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_entities_created ON entities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entities_updated ON entities(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_involved_jsonb ON activities USING GIN(involved_entities);
CREATE INDEX IF NOT EXISTS idx_activities_involved_v2_jsonb ON activities USING GIN(involved_entities_v2);

CREATE INDEX IF NOT EXISTS idx_metrics_user_id ON metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_entity ON metrics(entity_id);

COMMIT;

-- Post-run checks
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('entities','activities','metrics');
-- SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('entities','activities','metrics');
