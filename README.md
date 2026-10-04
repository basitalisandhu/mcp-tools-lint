# mcp-tools-lint

Lint MCP tool schemas and annotations before clients reject them. Point it at a running MCP server (stdio or Streamable HTTP) or at a saved `tools/list` result, and it checks every tool against what Claude Code and other strict clients accept: JSON Schema 2020-12 only, no boolean schemas, `required` names that exist, and annotations that are present, camelCase and not self-contradictory. It prints text, JSON or SARIF, writes an RFC 6902 patch for the fixable findings, and ships as a GitHub Action.

Built alongside [Masoon](https://github.com/basitalisandhu/masoon), open-source trust infrastructure for AI agents, and [dev-mcp-servers](https://github.com/basitalisandhu/dev-mcp-servers).

[![CI](https://github.com/basitalisandhu/mcp-tools-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/basitalisandhu/mcp-tools-lint/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-20%2B-blue.svg)](package.json)

## Why now

The MCP specification defines `inputSchema` and `outputSchema` as JSON Schema 2020-12, and the 2026-07-28 revision of the spec widened them to allow any 2020-12 keyword. Claude Code enforces that dialect: its default validator compiles 2020-12 only, so a tool whose schema carries `"$schema": "http://json-schema.org/draft-07/schema#"` is listed without complaint and then fails on every call with `JSON Schema declares an unsupported dialect`.

That `$schema` line is what the TypeScript SDK's `McpServer` writes by default. The SDK converts zod schemas with `toJsonSchemaCompat` and no target, which falls back to `draft-7` (verified against `@modelcontextprotocol/sdk` 1.32.0 on 2026-10-03, for zod v3 and zod v4 schemas, on both `inputSchema` and `outputSchema`). The reference filesystem server was unusable from Claude Code for this reason ([anthropics/claude-code#88882](https://github.com/anthropics/claude-code/issues/88882), opened 2026-08-22 and open as of 2026-10-03), and the same bug was then filed against one downstream server after another in the following weeks, for example [whoop-mcp#251](https://github.com/shashankswe2020-ux/whoop-mcp/issues/251) (which quotes the client error and was fixed by dropping the dialect declaration), [vikunja-mcp#3](https://github.com/aimbitgmbh/vikunja-mcp/issues/3) and [IBM/ibmi-mcp-server#165](https://github.com/IBM/ibmi-mcp-server/issues/165). This linter catches that in CI, before a user does.

Annotations are the second half. The MCP blog's post on tool annotations says coverage is uneven and many servers ship without them; clients that gate on `readOnlyHint` then prompt on every call, and a tool that says `readOnlyHint: true` while being called `delete_record` teaches users to click through prompts. A separate class of bug comes from servers that emit `read_only_hint` in snake_case, as the Python SDK 2.x does: clients read `readOnlyHint`, so every such tool is treated as write-capable ([hermes-agent#123485](https://github.com/NousResearch/hermes-agent/issues/123485)).

## What it catches

| Rule | Severity | What it means | `--fix` |
|---|---|---|---|
| `dialect-2020-12` | error | A `$schema` anywhere in `inputSchema` or `outputSchema` is not `https://json-schema.org/draft/2020-12/schema` (a trailing `#` is accepted). | removes the `$schema` key |
| `no-boolean-schema` | error | `true` or `false` sits where a schema object is expected: a `properties` entry, `items`, an `allOf`/`anyOf`/`oneOf` entry, `$defs`, `not`, `if`/`then`/`else`, the root. Booleans under `additionalProperties`, `additionalItems`, `unevaluatedProperties` and `unevaluatedItems` are allowed. | no: replace `true` with `{}` and `false` with `{"not": {}}` |
| `required-names-property` | error | A `required` entry names a key that `properties` does not define on the same object schema. Schemas that compose others (`allOf`, `$ref` and so on) are skipped. | no: add the property or drop the entry |
| `unsupported-keyword` | warning | `$id` with a fragment, `definitions` instead of `$defs`, or a boolean `required` (draft-03 style). | no: use `$anchor`, `$defs`, an array `required` |
| `missing-annotations` | warning | The tool has no `annotations` object. | no: add the four hints truthfully |
| `readonly-verb-contradiction` | error | `readOnlyHint` is `true` but the name or title starts with `create`, `add`, `insert`, `update`, `set`, `put`, `patch`, `delete`, `remove`, `drop`, `send`, `post`, `publish`, `write`, `execute`, `run`, `deploy`, `move` or `rename` followed by `_` or `-`. | no: set `readOnlyHint: false` |
| `destructive-without-hint` | warning | The name starts with `delete`, `remove` or `drop` and `destructiveHint` is not declared. | no: declare `destructiveHint` |
| `snake-case-annotation-keys` | error | `annotations` contains `read_only_hint`, `destructive_hint`, `idempotent_hint` or `open_world_hint`. | renames to camelCase (or removes the duplicate when the camelCase key already exists) |
| `description-missing` | info | The tool has no description. | no |

`mcp-tools-lint --rules` prints the same list. Rules are pure functions `(tool) => Finding[]` in [`src/rules.ts`](src/rules.ts); the verb lists are deliberately short to keep false positives down.

## Install

Requires Node.js 20 or newer. The only runtime dependencies are `@modelcontextprotocol/sdk` and its peer `zod`.

Every release is published by `publish-github-packages.yml` in two places on GitHub Packages: the npm package `@basitalisandhu/mcp-tools-lint` and the container image `ghcr.io/basitalisandhu/mcp-tools-lint`. The package is not on npmjs.com yet; when it is, it will use the same scoped name.

### npm from GitHub Packages

Point the `@basitalisandhu` scope at GitHub Packages in `~/.npmrc` (or the project's `.npmrc`):

```
@basitalisandhu:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

GitHub's npm registry asks for a token even to install public packages. That is a GitHub limitation, not a setting of this repository: use a personal access token (classic) with the `read:packages` scope, exported as `GITHUB_TOKEN`. Then:

```bash
npx @basitalisandhu/mcp-tools-lint --help              # run without installing
npm install -g @basitalisandhu/mcp-tools-lint@0.1.0    # global CLI, installs the mcp-tools-lint command
npm install -D @basitalisandhu/mcp-tools-lint@0.1.0    # as a dev dependency of a server project
```

### Container image

The image is built for `linux/amd64` and `linux/arm64`, runs as the non-root `node` user, and is tagged with the version and `latest`; pin the version. The working directory is `/work`, so mount the files to lint there:

```bash
docker run --rm -v "$PWD:/work:ro" ghcr.io/basitalisandhu/mcp-tools-lint:0.1.0 tools.json
docker run --rm ghcr.io/basitalisandhu/mcp-tools-lint:0.1.0 https://mcp.example.com/mcp -H "Authorization: Bearer $TOKEN"
```

A stdio target runs inside the container, so it only works for a server command the image can start (Node.js is available; mount the server's files). To write a SARIF file or a patch, mount `/work` read-write.

The image is signed with cosign (keyless) and carries a build provenance attestation; an SPDX SBOM is attached to the GitHub release. To check it before running it:

```bash
cosign verify ghcr.io/basitalisandhu/mcp-tools-lint:0.1.0 \
  --certificate-identity-regexp '^https://github.com/basitalisandhu/mcp-tools-lint/\.github/workflows/publish-github-packages\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/basitalisandhu/mcp-tools-lint:0.1.0 --owner basitalisandhu
```

To build the image from a checkout: `docker build -t mcp-tools-lint .`

### From a clone

```bash
git clone https://github.com/basitalisandhu/mcp-tools-lint && cd mcp-tools-lint
npm install && npm run build
node dist/cli.js --help            # or `npm link`, which puts `mcp-tools-lint` on your PATH
```

## Usage

Three kinds of target:

```bash
# 1. A stdio server: everything after "--" is the command. -e adds to its environment.
npx @basitalisandhu/mcp-tools-lint -- node dist/index.js
npx @basitalisandhu/mcp-tools-lint -e GITHUB_TOKEN=ghp_xxx -- npx -y @modelcontextprotocol/server-github

# 2. A Streamable HTTP server. -H adds request headers.
npx @basitalisandhu/mcp-tools-lint https://mcp.example.com/mcp -H "Authorization: Bearer $TOKEN"

# 3. A JSON file holding a tools/list result ({"tools": [...]}, a bare array,
#    or a whole JSON-RPC response with result.tools).
npx @basitalisandhu/mcp-tools-lint tools.json
```

Options go before the target; everything after `--` belongs to the server command. The tool calls `initialize` and `tools/list` (following `nextCursor`) with a 20 second timeout (`--timeout <seconds>`), and never calls a tool. It reads the raw `tools/list` payload rather than the SDK's parsed version, because the SDK's own parser would reject a boolean property schema and silently drop snake_case annotation keys, which are exactly the things to report.

Options: `--format text|json|sarif`, `--out <file>`, `--fix`, `--patch-out <file>`, `--write`, `--fail-on error|warning|info|none` (default `error`), `--sarif-location <uri>`, `--rules`, `--version`.

### Example output

Against a server built with the TypeScript SDK's defaults ([`tests/fixtures/tools/draft07.json`](tests/fixtures/tools/draft07.json)):

```text
$ npx @basitalisandhu/mcp-tools-lint -- node tests/fixtures/servers/draft07.mjs
node tests/fixtures/servers/draft07.mjs: 2 tools

  read_file
    error    dialect-2020-12  inputSchema declares dialect "http://json-schema.org/draft-07/schema#"; the default validator in Claude Code supports JSON Schema 2020-12 only  [fixable]
                              at /tools/0/inputSchema/$schema
    error    dialect-2020-12  inputSchema declares dialect "http://json-schema.org/draft-07/schema#"; the default validator in Claude Code supports JSON Schema 2020-12 only  [fixable]
                              at /tools/0/inputSchema/properties/options/$schema
    error    dialect-2020-12  outputSchema declares dialect "http://json-schema.org/draft-07/schema#"; the default validator in Claude Code supports JSON Schema 2020-12 only  [fixable]
                              at /tools/0/outputSchema/$schema

  write_file
    error    dialect-2020-12  inputSchema declares dialect "http://json-schema.org/draft-07/schema#"; the default validator in Claude Code supports JSON Schema 2020-12 only  [fixable]
                              at /tools/1/inputSchema/$schema
    error    dialect-2020-12  outputSchema declares dialect "http://json-schema.org/draft-07/schema#"; the default validator in Claude Code supports JSON Schema 2020-12 only  [fixable]
                              at /tools/1/outputSchema/$schema

5 errors, 0 warnings, 0 infos (5 fixable with --fix)
```

Against a server with schema and annotation mistakes ([`tests/fixtures/tools/boolean.json`](tests/fixtures/tools/boolean.json)):

```text
$ npx @basitalisandhu/mcp-tools-lint tests/fixtures/tools/boolean.json
tests/fixtures/tools/boolean.json: 3 tools

  search_docs
    error    no-boolean-schema        boolean schema true where an object schema is expected (under properties); clients that compile tool schemas reject it
                                      at /tools/0/inputSchema/properties/filters
    error    no-boolean-schema        boolean schema true where an object schema is expected (under items); clients that compile tool schemas reject it
                                      at /tools/0/inputSchema/properties/tags/items
    error    required-names-property  required lists "limit" but properties has no "limit"
                                      at /tools/0/inputSchema/required/1
    warning  unsupported-keyword      definitions is a draft-07 keyword; 2020-12 uses $defs
                                      at /tools/0/inputSchema/definitions

  update_doc
    error    readonly-verb-contradiction  readOnlyHint is true but "update_doc" starts with a write verb
                                          at /tools/1/annotations/readOnlyHint
    warning  unsupported-keyword          $id "https://example.com/schemas/update-doc#body" contains a fragment; 2020-12 forbids fragments in $id (use $anchor)
                                          at /tools/1/inputSchema/$id
    warning  unsupported-keyword          required: true is draft-03 syntax; 2020-12 expects an array of property names on the parent object
                                          at /tools/1/inputSchema/properties/id/required

  delete_doc
    warning  missing-annotations       no annotations; clients that gate on readOnlyHint will treat this tool as write-capable
                                       at /tools/2/annotations
    warning  destructive-without-hint  "delete_doc" looks destructive but declares no destructiveHint
                                       at /tools/2/annotations
    info     description-missing       no description
                                       at /tools/2/description

4 errors, 5 warnings, 1 info
```

A clean server prints the tool count and `No problems found.` and exits 0.

### `--fix` and `--write`

`--fix` writes `<target>.patch.json` (or `--patch-out <file>`), an [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) JSON Patch against the tools/list document that removes every offending `$schema` and renames snake_case annotation keys. Paths are JSON Pointers into `{"tools": [...]}` (or into the array, or into `result.tools`, matching the shape of a file target). For a server built with the Python SDK 2.x conventions ([`tests/fixtures/tools/snake.json`](tests/fixtures/tools/snake.json)):

```text
$ npx @basitalisandhu/mcp-tools-lint tests/fixtures/tools/snake.json --fix
...
6 errors, 0 warnings, 0 infos (6 fixable with --fix)
wrote 6 patch operations to tests/fixtures/tools/snake.json.patch.json
```

```json
[
  {
    "op": "move",
    "from": "/tools/0/annotations/read_only_hint",
    "path": "/tools/0/annotations/readOnlyHint"
  },
  {
    "op": "move",
    "from": "/tools/0/annotations/destructive_hint",
    "path": "/tools/0/annotations/destructiveHint"
  },
  ...
  {
    "op": "remove",
    "path": "/tools/1/annotations/read_only_hint"
  }
]
```

`--write` applies the patch to a JSON file target in place (it rewrites the file with two-space indentation); a second run then reports nothing. For a live server the patch tells you what to change in the server's source: delete the `$schema` keys from the schemas you register, or, with the TypeScript SDK, strip them before returning from your `tools/list` handler. The patch files for all four fixture servers are committed under [`tests/fixtures/expected/`](tests/fixtures/expected/) and tested byte for byte.

### JSON output

```bash
npx @basitalisandhu/mcp-tools-lint tools.json --format json
```

```json
{
  "version": 1,
  "target": "tests/fixtures/tools/snake.json",
  "tools": 2,
  "summary": { "errors": 6, "warnings": 0, "infos": 0 },
  "findings": [
    {
      "ruleId": "snake-case-annotation-keys",
      "severity": "error",
      "path": "/annotations/read_only_hint",
      "message": "annotations uses read_only_hint; clients read readOnlyHint and ignore this key",
      "fix": [{ "op": "move", "from": "/annotations/read_only_hint", "path": "/annotations/readOnlyHint" }],
      "tool": "get_sleep",
      "toolIndex": 0,
      "pointer": "/tools/0/annotations/read_only_hint"
    }
  ],
  "patch": [ ... ]
}
```

`path` is relative to the tool; `pointer` is relative to the document and is what the patch uses.

### SARIF and GitHub code scanning

```bash
npx @basitalisandhu/mcp-tools-lint --format sarif --out mcp-tools-lint.sarif --sarif-location src/index.ts -- node dist/index.js
```

The output is SARIF 2.1.0 with one `reportingDescriptor` per rule id, `error`, `warning` and `note` levels, a stable `partialFingerprints` entry per finding, and the RFC 6902 operation attached as a `fix` description where one exists. Each result carries a physical location (the file target, the first existing file among a stdio command's arguments, or whatever `--sarif-location` names) so GitHub code scanning shows it as an alert, plus a logical location with the tool name and the JSON Pointer.

### GitHub Action

```yaml
name: mcp-tools-lint
on: [push, pull_request]
permissions:
  contents: read
  security-events: write
jobs:
  lint-tools:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci && npm run build
      - uses: basitalisandhu/mcp-tools-lint/action@v0.1.0   # pin a release tag
        with:
          command: node dist/index.js        # or target: tools.json / https://host/mcp
          sarif-location: src/index.ts
          fail-on: error                     # error | warning | info | none
          env: |
            API_TOKEN=${{ secrets.API_TOKEN }}
```

Inputs: `target`, `command`, `env`, `headers`, `sarif-file`, `sarif-location`, `fail-on`, `upload` (set `false` to skip the code scanning upload), `patch-file`, `timeout`, `node-version`, `version` (version of `@basitalisandhu/mcp-tools-lint` to install from GitHub Packages; empty builds the action's own checkout), `token` (used for that install; defaults to the workflow token, which must be able to read packages). Outputs: `sarif-file`, `exit-code`, `errors`, `warnings`. The job summary gets the text report. See [action/action.yml](action/action.yml).

### Exit codes

| Code | Meaning |
|---|---|
| 0 | No finding at or above `--fail-on` (default: no errors). |
| 1 | At least one finding at or above `--fail-on`. |
| 2 | The target could not be read or reached (file missing or not JSON, server failed to start, connection or timeout), or the arguments were invalid. The server's stderr is included in the message. |

### As a library

```ts
import { lintTools, locateTools, applyPatch, checkTool } from '@basitalisandhu/mcp-tools-lint';

const doc = locateTools(JSON.parse(text));       // {"tools": [...]}, an array, or a JSON-RPC response
const result = lintTools(doc, 'tools.json');     // { findings, patch, summary, tools }
const fixed = applyPatch(doc.document, result.patch);
const findings = checkTool(tool);                // one tool, no I/O
```

## Frequently asked questions

**Why does Claude Code reject my MCP server's tools with "unsupported dialect" when the Inspector shows them fine?**
Claude Code compiles a tool's `outputSchema` with a JSON Schema 2020-12 validator, and the error is raised at call time, not at `tools/list`, so the Inspector's listing and even a successful `tools/list` prove nothing. The usual cause is a `"$schema": "http://json-schema.org/draft-07/schema#"` key that the TypeScript SDK adds when it converts zod schemas, and the fix is to delete it: the MCP specification already fixes the dialect at 2020-12, so the key carries no information. `mcp-tools-lint -- <your server command>` finds every such key, including nested ones, and `--fix` writes the patch.

**Which JSON Schema keywords can I use in an MCP tool's inputSchema?**
Since the 2026-07-28 revision of the specification, any JSON Schema 2020-12 keyword, with the root required to be `type: object`. What to avoid is the older dialect's spelling: `definitions` (use `$defs`), a fragment in `$id` (use `$anchor`), a boolean `required` on a property (use the array form on the parent), and `true` or `false` where a schema object belongs, except under `additionalProperties` and the `unevaluated*` keywords, where booleans are the normal way to close a schema. The `unsupported-keyword` and `no-boolean-schema` rules cover those cases.

**Do tool annotations matter if clients treat them as untrusted hints?**
Yes, in both directions. Clients that gate on `readOnlyHint` (write-approval modes, plan modes, auto-allow rules) prompt for every tool that lacks it, so a server without annotations trains its users to approve everything. A server whose `delete_` tool says `readOnlyHint: true` is worse, because a client that trusts the server will let it run unprompted. And a server that emits `read_only_hint` in snake_case gets neither benefit: clients read the camelCase key and treat every tool as write-capable. The three annotation rules flag all of this; they do not decide whether your server should be trusted.

**Can I run this in CI against a server that needs credentials or a running backend?**
Yes. For a stdio server pass `-e KEY=VALUE` for each variable (the SDK's default environment is kept and your entries are added), for a Streamable HTTP server pass `-H "Authorization: Bearer ..."`. The tool only calls `initialize` and `tools/list`, so a server that can start and enumerate its tools is enough; nothing is invoked. If the server needs OAuth with a browser round trip, save a `tools/list` response once with any client and lint the JSON file instead. Exit code 2 is reserved for "could not run", so a job can tell a broken server from a failing lint.

## Related tools

As of 2026-10-03: `mcp-lint` (npm) ships cross-client schema rules but no dialect or annotation rule; `mcp-conform` (PyPI) checks for boolean schemas and predates the dialect change; `mcp-surface` (npm) compiles schemas and snapshots the tool surface; the official conformance suite checks wire messages rather than tool contracts. None of them writes a fix.

## Design notes

- Rules are pure functions over one tool and produce findings with a JSON Pointer; the engine prefixes `/tools/<i>` and collects the patch. No rule has side effects, so the same input always gives the same report, which is what makes byte-for-byte patch tests possible.
- The CLI reads the raw `tools/list` payload through `client.request` with a permissive schema instead of `client.listTools()`, so that it sees what the server sent rather than what the SDK's parser accepts.
- The validator rules of any client are undocumented and can change. This repository tracks them as a versioned rule set: a rule's meaning changes only with a minor version bump and a changelog entry.
- The write-verb and destructive-verb lists are intentionally short and anchored at the start of the name, followed by `_` or `-`, so `deleted_items_report` is not flagged.

## Contributing

Issues and pull requests are welcome. Adding a rule is one function in `src/rules.ts` plus a unit test and, where the rule has a fix, a fixture; see [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/good-first-issues.md](docs/good-first-issues.md). Run `npm test` before opening a pull request. Security problems: see [SECURITY.md](SECURITY.md).

## Sibling projects

- [masoon](https://github.com/basitalisandhu/masoon): open-source trust infrastructure for AI agents: who they are, what they may touch, and proof of what they did.
- [dev-mcp-servers](https://github.com/basitalisandhu/dev-mcp-servers): ten small MCP servers for everyday development and security checks, one npm package each.

## Licence

MIT, see [LICENSE](LICENSE). Copyright 2026 Muhammad Basit Ali.
