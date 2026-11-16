import { finding } from "../finding.js";
import { matchMcpName } from "../mcpname.js";
import type { ArtifactFile, Inventory } from "../load.js";
import { readMcpb } from "../artifacts/mcpb.js";
import { readNpmTarball, type NpmFacts } from "../artifacts/npm.js";
import { OCI_LABEL, readDockerfile, readInspect, type OciLabels } from "../artifacts/oci.js";
import { normalizeName, readSdist, readWheel, type PypiFacts } from "../artifacts/pypi.js";
import type { Finding } from "../types.js";

type Obj = Record<string, unknown>;

interface Ctx {
  server: Obj;
  inv: Inventory;
  requireAll: boolean;
  out: Finding[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Memoise a per-file reader so a file shared by several packages is opened once. */
function cached<T>(read: (file: string) => T): (file: string) => T {
  const cache = new Map<string, T>();
  return (file) => {
    if (!cache.has(file)) cache.set(file, read(file));
    return cache.get(file) as T;
  };
}

const npmFacts = cached(readNpmTarball);
const wheelFacts = cached(readWheel);
const sdistFacts = cached(readSdist);
const mcpbFacts = cached(readMcpb);

/**
 * Choose the artifact that belongs to a package. Prefer files whose embedded name matches; a lone
 * artifact is used even when the name differs so the mismatch is reported instead of "skipped".
 */
function pick<T>(
  files: ArtifactFile[],
  facts: (f: string) => T,
  nameMatches: (f: T) => boolean,
  versionOf: (f: T) => string | undefined,
  wanted: string | undefined,
): { chosen?: T; ambiguous?: string[] } {
  const all = files.map((f) => ({ path: f.path, facts: facts(f.path) }));
  const named = all.filter((a) => nameMatches(a.facts));
  const pool = named.length > 0 ? named : all.length === 1 ? all : [];
  if (pool.length === 0) return {};
  if (pool.length === 1) return { chosen: (pool[0] as (typeof pool)[number]).facts };
  const exact = pool.filter((a) => versionOf(a.facts) === wanted);
  if (exact.length === 1) return { chosen: (exact[0] as (typeof pool)[number]).facts };
  return { ambiguous: pool.map((a) => a.path) };
}

const label = (type: string, id: string, i: number): string => `packages[${i}] (${type} ${id})`;

function skipped(ctx: Ctx, where: string, type: string, id: string): void {
  ctx.out.push(finding("skipped.no-artifact", ctx.requireAll ? "error" : "warn", where, { params: { type, identifier: id } }));
}

function ambiguous(ctx: Ctx, where: string, files: string[]): void {
  ctx.out.push(finding("ambiguous.multiple", "error", where, { actual: files.join(", "), params: { files: files.join(", ") } }));
}

function compare(ctx: Ctx, base: string, where: string, expected: string, actual: string | undefined, source: string, params: Record<string, string | number> = {}): void {
  const ok = actual === expected;
  ctx.out.push(
    finding(`${base}.${ok ? "ok" : "mismatch"}`, ok ? "ok" : "error", where, { expected, actual: actual ?? "(none)", source, params: { expected, actual: actual ?? "(none)", file: source, ...params } }),
  );
}

function checkNpm(ctx: Ctx, pkg: Obj, i: number): void {
  const id = str(pkg.identifier) ?? "";
  const where = label("npm", id, i);
  const files = ctx.inv.files.filter((f) => f.kind === "npm");
  const want = str(pkg.version) ?? str(ctx.server.version);
  const r = pick(files, npmFacts, (f) => f.name === id, (f) => f.version, want);
  if (r.ambiguous) return ambiguous(ctx, where, r.ambiguous);
  const t: NpmFacts | undefined = r.chosen;
  if (!t) return skipped(ctx, where, "npm", id);
  compare(ctx, "npm-identifier", where, id, t.name, t.file);
  if (want !== undefined) compare(ctx, "npm-version", where, want, t.version, t.file);
  const name = str(ctx.server.name) ?? "";
  if (t.mcpName === name) ctx.out.push(finding("npm-mcp-name.ok", "ok", where, { expected: name, actual: name, source: t.file }));
  else {
    const variant = t.mcpName === undefined ? "missing" : t.mcpName.toLowerCase() === name.toLowerCase() ? "case" : "mismatch";
    ctx.out.push(finding(`npm-mcp-name.${variant}`, "error", where, { expected: name, actual: t.mcpName ?? "(none)", source: t.file, params: { expected: name, actual: t.mcpName ?? "(none)", file: t.file } }));
  }
}

function mcpNameFindings(ctx: Ctx, where: string, facts: PypiFacts): void {
  const name = str(ctx.server.name) ?? "";
  if (facts.description === undefined) {
    ctx.out.push(finding("pypi-mcp-name.no-readme", "error", where, { expected: `mcp-name: ${name}`, actual: "(no README in metadata)", source: facts.file, params: { file: facts.file, kind: facts.kind } }));
    return;
  }
  const m = matchMcpName(facts.description, name);
  const params = { file: facts.file, kind: facts.kind, name };
  const expected = `mcp-name: ${name}`;
  switch (m.status) {
    case "ok":
      ctx.out.push(finding("pypi-mcp-name.ok", "ok", where, { expected, actual: expected, source: facts.file, params }));
      break;
    case "glued":
      ctx.out.push(finding("pypi-mcp-name.glued", "error", where, { expected: `${expected}<end, space or '<'>`, actual: `${expected}${m.char}`, source: facts.file, params: { ...params, char: m.char } }));
      break;
    case "different":
      ctx.out.push(finding("pypi-mcp-name.different", "error", where, { expected, actual: `mcp-name: ${m.found}`, source: facts.file, params: { ...params, found: m.found } }));
      break;
    default:
      ctx.out.push(finding(`pypi-mcp-name.${m.status}`, "error", where, { expected, actual: "(none)", source: facts.file, params }));
  }
}

function checkPypi(ctx: Ctx, pkg: Obj, i: number): void {
  const id = str(pkg.identifier) ?? "";
  const where = label("pypi", id, i);
  const want = str(pkg.version) ?? str(ctx.server.version);
  const nameOk = (f: PypiFacts): boolean => f.name !== undefined && normalizeName(f.name) === normalizeName(id);
  const wheels = pick(ctx.inv.files.filter((f) => f.kind === "wheel"), wheelFacts, nameOk, (f) => f.version, want);
  const sdists = pick(ctx.inv.files.filter((f) => f.kind === "sdist"), sdistFacts, nameOk, (f) => f.version, want);
  if (wheels.ambiguous) return ambiguous(ctx, where, wheels.ambiguous);
  if (sdists.ambiguous) return ambiguous(ctx, where, sdists.ambiguous);
  const wheel = wheels.chosen;
  const sdist = sdists.chosen;
  if (!wheel && !sdist) return skipped(ctx, where, "pypi", id);
  for (const f of [wheel, sdist]) {
    if (!f) continue;
    const ok = f.name !== undefined && normalizeName(f.name) === normalizeName(id);
    ctx.out.push(finding(`pypi-name.${ok ? "ok" : "mismatch"}`, ok ? "ok" : "error", where, { expected: id, actual: f.name ?? "(none)", source: f.file, params: { expected: id, actual: f.name ?? "(none)", file: f.file } }));
    if (want !== undefined) {
      const rule = f.kind === "wheel" ? "pypi-version" : "sdist-version";
      compare(ctx, rule, where, want, f.version, f.file, { kind: f.kind });
    }
  }
  // PyPI renders one description; the wheel is what pip users get, so check it first and fall back to the sdist.
  mcpNameFindings(ctx, where, (wheel ?? sdist) as PypiFacts);
}

const GITHUB_ASSET = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/releases\/download\/[^/\s]+\/[^/\s]+$/;
const GITLAB_ASSET = /^https:\/\/gitlab\.com\/.+\/releases\/.+/;

function checkMcpb(ctx: Ctx, pkg: Obj, i: number): void {
  const id = str(pkg.identifier) ?? "";
  const where = label("mcpb", id, i);
  const urlOk = GITHUB_ASSET.test(id) || GITLAB_ASSET.test(id);
  const hasMcp = id.toLowerCase().includes("mcp");
  const urlKey = !urlOk ? "mcpb-url.bad" : !hasMcp ? "mcpb-url.no-mcp" : "mcpb-url.ok";
  ctx.out.push(finding(urlKey, urlKey.endsWith(".ok") ? "ok" : "error", where, { actual: id, params: { url: id } }));
  const files = ctx.inv.files.filter((f) => f.kind === "mcpb");
  const base = id.split("/").pop() ?? "";
  const named = files.filter((f) => f.path.split(/[\\/]/).pop() === base);
  const pool = named.length > 0 ? named : files.length === 1 ? files : [];
  if (pool.length > 1) return ambiguous(ctx, where, pool.map((f) => f.path));
  const f = pool[0];
  if (!f) return skipped(ctx, where, "mcpb", id);
  const facts = mcpbFacts(f.path);
  const declared = str(pkg.fileSha256)?.toLowerCase();
  if (declared === facts.sha256) ctx.out.push(finding("mcpb-sha256.ok", "ok", where, { expected: facts.sha256, actual: declared, source: f.path }));
  else ctx.out.push(finding("mcpb-sha256.mismatch", "error", where, { expected: facts.sha256, actual: declared ?? "(none)", source: f.path, params: { file: f.path, sha256: facts.sha256, declared: declared ?? "(none)" } }));
  const top = str(ctx.server.version);
  if (facts.manifestVersion !== undefined && top !== undefined && facts.manifestVersion !== top) {
    ctx.out.push(finding("mcpb-manifest.mismatch", "warn", where, { expected: top, actual: facts.manifestVersion, source: f.path, params: { file: f.path, expected: top, actual: facts.manifestVersion } }));
  } else if (facts.manifestProblem === "unreadable" || facts.manifestProblem === "invalid") {
    ctx.out.push(finding("mcpb-manifest.unreadable", "warn", where, { source: f.path, params: { file: f.path } }));
  }
}

/** Tag part of an OCI identifier, or undefined for none; digests return "@digest". */
function ociTag(id: string): string | undefined {
  if (id.includes("@")) return "@digest";
  const last = id.split("/").pop() ?? id;
  const idx = last.indexOf(":");
  return idx < 0 ? undefined : last.slice(idx + 1);
}

function checkOci(ctx: Ctx, pkg: Obj, i: number): void {
  const id = str(pkg.identifier) ?? "";
  const where = label("oci", id, i);
  const sources: OciLabels[] = [];
  for (const f of ctx.inv.files) {
    if (f.kind === "dockerfile") sources.push(readDockerfileCached(f.path));
    if (f.kind === "inspect") sources.push(readInspectCached(f.path));
  }
  const top = str(ctx.server.version);
  const tag = ociTag(id);
  if (tag === undefined) ctx.out.push(finding("oci-tag.missing", "warn", where, { actual: id, params: { identifier: id } }));
  else if (tag !== "@digest" && top !== undefined && tag.replace(/^v/, "") !== top) {
    ctx.out.push(finding("oci-tag.mismatch", "warn", where, { expected: top, actual: tag, params: { expected: top, actual: tag } }));
  }
  if (sources.length === 0) return skipped(ctx, where, "oci", id);
  const name = str(ctx.server.name) ?? "";
  for (const s of sources) {
    const params = { file: s.source, label: OCI_LABEL, expected: name, actual: s.value ?? "(none)" };
    if (s.unresolved) ctx.out.push(finding("oci-label.unresolved", "warn", where, { source: s.source, params }));
    else if (s.value === undefined) ctx.out.push(finding("oci-label.missing", "error", where, { expected: name, actual: "(none)", source: s.source, params }));
    else if (s.value === name) ctx.out.push(finding("oci-label.ok", "ok", where, { expected: name, actual: s.value, source: s.source, params }));
    else ctx.out.push(finding(s.value.toLowerCase() === name.toLowerCase() ? "oci-label.case" : "oci-label.mismatch", "error", where, { expected: name, actual: s.value, source: s.source, params }));
  }
}

const readDockerfileCached = cached(readDockerfile);
const readInspectCached = cached(readInspect);

/** Compare every package in server.json with the built artifacts found on disk. */
export function checkArtifacts(server: Obj, inv: Inventory, opts: { requireAll?: boolean } = {}): Finding[] {
  const out: Finding[] = [];
  const ctx: Ctx = { server, inv, requireAll: opts.requireAll ?? false, out };
  const packages = Array.isArray(server.packages) ? (server.packages as Obj[]) : [];
  const top = str(server.version);
  packages.forEach((pkg, i) => {
    if (pkg === null || typeof pkg !== "object") return;
    const type = str(pkg.registryType);
    const id = str(pkg.identifier) ?? "";
    const where = label(type ?? "?", id, i);
    const pv = str(pkg.version);
    if (pv !== undefined && top !== undefined) {
      if (pv === top) out.push(finding("version-drift.ok", "ok", where, { expected: top, actual: pv }));
      else out.push(finding("version-drift.drift", "warn", where, { expected: top, actual: pv, params: { top, actual: pv, index: i } }));
    }
    switch (type) {
      case "npm": return checkNpm(ctx, pkg, i);
      case "pypi": return checkPypi(ctx, pkg, i);
      case "mcpb": return checkMcpb(ctx, pkg, i);
      case "oci": return checkOci(ctx, pkg, i);
      case "nuget":
      case "cargo":
        out.push(finding("unsupported-registry.info", "info", where, { params: { type } }));
        return;
      default:
        return;
    }
  });
  if (packages.length === 0) out.push(finding("no-packages.info", "info", "packages"));
  return out;
}
