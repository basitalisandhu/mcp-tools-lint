// Fixture: refuses to start unless FIXTURE_TOKEN=ok is in the environment (tests -e).
import { serveStdio } from './serve.mjs';

if (process.env.FIXTURE_TOKEN !== 'ok') {
  process.stderr.write('fixture: FIXTURE_TOKEN is not set to "ok"\n');
  process.exit(3);
}
await serveStdio('clean');
