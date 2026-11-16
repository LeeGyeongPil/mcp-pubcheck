import { gunzipSync } from "node:zlib";
import { ArchiveError, UnsupportedArchiveError } from "../errors.js";
import type { Archive } from "./index.js";

const BLOCK = 512;
const MAX_GUNZIP = 512 * 1024 * 1024;

function cString(buf: Buffer): string {
  const end = buf.indexOf(0);
  return buf.subarray(0, end < 0 ? buf.length : end).toString("utf8");
}

function parseNumber(field: Buffer): number {
  // GNU base-256 encoding for very large values.
  if ((field[0] ?? 0) & 0x80) {
    let n = (field[0] ?? 0) & 0x7f;
    for (let i = 1; i < field.length; i++) n = n * 256 + (field[i] ?? 0);
    return n;
  }
  const text = cString(field).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError("archive.tar-corrupt", { detail: "tar-bad-number" }, "corrupt tar header");
  return parseInt(text, 8);
}

function checksumOk(hdr: Buffer): boolean {
  const stored = parseNumber(hdr.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (hdr[i] ?? 0);
  return sum === stored;
}

/** Parse pax extended header records (`<len> <key>=<value>\n`). */
function parsePax(data: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let off = 0;
  while (off < data.length) {
    const space = data.indexOf(0x20, off);
    if (space < 0) break;
    const len = parseInt(data.subarray(off, space).toString("ascii"), 10);
    if (!Number.isFinite(len) || len <= 0 || off + len > data.length) {
      throw new ArchiveError("archive.tar-corrupt", { detail: "tar-bad-pax" }, "corrupt tar pax header");
    }
    const record = data.subarray(space + 1, off + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    off += len;
  }
  return out;
}

/**
 * Read a tar stream (gzip-compressed or plain). Supports ustar, pax `path`/`size` and GNU long names.
 * Sparse files and multi-volume archives raise {@link UnsupportedArchiveError}.
 */
export function readTar(input: Buffer): Archive {
  let buf = input;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = gunzipSync(buf, { maxOutputLength: MAX_GUNZIP });
    } catch {
      throw new ArchiveError("archive.gzip-corrupt", {}, "corrupt or truncated gzip data");
    }
  }
  const files = new Map<string, Buffer>();
  let off = 0;
  let nextPath: string | undefined;
  let nextSize: number | undefined;
  let sawEnd = false;
  while (off + BLOCK <= buf.length) {
    const hdr = buf.subarray(off, off + BLOCK);
    if (hdr.every((b) => b === 0)) {
      sawEnd = true;
      break;
    }
    if (!checksumOk(hdr)) throw new ArchiveError("archive.tar-corrupt", { detail: "tar-bad-checksum" }, "corrupt tar header (checksum)");
    const type = String.fromCharCode(hdr[156] || 48);
    let size = parseNumber(hdr.subarray(124, 136));
    const dataStart = off + BLOCK;
    const isMeta = type === "x" || type === "g" || type === "L" || type === "K";
    if (!isMeta && nextSize !== undefined) size = nextSize;
    if (dataStart + size > buf.length) throw new ArchiveError("archive.tar-truncated", {}, "tar archive is truncated");
    const data = buf.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      const pax = parsePax(data);
      if (pax.has("path")) nextPath = pax.get("path");
      if (pax.has("size")) nextSize = parseInt(pax.get("size") ?? "0", 10);
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      nextPath = cString(data);
      continue;
    }
    if (type === "K") continue;
    if (type === "S" || type === "M" || type === "V") {
      throw new UnsupportedArchiveError("archive.tar-unsupported", { type }, `unsupported tar entry type '${type}'`);
    }
    let name = nextPath;
    if (name === undefined) {
      const base = cString(hdr.subarray(0, 100));
      const magic = hdr.subarray(257, 262).toString("ascii");
      const prefix = magic === "ustar" ? cString(hdr.subarray(345, 500)) : "";
      name = prefix ? `${prefix}/${base}` : base;
    }
    nextPath = undefined;
    nextSize = undefined;
    if (type === "0" || type === "\0" || type === "7") files.set(name.replace(/^\.\//, ""), data);
  }
  if (!sawEnd && off < buf.length) throw new ArchiveError("archive.tar-truncated", {}, "tar archive is truncated");
  if (!sawEnd && files.size === 0) throw new ArchiveError("archive.tar-corrupt", { detail: "tar-no-entries" }, "not a tar archive");
  return { names: () => [...files.keys()], read: (n) => files.get(n) };
}
