# Quick Start

Use this file for the fastest setup path.

## 1. Clone and install

```bash
git clone https://github.com/your-org/dev-ron.git
cd dev-ron
npm install
cp .env.example .env
```

## 2. Configure environment

Set in `.env`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_BASE_URL` (example: `https://your-domain.com`)
- `MCP_OAUTH_SECRET` (long random string for OAuth token/code signing; required in production)

## 3. Create database schema

Run SQL from [SETUP_DATABASE.md](SETUP_DATABASE.md) in Supabase SQL Editor.

## 4. Build and run

```bash
npm run build
npm run dev:server
```

## 5. Verify

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/mcp
```

## 6. Connect in Claude

Use your deployed endpoint:

- `https://your-domain.com/api/mcp`

Claude handles OAuth registration and token flow during connector setup.

## Canonical docs

- Product and architecture: [README.md](README.md)
- Database schema: [SETUP_DATABASE.md](SETUP_DATABASE.md)
- Connector specifics: [MCP_SETUP.md](MCP_SETUP.md)
