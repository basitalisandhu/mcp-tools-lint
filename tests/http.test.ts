import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseReport, runCli, serverScript } from './helpers.js';

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
