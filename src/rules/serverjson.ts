import { finding } from "../finding.js";
import type { Finding } from "../types.js";

type Obj = Record<string, unknown>;

/** Property names the server.json schema knows in camelCase. The schema allows extra keys, so typos slip through. */
const KNOWN_KEYS = [
  "registryType", "registryBaseUrl", "fileSha256", "runtimeHint", "runtimeArguments", "packageArguments",
  "environmentVariables", "isRequired", "isSecret", "isRepeated", "valueHint", "websiteUrl", "mimeType",
];
const normalizeKey = (k: string): string => k.replace(/[-_]/g, "").toLowerCase();
const KNOWN_BY_NORMAL = new Map(KNOWN_KEYS.map((k) => [normalizeKey(k), k]));

/** Keys whose children are user-chosen names, not schema properties. */
const OPAQUE_KEYS = new Set(["_meta", "variables"]);

function walkKeys(value: unknown, path: string, out: Finding[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkKeys(v, `${path}[${i}]`, out));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Obj)) {
    const known = KNOWN_BY_NORMAL.get(normalizeKey(k));
    if (known !== undefined && known !== k) {
      out.push(finding("typo-key.found", "error", `${path}.${k}`.replace(/^\./, ""), { expected: known, actual: k, params: { key: k, suggestion: known } }));
    }
    if (!OPAQUE_KEYS.has(k)) walkKeys(v, `${path}.${k}`, out);
  }
}

/** `latest` or a version range instead of one exact version. */
export function versionProblem(version: string): "latest" | "range" | undefined {
  if (/^(latest|\*|x)$/i.test(version.trim())) return "latest";
  if (/[\^~*<>=|]|\s|(^|\.)[xX]($|\.)/.test(version)) return "range";
  return undefined;
}

const FORBIDDEN: Record<string, string[]> = {
  oci: ["version", "registryBaseUrl"],
  npm: ["fileSha256"],
  pypi: ["fileSha256"],
  nuget: ["fileSha256"],
  cargo: ["fileSha256"],
  mcpb: ["registryBaseUrl"],
};

const BASE_URLS: Record<string, string> = {
  npm: "https://registry.npmjs.org",
  pypi: "https://pypi.org",
  nuget: "https://api.nuget.org/v3/index.json",
  cargo: "https://crates.io",
};

const META_KEY = "io.modelcontextprotocol.registry/publisher-provided";
export const META_LIMIT = 4096;

/** `io.github.<owner>` namespace against the repository owner (case matters to the registry). */
function checkNamespace(server: Obj, repoUrl: string | undefined): Finding[] {
  const name = typeof server.name === "string" ? server.name : "";
  const ns = name.split("/")[0] ?? "";
  if (!ns.startsWith("io.github.")) return [];
  const nsOwner = ns.slice("io.github.".length);
  const url = repoUrl ?? (typeof (server.repository as Obj | undefined)?.url === "string" ? ((server.repository as Obj).url as string) : undefined);
  const owner = url ? /github\.com[/:]([^/]+)\//i.exec(url)?.[1] : undefined;
  if (!owner) return [];
  if (owner === nsOwner) return [finding("namespace-owner.ok", "ok", "name", { params: { owner } })];
  const level = owner.toLowerCase() === nsOwner.toLowerCase() ? "case" : "mismatch";
  return [
    finding(`namespace-owner.${level}`, level === "case" ? "warn" : "error", "name", {
      expected: `io.github.${owner}`,
      actual: ns,
      params: { namespace: ns, owner },
    }),
  ];
}

/** Rules the JSON Schema cannot express. Pure function of the parsed server.json. */
export function checkServerJson(server: Obj, opts: { repoUrl?: string } = {}): Finding[] {
  const out: Finding[] = [];
  walkKeys(server, "", out);

  const top = server.version;
  if (typeof top === "string") {
    const p = versionProblem(top);
    if (p) out.push(finding(`version-range.${p}`, "error", "version", { actual: top, params: { value: top } }));
  }

  const packages = Array.isArray(server.packages) ? (server.packages as Obj[]) : [];
  packages.forEach((pkg, i) => {
    if (pkg === null || typeof pkg !== "object") return;
    const type = typeof pkg.registryType === "string" ? pkg.registryType : "";
    const where = `packages[${i}]`;
    if (typeof pkg.version === "string") {
      const p = versionProblem(pkg.version);
      if (p) out.push(finding(`version-range.${p}`, "error", `${where}.version`, { actual: pkg.version, params: { value: pkg.version } }));
    }
    for (const field of FORBIDDEN[type] ?? []) {
      if (field in pkg) out.push(finding("forbidden-field.found", "error", `${where}.${field}`, { params: { type, field } }));
    }
    const base = pkg.registryBaseUrl;
    const allowed = BASE_URLS[type];
    if (typeof base === "string" && allowed !== undefined && base.replace(/\/$/, "") !== allowed.replace(/\/$/, "")) {
      out.push(finding("registry-base-url.disallowed", "error", `${where}.registryBaseUrl`, { expected: allowed, actual: base, params: { type, url: base, allowed } }));
    }
  });

  const meta = server._meta;
  if (meta !== null && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Obj;
    const dropped = Object.keys(m).filter((k) => k !== META_KEY);
    if (dropped.length > 0) out.push(finding("meta-keys.dropped", "warn", "_meta", { actual: dropped.join(", "), params: { keys: dropped.join(", "), kept: META_KEY } }));
    if (META_KEY in m) {
      const bytes = Buffer.byteLength(JSON.stringify(m[META_KEY]), "utf8");
      if (bytes > META_LIMIT) out.push(finding("meta-size.too-large", "error", `_meta.${META_KEY}`, { expected: `<= ${META_LIMIT}`, actual: String(bytes), params: { bytes, limit: META_LIMIT } }));
    }
  }

  out.push(...checkNamespace(server, opts.repoUrl));
  return out;
}
