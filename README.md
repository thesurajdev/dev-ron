# dev-ron

AI-native Business Operating System that learns, remembers, connects, and reasons about everything in the business.

The user does not fill forms. They talk, type, upload documents, or connect external systems. The AI converts raw input into structured business knowledge.

## Architecture

```text
User / AI / Integrations
            |
            v
      MCP / API Layer
            |
            v
      Memory Engine (Brain)
            |
  +---------+---------+
  |         |         |
  v         v         v
Reasoning Validation Search
  |         |         |
  +---------+---------+
            v
     Relationship Engine
            |
            v
      Storage Layer
            |
            v
        Supabase
```

## Core Principle

The database stores facts.
The Memory Engine creates understanding.
The AI provides reasoning.

This separation keeps the system reliable, extensible, and ready to evolve into a complete AI-powered operating system.

## The Brain: Memory Engine

The Memory Engine never blindly stores data. For every new input, it:

1. Understands intent.
2. Extracts business objects.
3. Searches existing memory.
4. Detects duplicates.
5. Decides Create, Update, Merge, or Ignore.
6. Builds relationships.
7. Records an immutable event.
8. Saves final state.

## Business Objects

Everything becomes a Business Object.

Examples:

- Person
- Company
- Lead
- Meeting
- Task
- Opportunity
- Invoice
- Payment
- Product
- File
- Note
- Conversation
- Project
- Event

New object types can be introduced without redesigning the database.

## Relationship-First Knowledge

Objects are connected naturally, and those links become business understanding.

```text
Rahul
  |
works_at
  |
Google
  |
requested
  |
Corporate Event
  |
requires
  |
Caricature Artist
```

## Event-Centric State

Every business action is recorded as an immutable event.

Examples:

- Lead Created
- Call Received
- Meeting Scheduled
- Quotation Sent
- Invoice Generated
- Payment Received
- Task Completed

Current business state is derived from these events.

## Storage Responsibility

Storage is not the brain. It stores:

- Business Objects
- Relationships
- Events
- History
- Files
- Metadata

Intelligence remains in the Memory Engine.

## Current Implementation Direction

- MCP and API receive unstructured input.
- Memory logic performs schema-less matching and merge.
- Relationship edges are persisted for connected reasoning.
- Supabase stores durable facts and event history.

## Local Development

### Documentation Map

- Fast setup: [QUICK_START.md](QUICK_START.md)
- Database schema: [SETUP_DATABASE.md](SETUP_DATABASE.md)
- Claude connector setup: [MCP_SETUP.md](MCP_SETUP.md)
- Improvement roadmap: [NEXT_STEPS.md](NEXT_STEPS.md)

### Prerequisites

- Node.js 18+
- npm
- Supabase project

### Setup

```bash
git clone https://github.com/thesurajdev/dev-ron.git
cd dev-ron
npm install
cp .env.example .env
```

Set environment variables in `.env`:

- SUPABASE_URL
- SUPABASE_ANON_KEY
- DEFAULT_MCP_USER_ID (optional for local non-OAuth testing only)

### Run

```bash
npm run build
npm run dev:server
```

### MCP Endpoint

- GET `/api/mcp` (manifest/discovery)
- POST `/api/mcp` (OAuth Bearer required for tool execution)

## Go Live In 10 Minutes

1. Create your own Supabase project.
2. Run SQL from [SETUP_DATABASE.md](SETUP_DATABASE.md).
3. Fork/clone this repo.
4. Deploy to Vercel.
5. Set environment variables in Vercel:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (recommended for backend)
  - `PUBLIC_BASE_URL` (example: `https://your-domain.com`)
6. Redeploy.
7. Verify:
  - `GET https://your-domain.com/health`
  - `GET https://your-domain.com/api/mcp`
8. Connect in Claude using:
  - `https://your-domain.com/api/mcp`

### Why this is safe by default

- Tool execution (`POST /api/mcp`) requires OAuth token.
- Tenant scope is enforced server-side from token context.
- Client-provided `user_id` is ignored when token scope is present.
- Storage queries are scoped to tenant `user_id`.

## Public Deployment Security Checklist

If you publish this repo and let others deploy their own instance:

1. Use a dedicated Supabase project per deployment.
2. Keep `POST /api/mcp` authenticated with OAuth (enabled by default).
3. Never allow client-supplied `user_id` to override token scope.
4. Keep all entity reads/writes scoped by `user_id` in storage queries.
5. Keep Supabase Row Level Security enabled on all business tables.
6. Do not use `DEFAULT_MCP_USER_ID` in production.

## MCP Behavior Goals

- No forced forms.
- No rigid schema requirements.
- No duplicate entity mess.
- Later details should enrich existing entities.
- Search and reasoning should work on full object context.

## Status

dev-ron is evolving from a data logger into a complete AI-native business operating system with a memory-first core.
