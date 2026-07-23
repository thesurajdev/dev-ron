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

// Request logging middleware
app.use((req: any, res: any, next: any) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  if (req.method === 'POST' && req.body) {
    console.log(`  Body keys: ${Object.keys(req.body).join(', ')}`);
  }
  next();
});

// In-memory OAuth client store (in production use database)
const registeredClients: Record<string, any> = {};
const validTokens: Set<string> = new Set();
const authorizationCodes: Record<string, any> = {}; // Track auth codes with expiration

// Generate a simple client ID and secret
function generateClientCredentials() {
  return {
    id: crypto.randomBytes(16).toString('hex'),
    secret: crypto.randomBytes(32).toString('hex'),
  };
}

// Generate and store authorization code (expires in 10 minutes)
function generateAuthCode(clientId: string, redirectUri: string, scope: string) {
  const code = 'code-' + crypto.randomBytes(16).toString('hex');
  authorizationCodes[code] = {
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    created_at: Date.now(),
    expires_at: Date.now() + 10 * 60 * 1000, // 10 minute expiration
    used: false,
  };
  return code;
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

// OAuth token endpoint - validates authorization code
app.post('/oauth/token', (req: any, res: any) => {
  try {
    const { grant_type, code, client_id, client_secret, redirect_uri } = req.body;

    if (grant_type === 'authorization_code') {
      // Validate authorization code
      const authCode = authorizationCodes[code];
      
      if (!authCode) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code not found' });
      }
      
      if (authCode.used) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code already used' });
      }
      
      if (Date.now() > authCode.expires_at) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
      }
      
      if (authCode.client_id !== client_id) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Client ID mismatch' });
      }
      
      if (redirect_uri && authCode.redirect_uri !== redirect_uri) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Redirect URI mismatch' });
      }

      // Verify client credentials if provided
      if (client_secret) {
        const client = registeredClients[client_id];
        if (!client || client.client_secret !== client_secret) {
          return res.status(401).json({ error: 'invalid_client' });
        }
      }

      // Mark code as used
      authCode.used = true;

      // Generate and track token
      const accessToken = 'mcp-token-' + crypto.randomBytes(16).toString('hex');
      validTokens.add(accessToken);

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 86400,
        scope: authCode.scope,
      });
    } else if (grant_type === 'client_credentials') {
      // Client credentials flow (for testing)
      if (!client_secret) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'client_secret required for client_credentials' });
      }
      
      const client = registeredClients[client_id];
      if (!client || client.client_secret !== client_secret) {
        return res.status(401).json({ error: 'invalid_client' });
      }

      const accessToken = 'mcp-token-' + crypto.randomBytes(16).toString('hex');
      validTokens.add(accessToken);

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

// OAuth authorization endpoint - issues authorization code
app.get('/oauth/authorize', (req: any, res: any) => {
  try {
    const { client_id, redirect_uri, state, scope = 'mcp:read mcp:write' } = req.query;

    // Verify client exists
    const client = registeredClients[client_id];
    if (!client) {
      return res.status(400).json({ error: 'unauthorized_client' });
    }

    // Verify redirect URI matches registered URI
    if (!client.redirect_uris.includes(redirect_uri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Redirect URI not registered' });
    }

    // Generate and store authorization code
    const code = generateAuthCode(client_id, redirect_uri, scope);
    
    // Redirect with code and state
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);
    
    res.redirect(redirectUrl.toString());
  } catch (err: any) {
    res.status(400).json({ error: 'server_error', error_description: err.message });
  }
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

