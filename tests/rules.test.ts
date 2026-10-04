import { describe, expect, it } from 'vitest';
import {
  checkTool,
  descriptionMissing,
  destructiveWithoutHint,
  dialect2020_12,
  missingAnnotations,
  noBooleanSchema,
  readonlyVerbContradiction,
  requiredNamesProperty,
  rules,
  snakeCaseAnnotationKeys,
  unsupportedKeyword,
} from '../src/rules.js';
import type { Tool } from '../src/types.js';

const ok: Tool = {
  name: 'list_items',
  description: 'List items.',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

describe('rule set', () => {
  it('has the nine documented rule ids in a fixed order', () => {
    expect(rules.map((r) => r.id)).toEqual([
      'dialect-2020-12',
      'no-boolean-schema',
      'required-names-property',
      'unsupported-keyword',
      'missing-annotations',
      'readonly-verb-contradiction',
      'destructive-without-hint',
      'snake-case-annotation-keys',
      'description-missing',
    ]);
  });

  it('reports nothing for a correct tool', () => {
    expect(checkTool(ok)).toEqual([]);
  });

  it('is pure: the same tool gives the same findings and the input is untouched', () => {
    const tool: Tool = JSON.parse(JSON.stringify(ok));
    const a = checkTool(tool);
    const b = checkTool(tool);
    expect(a).toEqual(b);
    expect(tool).toEqual(ok);
  });
});

describe('dialect-2020-12', () => {
  it('flags draft-07 at the root of inputSchema and outputSchema with a remove fix', () => {
    const tool: Tool = {
      ...ok,
      inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' },
      outputSchema: { $schema: 'http://json-schema.org/draft-04/schema#', type: 'object' },
    };
    const findings = dialect2020_12.check(tool);
    expect(findings.map((f) => f.path)).toEqual(['/inputSchema/$schema', '/outputSchema/$schema']);
    expect(findings[0]?.fix).toEqual([{ op: 'remove', path: '/inputSchema/$schema' }]);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
  });

  it('flags a nested $schema and ignores a property that happens to be called $schema', () => {
    const tool: Tool = {
      ...ok,
      inputSchema: {
        type: 'object',
        properties: {
          $schema: { type: 'string' },
          nested: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' },
        },
      },
    };
    expect(dialect2020_12.check(tool).map((f) => f.path)).toEqual(['/inputSchema/properties/nested/$schema']);
  });

  it('accepts 2020-12 with and without the trailing #', () => {
    for (const value of ['https://json-schema.org/draft/2020-12/schema', 'https://json-schema.org/draft/2020-12/schema#']) {
      expect(dialect2020_12.check({ ...ok, inputSchema: { $schema: value, type: 'object' } })).toEqual([]);
    }
  });
});

describe('no-boolean-schema', () => {
  it('flags booleans in properties, items, allOf, $defs and at the root', () => {
    const tool: Tool = {
      ...ok,
      inputSchema: {
        type: 'object',
        properties: { a: true, b: { type: 'array', items: false }, c: { allOf: [true] } },
        $defs: { d: false },
      },
      outputSchema: true,
    };
    expect(noBooleanSchema.check(tool).map((f) => f.path)).toEqual([
      '/inputSchema/properties/a',
      '/inputSchema/properties/b/items',
      '/inputSchema/properties/c/allOf/0',
      '/inputSchema/$defs/d',
      '/outputSchema',
    ]);
  });

  it('allows additionalProperties, additionalItems, unevaluatedProperties and unevaluatedItems', () => {
    const tool: Tool = {
      ...ok,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        unevaluatedProperties: false,
        properties: { list: { type: 'array', prefixItems: [{ type: 'string' }], additionalItems: false, unevaluatedItems: true } },
      },
    };
    expect(noBooleanSchema.check(tool)).toEqual([]);
  });
});

