# Dev-Ron MCP Setup (Core Graph Only)

## Goal

This setup is intentionally minimal and focused on one question:

What happened, to whom, when, why, and how is it connected?

## Core Architecture

Only these core tables are used as the business memory model:

- objects
- relations
- events
- activities
- attachments
- history
- jobs

Optional:

- collections

## Connector Setup

In Claude.ai Settings -> Connectors:

1. Click Add custom connector.
2. Name: Dev-Ron
3. Remote MCP server URL: https://your-domain.com/api/mcp
4. Click Connect.

## Database Migrations (Run in Order)

1. Phase 1 (safe legacy alignment):
   - migrations/20260724_safe_legacy_alignment.sql
2. Phase 2 (create unified graph tables):
   - migrations/20260724_phase2_unified_graph_tables.sql
3. Phase 3 (backfill existing data):
   - migrations/20260724_phase3_backfill_unified_graph.sql

## Core MCP Tools (Minimal)

- add_data
- search
- graph_get_object
- graph_get_connections
- graph_get_timeline
- get_summary

These are the only tools exposed in manifest to keep usage simple and aligned with the graph model.

## Verification Queries

Verify graph tables:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'objects','relations','events','activities','attachments','history','jobs','collections','collection_objects'
  )
ORDER BY table_name;
```

Verify backfill counts:

```sql
SELECT 'objects' AS table_name, COUNT(*) AS total FROM objects
UNION ALL SELECT 'relations', COUNT(*) FROM relations
UNION ALL SELECT 'events', COUNT(*) FROM events
UNION ALL SELECT 'history', COUNT(*) FROM history;
```
