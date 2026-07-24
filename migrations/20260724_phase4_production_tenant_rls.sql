-- Phase 4: Production tenant RLS hardening for legacy and unified tables
-- Idempotent and safe to re-run.
--
-- Tenant identity source priority:
-- 1) JWT claim mcp_tenant_id (recommended for token-based tenant scope)
-- 2) auth.uid()::text fallback
--
-- Note: backend service-role key should still be used for server-side writes.

BEGIN;

-- Helper expression note used across policies:
-- COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)

-- Legacy tables
ALTER TABLE IF EXISTS entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS metrics ENABLE ROW LEVEL SECURITY;

-- Unified tables
ALTER TABLE IF EXISTS objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS collections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Remove overly broad legacy policy names if present.
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

DO $$
BEGIN
  -- Legacy policies
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='entities' AND policyname='tenant_isolation_entities_v2'
  ) THEN
    CREATE POLICY tenant_isolation_entities_v2 ON entities FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='activities' AND policyname='tenant_isolation_activities_v2'
  ) THEN
    CREATE POLICY tenant_isolation_activities_v2 ON activities FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='metrics' AND policyname='tenant_isolation_metrics_v2'
  ) THEN
    CREATE POLICY tenant_isolation_metrics_v2 ON metrics FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;

  -- Unified policies
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='objects' AND policyname='tenant_isolation_objects_v2'
  ) THEN
    CREATE POLICY tenant_isolation_objects_v2 ON objects FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='relations' AND policyname='tenant_isolation_relations_v2'
  ) THEN
    CREATE POLICY tenant_isolation_relations_v2 ON relations FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='events' AND policyname='tenant_isolation_events_v2'
  ) THEN
    CREATE POLICY tenant_isolation_events_v2 ON events FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='history' AND policyname='tenant_isolation_history_v2'
  ) THEN
    CREATE POLICY tenant_isolation_history_v2 ON history FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='attachments' AND policyname='tenant_isolation_attachments_v2'
  ) THEN
    CREATE POLICY tenant_isolation_attachments_v2 ON attachments FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='jobs' AND policyname='tenant_isolation_jobs_v2'
  ) THEN
    CREATE POLICY tenant_isolation_jobs_v2 ON jobs FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='collections' AND policyname='tenant_isolation_collections_v2'
  ) THEN
    CREATE POLICY tenant_isolation_collections_v2 ON collections FOR ALL
      USING (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      )
      WITH CHECK (
        user_id = COALESCE(NULLIF(auth.jwt() ->> 'mcp_tenant_id', ''), auth.uid()::text)
      );
  END IF;
END $$;

COMMIT;

-- Verification queries:
-- SELECT tablename, policyname
-- FROM pg_policies
-- WHERE schemaname='public'
--   AND tablename IN (
--     'entities','activities','metrics','objects','relations','events','history','attachments','jobs','collections'
--   )
-- ORDER BY tablename, policyname;
