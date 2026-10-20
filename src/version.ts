import { readFileSync } from 'node:fs';

/** The version in this package's package.json, read once; "0.0.0" if it cannot be read. */
export const PACKAGE_VERSION: string = (() => {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
