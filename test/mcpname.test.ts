import { describe, expect, it } from "vitest";
import { matchMcpName } from "../src/mcpname.js";
import { parseCoreMetadata } from "../src/artifacts/pypi.js";

const N = "io.github.example-user/demo-mcp";

describe("mcp-name boundary rule", () => {
  it.each([
    ["end of text", `mcp-name: ${N}`],
    ["end of line", `mcp-name: ${N}\nmore`],
    ["space", `mcp-name: ${N} trailing`],
    ["'<'", `<b>mcp-name: ${N}</b>`],
    ["comment close", `<!-- mcp-name: ${N}-->`],
    ["comment close after space", `<!-- mcp-name: ${N} -->`],
    ["comma", `mcp-name: ${N}, see docs`],
  ])("passes before %s", (_label, text) => {
    expect(matchMcpName(text, N).status).toBe("ok");
  });

  it.each([".", "-", "/", "_", "x", "7"])("is glued when '%s' follows the name", (ch) => {
    expect(matchMcpName(`mcp-name: ${N}${ch}`, N)).toEqual({ status: "glued", char: ch });
  });

  it("accepts a later valid token even if an earlier one is glued", () => {
    expect(matchMcpName(`mcp-name: ${N}.\n\nmcp-name: ${N}\n`, N).status).toBe("ok");
  });

  it("detects a case-only difference", () => {
    expect(matchMcpName("mcp-name: io.github.Example-User/demo-mcp", N).status).toBe("case-only");
  });

  it("detects wrong spacing after the colon", () => {
    expect(matchMcpName(`mcp-name:  ${N}`, N).status).toBe("spacing");
  });

  it("names the other server when the token points elsewhere", () => {
    expect(matchMcpName("mcp-name: io.github.someone/else", N)).toEqual({ status: "different", found: "io.github.someone/else" });
  });

  it("reports a missing token", () => {
    expect(matchMcpName("# demo\n\nno token here", N).status).toBe("missing");
  });
});

describe("core metadata parsing", () => {
  it("uses the body as the long description", () => {
    const m = parseCoreMetadata("Metadata-Version: 2.4\nName: demo\nVersion: 1\n\n# Title\nmcp-name: x\n");
    expect(m).toMatchObject({ name: "demo", version: "1" });
    expect(m.description).toContain("mcp-name: x");
  });
  it("falls back to the Description header with folded lines", () => {
    const m = parseCoreMetadata("Metadata-Version: 2.1\nName: demo\nVersion: 1\nDescription: first\n        mcp-name: x\n\n");
    expect(m.description).toContain("mcp-name: x");
  });
  it("reports no description when there is no README text", () => {
    expect(parseCoreMetadata("Metadata-Version: 2.4\nName: demo\nVersion: 1\n\n").description).toBeUndefined();
  });
});
