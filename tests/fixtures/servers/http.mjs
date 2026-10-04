// Fixture: Streamable HTTP server on 127.0.0.1:<port> at /mcp. Requires the header
// X-Fixture-Token: ok (tests -H). Usage: node http.mjs <port> [fixture-name]
import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, loadFixture } from './serve.mjs';

const name = process.argv[3] ?? 'clean';
const tools = await loadFixture(name);

const httpServer = createHttpServer(async (req, res) => {
  if (req.url !== '/mcp') {
    res.writeHead(404).end();
    return;
  }
  if (req.headers['x-fixture-token'] !== 'ok') {
    res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'missing X-Fixture-Token' }));
    return;
  }
  // Stateless: one transport and server per request.
  const server = createServer(name, tools);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

httpServer.listen(Number(process.argv[2] ?? 0), '127.0.0.1', () => {
  process.stdout.write(`listening ${httpServer.address().port}\n`);
});
