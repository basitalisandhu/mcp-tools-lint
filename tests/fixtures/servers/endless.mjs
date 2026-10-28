// Fixture: a broken server whose tools/list never ends. Every page returns one tool and
// a new cursor, so a client that follows nextCursor without a limit never stops.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'fixture-endless', version: '0.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  const n = Number(request.params?.cursor ?? 0);
  return {
    tools: [{ name: `tool_${n}`, description: 'x', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
    nextCursor: String(n + 1),
  };
});
await server.connect(new StdioServerTransport());
