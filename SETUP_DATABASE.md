# Database Setup for Smart Entity System

## 1. Create Tables in Supabase

Copy and paste this SQL into your Supabase SQL Editor:

```sql
-- Enable uuid and jsonb extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Entities table
CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  related_to JSONB NOT NULL DEFAULT '[]',
  history JSONB NOT NULL DEFAULT '[]',
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  confidence NUMERIC DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_entities_user_id ON entities(user_id);
CREATE INDEX idx_entities_entity_type ON entities(entity_type);
CREATE INDEX idx_entities_tags ON entities USING GIN(tags);
CREATE INDEX idx_entities_data ON entities USING GIN(data);
CREATE INDEX idx_entities_created_at ON entities(created_at);
CREATE INDEX idx_entities_updated_at ON entities(updated_at);

-- Activities table
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  data JSONB NOT NULL DEFAULT '{}',
  involved_entities UUID[] DEFAULT ARRAY[]::UUID[],
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for activities
CREATE INDEX idx_activities_user_id ON activities(user_id);
CREATE INDEX idx_activities_activity_type ON activities(activity_type);
CREATE INDEX idx_activities_date ON activities(date);
CREATE INDEX idx_activities_involved_entities ON activities USING GIN(involved_entities);

-- Metrics table
CREATE TABLE IF NOT EXISTS metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value NUMERIC NOT NULL,
  entity_id UUID,
  date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for metrics
CREATE INDEX idx_metrics_user_id ON metrics(user_id);
CREATE INDEX idx_metrics_metric_name ON metrics(metric_name);
CREATE INDEX idx_metrics_entity_id ON metrics(entity_id);
CREATE INDEX idx_metrics_date ON metrics(date);

-- Full-text search indexes
CREATE INDEX idx_entities_data_search ON entities USING GIN(to_tsvector('english', jsonb_to_text(data)));
```

## 2. Environment Configuration

Create `.env` file in project root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
NODE_ENV=development
PORT=3000
```

Get these from Supabase Dashboard → Settings → API

## 3. Start the Server

```bash
npm run build
npm run dev:server
```

Server will be available at: `http://localhost:3000`

## 4. Test the MCP Endpoints

### Health Check
```bash
curl http://localhost:3000/health
```

### Get Manifest
```bash
curl http://localhost:3000/api/mcp/manifest
```

### Add Data (Add Client)
```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "add_data",
      "arguments": {
        "entity_type": "client",
        "data": {
          "name": "John Doe",
          "email": "john@example.com",
          "phone": "+1-555-0123",
          "company": "Acme Corp"
        },
        "tags": ["lead", "active"]
      }
    }
  }'
```

### Search Entities
```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "search",
      "arguments": {
        "query": "john",
        "entity_type": "client"
      }
    }
  }'
```

### Get Entity Summary
```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_summary",
      "arguments": {
        "entity_id": "ENTITY_ID_FROM_ADD_DATA_RESPONSE"
      }
    }
  }'
```

## 5. Test Smart Deduplication

The system automatically detects and merges duplicates:

```bash
# Add first client
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "add_data",
      "arguments": {
        "entity_type": "client",
        "data": {
          "name": "John Doe",
          "email": "john@example.com",
          "phone": "+1-555-0123"
        }
      }
    }
  }'

# Add similar client (should merge if score > 60%)
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "add_data",
      "arguments": {
        "entity_type": "client",
        "data": {
          "name": "John Doe",
          "email": "john@example.com",
          "title": "Sales Manager"
        }
      }
    }
  }'

# Search - should only show ONE client with all data consolidated
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search",
      "arguments": {
        "query": "john"
      }
    }
  }'
```

## Architecture Features

### Smart Deduplication
- Calculates match score based on email, phone, name similarities
- Score >60% = automatic merge (consolidates all data)
- Score <60% = creates new entity
- Prevents duplicates and mess

### Entity Consolidation
- All data from updates merged into single entity
- History tracked (last 50 changes)
- Bidirectional relationships maintained
- No data loss

### Complete Summaries
- Activity timeline with all interactions
- Related entities (links to other entities)
- Aggregated metrics and KPIs
- Full history of changes
- No missing or duplicate information

See SMART_ARCHITECTURE.md for detailed explanation.
