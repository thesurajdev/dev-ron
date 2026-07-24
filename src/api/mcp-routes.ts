/**
 * Example API Route for MCP
 * Usage with Express.js or similar framework
 */

export interface MCPRequest {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: { name?: string; arguments?: Record<string, any> };
  tool?: string;
  input?: Record<string, any>;
}

export interface MCPResponse {
  jsonrpc?: string;
  id?: string | number;
  result?: any;
  error?: { code: number; message: string } | string;
  success?: boolean;
  data?: any;
}

/**
 * POST /api/mcp
 * Main MCP endpoint
 */
export async function handleMCPAPI(body: MCPRequest): Promise<MCPResponse> {
  // @ts-ignore - Dynamic import
  const { handleMCPRequest } = await import('../mcp/handler.js');
  return await handleMCPRequest(body);
}

/**
 * GET /api/mcp/manifest
 * Get the MCP manifest
 */
export async function getManifestAPI() {
  // @ts-ignore - Dynamic import
  const { getMcpManifest } = await import('../mcp/server-v2.js');
  return getMcpManifest();
}

/**
 * Example Express.js route setup
 * 
 * import express from 'express';
 * import { handleMCPAPI, getManifestAPI } from './src/api/mcp-routes';
 * 
 * const app = express();
 * app.use(express.json());
 * 
 * // MCP endpoints
 * app.post('/api/mcp', async (req, res) => {
 *   const response = await handleMCPAPI(req.body);
 *   res.json(response);
 * });
 * 
 * app.get('/api/mcp/manifest', (req, res) => {
 *   res.json(getManifestAPI());
 * });
 * 
 * app.listen(3000, () => {
 *   console.log('MCP API server running on http://localhost:3000');
 * });
 */
