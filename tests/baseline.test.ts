import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers.js';

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
  it('suppresses known findings after tool reordering and gates new findings only', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify({ tools: [broken('read_old'), tool('read_clean')] }));
    const first = await runCli([target, '--format', 'json']);
    await writeFile(baseline, first.stdout);
    await writeFile(target, JSON.stringify({ tools: [tool('read_clean'), broken('read_old'), broken('read_new')] }));
    const next = await runCli([target, '--baseline', baseline, '--new-only', '--format', 'json']);
    expect(next.code).toBe(1);
    const report = JSON.parse(next.stdout);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].tool).toBe('read_new');
    expect(report.baseline).toEqual({ existing: 1, new: 1, resolved: 0 });
    expect(report.patch).toEqual([{ op: 'remove', path: '/tools/2/inputSchema/$schema' }]);
    const patchPath = `${target}.patch.json`;
    const fix = await runCli([target, '--baseline', baseline, '--new-only', '--fix']);
    expect(fix.code).toBe(1);
    expect(JSON.parse(await readFile(patchPath, 'utf8'))).toEqual(report.patch);
  });
  it('passes unchanged findings and counts resolved findings', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([broken('read_old')]));
    await writeFile(baseline, (await runCli([target, '--format', 'json'])).stdout);
    const same = await runCli([target, '--baseline', baseline, '--new-only', '--format', 'json']);
    expect(same.code).toBe(0);
    expect(JSON.parse(same.stdout).summary.errors).toBe(0);
    await writeFile(target, JSON.stringify([tool('read_old')]));
    const clean = await runCli([target, '--baseline', baseline, '--new-only', '--format', 'json']);
    expect(JSON.parse(clean.stdout).baseline).toEqual({ existing: 0, new: 0, resolved: 1 });
  });
  it('retains full reports without --new-only, including SARIF baseline state', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([broken('read_old')]));
    await writeFile(baseline, (await runCli([target, '--format', 'json'])).stdout);
    const run = await runCli([target, '--baseline', baseline, '--format', 'sarif']);
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout).runs[0].results[0].baselineState).toBe('unchanged');
  });
  it('does not hide a second instance with the same tool name', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([broken('same')]));
    await writeFile(baseline, (await runCli([target, '--format', 'json'])).stdout);
    await writeFile(target, JSON.stringify([broken('same'), broken('same')]));
    const run = await runCli([target, '--baseline', baseline, '--new-only', '--format', 'json']);
    expect(JSON.parse(run.stdout).findings).toHaveLength(1);
  });
  it('limits in-place annotation renames to new findings in JSON-RPC responses', async () => {
    const { target, baseline } = await files();
    const snake = (name: string) => ({ ...tool(name), annotations: { read_only_hint: true } });
    await writeFile(target, JSON.stringify({ result: { tools: [snake('old')] } }));
    await writeFile(baseline, (await runCli([target, '--format', 'json'])).stdout);
    await writeFile(target, JSON.stringify({ result: { tools: [snake('old'), snake('new')] } }));
    const run = await runCli([target, '--baseline', baseline, '--new-only', '--write']);
    expect(run.code).toBe(1);
    const patched = JSON.parse(await readFile(target, 'utf8'));
    expect(patched.result.tools[0].annotations).toEqual({ read_only_hint: true });
    expect(patched.result.tools[1].annotations).toEqual({ readOnlyHint: true });
  });
  it('respects severity thresholds for new warning-only findings', async () => {
    const { target, baseline } = await files();
    await writeFile(baseline, '{"findings":[]}');
    await writeFile(target, JSON.stringify([{ name: 'read_data', description: 'Read.', inputSchema: {} }]));
    expect((await runCli([target, '--baseline', baseline, '--new-only'])).code).toBe(0);
    expect((await runCli([target, '--baseline', baseline, '--new-only', '--fail-on', 'warning'])).code).toBe(1);
  });
  it('rejects missing or malformed baselines and --new-only without a baseline', async () => {
    const { target, baseline } = await files();
    await writeFile(target, JSON.stringify([tool('read_clean')]));
    expect((await runCli([target, '--new-only'])).code).toBe(2);
    expect((await runCli([target, '--baseline', baseline])).code).toBe(2);
    for (const content of ['{', '{}', '{"findings":[{}]}']) {
      await writeFile(baseline, content);
      expect((await runCli([target, '--baseline', baseline])).code).toBe(2);
    }
  });
});
