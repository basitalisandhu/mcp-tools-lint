import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as z from 'zod/v4';
import { locateTools, type ToolsDocument } from './lint.js';

export type Target =
  | { kind: 'file'; path: string }
  | { kind: 'http'; url: string }
  | { kind: 'stdio'; command: string; args: string[] };

export interface LoadOptions {
  /** Extra environment for a stdio server, merged over the SDK's default environment. */
  env?: Record<string, string>;
  /** Extra HTTP headers for a Streamable HTTP server. */
  headers?: Record<string, string>;
  /** Timeout for initialize and for each tools/list request, in milliseconds. */
  timeoutMs?: number;
  /** Receives the server's stderr lines (stdio targets) for diagnostics. */
  onStderr?: (chunk: string) => void;
}

/** Thrown when the target could not be reached or read. The CLI maps it to exit code 2. */
export class ConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConnectionError';
  }
}

export const DEFAULT_TIMEOUT_MS = 20_000;

/** The wire shape, kept loose on purpose: the point is to see what the server sent. */
const RawListToolsResult = z.looseObject({
  tools: z.array(z.record(z.string(), z.unknown())),
  nextCursor: z.string().optional(),
});

export function describeTarget(target: Target): string {
  switch (target.kind) {
    case 'file':
      return target.path;
    case 'http':
      return target.url;
    case 'stdio':
      return [target.command, ...target.args].join(' ');
  }
}

async function loadFile(path: string): Promise<ToolsDocument> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new ConnectionError(`cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConnectionError(`${path} is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  try {
    return locateTools(parsed);
  } catch (error) {
    throw new ConnectionError(`${path}: ${(error as Error).message}`, { cause: error });
  }
}

async function listAllTools(client: Client, timeoutMs: number): Promise<unknown[]> {
  const tools: unknown[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await client.request(
      { method: 'tools/list', params: cursor === undefined ? {} : { cursor } },
      RawListToolsResult,
      { timeout: timeoutMs },
    );
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (cursor !== undefined) {
      if (seen.has(cursor)) throw new ConnectionError(`server repeated pagination cursor ${JSON.stringify(cursor)}`);
      seen.add(cursor);
    }
  } while (cursor !== undefined);
  return tools;
}

async function loadLive(target: Exclude<Target, { kind: 'file' }>, options: LoadOptions): Promise<ToolsDocument> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = new Client({ name: 'mcp-tools-lint', version: '0.1.1' }, { capabilities: {} });
  const stderrTail: string[] = [];

  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  if (target.kind === 'stdio') {
    transport = new StdioClientTransport({
      command: target.command,
      args: target.args,
      env: { ...getDefaultEnvironment(), ...(options.env ?? {}) },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrTail.push(text);
      if (stderrTail.length > 50) stderrTail.shift();
      options.onStderr?.(text);
    });
  } else {
    let url: URL;
    try {
      url = new URL(target.url);
    } catch {
      throw new ConnectionError(`invalid URL ${JSON.stringify(target.url)}`);
    }
    transport = new StreamableHTTPClientTransport(url, {
      requestInit: options.headers && Object.keys(options.headers).length > 0 ? { headers: options.headers } : undefined,
    });
  }

  try {
    await client.connect(transport, { timeout: timeoutMs });
    const tools = await listAllTools(client, timeoutMs);
    return { document: { tools }, basePointer: '/tools', tools };
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    const stderr = stderrTail.join('').trim();
    const suffix = stderr === '' ? '' : `\nserver stderr:\n${stderr.split('\n').slice(-20).join('\n')}`;
    throw new ConnectionError(`cannot list tools from ${describeTarget(target)}: ${detail}${suffix}`, { cause: error });
  } finally {
    try {
      await client.close();
    } catch {
      // the transport is already gone; nothing to clean up
    }
  }
}

/** Load the tools array from a file, a stdio command or a Streamable HTTP URL. */
export async function loadTools(target: Target, options: LoadOptions = {}): Promise<ToolsDocument> {
  if (target.kind === 'file') return loadFile(target.path);
  return loadLive(target, options);
}
