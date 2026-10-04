import { describe, expect, it } from 'vitest';
import { lintTools, locateTools } from '../src/lint.js';
import { applyPatch, formatPatch } from '../src/patch.js';
import { escapeToken, joinPointer, parsePointer } from '../src/pointer.js';
import { walkSchema } from '../src/schema.js';

describe('JSON Pointer', () => {
  it('escapes ~ and / per RFC 6901', () => {
    expect(escapeToken('a/b~c')).toBe('a~1b~0c');
    expect(joinPointer('/tools/0', 'properties', 'a/b')).toBe('/tools/0/properties/a~1b');
    expect(parsePointer('/tools/0/properties/a~1b~0c')).toEqual(['tools', '0', 'properties', 'a/b~c']);
    expect(parsePointer('')).toEqual([]);
    expect(() => parsePointer('tools')).toThrow(/must start with/);
  });
});

describe('walkSchema', () => {
  it('visits subschemas in document order with the keyword they sit under', () => {
    const visits: string[] = [];
    walkSchema(
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { anyOf: [{ type: 'null' }, { type: 'number' }] } },
        items: [{ type: 'string' }],
        dependencies: { a: ['b'], c: { type: 'object' } },
        not: false,
      },
      '',
      ({ pointer, keyword }) => visits.push(`${keyword ?? 'root'}:${pointer}`),
    );
    expect(visits).toEqual([
      'root:',
      'properties:/properties/a',
      'properties:/properties/b',
      'anyOf:/properties/b/anyOf/0',
      'anyOf:/properties/b/anyOf/1',
      'items:/items/0',
      'dependencies:/dependencies/c',
      'not:/not',
    ]);
  });
});

describe('applyPatch', () => {
  it('applies remove and move without touching the input', () => {
    const doc = { tools: [{ inputSchema: { $schema: 'x', type: 'object' }, annotations: { read_only_hint: true } }] };
    const before = JSON.stringify(doc);
    const out = applyPatch(doc, [
      { op: 'remove', path: '/tools/0/inputSchema/$schema' },
      { op: 'move', from: '/tools/0/annotations/read_only_hint', path: '/tools/0/annotations/readOnlyHint' },
    ]);
    expect(out).toEqual({ tools: [{ inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('supports add and replace, including array append', () => {
    const out = applyPatch({ a: [1], b: 1 }, [
      { op: 'add', path: '/a/-', value: 2 },
      { op: 'replace', path: '/b', value: 3 },
      { op: 'add', path: '/c', value: { d: 4 } },
    ]);
    expect(out).toEqual({ a: [1, 2], b: 3, c: { d: 4 } });
  });

  it('rejects paths that do not exist', () => {
    expect(() => applyPatch({ a: {} }, [{ op: 'remove', path: '/a/b' }])).toThrow(/does not exist/);
    expect(() => applyPatch([1], [{ op: 'remove', path: '/5' }])).toThrow(/does not exist/);
  });

  it('formats the patch exactly as --fix writes it', () => {
    expect(formatPatch([])).toBe('[]\n');
    expect(formatPatch([{ op: 'remove', path: '/x' }])).toBe('[\n  {\n    "op": "remove",\n    "path": "/x"\n  }\n]\n');
  });
});

describe('locateTools and lintTools', () => {
  const tool = { name: 'get_x', description: 'x', inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }, annotations: { readOnlyHint: true } };

  it('accepts a bare array, a tools/list result and a JSON-RPC response, with patch paths that match', () => {
    const cases: [unknown, string][] = [
      [[tool], '/0/inputSchema/$schema'],
      [{ tools: [tool] }, '/tools/0/inputSchema/$schema'],
      [{ jsonrpc: '2.0', id: 1, result: { tools: [tool] } }, '/result/tools/0/inputSchema/$schema'],
    ];
    for (const [doc, path] of cases) {
      const located = locateTools(doc);
      const result = lintTools(located, 't');
      expect(result.patch).toEqual([{ op: 'remove', path }]);
      expect(result.findings[0]?.pointer).toBe(path);
      const fixed = applyPatch(located.document, result.patch);
      expect(lintTools(locateTools(fixed), 't').summary.errors).toBe(0);
    }
  });

  it('rejects documents without a tools array', () => {
    expect(() => locateTools({ result: {} })).toThrow(/expected a JSON array of tools/);
    expect(() => locateTools('nope')).toThrow();
  });

  it('names tools without a string name by index and still lints them', () => {
    const result = lintTools(locateTools([{ inputSchema: { type: 'object' } }, 'junk']), 't');
    expect(result.findings.map((f) => f.tool)).toEqual(['#0', '#0', '#1', '#1']);
    expect(result.summary).toEqual({ errors: 0, warnings: 2, infos: 2 });
  });
});
