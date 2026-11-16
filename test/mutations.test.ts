import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasKey } from "../src/i18n/index.js";
import { checkRelease } from "../src/index.js";
import type { CheckOptions, Report } from "../src/types.js";
import { makeRelease, type ReleaseOpts } from "./helpers/pack.js";
import { tmpDir } from "./helpers/tmp.js";

const examples = new URL("../examples/", import.meta.url).pathname;

async function run(o: ReleaseOpts): Promise<Report> {
  const r = makeRelease(tmpDir(), o);
  const opts: CheckOptions = { serverJson: r.serverJson, artifacts: [r.artifacts, r.dockerfile] };
  return checkRelease(opts);
}

interface Mutation {
  name: string;
  opts: ReleaseOpts;
  key: string;
  level: "error" | "warn";
}

// One planted mistake per row, each starting from a release that passes.
const MUTATIONS: Mutation[] = [
  { name: "tarball version differs from server.json", opts: { npmTarVersion: "1.1.9" }, key: "npm-version.mismatch", level: "error" },
  { name: "tarball has no mcpName", opts: { npmMcpName: null }, key: "npm-mcp-name.missing", level: "error" },
  { name: "tarball mcpName differs by case", opts: { npmMcpName: "io.github.Example-User/demo-mcp" }, key: "npm-mcp-name.case", level: "error" },
  { name: "tarball mcpName names another server", opts: { npmMcpName: "io.github.example-user/other" }, key: "npm-mcp-name.mismatch", level: "error" },
  { name: "identifier differs from tarball name", opts: { editServer: (s) => (s.packages[0].identifier = "@example-user/other") }, key: "npm-identifier.mismatch", level: "error" },
  { name: "wheel version differs", opts: { wheelVersion: "1.1.0" }, key: "pypi-version.mismatch", level: "error" },
  { name: "wheel token glued to a period", opts: { readme: "# x\n\nmcp-name: io.github.example-user/demo-mcp.\n" }, key: "pypi-mcp-name.glued", level: "error" },
  { name: "wheel token missing", opts: { readme: "# x\n\nno token\n" }, key: "pypi-mcp-name.missing", level: "error" },
  { name: "wheel token differs by case", opts: { readme: "mcp-name: io.github.Example-User/demo-mcp\n" }, key: "pypi-mcp-name.case-only", level: "error" },
  { name: "README not in package metadata", opts: { readme: null }, key: "pypi-mcp-name.no-readme", level: "error" },
  { name: "sdist version differs", opts: { sdistVersion: "1.1.0" }, key: "sdist-version.mismatch", level: "error" },
  { name: "mcpb hash not updated", opts: { mcpbSha: "0".repeat(64) }, key: "mcpb-sha256.mismatch", level: "error" },
  { name: "mcpb URL without 'mcp'", opts: { mcpbUrl: "https://github.com/example-user/demo/releases/download/v1.2.0/bundle.zip" }, key: "mcpb-url.no-mcp", level: "error" },
  { name: "mcpb URL not a release asset", opts: { mcpbUrl: "https://example.com/demo-mcp.mcpb" }, key: "mcpb-url.bad", level: "error" },
  { name: "docker label differs by case", opts: { dockerLabel: "io.github.Example-User/demo-mcp" }, key: "oci-label.case", level: "error" },
  { name: "docker label missing", opts: { dockerLabel: null }, key: "oci-label.missing", level: "error" },
  { name: "oci package has a version field", opts: { editServer: (s) => (s.packages[3].version = "1.2.0") }, key: "forbidden-field.found", level: "error" },
  { name: "only the top-level version was bumped", opts: { serverVersion: "1.3.0", npmPkgVersion: "1.2.0", pypiPkgVersion: "1.2.0" }, key: "version-drift.drift", level: "warn" },
  { name: "mcpb manifest has an old version", opts: { mcpbManifestVersion: "1.1.0" }, key: "mcpb-manifest.mismatch", level: "warn" },
  { name: "oci tag differs from version", opts: { ociTag: "1.1.0" }, key: "oci-tag.mismatch", level: "warn" },
  { name: "namespace owner differs by case", opts: { editServer: (s) => (s.name = "io.github.Example-User/demo-mcp") }, key: "namespace-owner.case", level: "warn" },
];

describe("mutation detection", () => {
  it("the unmodified release has no errors and no warnings", async () => {
    const r = await run({});
    expect(r.findings.filter((f) => f.level === "error" || f.level === "warn")).toEqual([]);
    expect(r.summary.passed).toBeGreaterThanOrEqual(12);
  });

  it("covers at least 12 mutations", () => expect(MUTATIONS.length).toBeGreaterThanOrEqual(12));

  it.each(MUTATIONS)("$name -> $key", async ({ opts, key, level }) => {
    const r = await run(opts);
    const hit = r.findings.find((f) => f.key === key);
    expect(hit, `expected finding ${key}`).toBeDefined();
    expect(hit?.level).toBe(level);
    // Every emitted finding has a message (and a fix for problems) in both languages.
    for (const f of r.findings) {
      for (const lang of ["en", "ko"] as const) {
        expect(hasKey(lang, `f.${f.key}.msg`), `${lang} message for ${f.key}`).toBe(true);
        if (f.level === "error" || f.level === "warn") expect(hasKey(lang, `f.${f.key}.fix`), `${lang} fix for ${f.key}`).toBe(true);
      }
    }
  });

  it("a mutation does not trigger unrelated errors (only expected levels change)", async () => {
    const r = await run({ npmTarVersion: "1.1.9" });
    expect(r.findings.filter((f) => f.level === "error").map((f) => f.rule)).toEqual(["npm-version"]);
  });
});

describe("bundled examples", () => {
  const check = (name: string) =>
    checkRelease({ serverJson: join(examples, name, "server.json"), artifacts: [join(examples, name, "dist")], dockerfile: join(examples, name, "Dockerfile") });

  it("broken: exactly the four planted errors and the drift warning", async () => {
    const r = await check("broken");
    expect(r.findings.filter((f) => f.level === "error").map((f) => f.rule).sort()).toEqual(["mcpb-sha256", "npm-version", "oci-label", "pypi-mcp-name"]);
    expect(r.findings.filter((f) => f.level === "warn").map((f) => f.rule)).toEqual(["version-drift"]);
    expect(r.summary).toMatchObject({ errors: 4, warnings: 1 });
  });

  it("fixed: no errors, no warnings", async () => {
    const r = await check("fixed");
    expect(r.summary).toMatchObject({ errors: 0, warnings: 0 });
  });
});
