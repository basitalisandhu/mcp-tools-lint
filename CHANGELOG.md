# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `schema-compiles` catches dangling local references, malformed regular expressions and invalid keyword types in input and output schemas using a local JSON Schema 2020-12 compiler. External references are not fetched; existing dialect diagnostics remain authoritative for older drafts. (#12)

## [0.3.0] - 2026-10-20

### Added

- `--transport streamable-http|sse` for HTTP targets (default `streamable-http`). `sse` connects with the SDK's HTTP+SSE client for servers that still speak the 2024-11-05 transport; `-H` headers are sent on the event stream and on every message POST. Passing it with a file or stdio target is a usage error. (#13)

### Changed

- README: a first screen with who the tool is for, a three-line quick start from a clone and a real run.

### Fixed

- `applyPatch` (exported from the package and used by `--write`) walked into `Object.prototype` when a path went through `__proto__`, so a patch such as `{"op": "add", "path": "/__proto__/x"}` changed every object in the process, and `add` or `replace` of a `__proto__` key replaced the object's prototype instead of setting a key. Paths now follow own properties only and keys are defined as own properties, so a schema property that is really named `__proto__` is patched like any other.
- The client sent `0.2.0` as its version in `initialize` whatever the installed version was; it now reads the version from `package.json`.
- `applyPatch` rejects array index tokens with leading zeros or signs (`/01`, `/-0`), as RFC 6901 requires, and a `move` into a child of its own `from` location, as RFC 6902 requires.

## [0.2.0] - 2026-10-09

### Added

- Repeatable `--ignore-rule <id>` suppression, with unknown-ID validation, omitted fixes and disabled SARIF rule descriptors.

## [0.1.1] - 2026-10-06

### Changed

- Removed the umbrella branding; this project stands alone and links its sibling repositories directly.

## [0.1.0] - 2026-10-04

First release. Published to two registries on GitHub Packages, using only the workflow's `GITHUB_TOKEN`:

- npm (`https://npm.pkg.github.com`): `@basitalisandhu/mcp-tools-lint`. The package is scoped because GitHub Packages requires the owner's scope; the unscoped name `mcp-tools-lint` is not published anywhere yet.
- GitHub Container Registry: `ghcr.io/basitalisandhu/mcp-tools-lint`, tagged `0.1.0` and `latest`, for linux/amd64 and linux/arm64, with an SPDX SBOM, a build provenance attestation and a keyless cosign signature.

### Added

- `publish-github-packages.yml`: on a `v*` tag, builds and tests, publishes the npm package to GitHub Packages (skipping a version that already exists), builds, pushes, attests and signs the image, and creates the GitHub release with the SBOM attached. Pull requests that touch packaging run it as a dry run.
- A `Dockerfile` on a digest-pinned `node:22-alpine` with only the runtime dependencies, running the CLI as the non-root `node` user with `/work` as the working directory, and a CI job that builds it and runs it.
- The action's `token` input, used with `version` to install the scoped package from GitHub Packages.

- `mcp-tools-lint <target>` for a tools.json file, a Streamable HTTP URL or a stdio command after `--`, using the official TypeScript SDK client with a 20 second timeout, `-e KEY=VALUE` for the child environment and `-H` for HTTP headers.
- Nine rules as pure functions over one tool: `dialect-2020-12`, `no-boolean-schema`, `required-names-property`, `unsupported-keyword`, `missing-annotations`, `readonly-verb-contradiction`, `destructive-without-hint`, `snake-case-annotation-keys`, `description-missing`.
- `--format text|json|sarif` (SARIF 2.1.0 with one rule per id), `--out`, `--fail-on`, `--rules`.
- `--fix` writes an RFC 6902 patch that removes offending `$schema` keys and renames snake_case annotation keys; `--write` applies it to a JSON file target in place.
- Exit codes: 0 clean, 1 findings at or above `--fail-on`, 2 when the target cannot be read or reached.
- Composite GitHub Action under `action/` that runs the CLI and uploads SARIF to code scanning.
- Fixture servers for a draft-07 server, a boolean-schema server, a snake_case-annotation server and a clean server, with byte-for-byte patch tests.

### Changed

- Package renamed to `@basitalisandhu/mcp-tools-lint`; the command is still `mcp-tools-lint`. The action's `version` input installs the scoped package.
- `release.yml` (npmjs.com) runs only when the repository variable `NPMJS_PUBLISH` is `true` and passes `--registry https://registry.npmjs.org`.
- Renamed the umbrella project from Hisar to Masoon; links, names and identifiers updated.

### Fixed

- The `mcp-tools-lint` command did nothing when started through the symlink that `npm install` and `npx` create in `node_modules/.bin`; the entry point now compares real paths. A test starts the CLI through a symlink.

[Unreleased]: https://github.com/basitalisandhu/mcp-tools-lint/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/basitalisandhu/mcp-tools-lint/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/basitalisandhu/mcp-tools-lint/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/basitalisandhu/mcp-tools-lint/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/basitalisandhu/mcp-tools-lint/releases/tag/v0.1.0
