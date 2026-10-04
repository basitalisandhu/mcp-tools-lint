import type { LintResult } from '../types.js';

export interface JsonReport {
  version: 1;
  target: string;
  tools: number;
  summary: LintResult['summary'];
  findings: LintResult['findings'];
  patch: LintResult['patch'];
}

/** Machine-readable report. Stable key order, two-space indent, trailing newline. */
export function formatJson(result: LintResult): string {
  const report: JsonReport = {
    version: 1,
    target: result.target,
    tools: result.tools,
    summary: result.summary,
    findings: result.findings,
    patch: result.patch,
  };
  return JSON.stringify(report, null, 2) + '\n';
}
