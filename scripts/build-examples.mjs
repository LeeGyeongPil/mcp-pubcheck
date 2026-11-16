// Regenerates examples/broken and examples/fixed from scratch with the real tools:
// `npm pack` (tgz), `uv build` (wheel + sdist) and `zip` (mcpb), then writes server.json and Dockerfile.
// Usage: node scripts/build-examples.mjs   (needs npm, uv and zip on PATH)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const NAME = "io.github.example-user/demo-mcp";

function write(file, text) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
}

function build(variant) {
  const broken = variant === "broken";
  const topVersion = broken ? "1.2.1" : "1.2.0"; // broken: only the top-level version was bumped (the jq mistake)
  const out = join(root, "examples", variant);
  rmSync(out, { recursive: true, force: true });
  const dist = join(out, "dist");
  mkdirSync(dist, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), `pubcheck-${variant}-`));

  // npm tarball: always built from 1.2.0 sources.
  const npmDir = join(work, "npm");
  write(join(npmDir, "index.js"), 'console.log("demo-mcp");\n');
  write(join(npmDir, "package.json"), JSON.stringify({ name: "@example-user/demo-mcp", version: "1.2.0", description: "Practice example for mcp-pubcheck", mcpName: NAME, bin: { "demo-mcp": "index.js" }, files: ["index.js"], license: "MIT" }, null, 2) + "\n");
  execFileSync("npm", ["pack", "--pack-destination", dist, "--silent"], { cwd: npmDir, stdio: "pipe" });

  // Python wheel + sdist. The broken README glues a period to the token.
  const pyDir = join(work, "py");
  write(join(pyDir, "src", "demo_mcp", "__init__.py"), '"""Practice example."""\n');
  write(join(pyDir, "pyproject.toml"), `[project]\nname = "demo-mcp"\nversion = "1.2.0"\ndescription = "Practice example for mcp-pubcheck"\nreadme = "README.md"\nrequires-python = ">=3.10"\n\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n\n[tool.hatch.build.targets.wheel]\npackages = ["src/demo_mcp"]\n`);
  const token = broken ? `Registry name: mcp-name: ${NAME}.` : `<!-- mcp-name: ${NAME} -->`;
  write(join(pyDir, "README.md"), `# demo-mcp\n\nPractice example package.\n\n${token}\n`);
  execFileSync("uv", ["build", "--out-dir", dist], { cwd: pyDir, stdio: "pipe" });
  rmSync(join(dist, ".gitignore"), { force: true }); // uv writes a catch-all .gitignore into the output directory

  // MCPB bundle (a zip with manifest.json).
  const bundle = join(work, "bundle");
  write(join(bundle, "manifest.json"), JSON.stringify({ manifest_version: "0.3", name: "demo-mcp", version: topVersion, description: "Practice example", server: { type: "node", entry_point: "index.js" } }, null, 2) + "\n");
  write(join(bundle, "index.js"), 'console.log("demo-mcp");\n');
  execFileSync("zip", ["-q", "-X", join(dist, "demo-mcp.mcpb"), "manifest.json", "index.js"], { cwd: bundle });
  const sha = createHash("sha256").update(readFileSync(join(dist, "demo-mcp.mcpb"))).digest("hex");

  // Dockerfile: the broken label differs only by letter case.
  const labelName = broken ? "io.github.Example-User/demo-mcp" : NAME;
  write(join(out, "Dockerfile"), `FROM node:22-alpine\nLABEL org.opencontainers.image.source="https://github.com/example-user/demo-mcp"\nLABEL io.modelcontextprotocol.server.name="${labelName}"\nCOPY index.js /app/index.js\nENTRYPOINT ["node", "/app/index.js"]\n`);

  const server = {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: NAME,
    description: "Practice example server for mcp-pubcheck (not a real project).",
    repository: { url: "https://github.com/example-user/demo-mcp", source: "github" },
    version: topVersion,
    packages: [
      { registryType: "npm", identifier: "@example-user/demo-mcp", version: topVersion, transport: { type: "stdio" } },
      { registryType: "pypi", identifier: "demo-mcp", version: "1.2.0", transport: { type: "stdio" } },
      { registryType: "mcpb", identifier: `https://github.com/example-user/demo-mcp/releases/download/v${topVersion}/demo-mcp.mcpb`, fileSha256: broken ? "0".repeat(64) : sha, transport: { type: "stdio" } },
      { registryType: "oci", identifier: `ghcr.io/example-user/demo-mcp:${topVersion}`, transport: { type: "stdio" } },
    ],
  };
  write(join(out, "server.json"), JSON.stringify(server, null, 2) + "\n");
  rmSync(work, { recursive: true, force: true });
  console.log(`${variant}: ${readdirSync(dist).join(", ")}`);
}

build("broken");
build("fixed");
// The test helpers reuse the real fixed artifacts as parser fixtures.
mkdirSync(join(root, "test", "fixtures", "real"), { recursive: true });
cpSync(join(root, "examples", "fixed", "dist"), join(root, "test", "fixtures", "real"), { recursive: true });
