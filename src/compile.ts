import { Ajv2020 } from 'ajv/dist/2020.js';
import { isObject, walkSchema } from './schema.js';
import type { Finding, Tool } from './types.js';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Compile locally, never resolving or fetching external schemas. */
export function schemaCompilationFindings(tool: Tool): Finding[] {
  const findings: Finding[] = [];
  for (const key of ['inputSchema', 'outputSchema'] as const) {
    if (tool[key] === undefined) continue;
    const schema = structuredClone(tool[key]);
    let oldDialect = false;
    walkSchema(schema, '', ({ node }) => {
      if (!isObject(node)) return;
      if (typeof node.$schema === 'string' && node.$schema.replace(/#$/, '') !== DIALECT) oldDialect = true;
      // External refs are outside a tools/list document. Ignore them, not their siblings.
      for (const ref of ['$ref', '$dynamicRef']) {
        if (typeof node[ref] === 'string' && !node[ref].startsWith('#')) delete node[ref];
      }
    });
    if (oldDialect) continue; // The dialect rule already explains this.
    const ajv = new Ajv2020({ strict: false, validateFormats: false, logger: false });
    try {
      ajv.compile(schema as object | boolean);
    } catch (error) {
      findings.push({
        ruleId: 'schema-compiles', severity: 'error', path: `/${key}`,
        message: `${key} cannot compile as JSON Schema 2020-12: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return findings;
}
