import { parsePointer } from './pointer.js';
import type { PatchOp } from './types.js';

type Container = Record<string, unknown> | unknown[];

function isContainer(value: unknown): value is Container {
  return typeof value === 'object' && value !== null;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function resolveParent(doc: unknown, pointer: string): { parent: Container; key: string } {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) throw new Error('cannot operate on the document root');
  let node: unknown = doc;
  for (const token of tokens.slice(0, -1)) {
    if (!isContainer(node)) throw new Error(`path ${pointer} does not exist`);
    node = Array.isArray(node) ? node[Number(token)] : node[token];
  }
  if (!isContainer(node)) throw new Error(`path ${pointer} does not exist`);
  return { parent: node, key: tokens[tokens.length - 1] as string };
}

function getAt(doc: unknown, pointer: string): unknown {
  const { parent, key } = resolveParent(doc, pointer);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`path ${pointer} does not exist`);
    }
    return parent[index];
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`path ${pointer} does not exist`);
  return parent[key];
}

function removeAt(doc: unknown, pointer: string): unknown {
  const { parent, key } = resolveParent(doc, pointer);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new Error(`path ${pointer} does not exist`);
    }
    return parent.splice(index, 1)[0];
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`path ${pointer} does not exist`);
  const value = parent[key];
  delete parent[key];
  return value;
}

function addAt(doc: unknown, pointer: string, value: unknown): void {
  const { parent, key } = resolveParent(doc, pointer);
  if (Array.isArray(parent)) {
    if (key === '-') {
      parent.push(value);
      return;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new Error(`path ${pointer} is out of bounds`);
    }
    parent.splice(index, 0, value);
    return;
  }
  parent[key] = value;
}

function replaceAt(doc: unknown, pointer: string, value: unknown): void {
  getAt(doc, pointer); // must exist
  const { parent, key } = resolveParent(doc, pointer);
  if (Array.isArray(parent)) parent[Number(key)] = value;
  else parent[key] = value;
}

/**
 * Apply an RFC 6902 patch and return a new document. The input is not modified.
 * Supports the operations this tool emits: remove, move, add and replace.
 */
export function applyPatch(document: unknown, ops: PatchOp[]): unknown {
  const doc = clone(document);
  for (const op of ops) {
    switch (op.op) {
      case 'remove':
        removeAt(doc, op.path);
        break;
      case 'move': {
        const value = removeAt(doc, op.from);
        addAt(doc, op.path, value);
        break;
      }
      case 'add':
        addAt(doc, op.path, clone(op.value));
        break;
      case 'replace':
        replaceAt(doc, op.path, clone(op.value));
        break;
      default: {
        const unknownOp: never = op;
        throw new Error(`unsupported patch operation ${JSON.stringify(unknownOp)}`);
      }
    }
  }
  return doc;
}

/** Serialise a patch the way `--fix` writes it: two-space indent, trailing newline. */
export function formatPatch(ops: PatchOp[]): string {
  return JSON.stringify(ops, null, 2) + '\n';
}
