# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-03

### Added

- `mcp-tools-lint <target>` for a tools.json file, a Streamable HTTP URL or a stdio command after `--`, using the official TypeScript SDK client with a 20 second timeout, `-e KEY=VALUE` for the child environment and `-H` for HTTP headers.
- Nine rules as pure functions over one tool: `dialect-2020-12`, `no-boolean-schema`, `required-names-property`, `unsupported-keyword`, `missing-annotations`, `readonly-verb-contradiction`, `destructive-without-hint`, `snake-case-annotation-keys`, `description-missing`.
- `--format text|json|sarif` (SARIF 2.1.0 with one rule per id), `--out`, `--fail-on`, `--rules`.
- `--fix` writes an RFC 6902 patch that removes offending `$schema` keys and renames snake_case annotation keys; `--write` applies it to a JSON file target in place.
- Exit codes: 0 clean, 1 findings at or above `--fail-on`, 2 when the target cannot be read or reached.
- Composite GitHub Action under `action/` that runs the CLI and uploads SARIF to code scanning.
- Fixture servers for a draft-07 server, a boolean-schema server, a snake_case-annotation server and a clean server, with byte-for-byte patch tests.

[Unreleased]: https://github.com/basitalisandhu/mcp-tools-lint/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/basitalisandhu/mcp-tools-lint/releases/tag/v0.1.0
