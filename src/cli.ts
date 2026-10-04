#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { formatJson } from './format/json.js';
import { formatSarif } from './format/sarif.js';
import { formatText } from './format/text.js';
import { lintTools, locateTools } from './lint.js';
import { ConnectionError, DEFAULT_TIMEOUT_MS, describeTarget, loadTools, type Target } from './load.js';
import { applyPatch, formatPatch } from './patch.js';
import { rules } from './rules.js';
import type { LintResult, Severity } from './types.js';

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_CANNOT_RUN = 2;

type Format = 'text' | 'json' | 'sarif';
type FailOn = Severity | 'none';

const FORMATS: Format[] = ['text', 'json', 'sarif'];
const FAIL_ON: FailOn[] = ['error', 'warning', 'info', 'none'];

class UsageError extends Error {}

function usage(): string {
  return `mcp-tools-lint: lint MCP tool schemas and annotations before clients reject them

Usage
  mcp-tools-lint <tools.json> [options]
  mcp-tools-lint <http(s)://host/mcp> [options] [-H "Name: value"]...
  mcp-tools-lint [options] -- <command> [args...]       stdio server

Targets
  A JSON file holding a tools/list result ({"tools": [...]}, a bare array, or a
  full JSON-RPC response), a Streamable HTTP URL, or a stdio command after "--".

Options
  -f, --format <text|json|sarif>   output format (default: text)
  -o, --out <file>                 write the report to a file instead of stdout
      --fix                        write an RFC 6902 patch to <target>.patch.json (or --patch-out)
      --patch-out <file>           where --fix writes the patch
      --write                      apply the patch to a JSON file target in place (implies --fix)
      --fail-on <error|warning|info|none>
                                   lowest severity that exits 1 (default: error)
  -e, --env KEY=VALUE              extra environment for a stdio server (repeatable)
  -H, --header "Name: value"       extra HTTP header for a Streamable HTTP server (repeatable)
      --timeout <seconds>          initialize and tools/list timeout (default: ${DEFAULT_TIMEOUT_MS / 1000})
      --sarif-location <uri>       artifact URI used in SARIF results (default: the file target,
                                   or the first existing file among a stdio command's arguments)
      --rules                      list the rules and exit
  -v, --version                    print the version and exit
  -h, --help                       show this help

Exit codes
  0  no finding at or above --fail-on
  1  at least one finding at or above --fail-on
  2  the target could not be read or reached, or the arguments were invalid
`;
}

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function parseKeyValue(entries: string[], flag: string, separator: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const at = entry.indexOf(separator);
    if (at <= 0) throw new UsageError(`${flag} expects KEY${separator.trim()}VALUE, got ${JSON.stringify(entry)}`);
    out[entry.slice(0, at).trim()] = entry.slice(at + separator.length).trim();
  }
  return out;
}

