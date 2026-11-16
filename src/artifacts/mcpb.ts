import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readZip } from "../archive/zip.js";
import { ArchiveError } from "../errors.js";

export interface McpbFacts {
  file: string;
  sha256: string;
  /** `version` from the bundled manifest.json, when it can be read. */
  manifestVersion?: string;
  /** Set when manifest.json could not be read (not a zip, missing, invalid). */
  manifestProblem?: "missing" | "unreadable" | "invalid";
}

/** Hash the bundle and peek at its manifest. Only the hash decides pass/fail; the manifest is advisory. */
export function readMcpb(file: string): McpbFacts {
  const buf = readFileSync(file);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  try {
    const zip = readZip(buf);
    const raw = zip.read("manifest.json");
    if (!raw) return { file, sha256, manifestProblem: "missing" };
    const json = JSON.parse(raw.toString("utf8")) as { version?: unknown };
    return typeof json.version === "string" ? { file, sha256, manifestVersion: json.version } : { file, sha256, manifestProblem: "invalid" };
  } catch (e) {
    if (e instanceof ArchiveError || e instanceof SyntaxError) return { file, sha256, manifestProblem: "unreadable" };
    throw e;
  }
}
