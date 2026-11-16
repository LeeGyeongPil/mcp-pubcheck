// In-memory tar / zip writers and a release builder used to plant one mistake at a time.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, gzipSync } from "node:zlib";

export type Entry = { name: string; data: string | Buffer };
export type TarFormat = "ustar" | "pax" | "gnu";

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

function header(name: string, size: number, type: string, prefix = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write(octal(0o644, 8), 100);
  h.write(octal(0, 8), 108);
  h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124);
  h.write(octal(0, 12), 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7).slice(0, 6) + "\0 ", 148);
  return h;
}

function padded(data: Buffer): Buffer {
  const rem = data.length % 512;
  return rem === 0 ? data : Buffer.concat([data, Buffer.alloc(512 - rem)]);
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`);
}

/** Build a plain tar. `format` decides how names longer than 100 bytes are stored. */
export function tar(entries: Entry[], format: TarFormat = "ustar"): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    if (Buffer.byteLength(e.name) > 100 && format === "pax") {
      const rec = paxRecord("path", e.name);
      parts.push(header("PaxHeader/x", rec.length, "x"), padded(rec));
      parts.push(header(e.name.slice(0, 100), data.length, "0"), padded(data));
    } else if (Buffer.byteLength(e.name) > 100 && format === "gnu") {
      const longName = Buffer.from(e.name + "\0");
      parts.push(header("././@LongLink", longName.length, "L"), padded(longName));
      parts.push(header(e.name.slice(0, 100), data.length, "0"), padded(data));
    } else {
      parts.push(header(e.name, data.length, "0"), padded(data));
    }
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function tgz(entries: Entry[], format: TarFormat = "ustar"): Buffer {
  return gzipSync(tar(entries, format));
}

/** Build a zip with a central directory. */
export function zip(entries: Entry[], method: "store" | "deflate" = "deflate"): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const comp = method === "deflate" ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method === "deflate" ? 8 : 0, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method === "deflate" ? 8 : 0, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Insert a zip64 end-of-central-directory locator, as zip64 writers do. */
export function markZip64(z: Buffer): Buffer {
  const eocd = z.length - 22;
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  return Buffer.concat([z.subarray(0, eocd), locator, z.subarray(eocd)]);
}

export const NAME = "io.github.example-user/demo-mcp";

export interface ReleaseOpts {
  serverVersion?: string;
  npmPkgVersion?: string; // packages[0].version in server.json
  npmTarVersion?: string; // version inside the tarball
  npmMcpName?: string | null; // null = field absent
  pypiPkgVersion?: string;
  wheelVersion?: string;
  sdistVersion?: string;
  readme?: string | null; // README text in METADATA; null = no description at all
  mcpbManifestVersion?: string;
  mcpbSha?: string; // override fileSha256
  mcpbUrl?: string;
  dockerLabel?: string | null; // null = no label
  ociTag?: string;
  editServer?: (server: Record<string, any>) => void;
}

export interface Release {
  dir: string;
  serverJson: string;
  artifacts: string;
  dockerfile: string;
}

/** Write a complete, consistent release into `dir`, then apply the requested mistake. */
export function makeRelease(dir: string, o: ReleaseOpts = {}): Release {
  const v = o.serverVersion ?? "1.2.0";
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });

  const pkgJson: Record<string, unknown> = { name: "@example-user/demo-mcp", version: o.npmTarVersion ?? v };
  if (o.npmMcpName !== null) pkgJson.mcpName = o.npmMcpName ?? NAME;
  writeFileSync(join(dist, "example-user-demo-mcp.tgz"), tgz([{ name: "package/package.json", data: JSON.stringify(pkgJson) }]));

  const readme = o.readme === undefined ? `# demo\n\n<!-- mcp-name: ${NAME} -->\n` : o.readme;
  const meta = (version: string): string =>
    `Metadata-Version: 2.4\nName: demo-mcp\nVersion: ${version}\nSummary: demo\n${readme === null ? "" : "Description-Content-Type: text/markdown\n"}\n${readme ?? ""}`;
  writeFileSync(join(dist, "demo_mcp-1.2.0-py3-none-any.whl"), zip([{ name: "demo_mcp-1.2.0.dist-info/METADATA", data: meta(o.wheelVersion ?? v) }]));
  writeFileSync(join(dist, "demo_mcp-1.2.0.tar.gz"), tgz([{ name: "demo_mcp-1.2.0/PKG-INFO", data: meta(o.sdistVersion ?? v) }]));

  const bundle = zip([{ name: "manifest.json", data: JSON.stringify({ name: "demo-mcp", version: o.mcpbManifestVersion ?? v }) }]);
  writeFileSync(join(dist, "demo-mcp.mcpb"), bundle);
  const sha = createHash("sha256").update(bundle).digest("hex");

  const label = o.dockerLabel === undefined ? NAME : o.dockerLabel;
  const dockerfile = join(dir, "Dockerfile");
  writeFileSync(dockerfile, `FROM node:22-alpine\n${label === null ? "" : `LABEL io.modelcontextprotocol.server.name="${label}"\n`}ENTRYPOINT ["node"]\n`);

  const server: Record<string, any> = {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: NAME,
    description: "Practice server used by the tests.",
    repository: { url: "https://github.com/example-user/demo-mcp", source: "github" },
    version: v,
    packages: [
      { registryType: "npm", identifier: "@example-user/demo-mcp", version: o.npmPkgVersion ?? v, transport: { type: "stdio" } },
      { registryType: "pypi", identifier: "demo-mcp", version: o.pypiPkgVersion ?? v, transport: { type: "stdio" } },
      { registryType: "mcpb", identifier: o.mcpbUrl ?? `https://github.com/example-user/demo-mcp/releases/download/v${v}/demo-mcp.mcpb`, fileSha256: o.mcpbSha ?? sha, transport: { type: "stdio" } },
      { registryType: "oci", identifier: `ghcr.io/example-user/demo-mcp:${o.ociTag ?? v}`, transport: { type: "stdio" } },
    ],
  };
  o.editServer?.(server);
  const serverJson = join(dir, "server.json");
  writeFileSync(serverJson, JSON.stringify(server, null, 2));
  return { dir, serverJson, artifacts: dist, dockerfile };
}
