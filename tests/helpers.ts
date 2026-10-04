import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const CLI = join(ROOT, 'dist', 'cli.js');
export const FIXTURES = join(ROOT, 'tests', 'fixtures');

export function toolsFile(name: string): string {
  return join(FIXTURES, 'tools', `${name}.json`);
}

export function serverScript(name: string): string {
  return join(FIXTURES, 'servers', `${name}.mjs`);
}

export async function expectedPatch(name: string): Promise<string> {
  return readFile(join(FIXTURES, 'expected', `${name}.patch.json`), 'utf8');
}

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCli(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}): Promise<CliRun> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });
}

/** Copy a fixture tools file into a fresh temporary directory and return its path. */
export async function tempCopy(name: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-tools-lint-'));
  const file = join(dir, `${name}.json`);
  await copyFile(toolsFile(name), file);
  return { dir, file };
}

export interface JsonReportShape {
  version: number;
  target: string;
  tools: number;
  summary: { errors: number; warnings: number; infos: number };
  findings: { ruleId: string; severity: string; tool: string; pointer: string; message: string; fix?: unknown[] }[];
  patch: unknown[];
}

export function parseReport(stdout: string): JsonReportShape {
  return JSON.parse(stdout) as JsonReportShape;
}
