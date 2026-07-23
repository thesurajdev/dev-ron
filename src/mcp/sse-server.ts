/**
 * MCP Server using SSE (Server-Sent Events) transport
 * This allows Claude.ai to connect to the MCP server over HTTP
 */

import express, { Router } from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MCP_HANDLERS, getMcpManifest } from './server-v2.js';

const app = express();
app.use(cors());
app.use(express.json());

// MCP SSE endpoint for remote connection
const router = Router();

/**
 * List available tools
 */
router.get('/tools', async (req, res) => {
  try {
    const manifest = getMcpManifest();
    res.json({ tools: manifest.tools });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Call a tool - POST request with tool name and arguments
 */
router.post('/tools/:name/execute', async (req, res) => {
  try {
    const { name } = req.params;
    const { input } = req.body;

    const handler = MCP_HANDLERS[name];
    if (!handler) {
      return res.status(404).json({ error: `Tool "${name}" not found` });
    }

    const result = await handler(input);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * SSE endpoint for streaming responses
 * This establishes the connection for Claude.ai
 */
router.get('/sse', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', version: '2.0.0' })}\n\n`);

  // Keep connection alive with periodic heartbeats
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', type: 'mcp-sse' });
});

/**
 * Manifest endpoint (for validation)
 */
router.get('/manifest', (req, res) => {
  res.json(getMcpManifest());
});

app.use('/mcp', router);

// Additional routes for backward compatibility
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: 'sse', type: 'mcp' });
});

app.get('/api/mcp/manifest', (req, res) => {
  res.json(getMcpManifest());
});

export default app;

export async function startMCPServer(port: number = 3001) {
  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`MCP SSE Server running on http://localhost:${port}/mcp`);
      resolve(app);
    });
  });
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT || '3001', 10);
  startMCPServer(port);
}
