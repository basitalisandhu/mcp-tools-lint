// Seeded fuzz and scaling tests for the file reader and everything downstream of it.
// Bad input must become a ConnectionError (exit 2 naming the file) or a normal lint
// result, never a crash, and must not take more than a few seconds.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyPatch,
  ConnectionError,
  formatJson,
  formatPatch,
  formatSarif,
  formatText,
  lintTools,
  loadTools,
} from '../src/index.js';
import { FIXTURES, runCli } from './helpers.js';

let dir = '';
let fixtures: unknown[] = [];
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcp-tools-lint-fuzz-'));
  const names = (await readdir(join(FIXTURES, 'tools'))).filter((f) => f.endsWith('.json'));
  fixtures = await Promise.all(names.map(async (f) => JSON.parse(await readFile(join(FIXTURES, 'tools', f), 'utf8')) as unknown));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A seeded linear congruential generator, so a failing case reproduces. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const SCALARS: unknown[] = [null, true, false, 0, -1, 1e308, '', 'x', '\u0000', [], {}, 'a'.repeat(3000)];
const KEYS = ['$schema', 'type', 'properties', 'required', 'items', 'anyOf', 'annotations', 'readOnlyHint', 'read_only_hint', '__proto__', 'name', 'inputSchema', 'outputSchema', '$defs', 'dependencies'];

function mutate(next: () => number, value: unknown, depth = 0): unknown {
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)]!;
  if (next() < 0.12 || depth > 8) return pick(SCALARS);
  if (Array.isArray(value)) return value.map((x) => mutate(next, x, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(value)) {
      if (next() < 0.1) continue;
      out[k] = next() < 0.6 ? x : mutate(next, x, depth + 1);
    }
    if (next() < 0.3) out[pick(KEYS)] = next() < 0.5 ? pick(SCALARS) : mutate(next, value, depth + 1);
    return out;
  }
  return next() < 0.3 ? pick(SCALARS) : value;
}

async function pipeline(file: string): Promise<void> {
  let doc;
  try {
    doc = await loadTools({ kind: 'file', path: file });
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).message).toContain(file);
    return;
  }
  const result = lintTools(doc, file);
  formatText(result);
  formatJson(result);
  formatSarif(result, { toolVersion: 'test', artifactUri: 'tools.json' });
  formatPatch(result.patch);
  applyPatch(doc.document, result.patch);
}

describe('fuzzed tools files', () => {
  for (const block of [0, 1, 2, 3]) {
    it(`mutated fixtures lint, format and patch without crashing (block ${block})`, async () => {
      const next = rng(2020 + block);
      const file = join(dir, `in-${block}.json`);
      for (let i = 0; i < 150; i++) {
        const fixture = fixtures[Math.floor(next() * fixtures.length)];
        await writeFile(file, JSON.stringify(mutate(next, fixture)));
        const started = Date.now();
        await pipeline(file);
        expect(Date.now() - started).toBeLessThan(5000);
      }
    });
  }

  const deepSchema =
    '[{"name":"a","inputSchema":' + '{"type":"object","properties":{"x":'.repeat(20000) + '{}' + '}}'.repeat(20000) + '}]';
  const cases: Array<[string, Buffer, string]> = [
    ['utf16.json', Buffer.from('﻿[]', 'utf16le'), 'is UTF-16 text; save it as UTF-8'],
    ['latin1.json', Buffer.from([...Buffer.from('[{"name":"caf'), 0xe9, ...Buffer.from('"}]')]), 'is not UTF-8 text'],
    ['deep-schema.json', Buffer.from(deepSchema), 'nested more than 256 levels deep'],
    ['deep-array.json', Buffer.from('['.repeat(100000) + ']'.repeat(100000)), 'nested more than 256 levels deep'],
    ['empty.json', Buffer.alloc(0), 'is not valid JSON'],
    ['scalar.json', Buffer.from('"tools"'), 'expected a JSON array of tools'],
  ];
  for (const [name, bytes, message] of cases) {
    it(`${name}: exit 2 with the file name, no stack trace`, async () => {
      const file = join(dir, name);
      await writeFile(file, bytes);
      for (const args of [[file], [file, '--fix'], [file, '--format', 'sarif']]) {
        const run = await runCli(args, { cwd: dir });
        expect(run.code, args.join(' ')).toBe(2);
        expect(run.stderr).toContain(name);
        expect(run.stderr).toContain(message);
        expect(run.stderr).not.toMatch(/unexpected error|\n\s+at /);
      }
    });
  }

  it('a UTF-8 byte order mark is accepted', async () => {
    const file = join(dir, 'bom.json');
    await writeFile(file, '﻿' + (await readFile(join(FIXTURES, 'tools', 'clean.json'), 'utf8')));
    expect((await runCli([file], { cwd: dir })).code).toBe(0);
  });
});

describe('scaling', () => {
  it('10,000 tools lint and patch in a few seconds', async () => {
    // Measured on the 0.4.0 work: 1,000 tools 0.09 s and 10,000 tools 0.21 s for the
    // whole CLI run; this guards against a quadratic step creeping in.
    const tools = Array.from({ length: 10000 }, (_, i) => ({
      name: `tool_${i}`,
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a', 'missing'],
      },
      annotations: { read_only_hint: true },
    }));
    const file = join(dir, 'big.json');
    await writeFile(file, JSON.stringify({ tools }, null, 2));
    const started = Date.now();
    const doc = await loadTools({ kind: 'file', path: file });
    const result = lintTools(doc, file);
    applyPatch(doc.document, result.patch);
    formatSarif(result, { toolVersion: 'test', artifactUri: 'big.json' });
    expect(result.tools).toBe(10000);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('servers that never stop', () => {
  it('a tools/list that always returns a new cursor stops after MAX_PAGES with exit 2', async () => {
    // Before 0.4.0 this followed the cursors forever.
    const started = Date.now();
    const run = await runCli(['--', process.execPath, join(FIXTURES, 'servers', 'endless.mjs')]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('nextCursor on 1000 tools/list pages in a row');
    expect(Date.now() - started).toBeLessThan(20000);
  });
});
