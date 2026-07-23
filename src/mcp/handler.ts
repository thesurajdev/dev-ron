/**
 * MCP API Route Handler
 * Handles JSON-RPC 2.0 and legacy MCP payloads
 * Uses flexible entity model (server-v2)
 */

import { MCP_HANDLERS, getMcpManifest } from './server-v2.js';

export interface MCPRequest {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, any>;
    protocolVersion?: string;
    capabilities?: Record<string, any>;
    clientInfo?: { name?: string; version?: string };
  };
  tool?: string;
  input?: Record<string, any>;
}

export interface MCPResponse {
  jsonrpc?: string;
  id?: string | number | undefined;
  result?: any;
  error?: { code: number; message: string } | string;
  success?: boolean;
  data?: any;
}

/**
 * Handle MCP requests - supports both JSON-RPC 2.0 and legacy format
 */
export async function handleMCPRequest(req: MCPRequest): Promise<MCPResponse> {
  try {
    // Handle JSON-RPC 2.0 format
    if (req.jsonrpc === '2.0') {
      if (req.method === 'initialize') {
        const manifest = getMcpManifest();
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: req.params?.protocolVersion || '2024-11-05',
            capabilities: {
              tools: {
                listChanged: false,
              },
              resources: {
                subscribe: false,
                listChanged: false,
              },
            },
            serverInfo: {
              name: manifest.server_name || manifest.name,
              version: manifest.version,
            },
            instructions: manifest.description,
          },
        };
      }

      if (req.method === 'notifications/initialized') {
        // JSON-RPC notification: no response body needed.
        return {};
      }

      if (req.method === 'ping') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {},
        };
      }

      if (req.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            tools: getMcpManifest().tools,
          },
        };
      }

      if (req.method === 'resources/list') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            resources: getMcpManifest().resources || [],
          },
        };
      }

      if (req.method === 'tools/call') {
        const toolName = req.params?.name;
        const args = req.params?.arguments || {};

        if (!toolName || !MCP_HANDLERS[toolName]) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32601,
              message: `Tool '${toolName}' not found`,
            },
          };
        }

        try {
          const result = await MCP_HANDLERS[toolName](args);
          return {
            jsonrpc: '2.0',
            id: req.id,
            result,
          };
        } catch (err: any) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32603,
              message: err.message || 'Internal error',
            },
          };
        }
      }

      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32601,
          message: 'Method not found',
        },
      };
    }

    // Handle legacy format: { tool, input }
    if (req.tool) {
      const toolName = req.tool;
      const args = req.input || {};

      if (!MCP_HANDLERS[toolName]) {
        return { success: false, error: `Tool '${toolName}' not found` } as any;
      }

      try {
        const result = await MCP_HANDLERS[toolName](args);
        return result;
      } catch (err: any) {
        return { success: false, error: err.message || 'Internal error' } as any;
      }
    }

    return { success: false, error: 'Invalid request format' } as any;
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' } as any;
  }
}

/**
 * Get manifest
 */
export async function getManifest() {
  return getMcpManifest();
}
