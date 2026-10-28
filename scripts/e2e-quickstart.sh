#!/usr/bin/env bash
# Run the README quick start on a fresh install.
#
# 1. "Quick start": a fresh clone of this checkout, `npm install && npm run build`, then
#    the bundled draft-07 fixture server, checking the sample output.
# 2. "Usage": `npm pack`, install the tarball into a new empty project and run the stdio,
#    file, --fix, --write and SARIF examples against the bundled fixtures.
#
#   scripts/e2e-quickstart.sh        (npm run e2e)
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

expect() { # expect <file> <text>
  if ! grep -qF -- "$2" "$1"; then
    echo "FAIL: expected to find: $2" >&2
    cat "$1" >&2
    exit 1
  fi
}
run() { # run <expected exit code> <output file> <command...>
  local want="$1" out="$2"
  shift 2
  set +e
  "$@" >"$out" 2>"$out.err"
  local got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL: $* exited $got, expected $want" >&2
    cat "$out" "$out.err" >&2
    exit 1
  fi
}

echo "== Quick start from a fresh clone"
git clone --quiet "$repo" "$work/clone"
(cd "$work/clone" && npm install --no-audit --no-fund --silent && npm run --silent build)
cd "$work/clone"
run 1 "$work/sample.txt" node dist/cli.js -- node tests/fixtures/servers/draft07.mjs
expect "$work/sample.txt" "node tests/fixtures/servers/draft07.mjs: 2 tools"
expect "$work/sample.txt" 'error    dialect-2020-12  inputSchema declares dialect "http://json-schema.org/draft-07/schema#"'
expect "$work/sample.txt" "5 errors, 0 warnings, 0 infos (5 fixable with --fix)"

echo "== Usage from the packed tarball"
tarball="$(npm pack --silent --pack-destination "$work" | tail -1)"
mkdir "$work/project"
cd "$work/project"
npm init -y >/dev/null
npm install --no-audit --no-fund --silent "$work/$tarball"
fixtures="$work/clone/tests/fixtures"
bin="$work/project/node_modules/.bin/mcp-tools-lint"

# 1. A stdio server.
run 1 stdio.txt "$bin" -- node "$fixtures/servers/draft07.mjs"
expect stdio.txt "5 errors"

# 3. A JSON file, then --fix and --write; a second run reports nothing fixable.
cp "$fixtures/tools/snake.json" tools.json
run 1 fix.txt "$bin" tools.json --fix
expect fix.txt "6 errors, 0 warnings, 0 infos (6 fixable with --fix)"
expect fix.txt.err "wrote 6 patch operations to tools.json.patch.json"
test -s tools.json.patch.json
run 1 write.txt "$bin" tools.json --fix --write
expect write.txt.err "applied the patch to tools.json"
run 0 again.txt "$bin" tools.json
expect again.txt "No problems found."

# SARIF for code scanning.
run 1 out.sarif "$bin" "$fixtures/tools/draft07.json" --format sarif
node -e "const s=JSON.parse(require('fs').readFileSync('out.sarif','utf8')); if (s.version!=='2.1.0' || !s.runs[0].results.length) process.exit(1)"

# Rules list.
run 0 rules.txt "$bin" --rules
expect rules.txt "dialect-2020-12"

echo "quick start OK on a fresh install"
