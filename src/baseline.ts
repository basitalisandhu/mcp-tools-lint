import { isObject } from './schema.js';
import { rebase, summarise } from './lint.js';
import type { LintResult, ToolFinding } from './types.js';

// Messages and severities change between releases, so identity is tool + rule + path only:
// rewording a message or adjusting a severity must not resurrect baselined findings.
type Identity = Pick<ToolFinding, 'tool' | 'ruleId' | 'path'>;

// Tool-relative paths survive tool reordering and file/server target changes.
function identity(finding: Identity): string {
  return JSON.stringify([finding.tool, finding.ruleId, finding.path]);
}

/** Read only the identity fields; historical rule IDs need not exist in this version. */
export function parseBaseline(value: unknown): Identity[] {
  if (!isObject(value) || !Array.isArray(value.findings)) throw new Error('expected a JSON report with a findings array');
  return value.findings.map((finding: unknown) => {
    if (!isObject(finding) || !['tool', 'ruleId', 'path'].every((key) => typeof finding[key] === 'string')) {
      throw new Error('baseline findings must contain tool, ruleId and path');
    }
    return finding as unknown as Identity;
  });
}

/**
 * Drop findings already in the baseline and summarise the rest. Multiset comparison
 * keeps an extra occurrence of an identical finding new.
 */
export function compareBaseline(result: LintResult, baseline: Identity[]): LintResult {
  const remaining = new Map<string, number>();
  for (const finding of baseline) {
    const key = identity(finding);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let suppressed = 0;
  const findings: ToolFinding[] = [];
  for (const finding of result.findings) {
    const key = identity(finding);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      suppressed += 1;
      continue;
    }
    findings.push({ ...finding, baselineState: 'new' });
  }
  const patch = findings.flatMap((finding) => {
    const toolPointer = finding.pointer.slice(0, finding.pointer.length - finding.path.length);
    return rebase(finding.fix ?? [], toolPointer);
  });
  return {
    ...result,
    findings,
    patch,
    summary: { ...summarise(findings), suppressed, resolved: baseline.length - suppressed },
  };
}
