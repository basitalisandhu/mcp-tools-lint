import { createHash } from 'node:crypto';
import { rules } from '../rules.js';
import type { LintResult, Severity } from '../types.js';

export interface SarifOptions {
  /** Version string placed in tool.driver.version. */
  toolVersion: string;
  /** URI (relative to the repository root when possible) that results point at. */
  artifactUri: string;
}

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
};

/**
 * SARIF 2.1.0 with one reportingDescriptor per rule id. Every result carries a
 * physical location (so GitHub code scanning shows it) and a logical location
 * naming the tool and the JSON Pointer of the offending value.
 */
export function formatSarif(result: LintResult, options: SarifOptions): string {
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i] as const));
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'mcp-tools-lint',
            version: options.toolVersion,
            informationUri: 'https://github.com/basitalisandhu/mcp-tools-lint',
            rules: rules.map((rule) => ({
              id: rule.id,
              name: rule.id
                .split('-')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(''),
              shortDescription: { text: rule.description },
              fullDescription: { text: rule.description },
              help: { text: rule.fix },
              defaultConfiguration: { level: LEVEL[rule.severity] },
              properties: { tags: ['mcp', 'json-schema'] },
            })),
          },
        },
        artifacts: [{ location: { uri: options.artifactUri, uriBaseId: '%SRCROOT%' } }],
        results: result.findings.map((finding) => ({
          ruleId: finding.ruleId,
          ruleIndex: ruleIndex.get(finding.ruleId),
          level: LEVEL[finding.severity],
          message: { text: `${finding.tool}: ${finding.message} (${finding.pointer})` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: options.artifactUri, uriBaseId: '%SRCROOT%', index: 0 },
                region: { startLine: 1, startColumn: 1 },
              },
              logicalLocations: [
                { name: finding.tool, fullyQualifiedName: finding.pointer, kind: 'member' },
              ],
            },
          ],
          partialFingerprints: {
            'mcpToolsLint/v1': createHash('sha256')
              .update(`${finding.ruleId}\n${finding.tool}\n${finding.pointer}`)
              .digest('hex')
              .slice(0, 32),
          },
          ...(finding.fix
            ? {
                fixes: [
                  {
                    description: { text: `RFC 6902: ${JSON.stringify(finding.fix)}` },
                  },
                ],
              }
            : {}),
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + '\n';
}
