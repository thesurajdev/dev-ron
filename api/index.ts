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
app.use(express.urlencoded({ extended: true })); // Support form-encoded OAuth requests

// Explicit CORS preflight handlers
app.options('*', cors());

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
const validTokens: Map<string, { client_id: string; scope: string; expires_at: number }> = new Map();
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
  
  if (!authHeader) {
    console.log('[Auth] No authorization header');
    return res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token required' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    console.log('[Auth] Invalid bearer format');
    return res.status(401).json({ error: 'invalid_token', error_description: 'Invalid bearer token format' });
  }

  const token = parts[1];
  const tokenInfo = validTokens.get(token);
  const isValid = Boolean(tokenInfo && tokenInfo.expires_at > Date.now());
  
  console.log('[Auth] Bearer token', isValid ? 'VALID' : 'INVALID/UNKNOWN');

  if (!isValid || !tokenInfo) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Token is invalid or expired' });
  }

  // Bind request to tenant scope derived from OAuth client.
  req.mcpUserId = `tenant:${tokenInfo.client_id}`;
  
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

// MCP endpoint - GET returns manifest (NO AUTH - must be accessible for Claude to validate)
app.get(['/api/mcp', '/mcp'], async (_req: any, res: any) => {
  try {
    console.log('[MCP GET] Request received');
    
    const module = await import('../src/mcp/server-v2.js');
    const manifest = module.getMcpManifest();
    
    console.log('[MCP GET] Manifest has', manifest.tools?.length || 0, 'tools');
    
    // Verify structure
    if (!manifest.tools || !Array.isArray(manifest.tools)) {
      console.error('[MCP GET] Invalid manifest structure');
      return res.status(500).json({ error: 'Invalid manifest structure' });
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.json(manifest);
  } catch (err: any) {
    console.error('[MCP GET] Error:', err.message);
    console.error('[MCP GET] Stack:', err.stack);
    res.status(500).json({ 
      error: 'Server error',
      message: err.message,
      type: err.name
    });
  }
});

app.post(['/api/mcp', '/mcp'], validateMCPToken, async (req: any, res: any) => {
  try {
    const startTime = Date.now();
    console.log('[MCP POST] Request received');
    console.log('[MCP POST] Method:', req.body?.method);
    console.log('[MCP POST] Tool:', req.body?.tool);
    console.log('[MCP POST] Body keys:', Object.keys(req.body || {}));
    console.log('[MCP POST] Auth header:', req.headers.authorization ? 'YES' : 'NO');
    
    // Import handler
    let handler;
    try {
      const module = await import('../src/mcp/handler.js');
      handler = module.handleMCPRequest;
      console.log('[MCP POST] Handler loaded successfully');
    } catch (importErr: any) {
      console.error('[MCP POST] Import error:', importErr.message);
      return res.status(500).json({ 
        error: 'Failed to load MCP handler', 
        details: importErr.message 
      });
    }
    
    if (!handler) {
      console.error('[MCP POST] Handler function not found');
      return res.status(500).json({ error: 'Handler not available' });
    }
    
    // Call handler
    console.log('[MCP POST] Calling handler...');
    const response = await handler(req.body, { userId: req.mcpUserId });
    
    const duration = Date.now() - startTime;
    console.log(`[MCP POST] Success in ${duration}ms`);
    
    // Set proper headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');

    // JSON-RPC notifications do not require response bodies.
    if (req.body?.jsonrpc === '2.0' && typeof req.body?.id === 'undefined') {
      return res.status(202).end();
    }

    // Allow handlers to opt out of sending a payload.
    if (!response || (typeof response === 'object' && Object.keys(response).length === 0)) {
      return res.status(204).end();
    }
    
    res.json(response);
  } catch (err: any) {
    console.error('[MCP POST] Unhandled error:', err.message);
    console.error('[MCP POST] Stack:', err.stack);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: err?.message || 'Unknown error',
      type: err?.name || 'Error'
    });
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

// OAuth Protected Resource Metadata (RFC 9728)
app.get(['/.well-known/oauth-protected-resource', '/api/mcp/.well-known/oauth-protected-resource'], (_req: any, res: any) => {
  res.json({
    resource: 'https://ron.surajdev.com/api/mcp',
    authorization_servers: ['https://ron.surajdev.com'],
    scopes_supported: ['mcp:read', 'mcp:write'],
    bearer_methods_supported: ['header'],
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
      validTokens.set(accessToken, {
        client_id,
        scope: authCode.scope,
        expires_at: Date.now() + 86400 * 1000,
      });

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
      validTokens.set(accessToken, {
        client_id,
        scope: 'mcp:read mcp:write',
        expires_at: Date.now() + 86400 * 1000,
      });

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

// OAuth direct code endpoint - for clients that can't follow redirects
app.post('/oauth/authorize', (req: any, res: any) => {
  try {
    const { client_id, scope = 'mcp:read mcp:write' } = req.body;

    // Verify client exists
    const client = registeredClients[client_id];
    if (!client) {
      return res.status(400).json({ error: 'unauthorized_client' });
    }

    // Generate and return authorization code directly (no redirect)
    const redirect_uri = client.redirect_uris[0]; // Use first registered URI
    const code = generateAuthCode(client_id, redirect_uri, scope);
    
    res.json({
      code,
      scope,
      expires_in: 600, // 10 minutes
    });
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

// Catch-all 404 handler to log unhandled requests
app.use((_req: any, res: any) => {
  console.warn(`[Unhandled] ${_req.method} ${_req.path}`);
  res.status(404).json({ error: 'not_found', path: _req.path, method: _req.method });
});

module.exports = app;

