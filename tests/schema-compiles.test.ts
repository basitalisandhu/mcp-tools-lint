import { describe, expect, it } from 'vitest';
import { lintTools, locateTools } from '../src/lint.js';
import { DIALECT_2020_12 } from '../src/rules.js';
import type { Tool } from '../src/types.js';

function lint(document: unknown, options: { ignoreRules?: string[] } = {}) {
  return lintTools(locateTools(document), 'fixture', options.ignoreRules);
}

function check(schema: unknown, key: 'inputSchema' | 'outputSchema' = 'inputSchema') {
  const tool: Tool = {
    name: 'read_data', description: 'Read data.', annotations: { readOnlyHint: true },
    inputSchema: { type: 'object' }, [key]: schema,
  };
  return lint({ tools: [tool] }).findings.filter(f => f.ruleId === 'schema-compiles');
}

describe('schema-compiles', () => {
  it.each(['inputSchema', 'outputSchema'] as const)('rejects dangling refs in %s', key => {
    const findings = check({ type: 'object', properties: { x: { $ref: '#/$defs/missing' } } }, key);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', pointer: `/tools/0/${key}` });
  });
  it('rejects invalid keyword types and malformed patterns', () => {
    expect(check({ type: 'object', properties: { x: { minLength: 'five' } } })).toHaveLength(1);
    expect(check({ type: 'string', pattern: '[' })).toHaveLength(1);
  });
  it('accepts 2020-12 features, local refs, recursion, and annotations', () => {
    expect(check({
      $schema: DIALECT_2020_12, type: 'object',
      $defs: { node: { type: 'object', properties: { child: { $ref: '#/$defs/node' } } } },
      properties: { node: { $ref: '#/$defs/node' }, tuple: { prefixItems: [{ type: 'string' }], items: false } },
      'x-vendor': true,
    })).toEqual([]);
  });
  it('does not fetch remote refs or duplicate old-dialect errors', () => {
    expect(check({ $ref: 'https://example.invalid/schema.json' })).toEqual([]);
    expect(check({ $schema: 'http://json-schema.org/draft-07/schema#' })).toEqual([]);
  });
  it('does not leak schemas between tools with the same $id', () => {
    const tool = (type: string): Tool => ({
      name: type, inputSchema: { $id: 'https://example.test/schema', type },
    });
    expect(lint({ tools: [tool('string'), tool('number')] }).findings.filter(f => f.ruleId === 'schema-compiles')).toEqual([]);
  });
  it('can be suppressed like the other rules', () => {
    expect(lint({ tools: [{ name: 'x', inputSchema: { $ref: '#/missing' } }] }, {
      ignoreRules: ['schema-compiles'],
    }).findings.some(f => f.ruleId === 'schema-compiles')).toBe(false);
  });
  it('ignores external refs without hiding invalid sibling keywords or changing input', () => {
    const schema = {
      type: 'object', properties: {
        remote: { $ref: 'https://must-never-fetch.invalid/schema' },
        local: { type: 'string', minLength: 'bad' },
      },
    };
    const before = structuredClone(schema);
    expect(check(schema)).toHaveLength(1);
    expect(schema).toEqual(before);
  });
});
