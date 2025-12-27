#!/usr/bin/env node
/**
 * Bolagsverket MCP Server
 * Hämtar och analyserar företagsdata från Bolagsverkets API.
 *
 * Version: 5.6.0
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

  // Streamable HTTP sessions
  const httpSessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

  // SSE transporter per session (för bakåtkompatibilitet)
  const sseSessions = new Map<string, SSEServerTransport>();

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // CORS headers för både Claude.ai och ChatGPT
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: SERVER_CONFIG.NAME,
        version: SERVER_CONFIG.VERSION,
        transport: 'streamable-http',
        endpoints: {
          mcp: '/mcp',
          sse: '/sse',
          health: '/health'
        }
      }));
      return;
    }

    // ==========================================
    // MCP Endpoint - Streamable HTTP (primär)
    // ==========================================
    if (url.pathname === '/mcp') {
      const sessionId = (req.headers['mcp-session-id'] || req.headers['Mcp-Session-Id']) as string | undefined;
      let session = sessionId ? httpSessions.get(sessionId) : undefined;

      // POST /mcp - JSON-RPC request
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
                  httpSessions.set(id, { transport, server });
                  console.error(`[MCP] Session initialized: ${id}`);
                },
              });

              const server = createMcpServer();
              await server.connect(transport);
              session = { transport, server };
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

      // GET /mcp - SSE stream för Streamable HTTP
      if (req.method === 'GET') {
        if (!session) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No active session' }));
          return;
        }

        await session.transport.handleRequest(req, res);
        return;
      }

      // DELETE /mcp - Avsluta session
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
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // ==========================================
    // SSE Endpoint (bakåtkompatibilitet)
    // ==========================================
    if (url.pathname === '/sse') {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
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
    console.error(`[Server] MCP endpoint (Streamable HTTP): http://0.0.0.0:${PORT}/mcp`);
    console.error(`[Server] SSE endpoint (legacy): http://0.0.0.0:${PORT}/sse`);
    console.error(`[Server] Health check: http://0.0.0.0:${PORT}/health`);
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
