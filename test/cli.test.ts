import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/main.js";
import { markZip64, zip } from "./helpers/pack.js";
import { makeRelease } from "./helpers/pack.js";
import { tmpDir } from "./helpers/tmp.js";

const root = new URL("../", import.meta.url).pathname;
const ex = (p: string) => join(root, "examples", p);
const reportSchema = JSON.parse(readFileSync(join(root, "schemas", "report.schema.json"), "utf8"));

async function run(args: string[], env: Record<string, string> = { LANG: "C" }): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await runCli(args, env, { out: (s) => (out += s + "\n"), err: (s) => (err += s + "\n"), isTTY: false });
  return { code, out, err };
}

const brokenArgs = [ex("broken/server.json"), "--artifacts", ex("broken/dist"), "--dockerfile", ex("broken/Dockerfile")];
const fixedArgs = [ex("fixed/server.json"), "--artifacts", ex("fixed/dist"), "--dockerfile", ex("fixed/Dockerfile")];

describe("first run (demo)", () => {
  it("shows the five rule IDs, the summary and says it is a practice example; exit 0", async () => {
    const r = await run(["demo"]);
    expect(r.code).toBe(0);
    for (const id of ["npm-version", "pypi-mcp-name", "mcpb-sha256", "oci-label", "version-drift"]) expect(r.out).toContain(id);
    expect(r.out).toContain("4 errors, 1 warning");
    expect(r.out).toContain("practice example");
  });

  it("works as the real binary (npm start runs `node dist/cli.js demo`)", () => {
    if (!existsSync(join(root, "dist", "cli.js"))) return; // built by `pretest`
    const out = execFileSync("node", [join(root, "dist", "cli.js"), "demo"], { env: { PATH: process.env.PATH ?? "", LANG: "C" }, encoding: "utf8" });
    expect(out).toContain("4 errors, 1 warning");
  });

  it("demo --json is valid JSON marked as demo", async () => {
    const j = JSON.parse((await run(["demo", "--json"])).out);
    expect(j.demo).toBe(true);
    expect(new Ajv({ strict: false }).validate(reportSchema, j)).toBe(true);
  });
});

describe("exit codes", () => {
  it("broken example exits 1, fixed example exits 0", async () => {
    const b = await run(brokenArgs);
    expect(b.code).toBe(1);
    expect(b.out).toContain("4 errors, 1 warning");
    const f = await run(fixedArgs);
    expect(f.code).toBe(0);
    expect(f.out).toContain("0 errors");
  });

  it("warnings alone exit 0, and 1 with --strict", async () => {
    const r = makeRelease(tmpDir(), { mcpbManifestVersion: "1.0.0" });
    const args = [r.serverJson, "--artifacts", r.artifacts, "--dockerfile", r.dockerfile];
    expect((await run(args)).code).toBe(0);
    expect((await run([...args, "--strict"])).code).toBe(1);
  });

  it("a missing server.json exits 2 with a helpful message", async () => {
    const r = await run([join(tmpDir(), "nope.json")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not found");
  });

  it("an unknown artifact type exits 2", async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "notes.txt"), "x");
    const r = makeRelease(tmpDir());
    expect((await run([r.serverJson, "--artifacts", join(dir, "notes.txt")])).code).toBe(2);
  });

  it("a truncated tarball exits 2", async () => {
    const r = makeRelease(tmpDir());
    const tgz = join(r.artifacts, "example-user-demo-mcp.tgz");
    truncateSync(tgz, 40);
    const res = await run([r.serverJson, "--npm", tgz]);
    expect(res.code).toBe(2);
    expect(res.err).toContain("example-user-demo-mcp.tgz");
  });

  it("a zip64 wheel exits 2 and says so", async () => {
    const r = makeRelease(tmpDir());
    const whl = join(r.artifacts, "demo_mcp-1.2.0-py3-none-any.whl");
    writeFileSync(whl, markZip64(zip([{ name: "demo_mcp-1.2.0.dist-info/METADATA", data: "Name: demo-mcp\n" }])));
    const res = await run([r.serverJson, "--wheel", whl]);
    expect(res.code).toBe(2);
    expect(res.err).toContain("zip64");
  });

  it("invalid JSON exits 2 with line and column", async () => {
    const f = join(tmpDir(), "server.json");
    writeFileSync(f, '{\n  "name": oops\n}');
    const r = await run([f]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/line 2/);
  });

  it("unknown options and extra arguments exit 2", async () => {
    expect((await run(["--nope"])).code).toBe(2);
    expect((await run(["a.json", "b.json"])).code).toBe(2);
  });

  it("a package without artifact is a warning, an error with --require-all", async () => {
    const r = makeRelease(tmpDir());
    rmSync(join(r.artifacts, "demo-mcp.mcpb"));
    const args = [r.serverJson, "--artifacts", r.artifacts, "--dockerfile", r.dockerfile];
    const soft = await run(args);
    expect(soft.code).toBe(0);
    expect(soft.out).toContain("skipped");
    const hard = await run([...args, "--require-all"]);
    expect(hard.code).toBe(1);
  });

  it("explicit --wheel/--sdist/--mcpb/--npm/--oci-inspect options work", async () => {
    const r = makeRelease(tmpDir());
    writeFileSync(join(r.dir, "inspect.json"), JSON.stringify([{ Config: { Labels: { "io.modelcontextprotocol.server.name": "io.github.example-user/demo-mcp" } } }]));
    const a = r.artifacts;
    const res = await run([r.serverJson, "--npm", join(a, "example-user-demo-mcp.tgz"), "--wheel", join(a, "demo_mcp-1.2.0-py3-none-any.whl"), "--sdist", join(a, "demo_mcp-1.2.0.tar.gz"), "--mcpb", join(a, "demo-mcp.mcpb"), "--oci-inspect", join(r.dir, "inspect.json"), "--require-all"]);
    expect(res.out).toContain("0 errors");
    expect(res.code).toBe(0);
  });
});

