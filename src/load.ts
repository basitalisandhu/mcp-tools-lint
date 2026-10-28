import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as z from 'zod/v4';
import { locateTools, type ToolsDocument } from './lint.js';
import { PACKAGE_VERSION } from './version.js';

export type Target =
  | { kind: 'file'; path: string }
  | { kind: 'http'; url: string; transport?: HttpTransport }
  | { kind: 'stdio'; command: string; args: string[] };

/** How to talk to an HTTP target: Streamable HTTP (current spec) or the 2024-11-05 HTTP+SSE transport. */
export type HttpTransport = 'streamable-http' | 'sse';
export const HTTP_TRANSPORTS: readonly HttpTransport[] = ['streamable-http', 'sse'];

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

/**
 * How deeply a tools document may nest. The rules walk schemas recursively, so a schema
 * nested tens of thousands of levels deep overflowed the call stack. Real tool schemas
 * stay far below this.
 */
export const MAX_DEPTH = 256;

/** True when a JSON value nests deeper than `limit`. Iterative, so it cannot overflow. */
export function nestingExceeds(value: unknown, limit = MAX_DEPTH): boolean {
  const stack: Array<[unknown, number]> = [[value, 0]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (depth >= limit) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
    }
  }
  return false;
}

const TOO_DEEP = `nested more than ${MAX_DEPTH} levels deep; refusing to lint it`;

/**
 * Decode a file as UTF-8, dropping a leading byte order mark. Bytes that are not UTF-8
 * are an error: reading them with replacement characters would lint (and patch) a
 * different tool name than the one in the file.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    throw new Error('is UTF-16 text; save it as UTF-8');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('is not UTF-8 text; save it as UTF-8');
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function loadFile(path: string): Promise<ToolsDocument> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new ConnectionError(`cannot read ${path}: ${(error as Error).message}`, { cause: error });
  }
  let text: string;
  try {
    text = decodeUtf8(bytes);
  } catch (error) {
    throw new ConnectionError(`${path} ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConnectionError(`${path} is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  if (nestingExceeds(parsed)) throw new ConnectionError(`${path} is ${TOO_DEEP}`);
  try {
    return locateTools(parsed);
  } catch (error) {
    throw new ConnectionError(`${path}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * The most tools/list pages followed for one server. A server that hands out a new cursor
 * on every page would otherwise keep the tool listing forever (the repeated-cursor check
 * only catches a cursor that comes back).
 */
export const MAX_PAGES = 1000;

async function listAllTools(client: Client, timeoutMs: number): Promise<unknown[]> {
  const tools: unknown[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  let pages = 0;
  do {
    if (++pages > MAX_PAGES) {
      throw new ConnectionError(
        `server returned a nextCursor on ${MAX_PAGES} tools/list pages in a row (${tools.length} tools so far); stopping. A server should end the listing by leaving nextCursor out`,
      );
    }
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
  const client = new Client({ name: 'mcp-tools-lint', version: PACKAGE_VERSION }, { capabilities: {} });
  const stderrTail: string[] = [];

  let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
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
    // The SSE transport applies requestInit headers to the event stream and to every POST.
    const requestInit =
      options.headers && Object.keys(options.headers).length > 0 ? { headers: options.headers } : undefined;
    transport =
      target.transport === 'sse'
        ? new SSEClientTransport(url, { requestInit })
        : new StreamableHTTPClientTransport(url, { requestInit });
  }

  try {
    await client.connect(transport, { timeout: timeoutMs });
    const tools = await listAllTools(client, timeoutMs);
    if (nestingExceeds(tools)) throw new ConnectionError(`the tools/list result from ${describeTarget(target)} is ${TOO_DEEP}`);
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
