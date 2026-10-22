import { isObject } from './schema.js';
import { summarise } from './lint.js';
import type { LintResult, PatchOp, ToolFinding } from './types.js';

type Identity = Pick<ToolFinding, 'tool' | 'ruleId' | 'path' | 'message' | 'severity'>;

// Tool-relative paths survive tool reordering and file/server target changes.
function identity(finding: Identity): string {
  return JSON.stringify([finding.tool, finding.ruleId, finding.path, finding.message, finding.severity]);
}

/** Read only the identity fields; historical rule IDs need not exist in this version. */
export function parseBaseline(value: unknown): Identity[] {
  if (!isObject(value) || !Array.isArray(value.findings)) throw new Error('expected a JSON report with a findings array');
  return value.findings.map((finding: unknown) => {
    if (!isObject(finding) ||
        !['tool', 'ruleId', 'path', 'message'].every(key => typeof finding[key] === 'string') ||
        !['error', 'warning', 'info'].includes(String(finding.severity))) {
      throw new Error('baseline findings must contain tool, ruleId, path, message and severity');
    }
    return finding as unknown as Identity;
  });
}

function patches(findings: ToolFinding[]): PatchOp[] {
  return findings.flatMap(finding => {
    const prefix = finding.pointer.slice(0, finding.pointer.length - finding.path.length);
    return (finding.fix ?? []).map((op): PatchOp => {
      if (op.op === 'move') return { ...op, from: prefix + op.from, path: prefix + op.path };
      return { ...op, path: prefix + op.path };
    });
  });
}

/** Compare multisets so an extra occurrence of an identical finding is still new. */
export function compareBaseline(result: LintResult, baseline: Identity[], newOnly = false): LintResult {
  const remaining = new Map<string, number>();
  for (const finding of baseline) {
    const key = identity(finding);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let existing = 0;
  const compared = result.findings.map(finding => {
    const key = identity(finding);
    const count = remaining.get(key) ?? 0;
    const baselineState = count > 0 ? 'unchanged' : 'new';
    if (count > 0) {
      remaining.set(key, count - 1);
      existing++;
    }
    return { ...finding, baselineState } as ToolFinding;
  });
  const findings = newOnly ? compared.filter(finding => finding.baselineState === 'new') : compared;
  return {
    ...result,
    findings,
    patch: patches(findings),
    summary: summarise(findings),
    baseline: { existing, new: compared.length - existing, resolved: baseline.length - existing },
  };
}
