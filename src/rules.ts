import { joinPointer } from './pointer.js';
import { isObject, walkSchema } from './schema.js';
import type { Finding, Rule, Tool } from './types.js';

/** The only dialect the default validator in Claude Code accepts (with or without a trailing "#"). */
export const DIALECT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

const SCHEMA_FIELDS = ['inputSchema', 'outputSchema'] as const;

/** Verbs that contradict readOnlyHint: true when they start a tool name or title. */
export const WRITE_VERB_PATTERN =
  /^(create|add|insert|update|set|put|patch|delete|remove|drop|send|post|publish|write|execute|run|deploy|move|rename)[_-]/i;

/** The subset of write verbs that implies a destructive update. */
export const DESTRUCTIVE_VERB_PATTERN = /^(delete|remove|drop)[_-]/i;

/** Boolean values under these keywords are the normal way to close a schema; clients accept them. */
const BOOLEAN_ALLOWED_KEYWORDS = new Set([
  'additionalProperties',
  'additionalItems',
  'unevaluatedProperties',
  'unevaluatedItems',
]);

/** Keywords that compose or defer to other schemas; `required` on such a node may be satisfied elsewhere. */
const COMPOSITION_KEYWORDS = ['$ref', 'allOf', 'anyOf', 'oneOf', 'if', 'then', 'else', 'dependentSchemas'];

/** snake_case annotation keys the Python SDK 2.x emits, mapped to the spec's camelCase names. */
export const SNAKE_ANNOTATION_KEYS: Record<string, string> = {
  read_only_hint: 'readOnlyHint',
  destructive_hint: 'destructiveHint',
  idempotent_hint: 'idempotentHint',
  open_world_hint: 'openWorldHint',
};

function isAcceptedDialect(value: unknown): boolean {
  return value === DIALECT_2020_12 || value === DIALECT_2020_12 + '#';
}

function forEachSchemaField(tool: Tool, fn: (field: string, schema: unknown) => void): void {
  for (const field of SCHEMA_FIELDS) {
    if (field in tool && tool[field] !== undefined) fn(field, tool[field]);
  }
}

function toolTitles(tool: Tool): string[] {
  const out: string[] = [];
  if (typeof tool.name === 'string') out.push(tool.name);
  if (typeof tool.title === 'string') out.push(tool.title);
  const ann = tool.annotations;
  if (isObject(ann) && typeof ann.title === 'string') out.push(ann.title);
  return out;
}

export const dialect2020_12: Rule = {
  id: 'dialect-2020-12',
  severity: 'error',
  description:
    'Any $schema in inputSchema or outputSchema must be https://json-schema.org/draft/2020-12/schema; Claude Code rejects every other dialect at call time.',
  fix: 'Remove the $schema key (the MCP spec defines the dialect as 2020-12) or set it to https://json-schema.org/draft/2020-12/schema.',
  check(tool) {
    const findings: Finding[] = [];
    forEachSchemaField(tool, (field, schema) => {
      walkSchema(schema, '/' + field, ({ node, pointer }) => {
        if (!isObject(node) || !('$schema' in node)) return;
        if (isAcceptedDialect(node.$schema)) return;
        const path = joinPointer(pointer, '$schema');
        findings.push({
          ruleId: 'dialect-2020-12',
          severity: 'error',
          path,
          message: `${field} declares dialect ${JSON.stringify(node.$schema)}; the default validator in Claude Code supports JSON Schema 2020-12 only`,
          fix: [{ op: 'remove', path }],
        });
      });
    });
    return findings;
  },
};

