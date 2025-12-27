#!/usr/bin/env node
/**
 * Bolagsverket MCP Server
 * Hämtar och analyserar företagsdata från Bolagsverkets API.
 *
 * Version: 5.7.0
 * Stödjer stdio, SSE och Streamable HTTP transport.
 * Kompatibel med Claude.ai, ChatGPT och Claude Desktop.
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
const MCP_PROTOCOL_VERSION = '2025-11-05';

// Session timeout (30 minuter inaktivitet)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

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

    // GET - SSE stream för Streamable HTTP (om session finns)
    if (req.method === 'GET') {
      if (session) {
        await session.transport.handleRequest(req, res);
        return;
      }
      // Ingen session - returnera 405 (Claude tolkar detta som "POST-only server")
      res.writeHead(405, {
        'Content-Type': 'application/json',
        'Allow': 'POST, HEAD, DELETE',
      });
      res.end(JSON.stringify({
        error: 'Method Not Allowed',
        message: 'Use POST for MCP requests. GET requires active session.',
      }));
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

    // CORS headers för både Claude.ai och ChatGPT
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, mcp-session-id, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours

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
