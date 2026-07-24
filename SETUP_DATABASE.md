# Database Setup for Smart Entity System

## Canonical Target Model (Recommended)

This system should answer one question:

What happened, to whom, when, why, and how is it connected?

Use this unified object graph schema as the target architecture.

### Core tables (7)

- objects
- relations
- events
- activities
- attachments
- history
- jobs

Optional but recommended:

- collections

### Unified schema SQL

Copy this into Supabase SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 1) objects: everything in business is an object
CREATE TABLE IF NOT EXISTS objects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- 2) relations: graph edges between objects
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

-- 3) events: immutable business facts over time
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

-- 4) activities: interactions/conversations connected to many objects
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  object_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  direction TEXT,
  channel TEXT,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_user_id_v2 ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_type_v2 ON activities(type);
CREATE INDEX IF NOT EXISTS idx_activities_happened_at ON activities(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_object_ids_gin ON activities USING GIN(object_ids);
CREATE INDEX IF NOT EXISTS idx_activities_content_gin ON activities USING GIN(content);

-- 5) attachments: files linked to any object/event/activity
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
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_user_id ON attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_object_id ON attachments(object_id);
CREATE INDEX IF NOT EXISTS idx_attachments_event_id ON attachments(event_id);
CREATE INDEX IF NOT EXISTS idx_attachments_activity_id ON attachments(activity_id);

-- 6) history: before/after snapshots of changes
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

-- 7) jobs: background AI/system work
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

-- Optional 8) collections: dynamic groups/folders
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
```

### Migration note

The current runtime still uses legacy tables (entities, activities, metrics).

Adopt the unified model in phases:

1. Create the new tables above in parallel.
2. Add dual-write from MCP handlers to both old and new schemas.
3. Move reads to objects/relations/events progressively.
4. Remove legacy tables after full parity and verification.

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
  date DATE DEFAULT CURRENT_DATE,
  data JSONB NOT NULL DEFAULT '{}',
  involved_entities JSONB NOT NULL DEFAULT '[]',
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
  value TEXT NOT NULL,
  entity_id UUID,
  date DATE DEFAULT CURRENT_DATE,
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
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
NODE_ENV=development
PORT=3000
PUBLIC_BASE_URL=https://your-domain.com
```

Get these from Supabase Dashboard → Settings → API.

Use `SUPABASE_SERVICE_ROLE_KEY` on the server side only (never in client/browser code).

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
# NOTE: POST /api/mcp requires OAuth bearer token.
# Use Claude connector flow for OAuth automatically,
# or implement token exchange before direct curl tool calls.

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
