import { readFileSync } from "node:fs";
import { InputError } from "../errors.js";

export const OCI_LABEL = "io.modelcontextprotocol.server.name";

export interface OciLabels {
  source: string;
  kind: "dockerfile" | "inspect";
  /** The value of the ownership label, when found. */
  value?: string;
  /** True when the label (or its value) depends on an ARG/ENV substitution that cannot be resolved offline. */
  unresolved: boolean;
}

/** Split a LABEL instruction body into key/value pairs (handles quotes and the legacy `LABEL key value` form). */
function parseLabelBody(body: string): Array<[string, string]> {
  const tokens: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let started = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (quote) {
      if (c === "\\" && quote === '"' && i + 1 < body.length) {
        cur += body[++i];
      } else if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (c === "\\" && i + 1 < body.length) {
      cur += body[++i];
      started = true;
    } else if (/\s/.test(c)) {
      if (started) tokens.push(cur);
      cur = "";
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (started) tokens.push(cur);
  if (tokens.length === 0) return [];
  // Legacy form: LABEL key value (first token has no "=").
  const first = tokens[0] as string;
  if (!first.includes("=")) return [[first, tokens.slice(1).join(" ")]];
  const pairs: Array<[string, string]> = [];
  for (const t of tokens) {
    const eq = t.indexOf("=");
    if (eq > 0) pairs.push([t.slice(0, eq), t.slice(eq + 1)]);
  }
  return pairs;
}

/** Read the ownership label from the last build stage of a Dockerfile. */
export function readDockerfile(file: string): OciLabels {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new InputError("input.unreadable", { file }, `cannot read ${file}`);
  }
  // Join continuation lines, dropping comment lines inside continuations.
  const logical: string[] = [];
  let acc = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (acc === "" && (line === "" || line.startsWith("#"))) continue;
    if (acc !== "" && line.startsWith("#")) continue;
    if (line.endsWith("\\")) {
      acc += line.slice(0, -1) + " ";
    } else {
      logical.push((acc + line).trim());
      acc = "";
    }
  }
  if (acc.trim() !== "") logical.push(acc.trim());

  let labels = new Map<string, string>();
  for (const instr of logical) {
    const m = /^(\w+)\s+(.*)$/s.exec(instr);
    if (!m) continue;
    const op = (m[1] as string).toUpperCase();
    if (op === "FROM") labels = new Map();
    else if (op === "LABEL") for (const [k, v] of parseLabelBody(m[2] as string)) labels.set(k, v);
  }
  const value = labels.get(OCI_LABEL);
  const unresolved = value !== undefined ? /\$/.test(value) : [...labels.keys()].some((k) => /\$/.test(k));
  return { source: file, kind: "dockerfile", value, unresolved };
}

/** Read the ownership label from `docker inspect` (array or single object) or an image config JSON. */
export function readInspect(file: string): OciLabels {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new InputError("input.bad-inspect", { file }, `${file} is not valid JSON`);
  }
  const obj = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | undefined;
  const cfg = (obj?.Config ?? obj?.config ?? obj) as Record<string, unknown> | undefined;
  const hasLabelsShape = cfg !== undefined && cfg !== null && typeof cfg === "object" && "Labels" in cfg;
  if (!hasLabelsShape) throw new InputError("input.bad-inspect", { file }, `${file} does not look like docker inspect output (no Config.Labels)`);
  const labels = (cfg.Labels ?? {}) as Record<string, unknown>;
  const v = labels[OCI_LABEL];
  return { source: file, kind: "inspect", value: typeof v === "string" ? v : undefined, unresolved: false };
}
