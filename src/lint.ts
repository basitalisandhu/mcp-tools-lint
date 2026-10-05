import { joinPointer } from './pointer.js';
import { checkTool } from './rules.js';
import { isObject } from './schema.js';
import type { LintResult, PatchOp, Summary, Tool, ToolFinding } from './types.js';

/** A tools/list document in one of the shapes the tool accepts, plus where the tools array lives. */
export interface ToolsDocument {
  /** The document as loaded or received. */
  document: unknown;
  /** JSON Pointer to the tools array inside `document` ("" when the document is the array). */
  basePointer: string;
  tools: unknown[];
}

/**
 * Locate the tools array in a JSON value. Accepts a bare array, a tools/list result
 * `{"tools": [...]}` and a full JSON-RPC response `{"result": {"tools": [...]}}`.
 */
export function locateTools(document: unknown): ToolsDocument {
  if (Array.isArray(document)) return { document, basePointer: '', tools: document };
  if (isObject(document)) {
    if (Array.isArray(document.tools)) return { document, basePointer: '/tools', tools: document.tools };
    if (isObject(document.result) && Array.isArray(document.result.tools)) {
      return { document, basePointer: '/result/tools', tools: document.result.tools };
    }
  }
  throw new Error('expected a JSON array of tools, a {"tools": [...]} object, or a JSON-RPC response with result.tools');
}

function rebase(ops: PatchOp[], toolPointer: string): PatchOp[] {
  return ops.map((op) => {
    switch (op.op) {
      case 'move':
        return { op: 'move', from: toolPointer + op.from, path: toolPointer + op.path };
      case 'remove':
        return { op: 'remove', path: toolPointer + op.path };
      case 'add':
        return { op: 'add', path: toolPointer + op.path, value: op.value };
      case 'replace':
        return { op: 'replace', path: toolPointer + op.path, value: op.value };
    }
  });
}

export function summarise(findings: readonly { severity: string }[]): Summary {
  const summary: Summary = { errors: 0, warnings: 0, infos: 0 };
  for (const f of findings) {
    if (f.severity === 'error') summary.errors += 1;
    else if (f.severity === 'warning') summary.warnings += 1;
    else summary.infos += 1;
  }
  return summary;
}

/** Lint every tool in a located document. Pure apart from the input. */
export function lintTools(doc: ToolsDocument, target: string, ignoredRules: readonly string[] = []): LintResult {
  const findings: ToolFinding[] = [];
  const patch: PatchOp[] = [];
  doc.tools.forEach((raw, index) => {
    const tool: Tool = isObject(raw) ? raw : {};
    const name = typeof tool.name === 'string' && tool.name !== '' ? tool.name : `#${index}`;
    const toolPointer = joinPointer(doc.basePointer, String(index));
    for (const finding of checkTool(tool)) {
      if (ignoredRules.includes(finding.ruleId)) continue;
      findings.push({ ...finding, tool: name, toolIndex: index, pointer: toolPointer + finding.path });
      if (finding.fix) patch.push(...rebase(finding.fix, toolPointer));
    }
  });
  return { target, tools: doc.tools.length, findings, patch, summary: summarise(findings) };
}
