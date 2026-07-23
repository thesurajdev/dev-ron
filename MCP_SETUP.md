# Dev-Ron MCP Server Setup for Claude.ai

## Overview

Dev-Ron is a **Model Context Protocol (MCP) server** that provides intelligent data management with 10 specialized tools for:
- Entity management (leads, clients, contacts, etc.)
- Smart consolidation & deduplication
- Relationship mapping
- Metrics tracking
- Search & retrieval

## For Claude.ai Integration

### Option 1: Using `npx` with stdio MCP (Recommended)

If you have Node.js installed locally:

```bash
npx dev-ron@latest mcp
```

Then in Claude.ai:
1. Go to Settings → Connectors
2. Click "Add custom connector"
3. Choose **"Remote MCP server"**
4. In "Remote MCP server URL", use: 
   - **macOS/Linux:** `command://npx dev-ron@latest mcp`
   - Or install globally: `npm install -g dev-ron` then use `command://dev-ron-mcp`

### Option 2: Using Vercel-Hosted HTTP Endpoint

Claude.ai also supports HTTP-based MCP servers.

**Use this URL:** 
```
https://dev-ron.vercel.app/api/mcp
```

In Claude.ai:
1. Go to Settings → Connectors
2. Click "Add custom connector"
3. Name: `Dev-Ron Data Logger`
4. Remote MCP server URL: `https://dev-ron.vercel.app/api/mcp`
5. Leave OAuth fields empty (not required)
6. Click "Add"

### Option 3: Local Development Server

Run the MCP SSE server locally:

```bash
npm run mcp
```

Server runs on: `http://localhost:3001/mcp`

Then configure Claude.ai with that local URL.

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
- Verify the URL is correct and accessible
- Check CORS is enabled (it is on our Vercel deployment)
- Try hitting the endpoint directly: `curl https://dev-ron.vercel.app/api/mcp`

### "OAuth error"
- Leave OAuth Client ID and Secret empty (not required for this server)
- These fields are optional per the dialog

### "Tool not found"
- Verify you're using the correct endpoint: `https://dev-ron.vercel.app/api/mcp`
- Check that all 10 tools are listed when you connect

## API Endpoints

- `GET /health` - Health check
- `GET /api/mcp/manifest` - Tool definitions
- `GET /api/mcp` - MCP manifest (returns all tools)
- `POST /api/mcp` - Execute MCP tool requests

All endpoints support CORS and are publicly accessible.

## Support

For issues or questions:
1. Check the [GitHub repository](https://github.com/thesurajdev/dev-ron)
2. Review error reference numbers in Claude
3. File an issue with details

---

**Status:** ✅ Production-ready and deployed on Vercel
