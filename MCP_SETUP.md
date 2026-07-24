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

Example cash flow with custom type mapping:

```json
{
   "tool": "get_cash_flow",
   "input": {
      "period": "month",
      "currency": "INR",
      "inflow_types": ["sale", "income", "service_receipt"],
      "outflow_types": ["expense", "purchase", "vendor_payment"]
   }
}
```

Example finance summary:

```json
{
   "tool": "get_finance_summary",
   "input": {
      "period": "month",
      "currency": "INR",
      "revenue_types": ["sale", "income", "service_receipt"],
      "expense_types": ["expense", "purchase", "vendor_payment"],
      "pending_statuses": ["pending", "unpaid", "partial", "due"]
   }
}
```

### Insights
- **get_timeline** - Activity history
- **get_summary** - Comprehensive summary with stats

## Smart Features

✅ **Auto-Deduplication**
- Automatic detection of duplicate entities
- Match scoring (email: +50, phone: +50, name: +25-50)
- Auto-merge if confidence > 60%

✅ **Flexible Schema**
- JSONB-based storage - any data structure
- No fixed fields or tables
- Supports leads, clients, deals, tasks, contacts, etc.

✅ **Relationship Tracking**
- Link entities with semantic relationships
- Automatic bidirectional references
- Related entity queries

✅ **Audit Trail**
- Complete history of all changes
- Timestamp tracking
- Data consolidation logs

## Database

Powered by **Supabase PostgreSQL**:
- 3 optimized tables (entities, activities, metrics)
- 15+ performance indexes
- Row-Level Security enabled
- Real-time streaming support

## Example Usage in Claude

Once connected, you can ask Claude:
- "Add a new lead: John from Acme Corp (john@acme.com)"
- "Find all interactions with john@acme.com"
- "Show me the summary of leads from July"
- "Link John to the Acme Corp client account"
- "Find potential duplicates in my database"

## Troubleshooting

### "Couldn't connect to server"
- Verify the URL is correct and accessible: `https://your-domain.com/api/mcp`
- Check CORS is enabled on your deployment
- Try hitting the endpoint directly: `curl https://your-domain.com/api/mcp`

### "OAuth error"
- This server uses OAuth for `POST /api/mcp` requests.
- Claude handles dynamic registration + authorization automatically.
- If authorization fails, reconnect the connector and retry.

### "Tool not found"
- Verify you're using the correct endpoint: `https://your-domain.com/api/mcp`
- If you need advanced tools, set `MCP_SIMPLE_MODE=false` and reconnect

## API Endpoints

- `GET /health` - Health check
- `GET /api/mcp/manifest` - Tool definitions
- `GET /api/mcp` - MCP manifest (returns all tools)
- `POST /api/mcp` - Execute MCP tool requests (OAuth Bearer required)

Manifest endpoints are public. Tool execution is authenticated and tenant-scoped.

## Support

For issues or questions:
1. Check the [GitHub repository](https://github.com/thesurajdev/dev-ron)
2. Review error reference numbers in Claude
3. File an issue with details

---

**Status:** Template ready for self-hosted deployment
