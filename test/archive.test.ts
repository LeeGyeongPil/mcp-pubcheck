import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTar } from "../src/archive/tar.js";
import { readZip } from "../src/archive/zip.js";
import { readMcpb } from "../src/artifacts/mcpb.js";
import { readNpmTarball } from "../src/artifacts/npm.js";
import { readSdist, readWheel } from "../src/artifacts/pypi.js";
import { ArchiveError, UnsupportedArchiveError } from "../src/errors.js";
import { markZip64, tar, tgz, zip } from "./helpers/pack.js";
import { tmpDir } from "./helpers/tmp.js";

const real = new URL("./fixtures/real/", import.meta.url).pathname;
const LONG = "package/" + "deep/".repeat(30) + "file.txt"; // > 100 bytes

describe("real artifacts made by npm pack, uv build and zip", () => {
  it("reads the npm tarball", () => {
    const f = readNpmTarball(join(real, "example-user-demo-mcp-1.2.0.tgz"));
    expect(f).toMatchObject({ name: "@example-user/demo-mcp", version: "1.2.0", mcpName: "io.github.example-user/demo-mcp" });
  });
  it("reads the wheel (deflate) and the sdist", () => {
    const w = readWheel(join(real, "demo_mcp-1.2.0-py3-none-any.whl"));
    expect(w).toMatchObject({ name: "demo-mcp", version: "1.2.0" });
    expect(w.description).toContain("mcp-name: io.github.example-user/demo-mcp");
    const s = readSdist(join(real, "demo_mcp-1.2.0.tar.gz"));
    expect(s).toMatchObject({ name: "demo-mcp", version: "1.2.0" });
    expect(s.description).toContain("mcp-name:");
  });
  it("reads the mcpb manifest and hashes the file", () => {
    const m = readMcpb(join(real, "demo-mcp.mcpb"));
    expect(m.manifestVersion).toBe("1.2.0");
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("tar variants", () => {
  const entries = [{ name: LONG, data: "hello" }, { name: "package/package.json", data: "{}" }];
  it.each(["pax", "gnu"] as const)("long names in %s format", (fmt) => {
    const a = readTar(tgz(entries, fmt));
    expect(a.read(LONG)?.toString()).toBe("hello");
    expect(a.read("package/package.json")?.toString()).toBe("{}");
  });
  it("reads a plain (uncompressed) tar", () => {
    expect(readTar(tar([{ name: "a.txt", data: "x" }])).read("a.txt")?.toString()).toBe("x");
  });
  it("reads pax and GNU long names written by the system tar", () => {
    const dir = tmpDir();
    const deep = join(dir, "src", ...Array.from({ length: 30 }, () => "deep"));
    execFileSync("mkdir", ["-p", deep]);
    writeFileSync(join(deep, "f.txt"), "system");
    for (const fmt of ["pax", "gnutar"]) {
      const out = join(dir, `${fmt}.tar.gz`);
      try {
        execFileSync("tar", ["--format", fmt, "-czf", out, "-C", join(dir, "src"), "deep"]);
      } catch {
        continue; // this tar does not know the format; the in-memory tests above still cover it
      }
      const names = readTar(readFileSync(out)).names();
      expect(names.some((n) => n.endsWith("deep/f.txt") && n.length > 100)).toBe(true);
    }
  });
  it("reports a truncated gzip as an archive error", () => {
    const full = tgz([{ name: "package/package.json", data: "{}" }]);
    expect(() => readTar(full.subarray(0, full.length - 10))).toThrow(ArchiveError);
  });
  it("reports a cut-off tar entry as truncated", () => {
    const raw = tar([{ name: "a", data: "x".repeat(2000) }]);
    expect(() => readTar(raw.subarray(0, 700))).toThrow(/truncated/);
  });
  it("rejects a corrupt header checksum", () => {
    const raw = Buffer.from(tar([{ name: "a", data: "x" }]));
    raw[0] = 0x7a;
    expect(() => readTar(raw)).toThrow(ArchiveError);
  });
});

describe("zip variants", () => {
  const entries = [{ name: "a.txt", data: "stored or deflated" }, { name: "dir/b.txt", data: "b".repeat(500) }];
  it.each(["store", "deflate"] as const)("reads %s entries", (method) => {
    const z = readZip(zip(entries, method));
    expect(z.read("a.txt")?.toString()).toBe("stored or deflated");
    expect(z.read("dir/b.txt")?.toString()).toBe("b".repeat(500));
    expect(z.read("missing")).toBeUndefined();
  });
  it("refuses zip64 explicitly", () => {
    expect(() => readZip(markZip64(zip(entries)))).toThrow(UnsupportedArchiveError);
  });
  it("reports a truncated zip as an archive error", () => {
    const z = zip(entries);
    expect(() => readZip(z.subarray(0, z.length - 30))).toThrow(ArchiveError);
  });
  it("reports non-zip data", () => {
    expect(() => readZip(Buffer.from("definitely not a zip file at all"))).toThrow(/zip/);
  });
});
