#!/usr/bin/env node
/**
 * Bolagsverket MCP Server
 * Hämtar och analyserar företagsdata från Bolagsverkets API.
 * 
 * Version: 5.5.1
 * Stödjer stdio och SSE transport.
 * Kompatibel med Claude.ai och ChatGPT Developer Mode.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http';
import { SERVER_CONFIG } from './lib/config.js';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';
import { cacheManager } from './lib/cache-manager.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

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
 * Kör med SSE transport (remote).
 * Fungerar med både Claude.ai och ChatGPT.
 */
async function runSSE(): Promise<void> {
  console.error(`[Server] Startar ${SERVER_CONFIG.NAME} v${SERVER_CONFIG.VERSION} (HTTP på port ${PORT})`);
  
  const cleared = cacheManager.clearExpired();
  if (cleared > 0) {
    console.error(`[Cache] Rensade ${cleared} utgångna poster`);
  }

  // SSE transporter per session
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    
    // CORS headers för både Claude.ai och ChatGPT
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');

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
        transport: 'sse',
        endpoints: {
          mcp: '/mcp',
          sse: '/sse',
          health: '/health'
        }
      }));
      return;
    }

    // SSE endpoint (primär för Claude.ai)
    if (url.pathname === '/sse') {
      console.error('[SSE] Ny klient ansluter...');
      
      const server = createMcpServer();
      const transport = new SSEServerTransport('/message', res);
      
      transports.set(transport.sessionId, transport);
      
      res.on('close', () => {
        console.error(`[SSE] Klient ${transport.sessionId} bortkopplad`);
        transports.delete(transport.sessionId);
      });

      await server.connect(transport);
      console.error(`[SSE] Klient ${transport.sessionId} ansluten`);
      return;
    }

    // MCP endpoint - redirect till SSE (ChatGPT stöder SSE också)
    if (url.pathname === '/mcp' || url.pathname === '/Mcp') {
      // ChatGPT kan använda SSE, så redirect dit
      console.error('[MCP] Redirect till /sse');
      res.writeHead(307, { 
        'Location': '/sse',
        'Content-Type': 'application/json'
      });
      res.end(JSON.stringify({
        message: 'Use /sse endpoint for MCP connections',
        endpoint: '/sse'
      }));
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

      const transport = transports.get(sessionId);
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
    console.error(`[Server] MCP/SSE endpoint: http://0.0.0.0:${PORT}/sse`);
    console.error(`[Server] Health check: http://0.0.0.0:${PORT}/health`);
  });
}

/**
 * Huvudfunktion.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useSSE = args.includes('--sse') || args.includes('--http') || process.env.MCP_TRANSPORT === 'sse';

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

  if (useSSE) {
    await runSSE();
  } else {
    await runStdio();
  }
}

// Kör
main().catch((error) => {
  console.error('[Server] Fatal error:', error);
  process.exit(1);
});
