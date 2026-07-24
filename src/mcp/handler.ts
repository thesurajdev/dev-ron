/**
 * MCP API Route Handler
 * Handles JSON-RPC 2.0 and legacy MCP payloads
 * Uses flexible entity model (server-v2)
 */

import { MCP_HANDLERS, getMcpManifest, validateToolInput } from './server-v2.js';

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

export interface MCPRuntimeContext {
  userId?: string;
}

type ManifestTool = {
  name: string;
  description?: string;
  input_schema?: Record<string, any>;
  inputSchema?: Record<string, any>;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
  annotations?: Record<string, any>;
};

function toMcpTool(tool: ManifestTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema || tool.input_schema || { type: 'object', properties: {} },
    annotations: tool.annotations || {
      readOnlyHint: Boolean(tool.readOnlyHint),
      openWorldHint: Boolean(tool.openWorldHint),
      destructiveHint: Boolean(tool.destructiveHint),
    },
  };
}

function withRuntimeUserScope(args: Record<string, any>, context?: MCPRuntimeContext) {
  if (!context?.userId) return args;
  return { ...args, user_id: context.userId };
}

function sanitizeErrorMessage(error: unknown): string {
  const message = String(error || 'Internal error');
  const lower = message.toLowerCase();

  if (message.includes('<!DOCTYPE html') || message.includes('<html') || lower.includes('cloudflare')) {
    return 'Upstream service request failed';
  }

  if (message.length > 300) {
    return `${message.slice(0, 297)}...`;
  }

  return message;
}

function isToolExposed(toolName: string): boolean {
  const tools = getMcpManifest().tools || [];
  return tools.some((tool: any) => tool?.name === toolName);
}

/**
 * Handle MCP requests - supports both JSON-RPC 2.0 and legacy format
 */
export async function handleMCPRequest(
  req: MCPRequest,
  context?: MCPRuntimeContext
): Promise<MCPResponse> {
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
        const tools = (getMcpManifest().tools || []).map((tool: ManifestTool) => toMcpTool(tool));
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            tools,
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
        const rawArgs = withRuntimeUserScope(req.params?.arguments || {}, context);

        if (!toolName || !MCP_HANDLERS[toolName] || !isToolExposed(toolName)) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32601,
              message: `Tool '${toolName}' not found`,
            },
          };
        }

        const validation = validateToolInput(toolName, rawArgs);
        if (!validation.ok) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32602,
              message: validation.error,
            },
          };
        }

        try {
          const toolResult = await MCP_HANDLERS[toolName](validation.data);
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(toolResult),
                },
              ],
            },
          };
        } catch (err: any) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: -32603,
              message: sanitizeErrorMessage(err?.message || 'Internal error'),
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
      const rawArgs = withRuntimeUserScope(req.input || {}, context);

      if (!MCP_HANDLERS[toolName] || !isToolExposed(toolName)) {
        return { success: false, error: `Tool '${toolName}' not found` } as any;
      }

      const validation = validateToolInput(toolName, rawArgs);
      if (!validation.ok) {
        return { success: false, error: validation.error } as any;
      }

      try {
        const result = await MCP_HANDLERS[toolName](validation.data);
        return result;
      } catch (err: any) {
        return { success: false, error: sanitizeErrorMessage(err?.message || 'Internal error') } as any;
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
