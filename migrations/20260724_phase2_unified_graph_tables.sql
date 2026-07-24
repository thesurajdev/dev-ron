-- Phase 2: create unified graph tables in parallel (non-destructive)
-- Safe to run with existing entities/activities/metrics tables.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 1) objects
CREATE TABLE IF NOT EXISTS objects (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  status TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_objects_user_id ON objects(user_id);
CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);
CREATE INDEX IF NOT EXISTS idx_objects_status ON objects(status);
CREATE INDEX IF NOT EXISTS idx_objects_properties_gin ON objects USING GIN(properties);
CREATE INDEX IF NOT EXISTS idx_objects_title_trgm ON objects USING GIN(title gin_trgm_ops);

-- 2) relations
CREATE TABLE IF NOT EXISTS relations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  from_object UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  to_object UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  confidence NUMERIC NOT NULL DEFAULT 100,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, from_object, relation, to_object)
);

CREATE INDEX IF NOT EXISTS idx_relations_user_id ON relations(user_id);
CREATE INDEX IF NOT EXISTS idx_relations_from_object ON relations(from_object);
CREATE INDEX IF NOT EXISTS idx_relations_to_object ON relations(to_object);
CREATE INDEX IF NOT EXISTS idx_relations_relation ON relations(relation);

-- 3) events
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE SET NULL,
  performed_by UUID REFERENCES objects(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_object_id ON events(object_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_payload_gin ON events USING GIN(payload);

-- 4) history
CREATE TABLE IF NOT EXISTS history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  object_id UUID REFERENCES objects(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB,
  changed_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_object_id ON history(object_id);
CREATE INDEX IF NOT EXISTS idx_history_event_id ON history(event_id);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);

-- 5) attachments
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT,
  mime_type TEXT,
  storage_path TEXT,
  url TEXT,
  size_bytes BIGINT,
  checksum TEXT,
  object_id UUID REFERENCES objects(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  activity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_user_id ON attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_object_id ON attachments(object_id);
CREATE INDEX IF NOT EXISTS idx_attachments_event_id ON attachments(event_id);
CREATE INDEX IF NOT EXISTS idx_attachments_activity_id ON attachments(activity_id);

-- 6) jobs
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error JSONB,
  run_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_run_at ON jobs(run_at);

-- 7) collections (optional but recommended)
CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'dynamic',
  query JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS collection_objects (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, object_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_objects_object_id ON collection_objects(object_id);

-- RLS for user-scoped tables
ALTER TABLE objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE history ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='objects' AND policyname='tenant_isolation_objects'
  ) THEN
    CREATE POLICY tenant_isolation_objects ON objects FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='relations' AND policyname='tenant_isolation_relations'
  ) THEN
    CREATE POLICY tenant_isolation_relations ON relations FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='events' AND policyname='tenant_isolation_events'
  ) THEN
    CREATE POLICY tenant_isolation_events ON events FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='history' AND policyname='tenant_isolation_history'
  ) THEN
    CREATE POLICY tenant_isolation_history ON history FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='attachments' AND policyname='tenant_isolation_attachments'
  ) THEN
    CREATE POLICY tenant_isolation_attachments ON attachments FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='jobs' AND policyname='tenant_isolation_jobs'
  ) THEN
    CREATE POLICY tenant_isolation_jobs ON jobs FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='collections' AND policyname='tenant_isolation_collections'
  ) THEN
    CREATE POLICY tenant_isolation_collections ON collections FOR ALL
      USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);
  END IF;
END $$;

COMMIT;

-- Post-run checks:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema='public' AND table_name IN
-- ('objects','relations','events','history','attachments','jobs','collections','collection_objects');
--
-- SELECT schemaname, tablename, policyname
-- FROM pg_policies
-- WHERE schemaname='public' AND tablename IN
-- ('objects','relations','events','history','attachments','jobs','collections')
-- ORDER BY tablename, policyname;
