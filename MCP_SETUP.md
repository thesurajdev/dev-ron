# Dev-Ron MCP Server Setup for Claude.ai

## Overview

Dev-Ron is a **Model Context Protocol (MCP) server** that provides intelligent data management with 15 specialized tools for:
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
   - **Remote MCP server URL:** `https://your-domain.com/api/mcp`
3. Click "Add"
4. When it asks to "Connect", click "Connect"

The endpoint is ready. All 15 tools will be available immediately.

## Database Migration (Copy-Paste Steps)

Do this before heavy usage so schema and policies are safe.

1. Open Supabase SQL Editor for your project.
2. Open this file from repo and copy all SQL:
    - `migrations/20260724_safe_legacy_alignment.sql`
3. Paste and run once.
4. Confirm success with this check query:

```sql
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
   AND tablename IN ('entities', 'activities', 'metrics')
ORDER BY tablename, policyname;
```

5. If result shows `tenant_isolation_entities`, `tenant_isolation_activities`, and `tenant_isolation_metrics`, migration is good.

## First-Run Identity Bootstrap (Recommended)

Right after connector setup, save your identity so MCP and AI understand who you are in this tenant.

### Option A: Ask Claude directly

Paste this as your first message after connection:

```text
Run set_profile with profile_type=person and save this data:
name: Your Name
phone: Your Phone
email: your@email.com
role: Founder
```

Then save your business profile:

```text
Run set_profile with profile_type=business and save this data:
company_name: Your Company
industry: Your Industry
website: https://your-domain.com
owner_name: Your Name
```

### Option B: Direct MCP payload examples

Personal profile:

```json
{
   "tool": "set_profile",
   "input": {
      "profile_type": "person",
      "data": {
         "name": "Your Name",
         "phone": "8800815510",
         "email": "you@example.com",
         "role": "Founder"
      }
   }
}
```

Business profile:

```json
{
   "tool": "set_profile",
   "input": {
      "profile_type": "business",
      "data": {
         "company_name": "Your Company",
         "industry": "Your Industry",
         "website": "https://your-domain.com",
         "owner_name": "Your Name"
      }
   }
}
```

Verify saved profile:

```json
{
   "tool": "get_profile",
   "input": {
      "profile_type": "person"
   }
}
```

### Security Model (Important)

- `GET /api/mcp` is public for connector discovery.
- `POST /api/mcp` requires OAuth Bearer token.
- Every tool call is bound to a tenant scope derived from the OAuth client.
- Queries and writes are tenant-scoped only; no cross-tenant fallback is allowed.

### If "Connection issue" error appears:

**Try Option A: Remove and Re-add**
1. Remove the connector (3-dot menu → Remove)
2. Add it again with exact URL: `https://your-domain.com/api/mcp`
3. Click "Connect" again

**Try Option B: Use Alternative Endpoint**
If the above doesn't work, Claude.ai might need a simpler endpoint format. Contact support with the error reference ID shown in Claude.ai.

## Available Tools (15 total)

### Identity
- **set_profile** - Save/update owner profile (person or business)
- **get_profile** - Retrieve owner profile for current tenant

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

### Bookkeeping
- **record_transaction** - Record sale, purchase, expense, income, refund, or transfer entries
- **get_cash_flow** - Get inflow, outflow, and net cash flow for a period
- **get_finance_summary** - Get revenue, expense, gross profit, pending receivables, and pending payables

Example transaction (object-first):

```json
{
   "tool": "record_transaction",
   "input": {
      "transaction": {
         "type": "expense",
         "amount": 2500,
         "currency": "INR",
         "category": "marketing",
         "description": "Meta ads spend",
         "date": "2026-07-23",
         "invoice_no": "INV-8821",
         "vendor": "Meta"
      },
      "payment_mode": "upi",
      "tags": ["ads", "performance"]
   }
}
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
- Check that all 15 tools are listed when you connect

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
