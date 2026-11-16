import { readFileSync } from "node:fs";
import { readTar } from "../archive/tar.js";
import { readZip } from "../archive/zip.js";
import { ArchiveError, withFile } from "../errors.js";

export interface PypiFacts {
  file: string;
  kind: "wheel" | "sdist";
  name?: string;
  version?: string;
  /** Long description text (README), or undefined when the metadata carries none. */
  description?: string;
}

/** PEP 503 name normalisation. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** Parse core metadata (RFC 822 headers, blank line, optional body = long description). */
export function parseCoreMetadata(text: string): { name?: string; version?: string; description?: string } {
  const split = /\r?\n\r?\n/.exec(text);
  const head = split ? text.slice(0, split.index) : text;
  const body = split ? text.slice(split.index + split[0].length) : "";
  const headers = new Map<string, string[]>();
  let last: string[] | undefined;
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && last) {
      last[last.length - 1] += "\n" + line.replace(/^( {7}\||[ \t]{1,8})/, "");
      continue;
    }
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/.exec(line);
    if (!m || !m[1]) continue;
    const key = m[1].toLowerCase();
    const list = headers.get(key) ?? [];
    list.push(m[2] ?? "");
    headers.set(key, list);
    last = list;
  }
  const headerDescription = headers.get("description")?.join("\n");
  const description = body.trim() !== "" ? body : headerDescription && headerDescription.trim() !== "" ? headerDescription : undefined;
  return { name: headers.get("name")?.[0], version: headers.get("version")?.[0], description };
}

/** Read `*.dist-info/METADATA` from a wheel. */
export function readWheel(file: string): PypiFacts {
  const zip = withFile(file, () => readZip(readFileSync(file)));
  const entry = zip.names().find((n) => /^[^/]+\.dist-info\/METADATA$/.test(n));
  const raw = entry ? withFile(file, () => zip.read(entry)) : undefined;
  if (!raw) throw new ArchiveError("archive.wheel-no-metadata", { file }, `no .dist-info/METADATA found in ${file}`);
  return { file, kind: "wheel", ...parseCoreMetadata(raw.toString("utf8")) };
}

/** Read `<root>/PKG-INFO` from an sdist (.tar.gz). */
export function readSdist(file: string): PypiFacts {
  const tar = withFile(file, () => readTar(readFileSync(file)));
  const entry = tar.names().find((n) => /^[^/]+\/PKG-INFO$/.test(n));
  const raw = entry ? tar.read(entry) : undefined;
  if (!raw) throw new ArchiveError("archive.sdist-no-pkginfo", { file }, `no PKG-INFO found in ${file}`);
  return { file, kind: "sdist", ...parseCoreMetadata(raw.toString("utf8")) };
}
