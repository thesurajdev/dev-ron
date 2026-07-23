# MCP Feature Implementation Guide

This guide explains how to add a new MCP feature to the Born to Banger website using the same MCP architecture already in place.

## Current MCP architecture

The website uses MCP in three primary layers:

1. `lib/server/mcpServer.js`
   - Contains `MCP_HANDLERS` with all tool implementations.
   - Exposes `getMcpManifest()` to publish the manifest and tool metadata.
   - Provides the shared `response(success, data, error)` helper.

2. `app/api/mcp/route.js`
   - Handles JSON-RPC 2.0 endpoints for `tools/list` and `tools/call`.
   - Also supports legacy MCP payloads of the form `{ tool, input }`.
   - Dispatches calls to `MCP_HANDLERS[name]`.

3. `components/mcp/WebMCPProvider.js`
   - Registers browser-side WebMCP tools through `navigator.modelContext`.
   - Keeps browser tool definitions in `WEBMCP_TOOLS` aligned with server MCP tools.
   - Defines `toolHandlers` for client-side execution.

## How to add another feature

### 1. Choose the new tool

Pick a clear tool name and purpose. Follow existing naming conventions like:
- `discover_*`
- `get_*`
- `calculate_*`
- `create_*`
- `list_*`

Example tool ideas:
- `recommend_services`
- `find_available_slots`
- `verify_customer_details`
- `estimate_event_budget`

### 2. Add the tool implementation in `lib/server/mcpServer.js`

Add a new entry inside `MCP_HANDLERS`: 

```js
export const MCP_HANDLERS = {
  ...,
  recommend_services: async (input) => {
    const { query = '', location = '', guest_count } = input || {};

    // Use helpers and existing data
    const normalizedQuery = String(query || '').toLowerCase().trim();
    const matches = activities.filter((activity) => {
      return [activity.title, activity.description, activity.category]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });

    return response(true, {
      count: matches.length,
      recommendations: matches.slice(0, 5).map((activity) => ({
        slug: activity.slug,
        title: activity.title,
        category: activity.category,
        estimated_price: activity.base || activity.basePrice,
        description: activity.description?.substring(0, 120),
      }))
    });
  },
};
```

Key points:
- Use the existing helper functions like `findActivityByInput`, `findLocationByInput`, and `normalizeLookup` where appropriate.
- Always return `response(true, data)` or `response(false, null, error)`.
- Keep the output JSON structure consistent with current tool results.

### 3. Register the tool in the manifest

Update `getMcpManifest()` in `lib/server/mcpServer.js`.
Add a new tool entry with metadata and `input_schema`.

Example:

```js
{
  name: 'recommend_services',
  description: 'Recommend event services or activities based on user needs.',
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
  },
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The user request or event type.' },
      location: { type: 'string', description: 'City or place name for filtering.' },
      guest_count: { type: 'number', description: 'Number of guests, optional for estimate.' }
    },
    required: ['query']
  }
}
```

### 4. (Optional) Add browser WebMCP support

If you want the tool available in browser WebMCP contexts, update `components/mcp/WebMCPProvider.js`:

- Add a new item to `WEBMCP_TOOLS`.
- Add a matching handler under `toolHandlers`.

Example:

```js
const WEBMCP_TOOLS = [
  ...,
  {
    name: 'recommend_services',
    description: 'Recommend event services and activities for a request.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        location: { type: 'string' },
        guest_count: { type: 'number' }
      },
      required: ['query']
    },
    readOnlyHint: true,
    openWorldHint: false,
    destructiveHint: false,
  }
];

const toolHandlers = {
  ...,
  recommend_services: async (params) => {
    const response = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'recommend_services',
        input: params,
      }),
    });
    const data = await response.json();
    return data;
  },
};
```

### 5. Add developer documentation and examples

Update `app/developers/page.js` with a sample `curl` or WebMCP call.
This helps teammates understand how to test the new tool.

Example:

```js
curl -X POST https://borntobanger.in/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "recommend_services",
    "input": {
      "query": "birthday party DJ",
      "location": "gurugram",
      "guest_count": 120
    }
  }'
```

### 6. Test the new tool

Test both formats:

- JSON-RPC 2.0:

```bash
curl -X POST https://borntobanger.in/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "recommend_services",
      "arguments": {
        "query": "dj party",
        "location": "delhi"
      }
    }
  }'
```

- Legacy format:

```bash
curl -X POST https://borntobanger.in/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "recommend_services",
    "input": {"query": "dj party", "location": "delhi"}
  }'
```

## Prompt to use when asking for implementation

```text
We are using Model Context Protocol (MCP) on our Born to Banger website.
The current MCP server is implemented in `lib/server/mcpServer.js`, the MCP manifest is returned by `getMcpManifest()`, and browser WebMCP registration is handled in `components/mcp/WebMCPProvider.js`.

Please add a new MCP tool with the following behavior:

- Tool name: `recommend_services`
- Purpose: Recommend 3 suitable event services or activities based on user need and location.
- Input:
  - `query` (string) — user request or event type, e.g. "DJ for wedding".
  - `location` (string) — city or region, e.g. "gurugram".
  - `guest_count` (number, optional) — guest size for context.
- Output properties:
  - `count`
  - `recommendations`: array of objects with `slug`, `title`, `category`, `estimated_price`, and `description`

Implementation details:
1. In `lib/server/mcpServer.js`, add the new tool to `MCP_HANDLERS`.
2. Add its manifest metadata in `getMcpManifest()`, including `input_schema`.
3. Ensure the tool works via `/api/mcp` JSON-RPC and legacy `{ tool, input }` payloads.
4. If browser WebMCP should support it, add the tool to `components/mcp/WebMCPProvider.js`.
5. Add a sample developer `curl` example in `app/developers/page.js`.
6. Keep response format consistent with existing MCP handlers.
```

## Notes

- The new tool should mirror the existing data access and response style.
- If you want to add a true 