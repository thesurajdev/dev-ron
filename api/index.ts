// ESM entry point for Vercel serverless
// Note: src/ files are ESM (root package.json "type":"module"), must use dynamic import()
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

function isProductionRuntime(): boolean {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const vercelEnv = String(process.env.VERCEL_ENV || '').toLowerCase();
  return nodeEnv === 'production' || vercelEnv === 'production';
}

function getProductionPreflightIssues() {
  const issues: string[] = [];

  if (!isProductionRuntime()) {
    return issues;
  }

  if (!process.env.SUPABASE_URL) issues.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) issues.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.MCP_OAUTH_SECRET) issues.push('MCP_OAUTH_SECRET');
  if (!process.env.PUBLIC_BASE_URL) issues.push('PUBLIC_BASE_URL');

  return issues;
}

const PRODUCTION_PREFLIGHT_ISSUES = getProductionPreflightIssues();
if (PRODUCTION_PREFLIGHT_ISSUES.length > 0) {
  console.error(
    `Production preflight failed. Missing required environment variables: ${PRODUCTION_PREFLIGHT_ISSUES.join(', ')}`
  );
}

const OAUTH_SECRET = process.env.MCP_OAUTH_SECRET || '';
if (!OAUTH_SECRET) {
  console.warn('Warning: MCP_OAUTH_SECRET is missing. Using ephemeral in-memory secret for local runtime only.');
}
const SIGNING_SECRET = OAUTH_SECRET || crypto.randomBytes(32).toString('hex');
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.MCP_ACCESS_TOKEN_TTL_SECONDS || 86400);
const REFRESH_TOKEN_TTL_SECONDS = Number(process.env.MCP_REFRESH_TOKEN_TTL_SECONDS || 2592000);
const AUTH_CODE_TTL_SECONDS = Number(process.env.MCP_AUTH_CODE_TTL_SECONDS || 600);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Support form-encoded OAuth requests

app.use((req: any, res: any, next: any) => {
  if (!isProductionRuntime() || PRODUCTION_PREFLIGHT_ISSUES.length === 0) {
    return next();
  }

  if (req.path === '/health') {
    return next();
  }

  return res.status(503).json({
    error: 'server_misconfigured',
    missing: PRODUCTION_PREFLIGHT_ISSUES,
  });
});

const READ_SCOPES = new Set(['mcp:read', 'mcp:write']);
const WRITE_SCOPE = 'mcp:write';
const READ_ONLY_TOOLS = new Set([
  'get_profile',
  'get_entity',
  'get_related',
  'get_timeline',
  'get_summary',
  'search',
  'get_metrics',
  'get_cash_flow',
  'get_finance_summary',
  'graph_get_object',
  'graph_get_connections',
  'graph_get_timeline',
]);

