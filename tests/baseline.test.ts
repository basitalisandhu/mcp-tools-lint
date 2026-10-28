import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli, toolsFile } from './helpers.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function files() {
  const dir = await mkdtemp(join(tmpdir(), 'lint-baseline-'));
  dirs.push(dir);
  return { dir, target: join(dir, 'tools.json'), baseline: join(dir, 'baseline.json') };
}
const tool = (name: string, schema: unknown = { type: 'object' }) => ({
  name, description: 'Read data.', annotations: { readOnlyHint: true }, inputSchema: schema,
});
const broken = (name: string) => tool(name, { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' });

describe('baseline comparison', () => {
  it('passes the boolean fixture against its own baseline and resurfaces renamed tools', async () => {
    const { target, baseline } = await files();
    const fixture = JSON.parse(await readFile(toolsFile('boolean'), 'utf8'));
    await writeFile(target, JSON.stringify(fixture));
    await writeFile(baseline, (await runCli([target, '--format', 'json'])).stdout);
    const same = await runCli([target, '--baseline', baseline]);
    expect(same.code).toBe(0);
    const report = JSON.parse((await runCli([target, '--baseline', baseline, '--format', 'json'])).stdout);
    expect(report.findings).toHaveLength(0);
    expect(report.summary.suppressed).toBeGreaterThan(0);
    fixture.tools[0].name = 'moved_search_docs';
    await writeFile(target, JSON.stringify(fixture));
    const moved = await runCli([target, '--baseline', baseline]);
    expect(moved.code).toBe(1);
    const movedReport = JSON.parse((await runCli([target, '--baseline', baseline, '--format', 'json'])).stdout);
    expect(movedReport.findings.every((f: { tool: string }) => f.tool === 'moved_search_docs')).toBe(true);
    expect(movedReport.summary.suppressed).toBeGreaterThan(0);
  });
  it('suppresses known findings after tool reordering and fails on new findings', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify({ tools: [broken('read_old'), tool('read_clean')] }));
    const first = await runCli([target, '--format', 'json']);
    await writeFile(baseline, first.stdout);
    await writeFile(target, JSON.stringify({ tools: [tool('read_clean'), broken('read_old'), broken('read_new')] }));
    const next = await runCli([target, '--baseline', baseline, '--format', 'json']);
    expect(next.code).toBe(1);
    const report = JSON.parse(next.stdout);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].tool).toBe('read_new');
    expect(report.findings[0].baselineState).toBe('new');
    expect(report.summary).toEqual({ errors: 1, warnings: 0, infos: 0, suppressed: 1, resolved: 0 });
    expect(report.patch).toEqual([{ op: 'remove', path: '/tools/2/inputSchema/$schema' }]);
    const patchPath = `${target}.patch.json`;
    const fix = await runCli([target, '--baseline', baseline, '--fix']);
    expect(fix.code).toBe(1);
    expect(JSON.parse(await readFile(patchPath, 'utf8'))).toEqual(report.patch);
  });
  it('ignores message and severity drift in the baseline', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([broken('read_old')]));
    const written = JSON.parse((await runCli([target, '--format', 'json'])).stdout);
    for (const finding of written.findings) {
      finding.message = 'reworded in a later release';
      finding.severity = 'info';
    }
    await writeFile(baseline, JSON.stringify(written));
    const run = await runCli([target, '--baseline', baseline, '--format', 'json']);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).summary).toEqual({ errors: 0, warnings: 0, infos: 0, suppressed: 1, resolved: 0 });
  });
  it('writes a usable baseline with --baseline-write and counts resolved findings', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([broken('read_old')]));
    const write = await runCli([target, '--baseline-write', baseline]);
    expect(write.code).toBe(1);
    expect(JSON.parse(await readFile(baseline, 'utf8')).findings).toHaveLength(1);
    const same = await runCli([target, '--baseline', baseline, '--format', 'json']);
    expect(same.code).toBe(0);
    expect(JSON.parse(same.stdout).summary).toEqual({ errors: 0, warnings: 0, infos: 0, suppressed: 1, resolved: 0 });
    await writeFile(target, JSON.stringify([tool('read_old')]));
    const clean = await runCli([target, '--baseline', baseline, '--format', 'json']);
    expect(clean.code).toBe(0);
    expect(JSON.parse(clean.stdout).summary).toEqual({ errors: 0, warnings: 0, infos: 0, suppressed: 0, resolved: 1 });
  });
  it('marks surviving findings new in SARIF', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([broken('read_old')]));
    await writeFile(baseline, (await runCli([target, '--format', 'json'])).stdout);
    await writeFile(target, JSON.stringify([broken('read_old'), broken('read_new')]));
    const run = await runCli([target, '--baseline', baseline, '--format', 'sarif']);
    expect(run.code).toBe(1);
    const results = JSON.parse(run.stdout).runs[0].results;
    expect(results).toHaveLength(1);
    expect(results[0].baselineState).toBe('new');
  });
  it('mentions suppressed findings in the text summary', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([broken('read_old')]));
    await writeFile(baseline, (await runCli([target, '--format', 'json'])).stdout);
    await writeFile(target, JSON.stringify([broken('read_old'), broken('read_new')]));
    const run = await runCli([target, '--baseline', baseline]);
    expect(run.stdout).toContain('(1 suppressed by baseline, 1 fixable with --fix)');
  });
  it('does not hide a second instance with the same tool name', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([broken('same')]));
    await writeFile(baseline, (await runCli([target, '--format', 'json'])).stdout);
    await writeFile(target, JSON.stringify([broken('same'), broken('same')]));
    const run = await runCli([target, '--baseline', baseline, '--format', 'json']);
    expect(JSON.parse(run.stdout).findings).toHaveLength(1);
  });
  it('limits in-place annotation renames to new findings in JSON-RPC responses', async () => {
    const { target, baseline } = await files();
    const snake = (name: string) => ({ ...tool(name), annotations: { read_only_hint: true } });
    await writeFile(target, JSON.stringify({ result: { tools: [snake('old')] } }));
    await writeFile(baseline, (await runCli([target, '--format', 'json'])).stdout);
    await writeFile(target, JSON.stringify({ result: { tools: [snake('old'), snake('new')] } }));
    const run = await runCli([target, '--baseline', baseline, '--write']);
    expect(run.code).toBe(1);
    const patched = JSON.parse(await readFile(target, 'utf8'));
    expect(patched.result.tools[0].annotations).toEqual({ read_only_hint: true });
    expect(patched.result.tools[1].annotations).toEqual({ readOnlyHint: true });
  });
  it('respects severity thresholds for new warning-only findings', async () => {
    const { target, baseline } = await files();
    await writeFile(baseline, '{"findings":[]}');
    await writeFile(target, JSON.stringify([{ name: 'read_data', description: 'Read.', inputSchema: {} }]));
    expect((await runCli([target, '--baseline', baseline])).code).toBe(0);
    expect((await runCli([target, '--baseline', baseline, '--fail-on', 'warning'])).code).toBe(1);
  });
  it('rejects missing or malformed baselines', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([tool('read_clean')]));
    expect((await runCli([target, '--baseline', baseline])).code).toBe(2);
    for (const content of ['{', '{}', '{"findings":[{}]}']) {
      await writeFile(baseline, content);
      expect((await runCli([target, '--baseline', baseline])).code).toBe(2);
    }
  });
});
