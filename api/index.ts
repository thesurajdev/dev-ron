import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/mcp/manifest', async (_req: Request, res: Response) => {
  try {
    const { getMcpManifest } = await import('../src/mcp/server-v2.js');
    const manifest = getMcpManifest();
    res.json(manifest);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mcp', async (req: Request, res: Response) => {
  try {
    const { handleMCPRequest } = await import('../src/mcp/handler.js');
    const response = await handleMCPRequest(req.body);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