function sanitizeErrorMessage(error: unknown): string {
  const message = String(error || 'Internal error');
  const lower = message.toLowerCase();

  if (message.includes('<!DOCTYPE html') || message.includes('<html') || lower.includes('cloudflare')) {
    return 'Upstream service request failed';
  }

  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

function parseScopes(scope: string): Set<string> {
  return new Set(
    String(scope || '')
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function hasAnyReadScope(scopes: Set<string>): boolean {
  for (const scope of READ_SCOPES) {
    if (scopes.has(scope)) return true;
  }
  return false;
}

function getRequestedToolName(body: any): string | undefined {
  if (!body || typeof body !== 'object') return undefined;

  if (body.jsonrpc === '2.0' && body.method === 'tools/call') {
    return body?.params?.name;
  }

  if (typeof body.tool === 'string') {
    return body.tool;
  }

  return undefined;
}

function ensureToolScope(body: any, scopeText: string) {
  const toolName = getRequestedToolName(body);
  if (!toolName) return { allowed: true as const };

  const scopes = parseScopes(scopeText);
  const isReadOnlyTool = READ_ONLY_TOOLS.has(toolName);

  if (isReadOnlyTool) {
    if (!hasAnyReadScope(scopes)) {
      return {
        allowed: false as const,
        status: 403,
        payload: {
          error: 'insufficient_scope',
          error_description: 'mcp:read scope required',
          tool: toolName,
        },
      };
    }
    return { allowed: true as const };
  }

  if (!scopes.has(WRITE_SCOPE)) {
    return {
      allowed: false as const,
      status: 403,
      payload: {
        error: 'insufficient_scope',
        error_description: 'mcp:write scope required',
        tool: toolName,
      },
    };
  }

  return { allowed: true as const };
}

app.use((err: any, _req: any, res: any, next: any) => {
  if (!err) {
    return next();
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  return next(err);
});

function resolveBaseUrl(req?: any): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const host = req?.headers?.host;
  const isLocalhost = String(host || '').includes('localhost') || String(host || '').includes('127.0.0.1');
  const proto = req?.headers?.['x-forwarded-proto'] || (isLocalhost ? 'http' : 'https');
  if (host) {
    return `${proto}://${host}`;
  }

  return 'http://localhost:3000';
}

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

function base64urlEncode(value: string | Buffer) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signPayload(payload: Record<string, any>) {
  const payloadJson = JSON.stringify(payload);
  const encodedPayload = base64urlEncode(payloadJson);
  const sig = crypto.createHmac('sha256', SIGNING_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${sig}`;
}

function verifySignedPayload(token: string) {
  try {
    const [encodedPayload, providedSig] = token.split('.');
    if (!encodedPayload || !providedSig) return null;

    const expectedSig = crypto
      .createHmac('sha256', SIGNING_SECRET)
      .update(encodedPayload)
      .digest('base64url');

    if (providedSig !== expectedSig) return null;

    const payload = JSON.parse(base64urlDecode(encodedPayload));
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch {
    return null;
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function createAccessToken(clientId: string, scope: string) {
  const exp = nowSeconds() + ACCESS_TOKEN_TTL_SECONDS;
  const token = signPayload({
    typ: 'access',
    client_id: clientId,
    scope,
    exp,
  });

  // Keep legacy in-memory tracking for debugging and backward compatibility.
  validTokens.set(token, {
    client_id: clientId,
    scope,
    expires_at: exp * 1000,
  });

  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

function createRefreshToken(clientId: string, scope: string) {
  const exp = nowSeconds() + REFRESH_TOKEN_TTL_SECONDS;
  const token = signPayload({
    typ: 'refresh',
    client_id: clientId,
    scope,
    exp,
  });
  return { token, expiresIn: REFRESH_TOKEN_TTL_SECONDS };
}

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

function generateSignedAuthCode(clientId: string, redirectUri: string, scope: string) {
  const exp = nowSeconds() + AUTH_CODE_TTL_SECONDS;
  return signPayload({
    typ: 'auth_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    exp,
    nonce: crypto.randomBytes(8).toString('hex'),
  });
}

function validateAccessToken(token: string) {
  const payload = verifySignedPayload(token);
  if (payload?.typ === 'access' && payload.client_id && payload.scope && payload.exp > nowSeconds()) {
    return {
      client_id: payload.client_id,
      scope: payload.scope,
      expires_at: payload.exp * 1000,
    };
  }

  // Legacy fallback for already-issued in-memory tokens.
  const tokenInfo = validTokens.get(token);
  if (tokenInfo && tokenInfo.expires_at > Date.now()) {
    return tokenInfo;
  }

  return null;
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
  const tokenInfo = validateAccessToken(token);
  const isValid = Boolean(tokenInfo);
  
  console.log('[Auth] Bearer token', isValid ? 'VALID' : 'INVALID/UNKNOWN');

  if (!isValid || !tokenInfo) {
    return res.status(401).json({ error: 'invalid_token', error_description: 'Token is invalid or expired' });
  }

  // Bind request to tenant scope derived from OAuth client.
  req.mcpUserId = `tenant:${tokenInfo.client_id}`;
  req.mcpScope = tokenInfo.scope;
  
  next();
}

// Health - no imports needed
app.get('/health', (_req: any, res: any) => {
  const misconfigured = isProductionRuntime() && PRODUCTION_PREFLIGHT_ISSUES.length > 0;
  if (misconfigured) {
    return res.status(503).json({
      status: 'misconfigured',
      version: 'v4',
      missing: PRODUCTION_PREFLIGHT_ISSUES,
      timestamp: new Date().toISOString(),
    });
  }

  return res.json({ status: 'ok', version: 'v4', timestamp: new Date().toISOString() });
});

// Manifest - dynamic import() for ESM src/ module
app.get(['/api/mcp/manifest', '/manifest'], async (_req: any, res: any) => {
  try {
    const { getMcpManifest } = await import('../src/mcp/server-v2.js');
    const manifest = getMcpManifest();
    const baseUrl = resolveBaseUrl(_req);
    res.json({
      ...manifest,
      server_url: `${baseUrl}/api/mcp`,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'manifest_unavailable' });
  }
});

// MCP endpoint - GET returns manifest (NO AUTH - must be accessible for Claude to validate)
app.get(['/api/mcp', '/mcp'], async (_req: any, res: any) => {
  try {
    console.log('[MCP GET] Request received');
    
    const module = await import('../src/mcp/server-v2.js');
    const baseUrl = resolveBaseUrl(_req);
    const manifest = {
      ...module.getMcpManifest(),
      server_url: `${baseUrl}/api/mcp`,
    };
    
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
    res.status(500).json({ error: 'mcp_manifest_unavailable' });
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

    const scopeDecision = ensureToolScope(req.body, req.mcpScope || '');
    if (!scopeDecision.allowed) {
      return res.status(scopeDecision.status).json(scopeDecision.payload);
    }
    
    // Import handler
    let handler;
    try {
      const module = await import('../src/mcp/handler.js');
      handler = module.handleMCPRequest;
      console.log('[MCP POST] Handler loaded successfully');
    } catch (importErr: any) {
      console.error('[MCP POST] Import error:', importErr.message);
      return res.status(500).json({ error: 'mcp_handler_unavailable' });
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
    res.status(500).json({ error: sanitizeErrorMessage(err?.message || 'Internal Server Error') });
  }
});

// OAuth 2.0 Discovery - RFC 8414 - CRITICAL: Includes registration_endpoint
app.get('/.well-known/oauth-authorization-server', (_req: any, res: any) => {
  const baseUrl = resolveBaseUrl(_req);
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
    client_types_supported: ['public', 'confidential'],
    code_challenge_methods_supported: ['S256', 'plain'],
    scopes_supported: ['mcp:read', 'mcp:write'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  });
});

// OAuth Protected Resource Metadata (RFC 9728)
app.get(['/.well-known/oauth-protected-resource', '/api/mcp/.well-known/oauth-protected-resource'], (_req: any, res: any) => {
  const baseUrl = resolveBaseUrl(_req);
  res.json({
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
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
    const { grant_type, code, client_id, client_secret, redirect_uri, refresh_token, scope } = req.body;

    if (grant_type === 'authorization_code') {
      // Preferred path: validate stateless signed auth code.
      const signedCode = verifySignedPayload(String(code || ''));
      let resolvedClientId = client_id;
      let resolvedScope = 'mcp:read mcp:write';

      if (signedCode?.typ === 'auth_code') {
        if (signedCode.exp <= nowSeconds()) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
        }

        if (client_id && signedCode.client_id !== client_id) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'Client ID mismatch' });
        }

        if (redirect_uri && signedCode.redirect_uri !== redirect_uri) {
          return res.status(400).json({ error: 'invalid_grant', error_description: 'Redirect URI mismatch' });
        }

        resolvedClientId = signedCode.client_id;
        resolvedScope = signedCode.scope || resolvedScope;
      } else {
        // Legacy path for in-memory auth codes.
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

        authCode.used = true;
        resolvedClientId = authCode.client_id;
        resolvedScope = authCode.scope || resolvedScope;
      }

      // Verify client credentials if provided
      if (client_secret) {
        const client = registeredClients[client_id];
        if (!client || client.client_secret !== client_secret) {
          return res.status(401).json({ error: 'invalid_client' });
        }
      }

      if (!resolvedClientId) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
      }

      const access = createAccessToken(resolvedClientId, resolvedScope);
      const refresh = createRefreshToken(resolvedClientId, resolvedScope);

      res.json({
        access_token: access.token,
        token_type: 'Bearer',
        expires_in: access.expiresIn,
        refresh_token: refresh.token,
        scope: resolvedScope,
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

      const resolvedScope = typeof scope === 'string' && scope.trim() ? scope.trim() : 'mcp:read mcp:write';
      const access = createAccessToken(client_id, resolvedScope);
      const refresh = createRefreshToken(client_id, resolvedScope);

      res.json({
        access_token: access.token,
        token_type: 'Bearer',
        expires_in: access.expiresIn,
        refresh_token: refresh.token,
        scope: resolvedScope,
      });
    } else if (grant_type === 'refresh_token') {
      const payload = verifySignedPayload(String(refresh_token || ''));
      if (!payload || payload.typ !== 'refresh') {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
      }

      if (payload.exp <= nowSeconds()) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token expired' });
      }

      const refreshedScope = typeof scope === 'string' && scope.trim() ? scope.trim() : payload.scope;
      const access = createAccessToken(payload.client_id, refreshedScope);

      res.json({
        access_token: access.token,
        token_type: 'Bearer',
        expires_in: access.expiresIn,
        scope: refreshedScope,
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

    if (!client_id || !redirect_uri) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'client_id and redirect_uri required' });
    }

    // Verify redirect URI when client metadata is available.
    const client = registeredClients[client_id];
    if (client && !client.redirect_uris.includes(redirect_uri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Redirect URI not registered' });
    }

    // Issue a stateless authorization code so flow survives cold starts.
    const code = generateSignedAuthCode(client_id, redirect_uri, scope);
    
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
    const { client_id, scope = 'mcp:read mcp:write', redirect_uri } = req.body;

    if (!client_id) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
    }

    const client = registeredClients[client_id];
    const resolvedRedirectUri =
      redirect_uri ||
      client?.redirect_uris?.[0] ||
      'https://claude.ai/callback';

    const code = generateSignedAuthCode(client_id, resolvedRedirectUri, scope);
    
    res.json({
      code,
      scope,
      expires_in: AUTH_CODE_TTL_SECONDS,
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

export default app;

