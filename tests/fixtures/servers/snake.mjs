// Fixture: serves tests/fixtures/tools/snake.json over stdio.
import { serveStdio } from './serve.mjs';

await serveStdio('snake');