describe("--json", () => {
  it("validates against schemas/report.schema.json and keeps rule IDs the same in both languages", async () => {
    const en = JSON.parse((await run([...brokenArgs, "--json", "--lang", "en"])).out);
    const ko = JSON.parse((await run([...brokenArgs, "--json", "--lang", "ko"])).out);
    const ajv = new Ajv({ strict: false });
    expect(ajv.validate(reportSchema, en), JSON.stringify(ajv.errors)).toBe(true);
    expect(ajv.validate(reportSchema, ko)).toBe(true);
    const ids = (j: any) => j.findings.map((f: any) => [f.rule, f.level, f.key]);
    expect(ids(ko)).toEqual(ids(en));
    expect(en.findings.find((f: any) => f.rule === "npm-version").message).not.toEqual(ko.findings.find((f: any) => f.rule === "npm-version").message);
    expect(en.summary).toMatchObject({ errors: 4, warnings: 1 });
  });

  it("is plain JSON without color codes", async () => {
    const out = (await run([...fixedArgs, "--json"])).out;
    expect(out).not.toContain("\u001b[");
    expect(() => JSON.parse(out)).not.toThrow();
  });
});

describe("color", () => {
  it("uses colors only on a TTY without NO_COLOR", async () => {
    const go = async (env: Record<string, string>, tty: boolean, extra: string[] = []) => {
      let out = "";
      await runCli([...brokenArgs, ...extra], env, { out: (s) => (out += s), err: () => {}, isTTY: tty });
      return out;
    };
    expect(await go({ LANG: "C" }, true)).toContain("\u001b[");
    expect(await go({ LANG: "C" }, false)).not.toContain("\u001b[");
    expect(await go({ LANG: "C", NO_COLOR: "1" }, true)).not.toContain("\u001b[");
    expect(await go({ LANG: "C" }, true, ["--no-color"])).not.toContain("\u001b[");
  });
});

describe("spawned binary", () => {
  it("returns the exit code of the process", () => {
    if (!existsSync(join(root, "dist", "cli.js"))) return;
    const p = spawnSync("node", [join(root, "dist", "cli.js"), ...brokenArgs], { env: { PATH: process.env.PATH ?? "", LANG: "C" }, encoding: "utf8" });
    expect(p.status).toBe(1);
  });
});
