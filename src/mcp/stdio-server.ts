/**
 * MCP Server using stdio transport
 * Implements the Model Context Protocol for Claude.ai integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_HANDLERS, getMcpManifest, validateToolInput } from './server-v2.js';

function sanitizeErrorMessage(error: unknown): string {
  const message = String(error || 'Internal error');
  const lower = message.toLowerCase();

  if (message.includes('<!DOCTYPE html') || message.includes('<html') || lower.includes('cloudflare')) {
    return 'Upstream service request failed';
  }

  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

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
    const manifest = getMcpManifest();
    const isExposed = (manifest.tools || []).some((tool: any) => tool?.name === name);

    if (!handler || !isExposed) {
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

    const validation = validateToolInput(name, (args || {}) as Record<string, any>);
    if (!validation.ok) {
      return {
        content: [
          {
            type: 'text',
            text: validation.error,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await handler(validation.data);
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
            text: `Error executing tool: ${sanitizeErrorMessage(error?.message)}`,
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
