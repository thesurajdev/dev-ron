# Dev-Ron MCP Server Setup for Claude.ai

## Overview

Dev-Ron is a **Model Context Protocol (MCP) server** that provides intelligent data management with 10 specialized tools for:
- Entity management (leads, clients, contacts, etc.)
- Smart consolidation & deduplication
- Relationship mapping
- Metrics tracking
- Search & retrieval

## For Claude.ai Integration

### Quick Setup - Try This First

In Claude.ai Settings → Connectors:

1. **Click "Add custom connector"** (or if RON exists, remove it first)
2. Fill in:
   - **Name:** Dev-Ron
   - **Remote MCP server URL:** `https://ron.surajdev.com/api/mcp`
3. Click "Add"
4. When it asks to "Connect", click "Connect"

The endpoint is ready. All 10 tools will be available immediately.

### Security Model (Important)

- `GET /api/mcp` is public for connector discovery.
- `POST /api/mcp` requires OAuth Bearer token.
- Every tool call is bound to a tenant scope derived from the OAuth client.
- Queries and writes are tenant-scoped only; no cross-tenant fallback is allowed.

### If "Connection issue" error appears:

**Try Option A: Remove and Re-add**
1. Remove the connector (3-dot menu → Remove)
2. Add it again with exact URL: `https://ron.surajdev.com/api/mcp`
3. Click "Connect" again

**Try Option B: Use Alternative Endpoint**
If the above doesn't work, Claude.ai might need a simpler endpoint format. Contact support with the error reference ID shown in Claude.ai.

## Available Tools (10 total)

### Data Management
- **add_data** - Create/update entities with automatic deduplication
- **get_entity** - Retrieve entity details
- **search** - Full-text search across all data

### Relationships
- **link_entities** - Create relationships between entities
- **get_related** - Find connected entities
- **merge_entities** - Consolidate duplicates

### Metrics & Analytics
- **record_metric** - Store KPIs and metrics
- **get_metrics** - Retrieve and aggregate metrics

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
- Verify the URL is correct and accessible: `https://ron.surajdev.com/api/mcp`
- Check CORS is enabled (it is on our deployment)
- Try hitting the endpoint directly: `curl https://ron.surajdev.com/api/mcp`

### "OAuth error"
- This server uses OAuth for `POST /api/mcp` requests.
- Claude handles dynamic registration + authorization automatically.
- If authorization fails, reconnect the connector and retry.

### "Tool not found"
- Verify you're using the correct endpoint: `https://ron.surajdev.com/api/mcp`
- Check that all 10 tools are listed when you connect

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

**Status:** ✅ Production-ready and deployed on Vercel
