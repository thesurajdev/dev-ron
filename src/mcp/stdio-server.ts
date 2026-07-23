/**
 * MCP Server using stdio transport
 * Implements the Model Context Protocol for Claude.ai integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_HANDLERS, getMcpManifest } from './server-v2.js';

async function main() {
  const server = new Server({
    name: 'Smart Data Logger MCP',
    version: '2.0.0',
  });

  // Handler for tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const manifest = getMcpManifest();
    return {
      tools: manifest.tools,
    };
  });

  // Handler for tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = MCP_HANDLERS[name];

    if (!handler) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool "${name}" not found`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await handler(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing tool: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('MCP Server running on stdio');
}

main().catch(console.error);
