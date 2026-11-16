import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRelease } from "../src/index.js";
import { network } from "./setup.js";

const root = new URL("../", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("offline", () => {
  it("a full check makes no network call", async () => {
    await checkRelease({ serverJson: join(root, "examples/broken/server.json"), artifacts: [join(root, "examples/broken/dist")], dockerfile: join(root, "examples/broken/Dockerfile") });
    expect(network.calls).toBe(0);
  });
  it("the source never imports a network module", () => {
    for (const f of sourceFiles(join(root, "src"))) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/from "node:(http|https|net|tls|dgram|dns)"/);
      expect(text, f).not.toMatch(/\bfetch\(/);
    }
  });
});

describe("package", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  it("has exactly two runtime dependencies", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["ajv", "ajv-formats"]);
  });
  it("declares bin, engines, license and files", () => {
    expect(pkg.bin["mcp-pubcheck"]).toBe("dist/cli.js");
    expect(pkg.engines.node).toBe(">=20");
    expect(pkg.license).toBe("MIT");
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "schemas", "examples", "THIRD_PARTY_NOTICES.md", "LICENSE"]));
  });
  it("npm pack --dry-run lists the files users need", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const files: string[] = JSON.parse(out)[0].files.map((f: { path: string }) => f.path);
    for (const want of ["dist/cli.js", "dist/i18n/en.json", "dist/i18n/ko.json", "schemas/server.schema.2025-12-11.json", "schemas/report.schema.json", "THIRD_PARTY_NOTICES.md", "LICENSE", "examples/broken/server.json", "examples/fixed/dist/demo-mcp.mcpb"]) {
      expect(files, want).toContain(want);
    }
    expect(files.filter((f) => f.endsWith(".png")), "no screenshots in the package").toEqual([]);
  });
});
