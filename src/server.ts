import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleMCPRequest } from './mcp/handler.js';
import { getMcpManifest } from './mcp/server-v2.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: 'full-app', timestamp: new Date().toISOString() });
});

app.get(['/api/mcp/manifest', '/manifest'], (_req: Request, res: Response) => {
  try {
    const manifest = getMcpManifest();
    res.json(manifest);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/mcp', '/mcp'], async (req: Request, res: Response) => {
  try {
    const response = await handleMCPRequest(req.body);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