describe('required-names-property', () => {
  it('flags a required entry with no matching property, at any depth', () => {
    const tool: Tool = {
      ...ok,
      inputSchema: {
        type: 'object',
        properties: { a: { type: 'string' }, nested: { type: 'object', properties: { x: {} }, required: ['x', 'y'] } },
        required: ['a', 'b'],
      },
    };
    expect(requiredNamesProperty.check(tool).map((f) => f.path)).toEqual([
      '/inputSchema/required/1',
      '/inputSchema/properties/nested/required/1',
    ]);
  });

  it('skips nodes that compose other schemas, where required may be satisfied elsewhere', () => {
    const tool: Tool = {
      ...ok,
      inputSchema: { type: 'object', allOf: [{ properties: { a: { type: 'string' } } }], required: ['a'] },
    };
    expect(requiredNamesProperty.check(tool)).toEqual([]);
  });
});

describe('unsupported-keyword', () => {
  it('flags $id fragments, definitions and boolean required', () => {
    const tool: Tool = {
      ...ok,
      inputSchema: {
        $id: 'https://example.com/s#frag',
        type: 'object',
        definitions: {},
        properties: { a: { type: 'string', required: false } },
      },
    };
    const findings = unsupportedKeyword.check(tool);
    expect(findings.map((f) => f.path)).toEqual(['/inputSchema/$id', '/inputSchema/definitions', '/inputSchema/properties/a/required']);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });
});

describe('annotation rules', () => {
  it('missing-annotations warns when annotations is absent or not an object', () => {
    expect(missingAnnotations.check({ ...ok, annotations: undefined }).map((f) => f.ruleId)).toEqual(['missing-annotations']);
    expect(missingAnnotations.check({ ...ok, annotations: 'yes' }).length).toBe(1);
    expect(missingAnnotations.check(ok)).toEqual([]);
  });

  it('readonly-verb-contradiction matches the write verb list on name, title and annotations.title', () => {
    const ro = { readOnlyHint: true };
    expect(readonlyVerbContradiction.check({ ...ok, name: 'delete_item', annotations: ro }).length).toBe(1);
    expect(readonlyVerbContradiction.check({ ...ok, name: 'item', title: 'Send-mail', annotations: ro }).length).toBe(1);
    expect(readonlyVerbContradiction.check({ ...ok, name: 'item', annotations: { ...ro, title: 'Deploy_now' } }).length).toBe(1);
    expect(readonlyVerbContradiction.check({ ...ok, name: 'get_item', annotations: ro })).toEqual([]);
    expect(readonlyVerbContradiction.check({ ...ok, name: 'deleted_items_report', annotations: ro })).toEqual([]);
    expect(readonlyVerbContradiction.check({ ...ok, name: 'delete_item', annotations: { readOnlyHint: false } })).toEqual([]);
  });

  it('destructive-without-hint warns for delete, remove and drop names without destructiveHint', () => {
    expect(destructiveWithoutHint.check({ ...ok, name: 'drop-table', annotations: {} })[0]?.path).toBe('/annotations/destructiveHint');
    expect(destructiveWithoutHint.check({ ...ok, name: 'remove_user', annotations: undefined })[0]?.path).toBe('/annotations');
    expect(destructiveWithoutHint.check({ ...ok, name: 'delete_user', annotations: { destructiveHint: true } })).toEqual([]);
    expect(destructiveWithoutHint.check({ ...ok, name: 'update_user', annotations: {} })).toEqual([]);
  });

  it('snake-case-annotation-keys emits move fixes, or a remove when the camelCase key already exists', () => {
    const tool: Tool = { ...ok, annotations: { read_only_hint: true, destructive_hint: false, destructiveHint: false, custom_key: 1 } };
    const findings = snakeCaseAnnotationKeys.check(tool);
    expect(findings.map((f) => f.fix)).toEqual([
      [{ op: 'move', from: '/annotations/read_only_hint', path: '/annotations/readOnlyHint' }],
      [{ op: 'remove', path: '/annotations/destructive_hint' }],
    ]);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
  });

  it('description-missing is an info for absent or blank descriptions', () => {
    expect(descriptionMissing.check({ ...ok, description: undefined })[0]?.severity).toBe('info');
    expect(descriptionMissing.check({ ...ok, description: '   ' }).length).toBe(1);
    expect(descriptionMissing.check(ok)).toEqual([]);
  });
});
