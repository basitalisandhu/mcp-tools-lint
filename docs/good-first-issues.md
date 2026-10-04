# Good first issues

Issues the maintainer intends to open under the `good first issue` label, written out so
they can be filed in one sitting. Each is self-contained and has acceptance criteria that
`npm test` can verify. Read [CONTRIBUTING.md](../CONTRIBUTING.md) first: rules are pure
functions over one tool, output must stay deterministic, and every rule change needs a
fixture or a unit test.

## 1. Add `--ignore-rule <id>` to switch a rule off

**Context.** A team that knowingly ships tools without descriptions, or that lints a
third-party server it cannot change, wants to silence one rule without lowering
`--fail-on` for everything.

**Acceptance criteria.**

- `--ignore-rule <id>` is repeatable; an unknown id is a usage error (exit 2) that lists
  the valid ids.
- Ignored rules produce no findings and no patch operations, and are still listed in the
  SARIF `rules` array (so alert history is stable) with `defaultConfiguration.enabled:
  false`.
- Implemented by filtering in `src/lint.ts`, not inside the rules.
- Tests in `tests/cli.test.ts`: ignoring `dialect-2020-12` on the draft-07 fixture gives
  exit 0 and an empty patch; an unknown id gives exit 2.
- The README "Rules" section and `--help` mention the flag.

## 2. Add a `schema-compiles` rule using the SDK's Ajv validator

**Context.** The current rules catch the known-bad patterns. A schema can still fail to
compile under a 2020-12 validator for other reasons (a bad `pattern`, an unknown
`format`, a `$ref` that resolves nowhere). The TypeScript SDK already depends on `ajv`,
so compiling each schema costs no new dependency.

**Acceptance criteria.**

- New rule id `schema-compiles`, severity error, in `src/rules.ts`, that compiles
  `inputSchema` and `outputSchema` with an `Ajv2020` instance (`strict: false`) and
  reports the compile error message at the schema's pointer.
- `$schema` values the `dialect-2020-12` rule already rejects must not produce a second
  finding from this rule (strip `$schema` before compiling).
- Rule registered last in the `rules` array so existing SARIF `ruleIndex` values do not
  move.
- Unit test with a schema whose `pattern` is an invalid regular expression and one
  whose `$ref` points at a missing `$defs` entry; the clean fixture stays clean.

## 3. Support legacy SSE servers with `--transport sse`

**Context.** The CLI connects to HTTP targets with the Streamable HTTP transport. Servers
that still speak the 2024-11-05 HTTP+SSE transport answer `405` or hang.

**Acceptance criteria.**

- `--transport streamable-http|sse` (default `streamable-http`) selects
  `SSEClientTransport` from `@modelcontextprotocol/sdk/client/sse.js` for HTTP targets;
  `-H` headers are passed through `requestInit` and `eventSourceInit`.
- Passing `--transport` with a file or stdio target is a usage error.
- A fixture `tests/fixtures/servers/sse.mjs` serving the clean tools over
  `SSEServerTransport`, and a test in `tests/http.test.ts` that lints it.
- README "Usage" lists the flag.

## 4. Add a `--baseline <file>` to suppress known findings

**Context.** Teams adopting the linter on an existing server want to fail CI only on new
findings while they work through the backlog, the way most linters do.

**Acceptance criteria.**

- `--baseline <file>` reads a JSON report written by `--format json` and drops every
  finding whose `ruleId`, `tool` and `pointer` match one in the baseline before the
  summary and exit code are computed.
- `--baseline-write <file>` writes the current findings in that shape.
- Suppressed findings are counted in a new `suppressed` field of the JSON summary and
  mentioned in the text summary line.
- Tests: linting the boolean fixture against its own baseline exits 0; changing a tool
  name in a temp copy makes the moved findings reappear.

## 5. Add `--format markdown` for pull request comments and step summaries

**Context.** The GitHub Action pastes the text report into the job summary inside a code
block. A Markdown table reads better there and in bot comments.

**Acceptance criteria.**

- `src/format/markdown.ts` renders a heading with the target and tool count, then one
  table per tool with columns severity, rule, message, pointer, and a closing summary
  line; fixable findings get a `fixable` marker. Output is deterministic.
- `--format markdown` is accepted by the CLI and listed in `--help`.
- `action/action.yml` uses it for the step summary instead of the fenced text block.
- A test in `tests/cli.test.ts` checks the table header and the row count for the
  boolean fixture.
