import { readFileSync } from "node:fs";
import { readTar } from "../archive/tar.js";
import { ArchiveError, withFile } from "../errors.js";

export interface NpmFacts {
  file: string;
  name?: string;
  version?: string;
  mcpName?: string;
}

/** Read `package/package.json` from an `npm pack` tarball (the value that will actually be published). */
export function readNpmTarball(file: string): NpmFacts {
  const tar = withFile(file, () => readTar(readFileSync(file)));
  // npm always uses `package/`, but some tools use another top-level directory name.
  const candidates = tar.names().filter((n) => /^[^/]+\/package\.json$/.test(n));
  const entry = candidates.includes("package/package.json") ? "package/package.json" : candidates[0];
  const raw = entry ? tar.read(entry) : undefined;
  if (!raw) throw new ArchiveError("archive.npm-no-package-json", { file }, `no package.json found in ${file}`);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new ArchiveError("archive.npm-bad-package-json", { file }, `package.json inside ${file} is not valid JSON`);
  }
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return { file, name: str(json.name), version: str(json.version), mcpName: str(json.mcpName) };
}
