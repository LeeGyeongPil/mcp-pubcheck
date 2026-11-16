import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { readTar } from "./archive/tar.js";
import { ArchiveError, InputError, withFile } from "./errors.js";
import type { CheckOptions } from "./types.js";

export type JsonObject = Record<string, unknown>;

/** Line and column (1-based) of a character offset. */
function lineCol(text: string, pos: number): { line: number; col: number } {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  return { line, col: pos - before.lastIndexOf("\n") };
}

/** Best-effort error location from a JSON.parse message (V8 wording differs between versions). */
function locateJsonError(text: string, msg: string): { line: number; col: number } | undefined {
  const lc = /line (\d+) column (\d+)/.exec(msg);
  if (lc) return { line: Number(lc[1]), col: Number(lc[2]) };
  const pos = /position (\d+)/.exec(msg);
  if (pos) return lineCol(text, Number(pos[1]));
  if (/end of JSON input/i.test(msg)) return lineCol(text, text.length);
  const tok = /Unexpected token '(.)'/.exec(msg)?.[1];
  if (tok !== undefined) {
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === tok) return lineCol(text, i);
    }
  }
  return undefined;
}

/** Find an unpaired UTF-16 surrogate written as a `\uXXXX` escape. Returns the offset or -1. */
export function findLoneSurrogateEscape(text: string): number {
  const isHigh = (h: number): boolean => h >= 0xd800 && h <= 0xdbff;
  const isLow = (h: number): boolean => h >= 0xdc00 && h <= 0xdfff;
  const hexAt = (i: number): number => (/^\\u[0-9a-fA-F]{4}/.test(text.slice(i, i + 6)) ? parseInt(text.slice(i + 2, i + 6), 16) : -1);
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\\") continue;
    if (text[i + 1] !== "u") {
      i++;
      continue;
    }
    const v = hexAt(i);
    if (v < 0) continue;
    if (isHigh(v)) {
      const n = hexAt(i + 6);
      if (n >= 0 && isLow(n)) {
        i += 11;
        continue;
      }
      return i;
    }
    if (isLow(v)) return i;
    i += 5;
  }
  return -1;
}

/** Read and parse server.json. Invalid UTF-8, unpaired surrogates and bad JSON raise {@link InputError}. */
export function readServerJson(file: string): JsonObject {
  let buf: Buffer;
  try {
    buf = readFileSync(file);
  } catch {
    throw new InputError("input.unreadable", { file }, `cannot read ${file}`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new InputError("serverjson.bad-utf8", { file }, `${file} is not valid UTF-8`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const where = locateJsonError(text, msg);
    throw new InputError(
      "serverjson.bad-json",
      { file, detail: msg, line: where?.line ?? 0, col: where?.col ?? 0 },
      `${file} is not valid JSON: ${msg}`,
    );
  }
  const lone = findLoneSurrogateEscape(text);
  if (lone >= 0) {
    const w = lineCol(text, lone);
    throw new InputError("serverjson.lone-surrogate", { file, line: w.line, col: w.col }, `${file} contains an unpaired surrogate escape`);
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new InputError("serverjson.not-object", { file }, `${file} must contain a JSON object`);
  }
  return json as JsonObject;
}

export type ArtifactKind = "npm" | "wheel" | "sdist" | "mcpb" | "dockerfile" | "inspect";
export interface ArtifactFile {
  kind: ArtifactKind;
  path: string;
}

/** Everything found on disk that can be compared against server.json. */
export interface Inventory {
  files: ArtifactFile[];
}

function sniffTarGz(path: string): "npm" | "sdist" | undefined {
  try {
    const names = withFile(path, () => readTar(readFileSync(path))).names();
    if (names.some((n) => /^[^/]+\/PKG-INFO$/.test(n))) return "sdist";
    if (names.some((n) => /^[^/]+\/package\.json$/.test(n))) return "npm";
  } catch (e) {
    if (e instanceof ArchiveError) throw e;
  }
  return undefined;
}

function classify(path: string): ArtifactKind | undefined {
  const name = basename(path);
  if (/\.whl$/i.test(name)) return "wheel";
  if (/\.mcpb$/i.test(name)) return "mcpb";
  if (/\.tgz$/i.test(name)) return "npm";
  if (/\.tar\.gz$/i.test(name)) return sniffTarGz(path);
  if (/^Dockerfile$|^Dockerfile\.|\.Dockerfile$/.test(name)) return "dockerfile";
  return undefined;
}

function requireFile(path: string): string {
  if (!existsSync(path) || !statSync(path).isFile()) throw new InputError("input.not-found", { file: path }, `file not found: ${path}`);
  return path;
}

/** Collect artifacts from `--artifacts` directories/files and from the explicit options. */
export function discover(opts: CheckOptions): Inventory {
  const files: ArtifactFile[] = [];
  const seen = new Set<string>();
  const add = (kind: ArtifactKind, path: string): void => {
    const key = `${kind}:${resolve(path)}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push({ kind, path });
  };
  for (const target of opts.artifacts ?? []) {
    if (!existsSync(target)) throw new InputError("input.not-found", { file: target }, `not found: ${target}`);
    if (statSync(target).isDirectory()) {
      for (const entry of readdirSync(target).sort()) {
        const p = join(target, entry);
        if (!statSync(p).isFile()) continue;
        const kind = classify(p);
        if (kind) add(kind, p);
      }
    } else {
      const kind = classify(target);
      if (!kind) throw new InputError("input.unknown-artifact", { file: target }, `cannot tell what kind of artifact this is: ${target}`);
      add(kind, target);
    }
  }
  if (opts.npm) add("npm", requireFile(opts.npm));
  if (opts.wheel) add("wheel", requireFile(opts.wheel));
  if (opts.sdist) add("sdist", requireFile(opts.sdist));
  if (opts.mcpb) add("mcpb", requireFile(opts.mcpb));
  if (opts.dockerfile) add("dockerfile", requireFile(opts.dockerfile));
  if (opts.ociInspect) add("inspect", requireFile(opts.ociInspect));
  return { files };
}

/** `origin` URL from a `.git/config` file next to (or above) server.json. Never runs git. */
export function readGitOrigin(serverJsonPath: string): string | undefined {
  let dir = dirname(resolve(serverJsonPath));
  for (let i = 0; i < 6; i++) {
    const cfg = join(dir, ".git", "config");
    if (existsSync(cfg)) {
      const text = readFileSync(cfg, "utf8");
      const m = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(text);
      return m?.[1];
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
