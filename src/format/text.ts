import type { LintResult, Severity } from '../types.js';

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Human-readable report, one block per tool, deterministic and free of colour codes. */
export function formatText(result: LintResult): string {
  const lines: string[] = [];
  lines.push(`${result.target}: ${plural(result.tools, 'tool')}`);
  const byTool = new Map<string, LintResult['findings']>();
  for (const f of result.findings) {
    const key = `${f.toolIndex}:${f.tool}`;
    const list = byTool.get(key) ?? [];
    list.push(f);
    byTool.set(key, list);
  }
  for (const [key, findings] of byTool) {
    const name = key.slice(key.indexOf(':') + 1);
    lines.push('');
    lines.push(`  ${name}`);
    const sorted = [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    const widest = Math.max(...sorted.map((f) => f.ruleId.length));
    for (const f of sorted) {
      const fix = f.fix ? '  [fixable]' : '';
      lines.push(`    ${f.severity.padEnd(7)}  ${f.ruleId.padEnd(widest)}  ${f.message}${fix}`);
      lines.push(`    ${''.padEnd(7)}  ${''.padEnd(widest)}  at ${f.pointer}`);
    }
  }
  lines.push('');
  const { errors, warnings, infos } = result.summary;
  if (result.findings.length === 0) {
    lines.push('No problems found.');
  } else {
    const fixable = result.findings.filter((f) => f.fix).length;
    lines.push(
      `${plural(errors, 'error')}, ${plural(warnings, 'warning')}, ${plural(infos, 'info')}` +
        (fixable > 0 ? ` (${fixable} fixable with --fix)` : ''),
    );
  }
  return lines.join('\n') + '\n';
}
