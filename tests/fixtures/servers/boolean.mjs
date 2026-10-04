// Fixture: serves tests/fixtures/tools/boolean.json over stdio.
import { serveStdio } from './serve.mjs';

await serveStdio('boolean');
