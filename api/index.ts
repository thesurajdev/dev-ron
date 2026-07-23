/* eslint-disable @typescript-eslint/no-require-imports */
// CJS entry point for Vercel serverless
// Note: src/ files are ESM (root package.json "type":"module"), must use dynamic import()
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory OAuth client store (in production use database)
const registeredClients: Record<string, any> = {};
const validTokens: Set<string> = new Set();

// Generate a simple client ID and secret
function generateClientCredentials() {
  return {
    id: crypto.randomBytes(16).toString('hex'),
    secret: crypto.randomBytes(32).toString('hex'),
  };
}

// Middleware to validate Bearer token for MCP endpoints
function validateMCPToken(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  // Allow both with and without token for backward compatibility
  if (!authHeader) {
    return next(); // Allow access without token for now
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return next(); // Not a bearer token, continue anyway
  }

  const token = parts[1];
  
  // Check if token is valid (any token we issued)
  if (!validTokens.has(token)) {
    // Token doesn't match any we issued, but still allow for now
    // In production, reject here
  }
  
  next();
}

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
app.get(['/api/mcp', '/mcp'], validateMCPToken, async (_req: any, res: any) => {
  try {
    const { getMcpManifest } = await import('../src/mcp/server-v2.js');
    res.json(getMcpManifest());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/mcp', '/mcp'], validateMCPToken, async (req: any, res: any) => {
  try {
    const { handleMCPRequest } = await import('../src/mcp/handler.js');
    const response = await handleMCPRequest(req.body);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// OAuth 2.0 Discovery - RFC 8414 - CRITICAL: Includes registration_endpoint
app.get('/.well-known/oauth-authorization-server', (_req: any, res: any) => {
  res.json({
    issuer: 'https://ron.surajdev.com',
    authorization_endpoint: 'https://ron.surajdev.com/oauth/authorize',
    token_endpoint: 'https://ron.surajdev.com/oauth/token',
    registration_endpoint: 'https://ron.surajdev.com/oauth/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'client_credentials'],
    client_types_supported: ['public', 'confidential'],
    code_challenge_methods_supported: ['S256', 'plain'],
    scopes_supported: ['mcp:read', 'mcp:write'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  });
});

// OAuth 2.0 Dynamic Client Registration - RFC 7591 - ALLOWS CLAUDE TO AUTO-REGISTER
app.post('/oauth/register', (req: any, res: any) => {
  try {
    const { client_name, redirect_uris, response_types = ['code'], scope } = req.body;

    if (!client_name) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'client_name required' });
    }

    const creds = generateClientCredentials();
    const clientId = creds.id;
    const clientSecret = creds.secret;

    // Store client
    registeredClients[clientId] = {
      client_id: clientId,
      client_secret: clientSecret,
      client_name,
      redirect_uris: redirect_uris || ['https://claude.ai/callback'],
      response_types,
      scope: scope || 'mcp:read mcp:write',
      created_at: Date.now(),
    };

    // Return client credentials immediately (auto-approve)
    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name,
      redirect_uris: redirect_uris || ['https://claude.ai/callback'],
      response_types,
      scope: 'mcp:read mcp:write',
    });
  } catch (err: any) {
    res.status(400).json({ error: 'invalid_request', error_description: err.message });
  }
});

// OAuth token endpoint
app.post('/oauth/token', (req: any, res: any) => {
  try {
    const { grant_type, code, client_id, client_secret } = req.body;

    if (grant_type === 'authorization_code' || grant_type === 'client_credentials') {
      // Verify client if secret provided
      if (client_secret) {
        const client = registeredClients[client_id];
        if (!client || client.client_secret !== client_secret) {
          return res.status(401).json({ error: 'invalid_client' });
        }
      }

      const accessToken = 'mcp-token-' + crypto.randomBytes(16).toString('hex');
      validTokens.add(accessToken); // Track this token

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 86400,
        scope: 'mcp:read mcp:write',
      });
    } else {
      res.status(400).json({ error: 'unsupported_grant_type' });
    }
  } catch (err: any) {
    res.status(400).json({ error: 'invalid_request', error_description: err.message });
  }
});

// OAuth authorization endpoint
app.get('/oauth/authorize', (req: any, res: any) => {
  const { redirect_uri, state } = req.query;
  const code = 'code-' + crypto.randomBytes(16).toString('hex');
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

