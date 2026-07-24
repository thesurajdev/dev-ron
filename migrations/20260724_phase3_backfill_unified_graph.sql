-- Phase 3: backfill unified graph tables from legacy tables
-- Source tables: entities, activities, metrics
-- Target tables: objects, relations, events, history
-- Idempotent and safe to re-run.

BEGIN;

-- 1) Backfill objects from entities (same UUID id)
INSERT INTO objects (
  id,
  user_id,
  type,
  title,
  status,
  properties,
  created_at,
  updated_at,
  deleted_at
)
SELECT
  e.id,
  e.user_id,
  COALESCE(NULLIF(e.entity_type, ''), 'unknown') AS type,
  COALESCE(
    NULLIF(e.data->>'title', ''),
    NULLIF(e.data->>'name', ''),
    NULLIF(e.data->>'company_name', ''),
    NULLIF(e.data->>'company', ''),
    NULLIF(e.data->>'subject', ''),
    NULLIF(e.data->>'invoice_no', ''),
    'Object ' || e.id::text
  ) AS title,
  NULLIF(e.data->>'status', '') AS status,
  COALESCE(e.data, '{}'::jsonb) AS properties,
  COALESCE(e.created_at, NOW()) AS created_at,
  COALESCE(e.updated_at, NOW()) AS updated_at,
  NULL::timestamptz AS deleted_at
FROM entities e
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  type = EXCLUDED.type,
  title = EXCLUDED.title,
  status = EXCLUDED.status,
  properties = EXCLUDED.properties,
  updated_at = EXCLUDED.updated_at;

-- 2) Backfill relations from entities.related_to JSONB
INSERT INTO relations (
  user_id,
  from_object,
  relation,
  to_object,
  confidence,
  properties,
  created_at
)
SELECT
  e.user_id,
  e.id AS from_object,
  COALESCE(NULLIF(r.value->>'relationship_type', ''), 'related_to') AS relation,
  (r.value->>'entity_id')::uuid AS to_object,
  100 AS confidence,
  jsonb_build_object('source', 'backfill:entities.related_to') AS properties,
  COALESCE(e.updated_at, NOW()) AS created_at
FROM entities e
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.related_to, '[]'::jsonb)) AS r(value)
WHERE (r.value->>'entity_id') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM objects o
    WHERE o.id = (r.value->>'entity_id')::uuid
  )
ON CONFLICT (user_id, from_object, relation, to_object) DO NOTHING;

-- 3) Backfill events from activities (deterministic ID by activity id)
INSERT INTO events (
  id,
  user_id,
  type,
  object_id,
  performed_by,
  timestamp,
  payload
)
SELECT
  (
    substr(md5('activity:' || a.id::text), 1, 8) || '-' ||
    substr(md5('activity:' || a.id::text), 9, 4) || '-' ||
    substr(md5('activity:' || a.id::text), 13, 4) || '-' ||
    substr(md5('activity:' || a.id::text), 17, 4) || '-' ||
    substr(md5('activity:' || a.id::text), 21, 12)
  )::uuid AS id,
  a.user_id,
  COALESCE(NULLIF(a.activity_type, ''), 'activity_logged') AS type,
  (
    SELECT x
    FROM unnest(COALESCE(a.involved_entities, ARRAY[]::uuid[])) AS x
    WHERE EXISTS (SELECT 1 FROM objects o WHERE o.id = x)
    LIMIT 1
  ) AS object_id,
  NULL::uuid AS performed_by,
  COALESCE(a.date, NOW()) AS timestamp,
  jsonb_build_object(
    'source', 'backfill:activities',
    'activity_id', a.id,
    'data', COALESCE(a.data, '{}'::jsonb),
    'tags', COALESCE(to_jsonb(a.tags), '[]'::jsonb)
  ) AS payload
FROM activities a
ON CONFLICT (id) DO NOTHING;

-- 4) Backfill events from metrics (deterministic ID by metric id)
INSERT INTO events (
  id,
  user_id,
  type,
  object_id,
  performed_by,
  timestamp,
  payload
)
SELECT
  (
    substr(md5('metric:' || m.id::text), 1, 8) || '-' ||
    substr(md5('metric:' || m.id::text), 9, 4) || '-' ||
    substr(md5('metric:' || m.id::text), 13, 4) || '-' ||
    substr(md5('metric:' || m.id::text), 17, 4) || '-' ||
    substr(md5('metric:' || m.id::text), 21, 12)
  )::uuid AS id,
  m.user_id,
  'metric_recorded' AS type,
  CASE
    WHEN m.entity_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM objects o WHERE o.id = m.entity_id)
    THEN m.entity_id
    ELSE NULL
  END AS object_id,
  NULL::uuid AS performed_by,
  COALESCE(m.date, NOW()) AS timestamp,
  jsonb_build_object(
    'source', 'backfill:metrics',
    'metric_id', m.id,
    'metric_name', m.metric_name,
    'value', m.value,
    'tags', COALESCE(to_jsonb(m.tags), '[]'::jsonb)
  ) AS payload
FROM metrics m
ON CONFLICT (id) DO NOTHING;

-- 5) Backfill history from entities.history[] JSONB
-- Uses deterministic UUID by entity id + array index.
INSERT INTO history (
  id,
  user_id,
  object_id,
  event_id,
  action,
  before_state,
  after_state,
  changed_fields,
  created_at
)
SELECT
  (
    substr(md5('history:' || e.id::text || ':' || h.idx::text), 1, 8) || '-' ||
    substr(md5('history:' || e.id::text || ':' || h.idx::text), 9, 4) || '-' ||
    substr(md5('history:' || e.id::text || ':' || h.idx::text), 13, 4) || '-' ||
    substr(md5('history:' || e.id::text || ':' || h.idx::text), 17, 4) || '-' ||
    substr(md5('history:' || e.id::text || ':' || h.idx::text), 21, 12)
  )::uuid AS id,
  e.user_id,
  e.id AS object_id,
  NULL::uuid AS event_id,
  COALESCE(NULLIF(h.item->>'action', ''), 'updated') AS action,
  NULL::jsonb AS before_state,
  COALESCE(h.item->'values', '{}'::jsonb) AS after_state,
  COALESCE(
    ARRAY(
      SELECT jsonb_array_elements_text(COALESCE(h.item->'fields_changed', '[]'::jsonb))
    ),
    ARRAY[]::text[]
  ) AS changed_fields,
  COALESCE((h.item->>'date')::timestamptz, e.updated_at, NOW()) AS created_at
FROM entities e
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.history, '[]'::jsonb)) WITH ORDINALITY AS h(item, idx)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Post-run verification:
-- SELECT 'objects' AS table_name, COUNT(*) FROM objects
-- UNION ALL SELECT 'relations', COUNT(*) FROM relations
-- UNION ALL SELECT 'events', COUNT(*) FROM events
-- UNION ALL SELECT 'history', COUNT(*) FROM history;
