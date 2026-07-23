/* eslint-disable @typescript-eslint/no-require-imports */
// CJS entry point for Vercel serverless
// Note: src/ files are ESM (root package.json "type":"module"), must use dynamic import()
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health - no imports needed
app.get('/health', (_req: any, res: any) => {
  res.json({ status: 'ok', version: 'v4', timestamp: new Date().toISOString() });
});

// Manifest - dynamic import() for ESM src/ module
app.get(['/api/mcp/manifest', '/manifest'], async (_req: any, res: any) => {
  try {
    const { getMcpManifest } = await import('../src/mcp/server-v2.js');
    res.json(getMcpManifest());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// MCP endpoint - GET/HEAD returns manifest (for validation), POST handles requests
app.get(['/api/mcp', '/mcp'], async (_req: any, res: any) => {
  try {
    const { getMcpManifest } = await import('../src/mcp/server-v2.js');
    res.json(getMcpManifest());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.head(['/api/mcp', '/mcp'], async (_req: any, res: any) => {
  try {
    await import('../src/mcp/server-v2.js');
    res.status(200).end();
  } catch (err: any) {
    res.status(500).end();
  }
});

app.post(['/api/mcp', '/mcp'], async (req: any, res: any) => {
  try {
    const { handleMCPRequest } = await import('../src/mcp/handler.js');
    const response = await handleMCPRequest(req.body);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;

