/** RFC 6901 JSON Pointer helpers. */

export function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Split a pointer into tokens. The empty pointer refers to the whole document. */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(`invalid JSON Pointer ${JSON.stringify(pointer)}: must start with "/"`);
  }
  return pointer.slice(1).split('/').map(unescapeToken);
}

export function joinPointer(base: string, ...tokens: string[]): string {
  return base + tokens.map((t) => '/' + escapeToken(t)).join('');
}
