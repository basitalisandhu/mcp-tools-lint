// Fixture: legacy HTTP+SSE (2024-11-05) server on 127.0.0.1:<port>. GET /sse opens the
// event stream, POST /messages?sessionId=... carries requests. Requires the header
// X-Fixture-Token: ok on both (tests -H). Records the client name and version it saw
// and serves them at GET /client. Usage: node sse.mjs <port> [fixture-name]
import { createServer as createHttpServer } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer, loadFixture } from './serve.mjs';

const name = process.argv[3] ?? 'clean';
const tools = await loadFixture(name);
const sessions = new Map();
let client = null;

const httpServer = createHttpServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/client') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(client));
    return;
  }
  if (req.headers['x-fixture-token'] !== 'ok') {
    res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'missing X-Fixture-Token' }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/sse') {
    const transport = new SSEServerTransport('/messages', res);
    sessions.set(transport.sessionId, transport);
    res.on('close', () => sessions.delete(transport.sessionId));
    const server = createServer(name, tools);
    server.oninitialized = () => {
      client = server.getClientVersion() ?? null;
    };
    await server.connect(transport);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/messages') {
    const transport = sessions.get(url.searchParams.get('sessionId'));
    if (!transport) {
      res.writeHead(404).end();
      return;
    }
    await transport.handlePostMessage(req, res);
    return;
  }
  res.writeHead(404).end();
});

httpServer.listen(Number(process.argv[2] ?? 0), '127.0.0.1', () => {
  process.stdout.write(`listening ${httpServer.address().port}\n`);
});
