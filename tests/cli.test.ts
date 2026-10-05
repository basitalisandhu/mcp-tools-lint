import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLI, expectedPatch, parseReport, runCli, serverScript, tempCopy, toolsFile } from './helpers.js';

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

interface Expectation {
  tools: number;
  exit: number;
  summary: { errors: number; warnings: number; infos: number };
  rules: Record<string, number>;
}

const FIXTURES: Record<string, Expectation> = {
  draft07: { tools: 2, exit: 1, summary: { errors: 5, warnings: 0, infos: 0 }, rules: { 'dialect-2020-12': 5 } },
  boolean: {
    tools: 3,
    exit: 1,
    summary: { errors: 4, warnings: 5, infos: 1 },
    rules: {
      'no-boolean-schema': 2,
      'required-names-property': 1,
      'unsupported-keyword': 3,
      'readonly-verb-contradiction': 1,
      'missing-annotations': 1,
      'destructive-without-hint': 1,
      'description-missing': 1,
    },
  },
  snake: { tools: 2, exit: 1, summary: { errors: 6, warnings: 0, infos: 0 }, rules: { 'snake-case-annotation-keys': 6 } },
  clean: { tools: 2, exit: 0, summary: { errors: 0, warnings: 0, infos: 0 }, rules: {} },
};

function countRules(findings: { ruleId: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.ruleId] = (out[f.ruleId] ?? 0) + 1;
  return out;
}

describe.each(Object.entries(FIXTURES))('fixture %s', (name, expected) => {
  it('lints the JSON file: findings, summary and exit code', async () => {
    const run = await runCli([toolsFile(name), '--format', 'json']);
    expect(run.stderr).toBe('');
    expect(run.code).toBe(expected.exit);
    const report = parseReport(run.stdout);
    expect(report.tools).toBe(expected.tools);
    expect(report.summary).toEqual(expected.summary);
    expect(countRules(report.findings)).toEqual(expected.rules);
  });

  it('lints the stdio server and sees exactly what the file lint sees', async () => {
    const [fromServer, fromFile] = await Promise.all([
      runCli(['--format', 'json', '--', process.execPath, serverScript(name)]),
      runCli([toolsFile(name), '--format', 'json']),
    ]);
    expect(fromServer.code).toBe(expected.exit);
    const a = parseReport(fromServer.stdout);
    const b = parseReport(fromFile.stdout);
    expect(a.findings).toEqual(b.findings);
    expect(a.patch).toEqual(b.patch);
    expect(a.target).toContain(`${name}.mjs`);
  });

  it('writes the expected patch byte for byte with --fix', async () => {
    const copy = await tempCopy(name);
    tempDirs.push(copy.dir);
    const run = await runCli([copy.file, '--fix']);
    expect(run.code).toBe(expected.exit);
    const written = await readFile(`${copy.file}.patch.json`, 'utf8');
    expect(written).toBe(await expectedPatch(name));
    expect(run.stderr).toContain(`.patch.json`);
  });

  it('writes the same patch for the stdio server to --patch-out', async () => {
    const copy = await tempCopy(name);
    tempDirs.push(copy.dir);
    const out = join(copy.dir, 'server.patch.json');
    const run = await runCli(['--fix', '--patch-out', out, '--format', 'json', '--', process.execPath, serverScript(name)]);
    expect(run.code).toBe(expected.exit);
    expect(await readFile(out, 'utf8')).toBe(await expectedPatch(name));
  });
});

