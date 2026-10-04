// Fixture: serves tests/fixtures/tools/clean.json over stdio.
import { serveStdio } from './serve.mjs';

await serveStdio('clean');
