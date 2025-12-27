#!/usr/bin/env node
/**
 * Bolagsverket MCP HTTP Server
 * HTTP-server för Render deployment
 * 
 * Endpoints:
 * - / : README som HTML
 * - /health : Health check
 * - /mcp : MCP protocol (Streamable HTTP)
 * - /sse : Server-Sent Events (äldre klienter)
 */

import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';
import { z } from 'zod';
import * as api from './api-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server version
const VERSION = '1.0.0';

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(express.text());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
  res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============================================
// Skapa MCP Server med alla tools
// ============================================
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'bolagsverket-mcp-server',
    version: VERSION,
  });

  // Tool: Analysera företag (fullständig)
  server.tool(
    'bolagsverket_analyze_full',
    'Komplett årsredovisningsanalys av ett företag. Inkluderar finansiell data, nyckeltal och riskindikatorer.',
    {
      organisationsnummer: z.string().describe('Organisationsnummer (10 siffror)'),
      year: z.number().optional().describe('Räkenskapsår (valfritt, senaste om ej angivet)'),
    },
    async ({ organisationsnummer, year }) => {
      try {
        const [company, report] = await Promise.all([
          api.getCompanyInfo(organisationsnummer),
          api.getAnnualReport(organisationsnummer, year),
        ]);
        
        const keyFigures = api.calculateKeyFigures(report);
        const risks = api.analyzeRisks(report);
        
        const analysis = {
          foretag: {
            namn: company.namn,
            organisationsnummer: api.formatOrgNr(company.organisationsnummer),
            bolagsform: company.bolagsform,
            status: company.status,
          },
          rakenskapsperiod: report.rakenskapsperiod,
          finansiellData: report.data,
          nyckeltal: keyFigures,
          riskindikatorer: risks,
          taxonomi: report.taxonomi,
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(analysis, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool: Riskanalys
  server.tool(
    'bolagsverket_risk_check',
    'Identifiera röda flaggor och varningar i ett företags årsredovisning.',
    {
      organisationsnummer: z.string().describe('Organisationsnummer (10 siffror)'),
      year: z.number().optional().describe('Räkenskapsår (valfritt)'),
    },
    async ({ organisationsnummer, year }) => {
      try {
        const report = await api.getAnnualReport(organisationsnummer, year);
        const company = await api.getCompanyInfo(organisationsnummer);
        const risks = api.analyzeRisks(report);
        
        const result = {
          foretag: {
            namn: company.namn,
            organisationsnummer: api.formatOrgNr(company.organisationsnummer),
          },
          rakenskapsperiod: report.rakenskapsperiod,
          riskindikatorer: risks,
          sammanfattning: {
            kritiska: risks.filter(r => r.type === 'critical').length,
            varningar: risks.filter(r => r.type === 'warning').length,
            info: risks.filter(r => r.type === 'info').length,
          },
          bedomning: risks.some(r => r.type === 'critical') 
            ? 'HÖG RISK' 
            : risks.some(r => r.type === 'warning')
              ? 'MEDELHÖG RISK'
              : 'LÅG RISK',
        };
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool: Sök företag
  server.tool(
    'bolagsverket_search',
    'Sök efter företag utan att veta organisationsnummer. Sök på namn, ort eller bransch.',
    {
      query: z.string().describe('Sökterm (företagsnamn, ort, etc.)'),
      page: z.number().optional().describe('Sidnummer (standard: 1)'),
      pageSize: z.number().optional().describe('Antal resultat per sida (standard: 20, max: 100)'),
    },
    async ({ query, page, pageSize }) => {
      try {
        const result = await api.searchCompanies(query, { page, pageSize });
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              sokning: query,
              antal: result.totalCount,
              sida: result.page,
              foretag: result.companies.map(c => ({
                namn: c.namn,
                organisationsnummer: api.formatOrgNr(c.organisationsnummer),
                bolagsform: c.bolagsform,
                status: c.status,
              })),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool: Nyckeltal
  server.tool(
    'bolagsverket_key_figures',
    'Beräkna och visa nyckeltal för ett företag (soliditet, likviditet, lönsamhet).',
    {
      organisationsnummer: z.string().describe('Organisationsnummer (10 siffror)'),
      year: z.number().optional().describe('Räkenskapsår (valfritt)'),
    },
    async ({ organisationsnummer, year }) => {
      try {
        const [company, report] = await Promise.all([
          api.getCompanyInfo(organisationsnummer),
          api.getAnnualReport(organisationsnummer, year),
        ]);
        
        const keyFigures = api.calculateKeyFigures(report);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              foretag: {
                namn: company.namn,
                organisationsnummer: api.formatOrgNr(company.organisationsnummer),
              },
              rakenskapsperiod: report.rakenskapsperiod,
              nyckeltal: keyFigures,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool: Företagsinfo
  server.tool(
    'bolagsverket_company_info',
    'Hämta grundläggande information om ett företag (namn, adress, status).',
    {
      organisationsnummer: z.string().describe('Organisationsnummer (10 siffror)'),
    },
    async ({ organisationsnummer }) => {
      try {
        const company = await api.getCompanyInfo(organisationsnummer);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              namn: company.namn,
              organisationsnummer: api.formatOrgNr(company.organisationsnummer),
              bolagsform: company.bolagsform,
              status: company.status,
              registreringsdatum: company.registreringsdatum,
              adress: company.adress,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Fel: ${error instanceof Error ? error.message : 'Okänt fel'}`,
          }],
          isError: true,
        };
      }
    }
  );

  // Tool: Serverstatus
  server.tool(
    'bolagsverket_server_status',
    'Visa serverstatus, cache-statistik och tillgängliga verktyg.',
    {},
    async () => {
      const cacheStats = api.getCacheStats();
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            server: 'bolagsverket-mcp-server',
            version: VERSION,
            status: 'online',
            timestamp: new Date().toISOString(),
            cache: {
              entries: cacheStats.entries,
              oldestEntryAge: cacheStats.oldestEntry 
                ? `${Math.round(cacheStats.oldestEntry / 1000)}s`
                : null,
            },
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

// ============================================
// ENDPOINT 1: ROOT (/) - README som HTML
// ============================================
app.get('/', async (req: Request, res: Response) => {
  try {
    const readmePath = path.join(__dirname, '..', 'README.md');
    let readmeContent: string;
    
    try {
      readmeContent = await fs.readFile(readmePath, 'utf-8');
    } catch {
      readmeContent = `# Bolagsverket MCP Server v${VERSION}

MCP-server för Bolagsverkets API "Värdefulla datamängder".

## Remote MCP Server URL

\`\`\`
https://bolagsverket-mcp.onrender.com/mcp
\`\`\`

## Endpoints

| Endpoint | Beskrivning |
|----------|-------------|
| \`/mcp\` | Streamable HTTP (ChatGPT, Claude.ai, Claude Desktop) |
| \`/sse\` | Server-Sent Events (äldre klienter) |
| \`/health\` | Health check |

## Verktyg

- \`bolagsverket_analyze_full\` - Komplett årsredovisningsanalys
- \`bolagsverket_risk_check\` - Röda flaggor och varningar
- \`bolagsverket_search\` - Sök företag utan orgnummer
- \`bolagsverket_key_figures\` - Nyckeltal (soliditet, likviditet, etc.)
- \`bolagsverket_company_info\` - Grundläggande företagsinfo
- \`bolagsverket_server_status\` - Serverstatus och cache-statistik
`;
    }
    
    const htmlContent = await marked(readmeContent);

    const fullHtml = `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bolagsverket MCP Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
      color: #333;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 { color: #1a365d; border-bottom: 3px solid #3182ce; padding-bottom: 0.5rem; }
    h2 { color: #2d3748; margin-top: 2rem; }
    code {
      background: #edf2f7;
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      font-family: 'Fira Code', monospace;
    }
    pre {
      background: #1a202c;
      color: #e2e8f0;
      padding: 1rem;
      border-radius: 5px;
      overflow-x: auto;
    }
    pre code { background: transparent; color: inherit; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #e2e8f0; padding: 0.75rem; text-align: left; }
    th { background: #edf2f7; }
    .endpoint-links {
      background: #ebf8ff;
      padding: 1rem;
      border-radius: 5px;
      margin: 1rem 0;
      border-left: 4px solid #3182ce;
    }
    .endpoint-links a {
      display: inline-block;
      margin: 0.25rem 0.5rem;
      padding: 0.5rem 1rem;
      background: #3182ce;
      color: white;
      text-decoration: none;
      border-radius: 4px;
    }
    .endpoint-links a:hover { background: #2c5282; }
  </style>
</head>
<body>
  <div class="container">
    <div class="endpoint-links">
      <strong>Tjänst-endpoints:</strong>
      <a href="/health">Health Check</a>
      <a href="/mcp">MCP Endpoint</a>
      <a href="/sse">SSE Endpoint</a>
    </div>
    ${htmlContent}
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(fullHtml);
  } catch (error) {
    console.error('[HTTP] Error serving README:', error);
    res.status(500).send('Error loading documentation');
  }
});

// ============================================
// ENDPOINT 2: /health - Health Check
// ============================================
app.get('/health', async (req: Request, res: Response) => {
  const cacheStats = api.getCacheStats();
  
  const health = {
    status: 'ok',
    server: 'bolagsverket-mcp-server',
    version: VERSION,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cache: {
      entries: cacheStats.entries,
    },
    endpoints: {
      mcp: '/mcp',
      sse: '/sse',
      health: '/health',
    },
  };
  
  res.json(health);
});

// ============================================
// ENDPOINT 3: /mcp - Streamable HTTP
// ============================================
const mcpSessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

app.post('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let session = sessionId ? mcpSessions.get(sessionId) : undefined;

  try {
    // Ny session om initialize request utan session
    if (!session && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          mcpSessions.set(id, { transport, server });
          console.error(`[MCP] Session initialized: ${id}`);
        },
      });
      
      const server = createMcpServer();
      await server.connect(transport);
      session = { transport, server };
    }

    if (!session) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: 'Bad Request: No valid session. Send initialize request first.',
        },
        id: null,
      });
      return;
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[MCP] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// GET /mcp för SSE stream (Streamable HTTP)
app.get('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const session = mcpSessions.get(sessionId);

  if (!session) {
    res.status(400).json({ error: 'No active session' });
    return;
  }

  await session.transport.handleRequest(req, res);
});

// DELETE /mcp för att avsluta session
app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  const session = mcpSessions.get(sessionId);

  if (session) {
    await session.server.close();
    mcpSessions.delete(sessionId);
    console.error(`[MCP] Session closed: ${sessionId}`);
  }

  res.status(204).send();
});

// ============================================
// ENDPOINT 4: /sse - Server-Sent Events (äldre klienter)
// ============================================
app.get('/sse', async (req: Request, res: Response) => {
  console.error('[SSE] New connection');
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const transport = new SSEServerTransport('/sse/message', res);
  const server = createMcpServer();
  
  await server.connect(transport);

  req.on('close', () => {
    console.error('[SSE] Client disconnected');
    server.close();
  });
});

app.post('/sse/message', async (req: Request, res: Response) => {
  // SSE message handling via transport
  res.status(200).json({ ok: true });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.error(`[Bolagsverket MCP] HTTP Server v${VERSION} started`);
  console.error(`[Bolagsverket MCP] Port: ${PORT}`);
  console.error(`[Bolagsverket MCP] Endpoints:`);
  console.error(`  - Root:   http://localhost:${PORT}/`);
  console.error(`  - Health: http://localhost:${PORT}/health`);
  console.error(`  - MCP:    http://localhost:${PORT}/mcp`);
  console.error(`  - SSE:    http://localhost:${PORT}/sse`);
});

process.on('SIGTERM', () => {
  console.error('[HTTP] SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[HTTP] SIGINT received, shutting down...');
  process.exit(0);
});
