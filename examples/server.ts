/**
 * Example Express.js Server Implementation
 * This is a complete example showing how to run the MCP server with Express
 * 
 * To use this:
 * 1. Install: npm install express cors
 * 2. Update package.json scripts:
 *    "dev": "ts-node examples/server.ts"
 * 3. Create .env file with Supabase credentials
 * 4. Run: npm run dev
 */

import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleMCPAPI, getManifestAPI } from '../src/api/mcp-routes.js';
import { initializeMCP } from '../src/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// MCP manifest endpoint
app.get('/api/mcp/manifest', async (req: Request, res: Response) => {
  try {
    const manifest = await getManifestAPI();
    res.json(manifest);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Main MCP endpoint
app.post('/api/mcp', async (req: Request, res: Response) => {
  try {
    const response = await handleMCPAPI(req.body);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Documentation endpoint
app.get('/api/docs', (req: Request, res: Response) => {
  const docs = {
    title: 'Data Logger MCP API',
    version: '1.0.0',
    description: 'MCP tool for storing and retrieving business data',
    endpoints: {
      '/health': 'GET - Health check',
      '/api/mcp/manifest': 'GET - Get available tools',
      '/api/mcp': 'POST - Execute MCP tool',
      '/api/docs': 'GET - API documentation',
    },
    examples: {
      add_lead_data: {
        tool: 'add_data',
        input: {
          user_id: 'user@example.com',
          entity_type: 'lead',
          data: {
            name: 'John Doe',
            email: 'john@example.com',
            company: 'Tech Corp',
            status: 'new',
          },
          tags: ['important'],
        },
      },
      get_monthly_summary: {
        tool: 'get_summary',
        input: {
          user_id: 'user@example.com',
          period: 'month',
        },
      },
    },
  };
  res.json(docs);
});

// Initialize and start server
async function start() {
  try {
    console.log('🚀 Starting MCP Server...');
    
    // Initialize MCP
    const init = await initializeMCP();
    console.log('✅ MCP initialized with tools:', init.handlers);

    // Start Express server
    app.listen(PORT, () => {
      console.log(`🎯 Server running at http://localhost:${PORT}`);
      console.log(`📚 API docs: http://localhost:${PORT}/api/docs`);
      console.log(`🛠️ Manifest: http://localhost:${PORT}/api/mcp/manifest`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Start the server
start();
