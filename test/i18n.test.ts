import { describe, expect, it } from "vitest";
import { messageTables, resolveLang, t } from "../src/i18n/index.js";
import { runCli } from "../src/main.js";

async function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await runCli(args, env, { out: (s) => (out += s + "\n"), err: (s) => (err += s + "\n"), isTTY: false });
  return { code, out, err };
}

describe("message tables", () => {
  const { en, ko } = messageTables();
  const placeholders = (v: string | string[]): string[] => [...(Array.isArray(v) ? v.join("\n") : v).matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

  it("English and Korean have exactly the same keys", () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
  });
  it("every message uses the same placeholders in both languages", () => {
    for (const key of Object.keys(en)) expect(placeholders(ko[key] as string), key).toEqual(placeholders(en[key] as string));
  });
  it("no message is empty", () => {
    for (const table of [en, ko]) for (const [k, v] of Object.entries(table)) expect((Array.isArray(v) ? v.join("") : v).trim(), k).not.toBe("");
  });
  it("fills placeholders and falls back to the key for unknown messages", () => {
    expect(t("en", "summary.errors.other", { n: 4 })).toBe("4 errors");
    expect(t("ko", "summary.errors.other", { n: 4 })).toBe("오류 4건");
    expect(t("en", "no.such.key")).toBe("no.such.key");
  });
});

describe("language selection", () => {
  it("--help --lang ko prints Korean, --lang en prints English", async () => {
    expect((await run(["--help", "--lang", "ko"])).out).toContain("사용법");
    const en = (await run(["--help", "--lang", "en"])).out;
    expect(en).toContain("Usage");
    expect(en).not.toContain("사용법");
  });
  it("MCP_PUBCHECK_LANG=ko selects Korean", async () => {
    expect((await run(["--help"], { MCP_PUBCHECK_LANG: "ko" })).out).toContain("사용법");
  });
  it("--lang en beats MCP_PUBCHECK_LANG=ko", async () => {
    expect((await run(["--help", "--lang", "en"], { MCP_PUBCHECK_LANG: "ko" })).out).toContain("Usage");
  });
  it("LANG=ko_KR.UTF-8 selects Korean; LANG=fr_FR.UTF-8 selects English", async () => {
    expect((await run(["--help"], { LANG: "ko_KR.UTF-8" })).out).toContain("사용법");
    expect((await run(["--help"], { LANG: "fr_FR.UTF-8" })).out).toContain("Usage");
  });
  it("follows the documented order MCP_PUBCHECK_LANG > LC_ALL > LC_MESSAGES > LANG", () => {
    expect(resolveLang(undefined, { MCP_PUBCHECK_LANG: "en", LC_ALL: "ko_KR", LANG: "ko_KR" })).toBe("en");
    expect(resolveLang(undefined, { LC_ALL: "ko_KR", LC_MESSAGES: "en_US", LANG: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, { LC_MESSAGES: "ko_KR", LANG: "en_US" })).toBe("ko");
    expect(resolveLang(undefined, {})).toBe("en");
    expect(resolveLang("ko", { LANG: "en_US" })).toBe("ko");
  });
  it("the report text switches language", async () => {
    const ko = await run(["demo"], { LANG: "ko_KR.UTF-8" });
    const en = await run(["demo"], { LANG: "C" });
    expect(ko.out).toContain("오류 4건, 경고 1건");
    expect(en.out).toContain("4 errors, 1 warning");
    expect(ko.out).toContain("npm-version");
    expect(en.out).toContain("npm-version");
  });
  it("rejects an unknown --lang value with exit 2", async () => {
    const r = await run(["--lang", "fr", "demo"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("fr");
  });
});

describe("Korean output has no English sentence fragments", () => {
  const fragment = /\b[a-z]{3,} [a-z]{3,} [a-z]{3,}\b/;
  it("the demo text and JSON (message, fix, expected)", async () => {
    const text = await run(["demo", "--lang", "ko"]);
    for (const line of text.out.split("\n")) expect(line, line).not.toMatch(fragment);
    expect(text.out).not.toContain("<end,");
    const json = JSON.parse((await run(["demo", "--json", "--lang", "ko"])).out);
    for (const f of json.findings) {
      for (const k of ["message", "fix", "expected"]) if (typeof f[k] === "string") expect(f[k], `${f.rule}.${k}`).not.toMatch(fragment);
    }
  });
  it("archive error details and unknown options are translated", async () => {
    const opt = await run(["--bogus", "--lang", "ko"]);
    expect(opt.code).toBe(2);
    expect(opt.err).toContain("--bogus 은(는) 알 수 없는 옵션입니다");
    expect(opt.err).not.toContain("Unknown option");
    const en = await run(["--bogus", "--lang", "en"]);
    expect(en.err).toContain("unknown option '--bogus'");
    const t1 = messageTables();
    for (const l of ["en", "ko"] as const) expect(t1[l]["archive.detail.zip-no-eocd"]).toBeTruthy();
    expect(t1.ko["archive.detail.zip-no-eocd"]).not.toMatch(/[a-z]{3,} [a-z]{3,}/);
  });
});
