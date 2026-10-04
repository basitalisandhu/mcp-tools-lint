import { joinPointer } from './pointer.js';

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keywords whose value is a single subschema. */
const SINGLE_SCHEMA_KEYWORDS = new Set([
  'items',
  'additionalProperties',
  'additionalItems',
  'unevaluatedItems',
  'unevaluatedProperties',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'contentSchema',
]);

/** Keywords whose value is an array of subschemas. */
const ARRAY_SCHEMA_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

/** Keywords whose value is a map from name to subschema. */
const MAP_SCHEMA_KEYWORDS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

export interface SchemaVisit {
  /** The schema node: an object, a boolean, or something invalid. */
  node: unknown;
  /** JSON Pointer to the node, relative to the pointer passed to walkSchema. */
  pointer: string;
  /** The keyword under which the node sits, or null for the root. */
  keyword: string | null;
}

/**
 * Visit every schema node reachable from `root` through the structural keywords of
 * JSON Schema (drafts 4 through 2020-12), in document order. Property names under
 * `properties`, `$defs` and similar maps are never treated as keywords, so a property
 * called `$schema` or `items` is not mistaken for one.
 */
export function walkSchema(root: unknown, pointer: string, visit: (v: SchemaVisit) => void): void {
  walk(root, pointer, null, visit);
}

function walk(node: unknown, pointer: string, keyword: string | null, visit: (v: SchemaVisit) => void): void {
  visit({ node, pointer, keyword });
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (SINGLE_SCHEMA_KEYWORDS.has(key)) {
      if (key === 'items' && Array.isArray(value)) {
        value.forEach((sub, i) => walk(sub, joinPointer(pointer, key, String(i)), key, visit));
      } else {
        walk(value, joinPointer(pointer, key), key, visit);
      }
    } else if (ARRAY_SCHEMA_KEYWORDS.has(key) && Array.isArray(value)) {
      value.forEach((sub, i) => walk(sub, joinPointer(pointer, key, String(i)), key, visit));
    } else if (MAP_SCHEMA_KEYWORDS.has(key) && isObject(value)) {
      for (const [name, sub] of Object.entries(value)) walk(sub, joinPointer(pointer, key, name), key, visit);
    } else if (key === 'dependencies' && isObject(value)) {
      // draft-07: a value is either an array of property names or a schema
      for (const [name, sub] of Object.entries(value)) {
        if (!Array.isArray(sub)) walk(sub, joinPointer(pointer, key, name), key, visit);
      }
    }
  }
}
