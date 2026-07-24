# Next Steps

This file tracks recommended improvements after initial setup.

## Immediate priorities

1. Persist OAuth clients/tokens/codes in Supabase (replace in-memory auth state).
2. Add rate limiting for `/api/mcp` and OAuth endpoints.
3. Add structured logs and request correlation IDs.
4. Add integration tests for tenant isolation and dedupe behavior.
5. Implement unified object graph schema migration (`objects`, `relations`, `events`, `activities`, `attachments`, `history`, `jobs`).
6. Add optional `collections` and `collection_objects` for dynamic business groupings.
7. Add dual-write in MCP handlers so new schema reaches parity without downtime.

## Scale priorities

1. Add deterministic identity keys per tenant for stronger dedupe at volume.
2. Add async pipeline for heavy enrichment/extraction tasks.
3. Add relevance ranking index for schema-less search.
4. Move graph traversals to relation-first query paths for connected reasoning.
5. Derive current business status from immutable events, not mutable state fields.

## Security priorities

1. Keep `POST /api/mcp` authenticated only.
2. Keep all storage operations scoped by tenant `user_id`.
3. Rotate keys and enforce least-privilege deployment secrets.

## Where to look

- Runtime architecture: [README.md](README.md)
- Database schema and setup: [SETUP_DATABASE.md](SETUP_DATABASE.md)
- Claude connector setup: [MCP_SETUP.md](MCP_SETUP.md)