describe('--write', () => {
  it.each(['draft07', 'snake'])('applies the patch to %s in place so a second run is clean', async (name) => {
    const copy = await tempCopy(name);
    tempDirs.push(copy.dir);
    const first = await runCli([copy.file, '--write', '--format', 'json']);
    expect(first.code).toBe(1);
    expect(first.stderr).toContain('applied the patch');
    const second = await runCli([copy.file, '--format', 'json']);
    expect(second.code).toBe(0);
    expect(parseReport(second.stdout).findings).toEqual([]);
    const text = await readFile(copy.file, 'utf8');
    expect(text).not.toContain('draft-07');
    expect(text).not.toContain('_hint');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('leaves a file alone when nothing is fixable but still writes an empty patch', async () => {
    const copy = await tempCopy('boolean');
    tempDirs.push(copy.dir);
    const before = await readFile(copy.file, 'utf8');
    const run = await runCli([copy.file, '--write']);
    expect(run.code).toBe(1);
    expect(await readFile(`${copy.file}.patch.json`, 'utf8')).toBe('[]\n');
    expect(JSON.parse(await readFile(copy.file, 'utf8'))).toEqual(JSON.parse(before));
  });

  it('refuses --write for a server target', async () => {
    const run = await runCli(['--write', '--', process.execPath, serverScript('clean')]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--write applies only to a JSON file target');
  });
});

describe('--ignore-rule', () => {
  it('removes findings and fixes from the draft-07 stdio fixture', async () => {
    const copy = await tempCopy('draft07');
    tempDirs.push(copy.dir);
    const patch = join(copy.dir, 'ignored.patch.json');
    const run = await runCli(['--ignore-rule', 'dialect-2020-12', '--fix', '--patch-out', patch, '--format', 'json', '--', process.execPath, serverScript('draft07')]);
    expect(run.code).toBe(0);
    expect(parseReport(run.stdout).findings).toEqual([]);
    expect(parseReport(run.stdout).patch).toEqual([]);
    expect(await readFile(patch, 'utf8')).toBe('[]\n');
  });

  it('rejects unknown rule IDs before reading a target', async () => {
    const run = await runCli(['missing.json', '--ignore-rule', 'not-a-rule']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('unknown rule');
    expect(run.stderr).toContain('dialect-2020-12');
    expect(run.stderr).toContain('description-missing');
  });

  it('accepts repeated flags and keeps disabled descriptors in SARIF', async () => {
    const run = await runCli([toolsFile('boolean'), '--ignore-rule', 'description-missing', '--ignore-rule', 'missing-annotations', '--format', 'sarif']);
    expect(run.code).toBe(1);
    const sarif = JSON.parse(run.stdout);
    const rules = sarif.runs[0].tool.driver.rules;
    expect(rules).toHaveLength(9);
    for (const id of ['description-missing', 'missing-annotations']) {
      expect(rules.find((r: { id: string }) => r.id === id).defaultConfiguration.enabled).toBe(false);
      expect(sarif.runs[0].results.some((r: { ruleId: string }) => r.ruleId === id)).toBe(false);
    }
    expect(sarif.runs[0].results.length).toBe(8);
  });
});

describe('text output', () => {
  it('groups findings by tool and ends with a summary line', async () => {
    const run = await runCli([toolsFile('boolean')]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('tests/fixtures/tools/boolean.json: 3 tools');
    expect(run.stdout).toContain('\n  search_docs\n');
    expect(run.stdout).toContain('\n  delete_doc\n');
    expect(run.stdout).toContain('at /tools/0/inputSchema/properties/filters');
    expect(run.stdout.trimEnd().split('\n').at(-1)).toBe('4 errors, 5 warnings, 1 info');
  });

  it('says so when there is nothing to report', async () => {
    const run = await runCli([toolsFile('clean')]);
    expect(run.code).toBe(0);
    expect(run.stdout.trimEnd().split('\n').at(-1)).toBe('No problems found.');
  });

  it('is identical across runs', async () => {
    const [a, b] = await Promise.all([runCli([toolsFile('snake')]), runCli([toolsFile('snake')])]);
    expect(a.stdout).toBe(b.stdout);
  });
});

describe('SARIF output', () => {
  it('is SARIF 2.1.0 with one rule per id and one result per finding', async () => {
    const run = await runCli([toolsFile('boolean'), '--format', 'sarif']);
    expect(run.code).toBe(1);
    const sarif = JSON.parse(run.stdout);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-2.1.0');
    const driver = sarif.runs[0].tool.driver;
    expect(driver.name).toBe('mcp-tools-lint');
    expect(driver.rules.map((r: { id: string }) => r.id)).toHaveLength(9);
    expect(new Set(driver.rules.map((r: { id: string }) => r.id)).size).toBe(9);
    const results = sarif.runs[0].results;
    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(['error', 'warning', 'note']).toContain(result.level);
      expect(driver.rules[result.ruleIndex].id).toBe(result.ruleId);
      expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe('tests/fixtures/tools/boolean.json');
      expect(result.locations[0].logicalLocations[0].fullyQualifiedName).toMatch(/^\/tools\/\d/);
      expect(result.partialFingerprints['mcpToolsLint/v1']).toMatch(/^[0-9a-f]{32}$/);
    }
    const levels = results.map((r: { level: string }) => r.level).sort();
    expect(levels.filter((l: string) => l === 'error')).toHaveLength(4);
    expect(levels.filter((l: string) => l === 'note')).toHaveLength(1);
  });

  it('carries fixes for fixable findings and honours --sarif-location and --out', async () => {
    const copy = await tempCopy('draft07');
    tempDirs.push(copy.dir);
    const out = join(copy.dir, 'report.sarif');
    const run = await runCli([copy.file, '--format', 'sarif', '--out', out, '--sarif-location', 'src/server.ts']);
    expect(run.code).toBe(1);
    expect(run.stdout).toBe('');
    const sarif = JSON.parse(await readFile(out, 'utf8'));
    expect(sarif.runs[0].results[0].fixes[0].description.text).toContain('"op":"remove"');
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe('src/server.ts');
    expect(sarif.runs[0].artifacts[0].location.uri).toBe('src/server.ts');
  });
});

describe('exit codes and arguments', () => {
  it('exits 2 when the file is missing, not JSON, or has no tools array', async () => {
    const missing = await runCli(['/nonexistent/tools.json']);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('cannot read');
    const copy = await tempCopy('clean');
    tempDirs.push(copy.dir);
    const notJson = join(copy.dir, 'bad.json');
    await (await import('node:fs/promises')).writeFile(notJson, '{not json');
    expect((await runCli([notJson])).code).toBe(2);
    const noTools = join(copy.dir, 'notools.json');
    await (await import('node:fs/promises')).writeFile(noTools, '{"result": {}}');
    const run = await runCli([noTools]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('expected a JSON array of tools');
  });

  it('exits 2 when the stdio server cannot be started or dies, and shows its stderr', async () => {
    const run = await runCli(['--timeout', '5', '--', process.execPath, serverScript('env')]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('cannot list tools');
    expect(run.stderr).toContain('FIXTURE_TOKEN is not set');
    const nonexistent = await runCli(['--timeout', '5', '--', '/nonexistent/mcp-server-binary']);
    expect(nonexistent.code).toBe(2);
  });

  it('passes -e KEY=VALUE to the server environment', async () => {
    const run = await runCli(['-e', 'FIXTURE_TOKEN=ok', '--format', 'json', '--', process.execPath, serverScript('env')]);
    expect(run.code).toBe(0);
    expect(parseReport(run.stdout).tools).toBe(2);
  });

  it('follows nextCursor pagination', async () => {
    const run = await runCli(['--format', 'json', '--', process.execPath, serverScript('paged')]);
    expect(run.code).toBe(0);
    expect(parseReport(run.stdout).tools).toBe(2);
  });

  it('exits 2 on usage errors', async () => {
    expect((await runCli([])).code).toBe(2);
    expect((await runCli([toolsFile('clean'), '--format', 'xml'])).code).toBe(2);
    expect((await runCli([toolsFile('clean'), '--bogus'])).code).toBe(2);
    expect((await runCli([toolsFile('clean'), '-e', 'NOEQUALS'])).code).toBe(2);
    expect((await runCli([toolsFile('clean'), toolsFile('clean')])).code).toBe(2);
    expect((await runCli([toolsFile('clean'), '--timeout', '0'])).code).toBe(2);
  });

  it('--fail-on raises or lowers the threshold', async () => {
    expect((await runCli([toolsFile('boolean'), '--fail-on', 'none'])).code).toBe(0);
    const warnOnly = await tempCopy('boolean');
    tempDirs.push(warnOnly.dir);
    expect((await runCli([toolsFile('draft07'), '--fail-on', 'none'])).code).toBe(0);
    expect((await runCli([toolsFile('clean'), '--fail-on', 'info'])).code).toBe(0);
  });

  it('prints help, version and the rule list', async () => {
    const help = await runCli(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage');
    const version = await runCli(['--version']);
    expect(version.code).toBe(0);
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    expect(version.stdout.trim()).toBe(pkg.version);
    const rulesRun = await runCli(['--rules']);
    expect(rulesRun.stdout.trim().split('\n')).toHaveLength(9);
  });

  it('runs when started through a symlinked bin, as after npm install', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mtl-bin-'));
    tempDirs.push(dir);
    const link = join(dir, 'mcp-tools-lint');
    await symlink(CLI, link);
    const run = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    expect(run.stdout.trim()).toBe(pkg.version);
  });

  it('does not leave a patch file behind unless asked', async () => {
    const copy = await tempCopy('draft07');
    tempDirs.push(copy.dir);
    await runCli([copy.file]);
    await expect(stat(`${copy.file}.patch.json`)).rejects.toThrow();
  });
});
