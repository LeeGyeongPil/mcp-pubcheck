import { existsSync } from "node:fs";
import { discover, readGitOrigin, readServerJson } from "./load.js";
import { InputError } from "./errors.js";
import { checkArtifacts } from "./rules/artifacts.js";
import { checkSchema } from "./rules/schema.js";
import { checkServerJson } from "./rules/serverjson.js";
import type { CheckOptions, Finding, Report, Summary } from "./types.js";
import { VERSION } from "./version.js";

export type { CheckOptions, Finding, Level, Report, Summary, Lang } from "./types.js";
export { InputError, ArchiveError, UnsupportedArchiveError } from "./errors.js";
export { matchMcpName } from "./mcpname.js";
export type { McpNameStatus } from "./mcpname.js";

/** Count findings by level. */
export function summarize(findings: Finding[]): Summary {
  return {
    errors: findings.filter((f) => f.level === "error").length,
    warnings: findings.filter((f) => f.level === "warn").length,
    infos: findings.filter((f) => f.level === "info").length,
    passed: findings.filter((f) => f.level === "ok").length,
  };
}

/**
 * Compare `server.json` with the built artifacts, offline.
 *
 * Throws {@link InputError} when an input cannot be read or parsed (the CLI maps that to exit code 2).
 * Problems with the release itself are returned as findings.
 */
export async function checkRelease(options: CheckOptions): Promise<Report> {
  if (!existsSync(options.serverJson)) {
    throw new InputError("input.not-found", { file: options.serverJson }, `file not found: ${options.serverJson}`);
  }
  const server = readServerJson(options.serverJson);
  const inventory = discover(options);
  const repoUrl = options.repoUrl ?? (typeof (server.repository as { url?: unknown } | undefined)?.url === "string" ? undefined : readGitOrigin(options.serverJson));
  const findings: Finding[] = [
    ...checkSchema(server, options.schema),
    ...checkServerJson(server, { repoUrl }),
    ...checkArtifacts(server, inventory, { requireAll: options.requireAll }),
  ];
  return { tool: "mcp-pubcheck", version: VERSION, serverJson: options.serverJson, summary: summarize(findings), findings };
}