function resolveTarget(positionals: string[], afterDashDash: string[]): Target {
  if (afterDashDash.length > 0) {
    if (positionals.length > 0) {
      throw new UsageError(`unexpected argument ${JSON.stringify(positionals[0])} before "--"`);
    }
    return { kind: 'stdio', command: afterDashDash[0] as string, args: afterDashDash.slice(1) };
  }
  if (positionals.length === 0) throw new UsageError('no target given');
  if (positionals.length > 1) {
    throw new UsageError(`unexpected argument ${JSON.stringify(positionals[1])}; put a stdio command after "--"`);
  }
  const target = positionals[0] as string;
  if (/^https?:\/\//i.test(target)) return { kind: 'http', url: target };
  return { kind: 'file', path: target };
}

function defaultPatchPath(target: Target): string {
  switch (target.kind) {
    case 'file':
      return `${target.path}.patch.json`;
    case 'http':
      return `${new URL(target.url).hostname}.patch.json`;
    case 'stdio': {
      const last = target.args.length > 0 ? (target.args[target.args.length - 1] as string) : target.command;
      return `${basename(last)}.patch.json`;
    }
  }
}

function toRepoUri(path: string): string {
  const rel = isAbsolute(path) ? relative(process.cwd(), path) : path;
  const normalised = rel.split('\\').join('/');
  return normalised.startsWith('..') ? path.split('\\').join('/') : normalised;
}

function defaultSarifLocation(target: Target): string {
  switch (target.kind) {
    case 'file':
      return toRepoUri(target.path);
    case 'http':
      return target.url;
    case 'stdio': {
      const file = target.args.find((a) => !a.startsWith('-') && existsSync(a));
      return file === undefined ? 'mcp-tools-lint' : toRepoUri(file);
    }
  }
}

function meetsThreshold(result: LintResult, failOn: FailOn): boolean {
  if (failOn === 'none') return false;
  const { errors, warnings, infos } = result.summary;
  if (failOn === 'error') return errors > 0;
  if (failOn === 'warning') return errors + warnings > 0;
  return errors + warnings + infos > 0;
}

function listRules(): string {
  const widest = Math.max(...rules.map((r) => r.id.length));
  return rules.map((r) => `${r.id.padEnd(widest)}  ${r.severity.padEnd(7)}  ${r.description}`).join('\n') + '\n';
}

const ARG_CONFIG = {
  allowPositionals: true,
  strict: true,
  tokens: true,
  options: {
    format: { type: 'string', short: 'f', default: 'text' },
    out: { type: 'string', short: 'o' },
    fix: { type: 'boolean', default: false },
    'patch-out': { type: 'string' },
    write: { type: 'boolean', default: false },
    'fail-on': { type: 'string', default: 'error' },
    env: { type: 'string', short: 'e', multiple: true },
    header: { type: 'string', short: 'H', multiple: true },
    timeout: { type: 'string' },
    'sarif-location': { type: 'string' },
    rules: { type: 'boolean', default: false },
    version: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
} as const satisfies ParseArgsConfig;

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<typeof ARG_CONFIG>>;
  try {
    parsed = parseArgs({ ...ARG_CONFIG, args: argv });
  } catch (error) {
    process.stderr.write(`mcp-tools-lint: ${(error as Error).message}\n\n${usage()}`);
    return EXIT_CANNOT_RUN;
  }

  const { values } = parsed;
  if (values.help) {
    process.stdout.write(usage());
    return EXIT_OK;
  }
  if (values.version) {
    process.stdout.write(`${await readVersion()}\n`);
    return EXIT_OK;
  }
  if (values.rules) {
    process.stdout.write(listRules());
    return EXIT_OK;
  }

  try {
    // Everything after "--" is the stdio command; parseArgs reports it as positionals
    // after an option-terminator token, so split on that token.
    const terminator = parsed.tokens.findIndex((t) => t.kind === 'option-terminator');
    const before: string[] = [];
    const after: string[] = [];
    parsed.tokens.forEach((t, i) => {
      if (t.kind !== 'positional') return;
      if (terminator !== -1 && i > terminator) after.push(t.value);
      else before.push(t.value);
    });
    const target = resolveTarget(before, after);

    const format = values.format;
    if (!FORMATS.includes(format as Format)) throw new UsageError(`--format must be one of ${FORMATS.join(', ')}`);
    const failOn = values['fail-on'];
    if (!FAIL_ON.includes(failOn as FailOn)) throw new UsageError(`--fail-on must be one of ${FAIL_ON.join(', ')}`);
    const timeoutMs = values.timeout === undefined ? DEFAULT_TIMEOUT_MS : Number(values.timeout) * 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new UsageError('--timeout must be a positive number of seconds');
    const write = values.write;
    const fix = values.fix || write;
    if (write && target.kind !== 'file') throw new UsageError('--write applies only to a JSON file target; use --fix for servers');
    const env = parseKeyValue(values.env ?? [], '-e', '=');
    const headers = parseKeyValue(values.header ?? [], '-H', ':');

    const doc = await loadTools(target, { env, headers, timeoutMs });
    const result = lintTools(doc, describeTarget(target));

    let report: string;
    if (format === 'json') report = formatJson(result);
    else if (format === 'sarif') {
      report = formatSarif(result, {
        toolVersion: await readVersion(),
        artifactUri: values['sarif-location'] ?? defaultSarifLocation(target),
      });
    } else report = formatText(result);

    if (values.out === undefined) process.stdout.write(report);
    else await writeFile(values.out, report, 'utf8');

    if (fix) {
      const patchPath = values['patch-out'] ?? defaultPatchPath(target);
      await writeFile(patchPath, formatPatch(result.patch), 'utf8');
      process.stderr.write(`wrote ${result.patch.length} patch operation${result.patch.length === 1 ? '' : 's'} to ${patchPath}\n`);
      if (write && target.kind === 'file') {
        const patched = applyPatch(doc.document, result.patch);
        await writeFile(target.path, JSON.stringify(patched, null, 2) + '\n', 'utf8');
        process.stderr.write(`applied the patch to ${target.path}\n`);
      }
    }

    return meetsThreshold(result, failOn as FailOn) ? EXIT_FINDINGS : EXIT_OK;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`mcp-tools-lint: ${error.message}\n\n${usage()}`);
      return EXIT_CANNOT_RUN;
    }
    if (error instanceof ConnectionError) {
      process.stderr.write(`mcp-tools-lint: ${error.message}\n`);
      return EXIT_CANNOT_RUN;
    }
    process.stderr.write(`mcp-tools-lint: unexpected error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    return EXIT_CANNOT_RUN;
  }
}

// Re-exported for tests that want to lint an in-memory document without a process.
export { lintTools, locateTools };

function invokedDirectly(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    // An installed bin (npm i, npx) is a symlink under node_modules/.bin, so compare real paths.
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly() || process.env.MCP_TOOLS_LINT_MAIN === '1') {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`mcp-tools-lint: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = EXIT_CANNOT_RUN;
    },
  );
}
