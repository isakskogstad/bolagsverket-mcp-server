#!/usr/bin/env node
/**
 * Bolagsverket MCP Server
 * Hämtar och analyserar företagsdata från Bolagsverkets API.
 *
 * Version: 6.0.0
 * Stödjer stdio, SSE och Streamable HTTP transport.
 * Kompatibel med Claude.ai, ChatGPT, Gemini, Codex och Claude Desktop.
 *
 * Sessionless-läge: Servern skapar automatiskt sessioner vid behov.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { SERVER_CONFIG } from './lib/config.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';
import { cacheManager } from './lib/cache-manager.js';

const PORT = parseInt(process.env.PORT || '10000', 10);
const MCP_PROTOCOL_VERSION = '2025-03-26';

// Session timeout (30 minuter inaktivitet)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Generera en vacker HTML-välkomstsida för webbläsarbesökare.
 */
function generateWelcomePage(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bolagsverket MCP Server</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      color: #e4e4e7;
      padding: 2rem;
    }
    .container { max-width: 900px; margin: 0 auto; }
    header {
      text-align: center;
      padding: 3rem 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      margin-bottom: 2rem;
    }
    h1 {
      font-size: 2.5rem;
      background: linear-gradient(90deg, #00d4ff, #7c3aed);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }
    .version { color: #a1a1aa; font-size: 0.9rem; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(34, 197, 94, 0.2);
      color: #22c55e;
      padding: 0.5rem 1rem;
      border-radius: 2rem;
      margin-top: 1rem;
    }
    .status::before {
      content: '';
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card h2 {
      color: #00d4ff;
      margin-bottom: 1rem;
      font-size: 1.3rem;
    }
    .url-box {
      background: #1e1e2e;
      border: 1px solid #3f3f46;
      border-radius: 0.5rem;
      padding: 1rem;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.95rem;
      word-break: break-all;
      color: #22c55e;
    }
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
    }
    .tool {
      background: rgba(124, 58, 237, 0.1);
      border: 1px solid rgba(124, 58, 237, 0.3);
      border-radius: 0.5rem;
      padding: 1rem;
    }
    .tool h3 {
      color: #a78bfa;
      font-size: 0.95rem;
      margin-bottom: 0.3rem;
    }
    .tool p { font-size: 0.85rem; color: #a1a1aa; }
    .clients {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .client {
      background: rgba(0, 212, 255, 0.1);
      border: 1px solid rgba(0, 212, 255, 0.3);
      padding: 0.5rem 1rem;
      border-radius: 2rem;
      font-size: 0.85rem;
      color: #00d4ff;
    }
    code {
      background: #27272a;
      padding: 0.2rem 0.4rem;
      border-radius: 0.25rem;
      font-size: 0.9rem;
    }
    .instructions {
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid rgba(251, 191, 36, 0.3);
      border-radius: 0.5rem;
      padding: 1rem;
      margin-top: 1rem;
    }
    .instructions h3 { color: #fbbf24; margin-bottom: 0.5rem; }
    .instructions ol { margin-left: 1.5rem; }
    .instructions li { margin-bottom: 0.5rem; line-height: 1.6; }
    footer {
      text-align: center;
      padding: 2rem 0;
      color: #71717a;
      font-size: 0.85rem;
    }
    a { color: #00d4ff; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🏢 Bolagsverket MCP Server</h1>
      <p class="version">Version ${SERVER_CONFIG.VERSION}</p>
      <div class="status">Online och redo</div>
    </header>

    <div class="card">
      <h2>🔗 Anslut till servern</h2>
      <p style="margin-bottom: 1rem;">Använd denna URL för att ansluta din AI-klient:</p>
      <div class="url-box">${baseUrl}</div>
      <div class="clients">
        <span class="client">Claude.ai</span>
        <span class="client">ChatGPT</span>
        <span class="client">Gemini</span>
        <span class="client">Codex</span>
        <span class="client">Claude Desktop</span>
        <span class="client">Cursor</span>
      </div>
      <div class="instructions">
        <h3>Så här ansluter du:</h3>
        <ol>
          <li><strong>Claude.ai:</strong> Gå till Inställningar → MCP Servers → Lägg till URL</li>
          <li><strong>ChatGPT:</strong> Lägg till som plugin med URL:en ovan</li>
          <li><strong>Claude Desktop:</strong> Lägg till i <code>claude_desktop_config.json</code></li>
          <li><strong>Cursor/VS Code:</strong> Konfigurera som MCP-server i inställningar</li>
        </ol>
      </div>
    </div>

    <div class="card">
      <h2>🛠️ Tillgängliga verktyg</h2>
      <div class="tools-grid">
        <div class="tool">
          <h3>bolagsverket_analyze_full</h3>
          <p>Komplett företagsanalys med all data</p>
        </div>
        <div class="tool">
          <h3>bolagsverket_get_basic_info</h3>
          <p>Grundläggande företagsinfo</p>
        </div>
        <div class="tool">
          <h3>bolagsverket_get_nyckeltal</h3>
          <p>Finansiella nyckeltal</p>
        </div>
        <div class="tool">
          <h3>bolagsverket_get_styrelse</h3>
          <p>Styrelsemedlemmar och revisorer</p>
        </div>
        <div class="tool">
          <h3>bolagsverket_risk_check</h3>
          <p>Riskbedömning med varningsflaggor</p>
        </div>
        <div class="tool">
          <h3>bolagsverket_trend</h3>
          <p>Trendanalys över flera år</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>📡 API-endpoints</h2>
      <p><code>POST /</code> eller <code>POST /mcp</code> — MCP JSON-RPC-förfrågningar</p>
      <p style="margin-top: 0.5rem;"><code>GET /sse</code> — SSE-streaming för äldre klienter</p>
      <p style="margin-top: 0.5rem;"><code>GET /health</code> — Hälsokontroll</p>
    </div>

    <footer>
      <p>Bolagsverket MCP Server — Skapad för att göra svensk företagsdata tillgänglig för AI</p>
      <p style="margin-top: 0.5rem;">MCP Protocol Version: ${MCP_PROTOCOL_VERSION}</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Skapa och konfigurera MCP-server.
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_CONFIG.NAME,
    version: SERVER_CONFIG.VERSION,
  });

  // Registrera alla komponenter
  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

/**
 * Kör med stdio-transport (lokal).
 */
async function runStdio(): Promise<void> {
  console.error(`[Server] Startar ${SERVER_CONFIG.NAME} v${SERVER_CONFIG.VERSION} (stdio)`);

  const cleared = cacheManager.clearExpired();
  if (cleared > 0) {
    console.error(`[Cache] Rensade ${cleared} utgångna poster`);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[Server] Ansluten via stdio');
}

/**
 * Kör med Streamable HTTP transport (för ChatGPT/Claude.ai).
 * Stödjer även SSE för bakåtkompatibilitet.
 */
async function runHTTP(): Promise<void> {
  console.error(`[Server] Startar ${SERVER_CONFIG.NAME} v${SERVER_CONFIG.VERSION} (HTTP på port ${PORT})`);

  const cleared = cacheManager.clearExpired();
  if (cleared > 0) {
    console.error(`[Cache] Rensade ${cleared} utgångna poster`);
  }

  // Streamable HTTP sessions med timeout-hantering
  interface HttpSession {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
    lastActivity: number;
  }
  const httpSessions = new Map<string, HttpSession>();

  // SSE transporter per session (för bakåtkompatibilitet)
  const sseSessions = new Map<string, SSEServerTransport>();

  // Session cleanup timer - rensa inaktiva sessioner var 5:e minut
  const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of httpSessions.entries()) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        console.error(`[MCP] Session timeout, closing: ${id}`);
        session.server.close().catch(() => {});
        httpSessions.delete(id);
      }
    }
  }, 5 * 60 * 1000);

  // Rensa interval vid shutdown
  process.on('SIGINT', () => clearInterval(sessionCleanupInterval));
  process.on('SIGTERM', () => clearInterval(sessionCleanupInterval));

  /**
   * Hantera MCP Streamable HTTP request
   */
  async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Session ID header (case-insensitive)
    const sessionId = (req.headers['mcp-session-id'] as string | undefined);
    let session = sessionId ? httpSessions.get(sessionId) : undefined;

    // Uppdatera lastActivity för aktiv session
    if (session) {
      session.lastActivity = Date.now();
    }

    // HEAD - Protocol discovery (krävs av Claude.ai)
    // Specifikationen säger att servern ska returnera MCP-Protocol-Version header
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Accept': 'application/json, text/event-stream',
      });
      res.end();
      return;
    }

    // POST - JSON-RPC request
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const jsonBody = JSON.parse(body);

          // Ny session vid initialize request
          if (!session && isInitializeRequest(jsonBody)) {
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (id) => {
                const newSession: HttpSession = {
                  transport,
                  server,
                  lastActivity: Date.now()
                };
                httpSessions.set(id, newSession);
                console.error(`[MCP] Session initialized: ${id}`);
              },
            });

            const server = createMcpServer();
            await server.connect(transport);
            session = { transport, server, lastActivity: Date.now() };
          }

          if (!session) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32600,
                message: 'Bad Request: No valid session. Send initialize request first.',
              },
              id: null,
            }));
            return;
          }

          await session.transport.handleRequest(req, res, jsonBody);
        } catch (error) {
          console.error('[MCP] Error:', error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Internal server error',
              },
              id: null,
            }));
          }
        }
      });
      return;
    }

    // GET - SSE stream för Streamable HTTP (om session finns) eller välkomstsida
    if (req.method === 'GET') {
      // Om det finns en aktiv session, använd SSE-streaming
      if (session) {
        await session.transport.handleRequest(req, res);
        return;
      }

      // Kontrollera om det är en MCP-klient (Accept: text/event-stream eller application/json)
      const accept = req.headers['accept'] || '';
      const isMcpClient = accept.includes('text/event-stream') ||
                          accept.includes('application/json') ||
                          req.headers['mcp-protocol-version'];

      if (isMcpClient) {
        // MCP-klient utan session - instruera att använda POST
        res.writeHead(405, {
          'Content-Type': 'application/json',
          'Allow': 'POST, HEAD, DELETE',
          'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Session required. Send initialize request via POST first.',
          },
          id: null,
        }));
        return;
      }

      // Webbläsare - visa välkomstsidan
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers['host'] || `localhost:${PORT}`;
      const baseUrl = `${protocol}://${host}`;

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(generateWelcomePage(baseUrl));
      return;
    }

    // DELETE - Avsluta session
    if (req.method === 'DELETE') {
      if (session && sessionId) {
        await session.server.close();
        httpSessions.delete(sessionId);
        console.error(`[MCP] Session closed: ${sessionId}`);
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // Metod stöds ej
    res.writeHead(405, {
      'Content-Type': 'application/json',
      'Allow': 'POST, GET, HEAD, DELETE',
    });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // CORS headers för alla AI-klienter (Claude.ai, ChatGPT, Gemini, Codex, etc.)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, mcp-session-id, Last-Event-ID, X-Request-Id, X-Requested-With');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, mcp-session-id, MCP-Protocol-Version, Content-Type, X-Request-Id');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: SERVER_CONFIG.NAME,
        version: SERVER_CONFIG.VERSION,
        transport: 'streamable-http',
        protocolVersion: MCP_PROTOCOL_VERSION,
        endpoints: {
          mcp: '/',
          health: '/health',
          sse: '/sse'
        }
      }));
      return;
    }

    // ==========================================
    // .well-known/mcp.json - MCP Server Discovery
    // ==========================================
    if (url.pathname === '/.well-known/mcp.json') {
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers['host'] || `localhost:${PORT}`;
      const baseUrl = `${protocol}://${host}`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        mcpServers: {
          bolagsverket: {
            url: baseUrl,
            name: 'Bolagsverket MCP Server',
            description: 'Hämtar och analyserar företagsdata från Bolagsverkets API. Ger tillgång till årsredovisningar, nyckeltal, styrelseinfo och riskbedömningar för svenska företag.',
            version: SERVER_CONFIG.VERSION,
            protocolVersion: MCP_PROTOCOL_VERSION,
            transport: ['streamable-http', 'sse'],
            capabilities: {
              tools: true,
              resources: true,
              prompts: true,
            },
            tools: [
              { name: 'bolagsverket_analyze_full', description: 'Komplett företagsanalys' },
              { name: 'bolagsverket_get_basic_info', description: 'Grundläggande företagsinfo' },
              { name: 'bolagsverket_get_nyckeltal', description: 'Finansiella nyckeltal' },
              { name: 'bolagsverket_get_styrelse', description: 'Styrelsemedlemmar och revisorer' },
              { name: 'bolagsverket_risk_check', description: 'Riskbedömning' },
              { name: 'bolagsverket_trend', description: 'Trendanalys över flera år' },
            ],
          },
        },
      }));
      return;
    }

    // ==========================================
    // Root path - MCP Endpoint (primär för Claude.ai)
    // ==========================================
    if (url.pathname === '/') {
      await handleMcpRequest(req, res);
      return;
    }

    // ==========================================
    // /mcp path - MCP Endpoint (för ChatGPT och bakåtkompatibilitet)
    // ==========================================
    if (url.pathname === '/mcp') {
      await handleMcpRequest(req, res);
      return;
    }

    // ==========================================
    // SSE Endpoint (bakåtkompatibilitet för äldre klienter)
    // ==========================================
    if (url.pathname === '/sse') {
      if (req.method !== 'GET') {
        res.writeHead(405, {
          'Content-Type': 'application/json',
          'Allow': 'GET',
        });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      console.error('[SSE] Ny klient ansluter...');

      const server = createMcpServer();
      const transport = new SSEServerTransport('/message', res);

      sseSessions.set(transport.sessionId, transport);

      res.on('close', () => {
        console.error(`[SSE] Klient ${transport.sessionId} bortkopplad`);
        sseSessions.delete(transport.sessionId);
      });

      await server.connect(transport);
      console.error(`[SSE] Klient ${transport.sessionId} ansluten`);
      return;
    }

    // Message endpoint för SSE
    if (url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session ID krävs' }));
        return;
      }

      const transport = sseSessions.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session hittades inte' }));
        return;
      }

      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          await transport.handlePostMessage(req, res, body);
        } catch (error) {
          console.error('[Message] Fel:', error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internt serverfel' }));
          }
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint hittades inte' }));
  });

  httpServer.listen(PORT, () => {
    console.error(`[Server] Lyssnar på http://0.0.0.0:${PORT}`);
    console.error(`[Server] MCP endpoint (Streamable HTTP): http://0.0.0.0:${PORT}/`);
    console.error(`[Server] MCP endpoint (alias): http://0.0.0.0:${PORT}/mcp`);
    console.error(`[Server] SSE endpoint (legacy): http://0.0.0.0:${PORT}/sse`);
    console.error(`[Server] Health check: http://0.0.0.0:${PORT}/health`);
    console.error(`[Server] Protocol version: ${MCP_PROTOCOL_VERSION}`);
  });
}

/**
 * Huvudfunktion.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useHTTP = args.includes('--http') || process.env.MCP_TRANSPORT === 'http';
  const useSSE = args.includes('--sse') || process.env.MCP_TRANSPORT === 'sse';

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.error('[Server] Avslutar...');
    cacheManager.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[Server] Avslutar...');
    cacheManager.close();
    process.exit(0);
  });

  // HTTP transport är nu standard för remote (både --http och --sse startar HTTP-servern)
  if (useHTTP || useSSE) {
    await runHTTP();
  } else {
    await runStdio();
  }
}

// Kör
main().catch((error) => {
  console.error('[Server] Fatal error:', error);
  process.exit(1);
});
