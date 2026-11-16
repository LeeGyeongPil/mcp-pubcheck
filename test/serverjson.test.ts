import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRelease } from "../src/index.js";
import { InputError } from "../src/errors.js";
import { findLoneSurrogateEscape } from "../src/load.js";
import { checkServerJson, versionProblem } from "../src/rules/serverjson.js";
import { tmpDir } from "./helpers/tmp.js";

const base = () => ({
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: "io.github.example-user/demo-mcp",
  description: "demo",
  repository: { url: "https://github.com/example-user/demo-mcp", source: "github" },
  version: "1.0.0",
  packages: [] as Record<string, unknown>[],
});
const keys = (s: Record<string, unknown>) => checkServerJson(s).filter((f) => f.level !== "ok").map((f) => f.key);

describe("rules the schema cannot express", () => {
  it("suggests the right key for snake_case typos", () => {
    const s = base();
    s.packages.push({ registry_type: "npm", identifier: "x", version: "1.0.0", file_sha256: "0".repeat(64) });
    const f = checkServerJson(s).filter((x) => x.rule === "typo-key");
    expect(f.map((x) => [x.actual, x.expected])).toEqual([["registry_type", "registryType"], ["file_sha256", "fileSha256"]]);
  });
  it("does not flag keys that are fine, nor keys inside _meta", () => {
    const s = { ...base(), _meta: { "io.example/x": { registry_type: 1 } } };
    expect(keys(s)).toEqual(["meta-keys.dropped"]);
  });
  it.each([["latest", "latest"], ["*", "latest"], ["^1.2.0", "range"], ["~1.2", "range"], ["1.x", "range"], [">=1.0.0", "range"], ["1.0.0 - 2.0.0", "range"]])(
    "version %s is a %s problem",
    (v, kind) => expect(versionProblem(v)).toBe(kind),
  );
  it.each(["1.2.3", "1.0.0-beta.1", "2026.11.17", "1.2.3+build.5"])("version %s is accepted", (v) => expect(versionProblem(v)).toBeUndefined());
  it("flags latest and ranges in version fields", () => {
    const s = base();
    s.version = "latest";
    s.packages.push({ registryType: "npm", identifier: "x", version: "^1.2.0" });
    expect(keys(s)).toEqual(["version-range.latest", "version-range.range"]);
  });
  it("flags fields that are forbidden for a package type", () => {
    const s = base();
    s.packages.push(
      { registryType: "oci", identifier: "ghcr.io/a/b:1", version: "1", registryBaseUrl: "https://ghcr.io" },
      { registryType: "npm", identifier: "x", version: "1", fileSha256: "0".repeat(64) },
      { registryType: "pypi", identifier: "y", version: "1", fileSha256: "0".repeat(64) },
      { registryType: "mcpb", identifier: "https://github.com/a/b/releases/download/v1/mcp.mcpb", fileSha256: "0".repeat(64), registryBaseUrl: "https://github.com" },
    );
    const f = checkServerJson(s).filter((x) => x.rule === "forbidden-field").map((x) => x.where);
    expect(f).toEqual(["packages[0].version", "packages[0].registryBaseUrl", "packages[1].fileSha256", "packages[2].fileSha256", "packages[3].registryBaseUrl"]);
  });
  it("checks the registryBaseUrl allow list", () => {
    const s = base();
    s.packages.push({ registryType: "npm", identifier: "x", version: "1", registryBaseUrl: "https://npm.example.com" }, { registryType: "pypi", identifier: "y", version: "1", registryBaseUrl: "https://pypi.org/" });
    expect(keys(s)).toEqual(["registry-base-url.disallowed"]);
  });
  it("warns about _meta keys that are dropped and errors above 4 KB", () => {
    const small = { ...base(), _meta: { "io.modelcontextprotocol.registry/publisher-provided": { a: 1 }, "other.key": {} } };
    expect(keys(small)).toEqual(["meta-keys.dropped"]);
    const big = { ...base(), _meta: { "io.modelcontextprotocol.registry/publisher-provided": { blob: "x".repeat(5000) } } };
    expect(keys(big)).toEqual(["meta-size.too-large"]);
    const edge = { ...base(), _meta: { "io.modelcontextprotocol.registry/publisher-provided": { blob: "x".repeat(4096 - 11) } } };
    expect(keys(edge)).toEqual([]);
  });
  it("compares the namespace owner with the repository owner, case-sensitively", () => {
    const wrong = { ...base(), name: "io.github.someone-else/demo-mcp" };
    expect(keys(wrong)).toEqual(["namespace-owner.mismatch"]);
    const caseOnly = { ...base(), name: "io.github.Example-User/demo-mcp" };
    const f = checkServerJson(caseOnly).find((x) => x.rule === "namespace-owner");
    expect(f).toMatchObject({ key: "namespace-owner.case", level: "warn" });
    expect(keys({ ...base(), name: "com.example/demo" })).toEqual([]);
  });
  it("uses --repo-url when given", () => {
    expect(checkServerJson(base(), { repoUrl: "https://github.com/other/demo-mcp" }).map((f) => f.key)).toContain("namespace-owner.mismatch");
  });
});

describe("reading server.json", () => {
  const write = (text: string | Buffer): string => {
    const f = join(tmpDir(), "server.json");
    writeFileSync(f, text);
    return f;
  };
  it("finds lone surrogate escapes but accepts valid pairs", () => {
    expect(findLoneSurrogateEscape('{"a":"\\ud83d\\ude00"}')).toBe(-1);
    expect(findLoneSurrogateEscape('{"a":"\\ud83d x"}')).toBeGreaterThan(0);
    expect(findLoneSurrogateEscape('{"a":"\\ude00"}')).toBeGreaterThan(0);
    expect(findLoneSurrogateEscape('{"a":"\\\\ud83d"}')).toBe(-1);
  });
  it("rejects a lone surrogate with a position (exit 2 class)", async () => {
    await expect(checkRelease({ serverJson: write('{"description":"\\ud83d"}') })).rejects.toMatchObject({ key: "serverjson.lone-surrogate" });
  });
  it("rejects invalid JSON with line and column", async () => {
    const err = await checkRelease({ serverJson: write('{\n  "name": oops\n}') }).catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect(err.key).toBe("serverjson.bad-json");
    expect(err.params.line).toBe(2);
  });
  it("rejects invalid UTF-8 and non-object JSON", async () => {
    await expect(checkRelease({ serverJson: write(Buffer.from([0x7b, 0xff, 0x7d])) })).rejects.toMatchObject({ key: "serverjson.bad-utf8" });
    await expect(checkRelease({ serverJson: write("[1,2]") })).rejects.toMatchObject({ key: "serverjson.not-object" });
  });
  it("accepts a UTF-8 BOM", async () => {
    const r = await checkRelease({ serverJson: write("﻿" + JSON.stringify(base())) });
    expect(r.summary.errors).toBe(0);
  });
  it("reports schema violations and a different $schema version", async () => {
    const r = await checkRelease({ serverJson: write(JSON.stringify({ name: "no-slash", version: "1.0.0", $schema: "https://example.com/other.json" })) });
    expect(r.findings.some((f) => f.rule === "schema" && f.level === "error")).toBe(true);
    expect(r.findings.some((f) => f.key === "schema-version.other")).toBe(true);
  });
});
