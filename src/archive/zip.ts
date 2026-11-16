import { inflateRawSync } from "node:zlib";
import { ArchiveError, UnsupportedArchiveError } from "../errors.js";
import type { Archive } from "./index.js";

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const MAX_ENTRY = 256 * 1024 * 1024;

interface Entry {
  method: number;
  csize: number;
  usize: number;
  localOffset: number;
}

/**
 * Read a zip file through its central directory. Entries are inflated lazily.
 * Supports stored and deflate; zip64 and encrypted entries raise {@link UnsupportedArchiveError}.
 */
export function readZip(buf: Buffer): Archive {
  const minEocd = 22;
  let eocd = -1;
  const stop = Math.max(0, buf.length - minEocd - 0xffff);
  for (let i = buf.length - minEocd; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ArchiveError("archive.zip-corrupt", { detail: "zip-no-eocd" }, "not a zip file or truncated");
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) {
    throw new UnsupportedArchiveError("archive.zip64", {}, "zip64 archives are not supported");
  }
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new UnsupportedArchiveError("archive.zip64", {}, "zip64 archives are not supported");
  }
  if (cdOffset + cdSize > buf.length) throw new ArchiveError("archive.zip-corrupt", { detail: "zip-cd-range" }, "zip is truncated");

  const entries = new Map<string, Entry>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) {
      throw new ArchiveError("archive.zip-corrupt", { detail: "zip-cd-entry" }, "corrupt zip central directory");
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) {
      throw new UnsupportedArchiveError("archive.zip64", {}, "zip64 archives are not supported");
    }
    if (flags & 1) throw new UnsupportedArchiveError("archive.zip-encrypted", {}, "encrypted zip entries are not supported");
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    if (!name.endsWith("/")) entries.set(name, { method, csize, usize, localOffset });
    p += 46 + nlen + elen + clen;
  }

  return {
    names: () => [...entries.keys()],
    read(name: string): Buffer | undefined {
      const e = entries.get(name);
      if (!e) return undefined;
      if (e.localOffset + 30 > buf.length || buf.readUInt32LE(e.localOffset) !== LOC_SIG) {
        throw new ArchiveError("archive.zip-corrupt", { detail: "zip-local-header", name }, "corrupt zip local header");
      }
      const start = e.localOffset + 30 + buf.readUInt16LE(e.localOffset + 26) + buf.readUInt16LE(e.localOffset + 28);
      if (start + e.csize > buf.length) throw new ArchiveError("archive.zip-corrupt", { detail: "zip-entry-truncated", name }, "zip entry is truncated");
      const raw = buf.subarray(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) {
        try {
          return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY });
        } catch {
          throw new ArchiveError("archive.zip-corrupt", { detail: "zip-inflate", name }, "corrupt deflate data in zip");
        }
      }
      throw new UnsupportedArchiveError("archive.zip-method", { method: e.method }, `unsupported zip compression method ${e.method}`);
    },
  };
}
