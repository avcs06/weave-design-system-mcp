#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

/**
 * Streamable HTTP entrypoint — the transport used when the server is deployed
 * and clients connect over the network.
 *
 * Sessions are stateful and held in memory: a client initializes once, gets an
 * `mcp-session-id` back, and sends it on every later request. That means this
 * process is single-instance as written; to run several replicas, move the
 * session map to a shared store and supply an `eventStore` for resumability.
 */

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const ENDPOINT = '/mcp';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Hosts and origins permitted to reach the server. DNS rebinding protection is
 * on by default so a local server cannot be driven by a page the user visits;
 * set WEAVE_ALLOWED_HOSTS / WEAVE_ALLOWED_ORIGINS when deploying behind a real
 * domain.
 */
const allowedHosts = (
  process.env.WEAVE_ALLOWED_HOSTS ?? `127.0.0.1:${PORT},localhost:${PORT}`
)
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const allowedOrigins = (process.env.WEAVE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Idle sessions are swept periodically: a client that disconnects without
 * sending DELETE would otherwise hold its transport in memory forever.
 */
const SESSION_TTL_MS = Number(
  process.env.WEAVE_SESSION_TTL_MS ?? 30 * 60 * 1000,
);
const SWEEP_INTERVAL_MS = 60 * 1000;

interface Session {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

const transports = new Map<string, Session>();

function touch(sessionId: string): void {
  const session = transports.get(sessionId);
  if (session) session.lastSeen = Date.now();
}

function sweepIdleSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, session] of transports) {
    if (session.lastSeen < cutoff) {
      transports.delete(sessionId);
      console.error(
        `[mcp] session expired after ${SESSION_TTL_MS}ms idle: ${sessionId}`,
      );
      void session.transport.close().catch(() => undefined);
    }
  }
}

const sweepTimer = setInterval(sweepIdleSessions, SWEEP_INTERVAL_MS);
// Do not keep the process alive purely for the sweep.
sweepTimer.unref();

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function jsonRpcError(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  send(res, status, {
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body too large');
    }
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Stand up a new MCP server + transport pair for a freshly initializing client. */
async function createSessionTransport(): Promise<StreamableHTTPServerTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableDnsRebindingProtection: true,
    allowedHosts,
    ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
    onsessioninitialized: (sessionId) => {
      transports.set(sessionId, { transport, lastSeen: Date.now() });
      console.error(`[mcp] session initialized: ${sessionId}`);
    },
    onsessionclosed: (sessionId) => {
      transports.delete(sessionId);
      console.error(`[mcp] session closed: ${sessionId}`);
    },
  });

  transport.onclose = () => {
    const id = transport.sessionId;
    if (id) transports.delete(id);
  };

  const server = createServer();
  await server.connect(transport);
  return transport;
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const header = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(header) ? header[0] : header;

  // GET (SSE stream) and DELETE (session teardown) always target an existing session.
  if (req.method === 'GET' || req.method === 'DELETE') {
    const session = sessionId ? transports.get(sessionId) : undefined;
    if (!session || !sessionId) {
      jsonRpcError(res, 404, 'Session not found');
      return;
    }
    touch(sessionId);
    await session.transport.handleRequest(req, res);
    return;
  }

  if (req.method !== 'POST') {
    jsonRpcError(res, 405, 'Method not allowed');
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    jsonRpcError(res, 400, `Invalid request body: ${(error as Error).message}`);
    return;
  }

  const existing = sessionId ? transports.get(sessionId) : undefined;
  if (existing && sessionId) {
    touch(sessionId);
    await existing.transport.handleRequest(req, res, body);
    return;
  }

  if (sessionId) {
    jsonRpcError(res, 404, 'Session not found');
    return;
  }

  if (!isInitializeRequest(body)) {
    jsonRpcError(
      res,
      400,
      'Missing mcp-session-id header for a non-initialize request',
    );
    return;
  }

  const transport = await createSessionTransport();
  await transport.handleRequest(req, res, body);
}

const httpServer = createHttpServer((req, res) => {
  const url = new URL(
    req.url ?? '/',
    `http://${req.headers.host ?? 'localhost'}`,
  );

  if (url.pathname === '/health') {
    send(res, 200, {
      status: 'ok',
      server: SERVER_NAME,
      version: SERVER_VERSION,
      sessions: transports.size,
    });
    return;
  }

  if (url.pathname !== ENDPOINT) {
    jsonRpcError(res, 404, 'Not found');
    return;
  }

  handleMcp(req, res).catch((error: unknown) => {
    console.error('[mcp] request failed:', error);
    if (!res.headersSent) {
      jsonRpcError(res, 500, 'Internal server error');
    } else {
      res.end();
    }
  });
});

async function shutdown(signal: string): Promise<void> {
  console.error(`[mcp] ${signal} received, shutting down`);
  httpServer.close();
  clearInterval(sweepTimer);
  await Promise.allSettled(
    [...transports.values()].map((s) => s.transport.close()),
  );
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

httpServer.listen(PORT, HOST, () => {
  console.error(
    `weave-design-system MCP server listening on http://${HOST}:${PORT}${ENDPOINT}`,
  );
});
