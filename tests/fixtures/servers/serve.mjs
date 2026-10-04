// Shared helper for the fixture servers. They use the SDK's low-level Server so the
// tools/list result goes out exactly as written in ../tools/<name>.json, including
// the mistakes the linter is meant to catch.
import { readFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function loadFixture(name) {
  const url = new URL(`../tools/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8')).tools;
}

export function createServer(name, tools, { pageSize } = {}) {
  const server = new Server({ name: `fixture-${name}`, version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    if (!pageSize) return { tools };
    const start = Number(request.params?.cursor ?? 0);
    const page = tools.slice(start, start + pageSize);
    const next = start + pageSize;
    return next < tools.length ? { tools: page, nextCursor: String(next) } : { tools: page };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: `called ${request.params.name}` }],
  }));
  return server;
}

export async function serveStdio(name, options) {
  const tools = await loadFixture(name);
  const server = createServer(name, tools, options);
  await server.connect(new StdioServerTransport());
}
