#!/usr/bin/env node
/**
 * Bolagsverket MCP Server
 * Hämtar och analyserar företagsdata från Bolagsverkets API.
 *
 * Version: 7.0.0
 * Stödjer stdio, SSE och Streamable HTTP transport.
 * Kompatibel med Claude.ai, ChatGPT, Gemini, Codex och Claude Desktop.
 *
 * Optimerad för Render deployment med:
 * - Sessionless HTTP mode för bättre kompatibilitet
 * - Keep-alive och connection pooling
 * - Gzip komprimering
 * - Strukturerad loggning
 * - Robust felhantering
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { gzipSync } from 'zlib';
import { SERVER_CONFIG } from './lib/config.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';
import { cacheManager } from './lib/cache-manager.js';
import { checkApiStatus } from './lib/api-client.js';

const PORT = parseInt(process.env.PORT || '10000', 10);
const MCP_PROTOCOL_VERSION = '2025-03-26';
const SERVER_START_TIME = Date.now();

// Session timeout (30 minuter inaktivitet)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// Request timeout (2 minuter för långa operationer)
const REQUEST_TIMEOUT_MS = 120000;

// Miljövariabler
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ENABLE_COMPRESSION = process.env.DISABLE_COMPRESSION !== 'true';
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_PRODUCTION ? 'info' : 'debug');

// =============================================================================
// Strukturerad loggning
// =============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  requestId?: string;
  sessionId?: string;
  duration?: number;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function log(level: LogLevel, component: string, message: string, extra?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[LOG_LEVEL as LogLevel]) {
    return;
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...extra,
  };

  if (IS_PRODUCTION) {
    // JSON-format för produktion (bättre för log aggregation)
    console.error(JSON.stringify(entry));
  } else {
    // Läsbar format för utveckling
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${component}]`;
    const extraStr = extra ? ` ${JSON.stringify(extra)}` : '';
    console.error(`${prefix} ${message}${extraStr}`);
  }
}

// =============================================================================
// Gzip komprimering
// =============================================================================

function shouldCompress(req: IncomingMessage): boolean {
  if (!ENABLE_COMPRESSION) return false;
  const acceptEncoding = req.headers['accept-encoding'] || '';
  return acceptEncoding.includes('gzip');
}

function compressResponse(data: string): Buffer {
  return gzipSync(data, { level: 6 });
}

// =============================================================================
// Välkomstsida
// =============================================================================

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
    .uptime { margin-top: 0.5rem; font-size: 0.8rem; color: #71717a; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Bolagsverket MCP Server</h1>
      <p class="version">Version ${SERVER_CONFIG.VERSION}</p>
      <div class="status">Online och redo</div>
      <p class="uptime">Uptime: ${formatUptime(Date.now() - SERVER_START_TIME)}</p>
    </header>

    <div class="card">
      <h2>Anslut till servern</h2>
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
      <h2>Tillgängliga verktyg</h2>
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
      <h2>API-endpoints</h2>
      <p><code>POST /</code> eller <code>POST /mcp</code> — MCP JSON-RPC-förfrågningar</p>
      <p style="margin-top: 0.5rem;"><code>GET /sse</code> — SSE-streaming för äldre klienter</p>
      <p style="margin-top: 0.5rem;"><code>GET /health</code> — Hälsokontroll</p>
      <p style="margin-top: 0.5rem;"><code>GET /.well-known/mcp.json</code> — MCP server discovery</p>
    </div>

    <footer>
      <p>Bolagsverket MCP Server — Skapad för att göra svensk företagsdata tillgänglig för AI</p>
      <p style="margin-top: 0.5rem;">MCP Protocol Version: ${MCP_PROTOCOL_VERSION}</p>
    </footer>
  </div>
</body>
</html>`;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// =============================================================================
// MCP Server Factory
// =============================================================================

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_CONFIG.NAME,
    version: SERVER_CONFIG.VERSION,
  });

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

// =============================================================================
// Sessionless Mode - Stateless request handling
// =============================================================================

interface StatelessSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

async function handleStatelessRequest(
  req: IncomingMessage,
  res: ServerResponse,
  jsonBody: unknown,
  requestId: string
): Promise<void> {
  const startTime = Date.now();

  // Skapa ny server och transport för varje initialize-request
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  try {
    await server.connect(transport);
    log('debug', 'Stateless', 'Created temporary session', { requestId });

    await transport.handleRequest(req, res, jsonBody);

    const duration = Date.now() - startTime;
    log('info', 'Stateless', 'Request completed', { requestId, duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', 'Stateless', 'Request failed', {
      requestId,
      duration,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    // Cleanup - stäng servern efter request
    try {
      await server.close();
    } catch {
      // Ignorera stängningsfel
    }
  }
}

// =============================================================================
// STDIO Transport
// =============================================================================

async function runStdio(): Promise<void> {
  log('info', 'Server', `Starting ${SERVER_CONFIG.NAME} v${SERVER_CONFIG.VERSION} (stdio)`);

  const cleared = cacheManager.clearExpired();
  if (cleared > 0) {
    log('debug', 'Cache', `Cleared ${cleared} expired entries`);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('info', 'Server', 'Connected via stdio');
}

// =============================================================================
// HTTP Transport
// =============================================================================

async function runHTTP(): Promise<void> {
  log('info', 'Server', `Starting ${SERVER_CONFIG.NAME} v${SERVER_CONFIG.VERSION} (HTTP on port ${PORT})`);

  const cleared = cacheManager.clearExpired();
  if (cleared > 0) {
    log('debug', 'Cache', `Cleared ${cleared} expired entries`);
  }

  // Sessionful HTTP sessions
  interface HttpSession {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
    lastActivity: number;
  }
  const httpSessions = new Map<string, HttpSession>();

  // SSE sessions (bakåtkompatibilitet)
  const sseSessions = new Map<string, SSEServerTransport>();

  // Request counters för metrics
  let requestCount = 0;
  let errorCount = 0;

  // Session cleanup timer
  const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of httpSessions.entries()) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        log('info', 'Session', `Timeout, closing session`, { sessionId: id });
        session.server.close().catch(() => {});
        httpSessions.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log('debug', 'Session', `Cleaned ${cleaned} expired sessions`);
    }
  }, 5 * 60 * 1000);

  // Graceful shutdown
  const cleanup = () => {
    clearInterval(sessionCleanupInterval);
    for (const session of httpSessions.values()) {
      session.server.close().catch(() => {});
    }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // ==========================================================================
  // MCP Request Handler
  // ==========================================================================

  async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const startTime = Date.now();
    requestCount++;

    // Session ID header (case-insensitive)
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let session = sessionId ? httpSessions.get(sessionId) : undefined;

    // Uppdatera activity för aktiv session
    if (session) {
      session.lastActivity = Date.now();
    }

    // HEAD - Protocol discovery
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Accept': 'application/json, text/event-stream',
        'X-Request-Id': requestId,
      });
      res.end();
      return;
    }

    // POST - JSON-RPC request
    if (req.method === 'POST') {
      let body = '';

      // Timeout för body reading
      const bodyTimeout = setTimeout(() => {
        if (!res.headersSent) {
          res.writeHead(408, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Request timeout' },
            id: null,
          }));
        }
      }, REQUEST_TIMEOUT_MS);

      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        clearTimeout(bodyTimeout);

        try {
          const jsonBody = JSON.parse(body);

          // Logg för debugging
          log('debug', 'MCP', 'Received request', {
            requestId,
            method: jsonBody.method,
            hasSession: !!session,
          });

          // =====================================================================
          // SESSIONLESS MODE: Hantera initialize utan att behöva session
          // Detta gör servern kompatibel med fler klienter
          // =====================================================================
          if (isInitializeRequest(jsonBody)) {
            if (!session) {
              // Skapa ny session
              const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (id) => {
                  const newSession: HttpSession = {
                    transport,
                    server,
                    lastActivity: Date.now(),
                  };
                  httpSessions.set(id, newSession);
                  log('info', 'Session', 'New session created', { sessionId: id, requestId });
                },
              });

              const server = createMcpServer();
              await server.connect(transport);
              session = { transport, server, lastActivity: Date.now() };
            }
          }

          // Om ingen session finns efter initialize check
          if (!session) {
            // FALLBACK: Sessionless mode - skapa temporär session för denna request
            // Detta gör servern mer kompatibel med olika klienter
            log('debug', 'MCP', 'No session, using stateless mode', { requestId });

            try {
              await handleStatelessRequest(req, res, jsonBody, requestId);
              return;
            } catch (error) {
              errorCount++;
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  jsonrpc: '2.0',
                  error: { code: -32603, message: 'Internal server error' },
                  id: null,
                }));
              }
              return;
            }
          }

          await session.transport.handleRequest(req, res, jsonBody);

          const duration = Date.now() - startTime;
          log('debug', 'MCP', 'Request completed', { requestId, duration });

        } catch (error) {
          errorCount++;
          log('error', 'MCP', 'Request error', {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });

          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            }));
          }
        }
      });
      return;
    }

    // GET - SSE stream eller välkomstsida
    if (req.method === 'GET') {
      if (session) {
        await session.transport.handleRequest(req, res);
        return;
      }

      // Kontrollera om det är en MCP-klient
      const accept = req.headers['accept'] || '';
      const isMcpClient = accept.includes('text/event-stream') ||
                          accept.includes('application/json') ||
                          req.headers['mcp-protocol-version'];

      if (isMcpClient) {
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
      const html = generateWelcomePage(baseUrl);

      // Komprimera om möjligt
      if (shouldCompress(req)) {
        const compressed = compressResponse(html);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Encoding': 'gzip',
          'Cache-Control': 'no-cache',
          'Vary': 'Accept-Encoding',
        });
        res.end(compressed);
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        });
        res.end(html);
      }
      return;
    }

    // DELETE - Avsluta session
    if (req.method === 'DELETE') {
      if (session && sessionId) {
        await session.server.close();
        httpSessions.delete(sessionId);
        log('info', 'Session', 'Session closed', { sessionId });
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

  // ==========================================================================
  // HTTP Server
  // ==========================================================================

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const requestId = randomUUID();

    // Standard headers
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Server', `${SERVER_CONFIG.NAME}/${SERVER_CONFIG.VERSION}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, mcp-session-id, Last-Event-ID, X-Request-Id, X-Requested-With, Accept-Encoding');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, mcp-session-id, MCP-Protocol-Version, Content-Type, X-Request-Id, Content-Encoding');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Keep-alive
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=65');

    // Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ========================================================================
    // Health Check - Detaljerad för Render
    // ========================================================================
    if (url.pathname === '/health') {
      const uptime = Date.now() - SERVER_START_TIME;
      const cacheStats = cacheManager.getStats();

      // Kontrollera Bolagsverket API (cached för prestanda)
      let apiStatus = 'unknown';
      const cachedApiStatus = cacheManager.get<boolean>('health', 'api_status');
      if (cachedApiStatus !== null) {
        apiStatus = cachedApiStatus ? 'ok' : 'degraded';
      } else {
        // Kontrollera API i bakgrunden
        checkApiStatus().then(status => {
          cacheManager.set('health', 'api_status', status, 60); // Cache 1 minut
        }).catch(() => {});
        apiStatus = 'checking';
      }

      const healthData = {
        status: 'ok',
        server: SERVER_CONFIG.NAME,
        version: SERVER_CONFIG.VERSION,
        transport: 'streamable-http',
        protocolVersion: MCP_PROTOCOL_VERSION,
        uptime: formatUptime(uptime),
        uptimeMs: uptime,
        api: {
          status: apiStatus,
          endpoint: 'bolagsverket.se',
        },
        sessions: {
          http: httpSessions.size,
          sse: sseSessions.size,
        },
        cache: {
          entries: cacheStats.total_entries,
          categories: Object.keys(cacheStats.categories).length,
        },
        metrics: {
          requests: requestCount,
          errors: errorCount,
          errorRate: requestCount > 0 ? (errorCount / requestCount * 100).toFixed(2) + '%' : '0%',
        },
        endpoints: {
          mcp: '/',
          health: '/health',
          sse: '/sse',
          discovery: '/.well-known/mcp.json',
        },
      };

      const jsonStr = JSON.stringify(healthData);

      if (shouldCompress(req)) {
        const compressed = compressResponse(jsonStr);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Cache-Control': 'no-store',
        });
        res.end(compressed);
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(jsonStr);
      }
      return;
    }

    // ========================================================================
    // MCP Discovery - .well-known/mcp.json
    // ========================================================================
    if (url.pathname === '/.well-known/mcp.json') {
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers['host'] || `localhost:${PORT}`;
      const baseUrl = `${protocol}://${host}`;

      const discoveryData = {
        mcpServers: {
          bolagsverket: {
            url: baseUrl,
            name: 'Bolagsverket MCP Server',
            description: 'Hämtar och analyserar företagsdata från Bolagsverkets API. Ger tillgång till årsredovisningar, nyckeltal, styrelseinfo och riskbedömningar för svenska företag.',
            version: SERVER_CONFIG.VERSION,
            protocolVersion: MCP_PROTOCOL_VERSION,
            transport: ['streamable-http', 'sse'],
            authentication: {
              type: 'none',
              description: 'No authentication required - public API access',
            },
            capabilities: {
              tools: true,
              resources: true,
              prompts: true,
              logging: true,
            },
            tools: [
              {
                name: 'bolagsverket_analyze_full',
                description: 'Komplett företagsanalys med all tillgänglig data',
                inputSchema: {
                  type: 'object',
                  properties: {
                    org_nummer: { type: 'string', description: 'Organisationsnummer (10 eller 12 siffror)' },
                  },
                  required: ['org_nummer'],
                },
              },
              {
                name: 'bolagsverket_get_basic_info',
                description: 'Grundläggande företagsinfo (namn, adress, status)',
                inputSchema: {
                  type: 'object',
                  properties: {
                    org_nummer: { type: 'string', description: 'Organisationsnummer' },
                  },
                  required: ['org_nummer'],
                },
              },
              {
                name: 'bolagsverket_get_nyckeltal',
                description: 'Finansiella nyckeltal (soliditet, likviditet, omsättning)',
                inputSchema: {
                  type: 'object',
                  properties: {
                    org_nummer: { type: 'string', description: 'Organisationsnummer' },
                  },
                  required: ['org_nummer'],
                },
              },
              {
                name: 'bolagsverket_get_styrelse',
                description: 'Styrelsemedlemmar, VD och revisorer',
                inputSchema: {
                  type: 'object',
                  properties: {
                    org_nummer: { type: 'string', description: 'Organisationsnummer' },
                  },
                  required: ['org_nummer'],
                },
              },
              {
                name: 'bolagsverket_risk_check',
                description: 'Riskbedömning med varningsflaggor',
                inputSchema: {
                  type: 'object',
                  properties: {
                    org_nummer: { type: 'string', description: 'Organisationsnummer' },
                  },
                  required: ['org_nummer'],
                },
              },
              {
                name: 'bolagsverket_trend',
                description: 'Trendanalys över flera år',
                inputSchema: {
                  type: 'object',
                  properties: {
                    org_nummer: { type: 'string', description: 'Organisationsnummer' },
                    years: { type: 'number', description: 'Antal år att analysera (2-10)', default: 3 },
                  },
                  required: ['org_nummer'],
                },
              },
            ],
            prompts: [
              { name: 'due-diligence', description: 'Komplett företagsanalys' },
              { name: 'konkurrensjamforelse', description: 'Jämför företag' },
              { name: 'annual-report-summary', description: 'Sammanfatta årsredovisning' },
              { name: 'snabbkontroll', description: 'Snabb riskbedömning' },
            ],
            contact: {
              repository: 'https://github.com/isakskogstad/bolagsverket-mcp-server',
            },
          },
        },
      };

      const jsonStr = JSON.stringify(discoveryData, null, 2);

      if (shouldCompress(req)) {
        const compressed = compressResponse(jsonStr);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(compressed);
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(jsonStr);
      }
      return;
    }

    // ========================================================================
    // Root path - MCP Endpoint
    // ========================================================================
    if (url.pathname === '/') {
      await handleMcpRequest(req, res);
      return;
    }

    // ========================================================================
    // /mcp path - MCP Endpoint (ChatGPT kompatibilitet)
    // ========================================================================
    if (url.pathname === '/mcp') {
      await handleMcpRequest(req, res);
      return;
    }

    // ========================================================================
    // SSE Endpoint (bakåtkompatibilitet)
    // ========================================================================
    if (url.pathname === '/sse') {
      if (req.method !== 'GET') {
        res.writeHead(405, {
          'Content-Type': 'application/json',
          'Allow': 'GET',
        });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      log('info', 'SSE', 'New client connecting');

      const server = createMcpServer();
      const transport = new SSEServerTransport('/message', res);

      sseSessions.set(transport.sessionId, transport);

      res.on('close', () => {
        log('info', 'SSE', 'Client disconnected', { sessionId: transport.sessionId });
        sseSessions.delete(transport.sessionId);
      });

      await server.connect(transport);
      log('info', 'SSE', 'Client connected', { sessionId: transport.sessionId });
      return;
    }

    // ========================================================================
    // Message endpoint för SSE
    // ========================================================================
    if (url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session ID required' }));
        return;
      }

      const transport = sseSessions.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          await transport.handlePostMessage(req, res, body);
        } catch (error) {
          log('error', 'Message', 'Error handling message', {
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        }
      });
      return;
    }

    // ========================================================================
    // 404
    // ========================================================================
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      path: url.pathname,
      availableEndpoints: ['/', '/mcp', '/sse', '/health', '/.well-known/mcp.json'],
    }));
  });

  // Server config
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
  httpServer.timeout = REQUEST_TIMEOUT_MS;

  httpServer.listen(PORT, () => {
    log('info', 'Server', `Listening on http://0.0.0.0:${PORT}`);
    log('info', 'Server', `MCP endpoint: http://0.0.0.0:${PORT}/`);
    log('info', 'Server', `SSE endpoint: http://0.0.0.0:${PORT}/sse`);
    log('info', 'Server', `Health check: http://0.0.0.0:${PORT}/health`);
    log('info', 'Server', `Discovery: http://0.0.0.0:${PORT}/.well-known/mcp.json`);
    log('info', 'Server', `Protocol version: ${MCP_PROTOCOL_VERSION}`);
    log('info', 'Server', `Compression: ${ENABLE_COMPRESSION ? 'enabled' : 'disabled'}`);
    log('info', 'Server', `Log level: ${LOG_LEVEL}`);
  });
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useHTTP = args.includes('--http') || process.env.MCP_TRANSPORT === 'http';
  const useSSE = args.includes('--sse') || process.env.MCP_TRANSPORT === 'sse';

  // Graceful shutdown
  process.on('SIGINT', () => {
    log('info', 'Server', 'Shutting down...');
    cacheManager.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('info', 'Server', 'Shutting down...');
    cacheManager.close();
    process.exit(0);
  });

  // Uncaught error handling
  process.on('uncaughtException', (error) => {
    log('error', 'Server', 'Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    log('error', 'Server', 'Unhandled rejection', { reason: String(reason) });
  });

  if (useHTTP || useSSE) {
    await runHTTP();
  } else {
    await runStdio();
  }
}

main().catch((error) => {
  log('error', 'Server', 'Fatal error', { error: error.message });
  process.exit(1);
});
