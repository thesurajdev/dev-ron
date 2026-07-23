# Next Steps - Setup & Deployment Guide

## ✅ Current Status

| Component | Status |
|-----------|--------|
| **Build** | ✅ Successful (0 errors) |
| **Source Files** | ✅ 6 TypeScript files |
| **Dependencies** | ✅ All installed |
| **Exports** | ✅ MCP_HANDLERS, getMcpManifest, initializeMCP |
| **Environment** | ⚠️ Configured, needs Supabase setup |
| **Database** | ⚠️ Schema needs to be created |

## 🔧 Setup Checklist

### Step 1: Configure Supabase Connection ✅

Your `.env` file is configured:
```
SUPABASE_URL=https://kclngegrgehogphtxeof.supabase.co
SUPABASE_ANON_KEY=sb_publishable_9MUdeqG09COaGHoF1Wf6Vw_7KtnVs1z
NODE_ENV=development
PORT=3000
```

**Verify**: All values are correct and present.

### Step 2: Create Database Schema ⏳

**Required**: Execute SQL in your Supabase dashboard

1. Go to: **Supabase Console → SQL Editor**
2. Create a new query
3. Copy the SQL from `SETUP_DATABASE.md` (lines 6-109)
4. Execute to create tables: `entities`, `activities`, `metrics`

**Tables Created**:
- `entities` - Flexible entity storage with JSONB
- `activities` - Activity/interaction tracking
- `metrics` - KPI and metric tracking
- Indexes on: user_id, entity_type, created_at, data (JSONB)

### Step 3: Start Development Server

```bash
# Terminal 1 - Start the server
npm run dev:server

# Expected output:
# ✅ MCP Server initialized
# 🚀 dev-ron MCP server ready
# Server running on http://localhost:3000
```

### Step 4: Test API Endpoints

**Terminal 2** - Test with curl:

```bash
# Health check
curl http://localhost:3000/health

# Get manifest
curl http://localhost:3000/api/mcp/manifest

# Add a client (create entity)
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "add_data",
      "arguments": {
        "user_id": "user123",
        "entity_type": "client",
        "data": {
          "name": "John Doe",
          "email": "john@example.com",
          "phone": "+1-555-0123"
        },
        "tags": ["vip", "active"]
      }
    }
  }'
```

### Step 5: Test Smart Deduplication

Add similar client (should auto-merge if match score >60%):

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "add_data",
      "arguments": {
        "user_id": "user123",
        "entity_type": "client",
        "data": {
          "name": "John Doe",
          "email": "john@example.com",
          "company": "Acme Corp"
        }
      }
    }
  }'
```

**Result**: Should consolidate into single entity with both name, email, and company data.

## 📊 Available MCP Tools (10 total)

```
1. add_data             - Add/update entity with smart consolidation
2. get_entity           - Retrieve complete entity profile
3. get_related          - Find related entities
4. get_timeline         - Activity history
5. get_summary          - Complete summary with stats
6. search               - Full-text search
7. link_entities        - Create relationships
8. merge_entities       - Manually merge duplicates
9. record_metric        - Track KPIs
10. get_metrics         - Retrieve metrics
```

## 🚀 Deployment Options

### Option A: Local Development
```bash
npm run dev:server
# Runs on http://localhost:3000
```

### Option B: Production Build
```bash
npm run build
npm start  # Runs dist/examples/server.js
```

### Option C: Docker (Optional)
```dockerfile
FROM node:24
WORKDIR /app
COPY . .
RUN npm install && npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 🧪 Full Testing Workflow

### 1. Create Client
```bash
RESPONSE=$(curl -s -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{...add_data...}')

# Extract entity_id from response
ENTITY_ID=$(echo $RESPONSE | jq -r '.data.id')
echo "Created entity: $ENTITY_ID"
```

### 2. Search Entities
```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search",
      "arguments": {
        "user_id": "user123",
        "query": "john"
      }
    }
  }'
```

### 3. Get Entity Summary
```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_summary",
      "arguments": {
        "user_id": "user123",
        "entity_id": "'$ENTITY_ID'"
      }
    }
  }'
```

### 4. Record Metrics
```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "record_metric",
      "arguments": {
        "user_id": "user123",
        "metric_name": "deal_value",
        "value": 50000,
        "entity_id": "'$ENTITY_ID'"
      }
    }
  }'
```

## 🔍 Troubleshooting

### Issue: "Missing Supabase environment variables"
**Fix**: Ensure .env file exists with SUPABASE_URL and SUPABASE_ANON_KEY

### Issue: "relation 'entities' does not exist"
**Fix**: Run SQL schema from SETUP_DATABASE.md in Supabase SQL Editor

### Issue: "Cannot find module '@supabase/supabase-js'"
**Fix**: Run `npm install` to reinstall dependencies

### Issue: Build errors
**Fix**: 
```bash
rm -rf dist node_modules
npm install
npm run build
```

## 📝 API Documentation

See full endpoint documentation in:
- [examples/server.ts](examples/server.ts) - Server implementation
- [examples/usage.ts](examples/usage.ts) - Usage examples
- [src/types/index.ts](src/types/index.ts) - Type definitions
- [SETUP_DATABASE.md](SETUP_DATABASE.md) - Database schema

## 🎯 Key Features

✅ **Smart Deduplication**
- Automatic duplicate detection (match score algorithm)
- Consolidates similar entities
- No duplicate data

✅ **Flexible Data Model**
- Store any JSON data
- Evolves with your business
- JSONB storage with indexes

✅ **Complete Consolidation**
- History tracking (last 50 changes)
- Bidirectional relationships
- Activity timeline
- No data loss

✅ **Full-Text Search**
- Search across all entity data
- Case-insensitive
- JSONB queries

✅ **Metrics Tracking**
- Record KPIs and business metrics
- Query by date range
- Associate with entities

## ❓ Need Help?

Check these files:
- [README.md](README.md) - Project overview
- [SETUP_DATABASE.md](SETUP_DATABASE.md) - Database setup
- [src/types/index.ts](src/types/index.ts) - Type definitions
- [examples/](examples/) - Working examples

---

**Status**: Ready for deployment! 🚀

All systems are operational. Next: Create database schema and start server.
