// Fixture: the clean tools, one per page, to exercise nextCursor handling.
import { serveStdio } from './serve.mjs';

await serveStdio('clean', { pageSize: 1 });