export const noBooleanSchema: Rule = {
  id: 'no-boolean-schema',
  severity: 'error',
  description:
    'A schema position (properties.*, items, allOf entries, $defs.* and so on) must hold an object, not true or false. Boolean values under additionalProperties, additionalItems, unevaluatedProperties and unevaluatedItems are allowed.',
  fix: 'Replace true with {} and false with {"not": {}}, or describe the value properly.',
  check(tool) {
    const findings: Finding[] = [];
    forEachSchemaField(tool, (field, schema) => {
      walkSchema(schema, '/' + field, ({ node, pointer, keyword }) => {
        if (typeof node !== 'boolean') return;
        if (keyword !== null && BOOLEAN_ALLOWED_KEYWORDS.has(keyword)) return;
        findings.push({
          ruleId: 'no-boolean-schema',
          severity: 'error',
          path: pointer,
          message: `boolean schema ${node} where an object schema is expected${keyword ? ` (under ${keyword})` : ''}; clients that compile tool schemas reject it`,
        });
      });
    });
    return findings;
  },
};

export const requiredNamesProperty: Rule = {
  id: 'required-names-property',
  severity: 'error',
  description: 'Every entry of required must name a key of properties on the same object schema.',
  fix: 'Add the property to properties or remove it from required.',
  check(tool) {
    const findings: Finding[] = [];
    forEachSchemaField(tool, (field, schema) => {
      walkSchema(schema, '/' + field, ({ node, pointer }) => {
        if (!isObject(node) || !Array.isArray(node.required)) return;
        if (COMPOSITION_KEYWORDS.some((k) => k in node)) return;
        if (!isObject(node.properties) && node.type !== 'object') return;
        const known = isObject(node.properties) ? new Set(Object.keys(node.properties)) : new Set<string>();
        node.required.forEach((entry, i) => {
          if (typeof entry !== 'string' || known.has(entry)) return;
          findings.push({
            ruleId: 'required-names-property',
            severity: 'error',
            path: joinPointer(pointer, 'required', String(i)),
            message: `required lists ${JSON.stringify(entry)} but properties has no ${JSON.stringify(entry)}`,
          });
        });
      });
    });
    return findings;
  },
};

export const unsupportedKeyword: Rule = {
  id: 'unsupported-keyword',
  severity: 'warning',
  description:
    'Flags keywords that 2020-12 validators ignore or reject: $id with a fragment, definitions instead of $defs, and a boolean required (draft-03 style).',
  fix: 'Use $defs, drop the fragment from $id, and express required as an array on the parent object.',
  check(tool) {
    const findings: Finding[] = [];
    forEachSchemaField(tool, (field, schema) => {
      walkSchema(schema, '/' + field, ({ node, pointer }) => {
        if (!isObject(node)) return;
        if (typeof node.$id === 'string' && node.$id.includes('#')) {
          findings.push({
            ruleId: 'unsupported-keyword',
            severity: 'warning',
            path: joinPointer(pointer, '$id'),
            message: `$id ${JSON.stringify(node.$id)} contains a fragment; 2020-12 forbids fragments in $id (use $anchor)`,
          });
        }
        if ('definitions' in node) {
          findings.push({
            ruleId: 'unsupported-keyword',
            severity: 'warning',
            path: joinPointer(pointer, 'definitions'),
            message: 'definitions is a draft-07 keyword; 2020-12 uses $defs',
          });
        }
        if (typeof node.required === 'boolean') {
          findings.push({
            ruleId: 'unsupported-keyword',
            severity: 'warning',
            path: joinPointer(pointer, 'required'),
            message: `required: ${node.required} is draft-03 syntax; 2020-12 expects an array of property names on the parent object`,
          });
        }
      });
    });
    return findings;
  },
};

export const missingAnnotations: Rule = {
  id: 'missing-annotations',
  severity: 'warning',
  description: 'The tool has no annotations object, so strict clients treat it as a write-capable, destructive tool and prompt on every call.',
  fix: 'Add annotations with readOnlyHint, destructiveHint, idempotentHint and openWorldHint set truthfully.',
  check(tool) {
    if (isObject(tool.annotations)) return [];
    return [
      {
        ruleId: 'missing-annotations',
        severity: 'warning',
        path: '/annotations',
        message: 'no annotations; clients that gate on readOnlyHint will treat this tool as write-capable',
      },
    ];
  },
};

