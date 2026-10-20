import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, parseReport, runCli, serverScript, toolsFile } from './helpers.js';

let server: ChildProcess;
let port = 0;

beforeAll(async () => {
  server = spawn(process.execPath, [serverScript('http'), '0', 'draft07'], { stdio: ['ignore', 'pipe', 'pipe'] });
  port = await new Promise<number>((resolve, reject) => {
    let out = '';
    server.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf8');
      const m = /listening (\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    server.on('exit', (code) => reject(new Error(`fixture exited with ${code}`)));
  });
});

afterAll(() => {
  server.kill();
});

describe('Streamable HTTP target', () => {
  it('lints a Streamable HTTP server with -H headers', async () => {
    const run = await runCli([`http://127.0.0.1:${port}/mcp`, '-H', 'X-Fixture-Token: ok', '--format', 'json']);
    expect(run.stderr).toBe('');
    expect(run.code).toBe(1);
    const report = parseReport(run.stdout);
    expect(report.target).toBe(`http://127.0.0.1:${port}/mcp`);
    expect(report.tools).toBe(2);
    expect(report.summary).toEqual({ errors: 5, warnings: 0, infos: 0 });
    expect(report.patch).toHaveLength(5);
  });

  it('exits 2 when the server rejects the request', async () => {
    const run = await runCli([`http://127.0.0.1:${port}/mcp`, '--timeout', '5']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('cannot list tools');
  });

  it('exits 2 when nothing is listening', async () => {
    const run = await runCli(['http://127.0.0.1:1/mcp', '--timeout', '5']);
    expect(run.code).toBe(2);
  });

  it('uses the URL as the SARIF location by default', async () => {
    const run = await runCli([`http://127.0.0.1:${port}/mcp`, '-H', 'X-Fixture-Token: ok', '--format', 'sarif']);
    const sarif = JSON.parse(run.stdout);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(`http://127.0.0.1:${port}/mcp`);
  });
});

describe('legacy HTTP+SSE target', () => {
  let sse: ChildProcess;
  let ssePort = 0;

  beforeAll(async () => {
    sse = spawn(process.execPath, [serverScript('sse'), '0', 'draft07'], { stdio: ['ignore', 'pipe', 'pipe'] });
    ssePort = await new Promise<number>((resolve, reject) => {
      let out = '';
      sse.stdout?.on('data', (d: Buffer) => {
        out += d.toString('utf8');
        const m = /listening (\d+)/.exec(out);
        if (m) resolve(Number(m[1]));
      });
      sse.on('exit', (code) => reject(new Error(`fixture exited with ${code}`)));
    });
  });

  afterAll(() => {
    sse.kill();
  });

  it('lints an SSE server with --transport sse, sending -H on the stream and the posts', async () => {
    const url = `http://127.0.0.1:${ssePort}/sse`;
    const run = await runCli([url, '--transport', 'sse', '-H', 'X-Fixture-Token: ok', '--format', 'json']);
    expect(run.code).toBe(1);
    const report = parseReport(run.stdout);
    expect(report.target).toBe(url);
    expect(report.tools).toBe(2);
    expect(report.summary).toEqual({ errors: 5, warnings: 0, infos: 0 });
  });

  it('identifies itself with the package version', async () => {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    const seen = await (await fetch(`http://127.0.0.1:${ssePort}/client`)).json();
    expect(seen).toEqual({ name: 'mcp-tools-lint', version: pkg.version });
  });

  it('exits 2 when the SSE server rejects the stream', async () => {
    const run = await runCli([`http://127.0.0.1:${ssePort}/sse`, '--transport', 'sse', '--timeout', '5']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('cannot list tools');
  });
});

describe('--transport usage', () => {
  it('rejects unknown values and non-HTTP targets', async () => {
    const bad = await runCli(['http://127.0.0.1:1/mcp', '--transport', 'websocket']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('--transport must be one of streamable-http, sse');
    const file = await runCli([toolsFile('clean'), '--transport', 'sse']);
    expect(file.code).toBe(2);
    expect(file.stderr).toContain('--transport applies only to an http(s) URL target');
  });
});
