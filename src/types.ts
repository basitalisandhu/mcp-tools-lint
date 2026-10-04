/** Severity of a finding. Errors fail the run (exit code 1). */
export type Severity = 'error' | 'warning' | 'info';

/** Identifiers of the rules this version implements. */
export type RuleId =
  | 'dialect-2020-12'
  | 'no-boolean-schema'
  | 'required-names-property'
  | 'unsupported-keyword'
  | 'missing-annotations'
  | 'readonly-verb-contradiction'
  | 'destructive-without-hint'
  | 'snake-case-annotation-keys'
  | 'description-missing';

/** An RFC 6902 operation. Paths are RFC 6901 JSON Pointers. */
export type PatchOp =
  | { op: 'remove'; path: string }
  | { op: 'move'; from: string; path: string }
  | { op: 'add'; path: string; value: unknown }
  | { op: 'replace'; path: string; value: unknown };

/** A finding produced by a rule. `path` is a JSON Pointer relative to the tool object. */
export interface Finding {
  ruleId: RuleId;
  severity: Severity;
  message: string;
  path: string;
  /** Patch operations, with paths relative to the tool object, that remove the cause. */
  fix?: PatchOp[];
}

/** A finding attached to a tool inside a tools/list document. */
export interface ToolFinding extends Finding {
  tool: string;
  toolIndex: number;
  /** JSON Pointer to the offending value, relative to the document root. */
  pointer: string;
}

/** A tool as it appears on the wire. Only `name` is assumed; everything else is checked. */
export type Tool = Record<string, unknown> & { name?: unknown };

export interface Rule {
  id: RuleId;
  severity: Severity;
  /** One sentence, shown in SARIF rule metadata and `--help`. */
  description: string;
  /** What to do about it, shown in SARIF help text. */
  fix: string;
  check: (tool: Tool) => Finding[];
}

export interface Summary {
  errors: number;
  warnings: number;
  infos: number;
}

export interface LintResult {
  /** The target as given on the command line (file path, URL or command). */
  target: string;
  /** Number of tools examined. */
  tools: number;
  findings: ToolFinding[];
  /** RFC 6902 patch, relative to the document root, that removes every fixable finding. */
  patch: PatchOp[];
  summary: Summary;
}