export const readonlyVerbContradiction: Rule = {
  id: 'readonly-verb-contradiction',
  severity: 'error',
  description: 'readOnlyHint is true but the name or title starts with a write verb such as create, update, delete or send.',
  fix: 'Set readOnlyHint to false (and destructiveHint truthfully), or rename the tool if it really is read-only.',
  check(tool) {
    const ann = tool.annotations;
    if (!isObject(ann) || ann.readOnlyHint !== true) return [];
    const offending = toolTitles(tool).find((t) => WRITE_VERB_PATTERN.test(t));
    if (offending === undefined) return [];
    return [
      {
        ruleId: 'readonly-verb-contradiction',
        severity: 'error',
        path: '/annotations/readOnlyHint',
        message: `readOnlyHint is true but ${JSON.stringify(offending)} starts with a write verb`,
      },
    ];
  },
};

export const destructiveWithoutHint: Rule = {
  id: 'destructive-without-hint',
  severity: 'warning',
  description: 'The name starts with delete, remove or drop but destructiveHint is not declared.',
  fix: 'Add destructiveHint: true (or false if the tool only marks things for later removal).',
  check(tool) {
    if (typeof tool.name !== 'string' || !DESTRUCTIVE_VERB_PATTERN.test(tool.name)) return [];
    const ann = tool.annotations;
    if (isObject(ann) && ann.destructiveHint !== undefined) return [];
    return [
      {
        ruleId: 'destructive-without-hint',
        severity: 'warning',
        path: isObject(ann) ? '/annotations/destructiveHint' : '/annotations',
        message: `${JSON.stringify(tool.name)} looks destructive but declares no destructiveHint`,
      },
    ];
  },
};

export const snakeCaseAnnotationKeys: Rule = {
  id: 'snake-case-annotation-keys',
  severity: 'error',
  description: 'annotations uses snake_case keys (read_only_hint and friends, as emitted by the Python SDK 2.x); clients read camelCase and ignore these.',
  fix: 'Rename the keys to readOnlyHint, destructiveHint, idempotentHint and openWorldHint.',
  check(tool) {
    const ann = tool.annotations;
    if (!isObject(ann)) return [];
    const findings: Finding[] = [];
    for (const key of Object.keys(ann)) {
      const camel = SNAKE_ANNOTATION_KEYS[key];
      if (camel === undefined) continue;
      const from = joinPointer('/annotations', key);
      const to = joinPointer('/annotations', camel);
      const duplicate = camel in ann;
      findings.push({
        ruleId: 'snake-case-annotation-keys',
        severity: 'error',
        path: from,
        message: duplicate
          ? `annotations has ${key} next to ${camel}; clients read ${camel} only`
          : `annotations uses ${key}; clients read ${camel} and ignore this key`,
        fix: duplicate ? [{ op: 'remove', path: from }] : [{ op: 'move', from, path: to }],
      });
    }
    return findings;
  },
};

export const descriptionMissing: Rule = {
  id: 'description-missing',
  severity: 'info',
  description: 'The tool has no description, so the model has only the name to decide when to call it.',
  fix: 'Add a one-sentence description that says what the tool does and when to use it.',
  check(tool) {
    if (typeof tool.description === 'string' && tool.description.trim() !== '') return [];
    return [
      {
        ruleId: 'description-missing',
        severity: 'info',
        path: '/description',
        message: 'no description',
      },
    ];
  },
};

/** All rules, in the order they run and appear in SARIF. */
export const rules: readonly Rule[] = [
  dialect2020_12,
  noBooleanSchema,
  requiredNamesProperty,
  unsupportedKeyword,
  missingAnnotations,
  readonlyVerbContradiction,
  destructiveWithoutHint,
  snakeCaseAnnotationKeys,
  descriptionMissing,
];

/** Run every rule against one tool. Pure: no I/O, same input gives the same findings. */
export function checkTool(tool: Tool): Finding[] {
  return rules.flatMap((rule) => rule.check(tool));
}
