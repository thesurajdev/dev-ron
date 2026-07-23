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

// MCP endpoint - GET returns manifest (for validation), POST handles requests
app.get(['/api/mcp', '/mcp'], async (_req: any, res: any) => {
  try {
    const { getMcpManifest } = await import('../src/mcp/server-v2.js');
    res.json(getMcpManifest());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

// OAuth 2.0 Discovery - so Claude.ai can recognize this as an OAuth-capable server
app.get('/.well-known/oauth-authorization-server', (_req: any, res: any) => {
  res.json({
    issuer: 'https://ron.surajdev.com',
    authorization_endpoint: 'https://ron.surajdev.com/oauth/authorize',
    token_endpoint: 'https://ron.surajdev.com/oauth/token',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
  });
});

// OAuth token endpoint - returns immediate access without requiring auth
app.post('/oauth/token', (req: any, res: any) => {
  res.json({
    access_token: 'mcp-token-' + Date.now(),
    token_type: 'Bearer',
    expires_in: 86400,
  });
});

// OAuth authorization endpoint - just redirect back
app.get('/oauth/authorize', (req: any, res: any) => {
  const { redirect_uri, state } = req.query;
  const code = 'code-' + Date.now();
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  redirectUrl.searchParams.set('state', state);
  res.redirect(redirectUrl.toString());
});

// SSE endpoint for Claude.ai Remote MCP connection
app.get('/sse', (req: any, res: any) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send server info
  res.write(`data: ${JSON.stringify({ 
    type: 'message',
    message: { type: 'serverInfo', info: { name: 'Dev-Ron MCP', version: '2.0.0' } }
  })}\n\n`);

  // Keep alive with heartbeats
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
  }, 30000);

  req.on('close', () => clearInterval(heartbeat));
});

module.exports = app;

