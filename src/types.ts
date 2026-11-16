export type Level = "error" | "warn" | "info" | "ok";
export type Params = Record<string, string | number>;

/** One check result. `rule` is language independent; `key` selects the message variant. */
export interface Finding {
  /** Stable rule ID, e.g. `npm-version`. Never translated. */
  rule: string;
  level: Level;
  /** Message variant, `<rule>.<variant>`, e.g. `npm-version.mismatch`. */
  key: string;
  /** Where the problem is, e.g. `packages[0] (npm @scope/name)` or a JSON path. */
  where: string;
  expected?: string;
  actual?: string;
  /** The artifact file the value came from, when there is one. */
  source?: string;
  params: Params;
}

export interface Summary {
  errors: number;
  warnings: number;
  infos: number;
  passed: number;
}

export interface Report {
  tool: "mcp-pubcheck";
  version: string;
  serverJson: string;
  summary: Summary;
  findings: Finding[];
}

/** Options for {@link checkRelease}. All paths are read-only inputs. */
export interface CheckOptions {
  serverJson: string;
  /** Directories (or files) searched for built artifacts. */
  artifacts?: string[];
  npm?: string;
  wheel?: string;
  sdist?: string;
  mcpb?: string;
  dockerfile?: string;
  ociInspect?: string;
  /** Overrides `repository.url` for the namespace-owner check. */
  repoUrl?: string;
  /** Use another copy of the server.json JSON Schema. */
  schema?: string;
  /** Treat packages without an artifact as errors instead of warnings. */
  requireAll?: boolean;
}

export type Lang = "en" | "ko";
