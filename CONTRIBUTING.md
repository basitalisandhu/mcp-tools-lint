# Contributing

Thanks for considering a contribution. The project is small on purpose: a loader for the three target kinds, nine rules that are pure functions over one tool, three formatters and a patch writer. The most useful contributions are new rules backed by a real client behaviour, fixtures copied from real servers, and reports of false positives.

## Set up

Requires Node.js 20 or newer.

```bash
git clone https://github.com/basitalisandhu/mcp-tools-lint
cd mcp-tools-lint
npm ci
npm test            # builds first, then runs vitest
```

`npm test` runs `npm run build` through the `pretest` script, so `dist/` is always current when the integration tests spawn `dist/cli.js`. The tests run offline: the fixture servers live in `tests/fixtures/servers/` and are started as child processes.

Keep `package-lock.json`. The npm that ships with Node 20 and 22 (10.8 and 10.9) crashes with `Cannot read properties of null (reading 'edgesOut')` when it resolves vitest 4's peer dependency set from scratch; with the lockfile present `npm ci`, `npm install` and adding a dependency all work. If you ever need to regenerate the lockfile, use npm 11 or newer (`npx npm@latest install`) or run `npm install --legacy-peer-deps` once.

## Before you open a pull request

```bash
npm run typecheck   # tsc --noEmit
npm test            # build and test
node dist/cli.js tests/fixtures/tools/boolean.json   # eyeball the text output
```

CI runs the build and tests on Node 20 and 22, smoke-tests the CLI against the fixtures, checks the packed file list and runs the composite action against the clean fixture.

## Adding a rule

1. Add a `Rule` object to `src/rules.ts`: `id` (kebab-case), `severity`, a one-sentence `description`, a `fix` sentence and a `check(tool)` function. Use `walkSchema` from `src/schema.ts` to visit subschemas; it hands you a JSON Pointer and the keyword each node sits under. Return findings with `path` relative to the tool, and `fix` operations only when the change is mechanical and safe.
2. Append it to the `rules` array. Order matters for SARIF `ruleIndex` and for the `--rules` listing; add new rules at the end.
3. Add the `RuleId` to `src/types.ts`.
4. Unit tests in `tests/rules.test.ts`: at least one positive and one negative case, and a case that shows the rule does not fire on the clean fixture.
5. If the rule has a fix, extend a fixture under `tests/fixtures/tools/` (or add one, with a matching `tests/fixtures/servers/<name>.mjs`) and update the expected patch under `tests/fixtures/expected/`. The patch tests compare byte for byte.
6. Add a row to the README rule table and a line to `CHANGELOG.md`.

A rule must describe a behaviour of a real client, a statement in the MCP specification, or a JSON Schema 2020-12 rule. Cite it in the pull request. Keep verb lists short: a false positive on a tool name costs more trust than a missed case.

## Style

- TypeScript, strict, ESM, Node 20 built-ins only beyond the SDK and zod.
- Output must be deterministic: no timestamps, no random ids, no colour codes.
- Plain language in messages: say what is wrong, where, and what the client does about it.
- No model names or vendor model identifiers in the repository.

## Reporting security issues

See [SECURITY.md](SECURITY.md).
