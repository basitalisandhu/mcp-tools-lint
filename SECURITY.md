# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability") rather than a public issue. Include the version, the command you ran, a minimal tools.json or fixture server that reproduces the problem, and what you expected to happen.

You will get an acknowledgement within 7 days and a fix or a mitigation plan within 30 days for confirmed issues. Credit is given in the release notes unless you prefer otherwise.

## Scope

mcp-tools-lint reads a JSON file, or connects to an MCP server you name on the command line (it spawns the stdio command you give it, or sends requests to the URL you give it), calls `initialize` and `tools/list`, and writes a report and optionally a patch file. It never calls a tool. Values from the server are treated as data: they are inspected, never evaluated or executed, and appear in the report only as quoted strings.

Issues of interest include: path handling in `--out`, `--patch-out` and `--write`; a server response that makes the walker loop or exhaust memory; a tools/list payload that produces a SARIF or JSON report capable of injecting content into a viewer; the `-e` environment and `-H` header handling; and dependency vulnerabilities in `@modelcontextprotocol/sdk` or `zod`.

Findings produced by the tool are not themselves security vulnerabilities in the tool. If a rule is wrong or a client's behaviour has changed, open a normal issue.

Note that linting a stdio server runs that server's code on your machine, as any MCP client would. Lint servers you would be willing to install.
