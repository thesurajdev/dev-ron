/* eslint-disable @typescript-eslint/no-require-imports */
// CJS entry point for Vercel serverless - all heavy imports are lazy (per-request)
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health - no imports needed
app.get('/health', (_req: any, res: any) => {
  res.json({ status: 'ok', version: 'v3', timestamp: new Date().toISOString() });
});

// Manifest - lazy import
app.get(['/api/mcp/manifest', '/manifest'], async (_req: any, res: any) => {
  try {
    const { getMcpManifest } = require('../src/mcp/server-v2');
    res.json(getMcpManifest());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// MCP endpoint - lazy import
app.post(['/api/mcp', '/mcp'], async (req: any, res: any) => {
  try {
    const { handleMCPRequest } = require('../src/mcp/handler');
    const response = await handleMCPRequest(req.body);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;

