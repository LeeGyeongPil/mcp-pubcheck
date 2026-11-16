import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { InputError } from "./errors.js";
import { checkRelease } from "./index.js";
import { packageRoot } from "./paths.js";
import type { CheckOptions, Report } from "./types.js";

/** Show a path relative to the current directory when that is shorter than an absolute path. */
function display(abs: string): string {
  const rel = relative(process.cwd(), abs);
  return rel === "" || rel.startsWith("..") ? abs : rel;
}

/** Options for checking one of the bundled practice examples (`broken` or `fixed`). */
export function exampleOptions(name: "broken" | "fixed"): CheckOptions {
  const dir = join(packageRoot, "examples", name);
  if (!existsSync(join(dir, "server.json"))) {
    throw new InputError("input.not-found", { file: display(dir) }, `bundled example missing: ${dir}`);
  }
  return {
    serverJson: display(join(dir, "server.json")),
    artifacts: [display(join(dir, "dist"))],
    dockerfile: display(join(dir, "Dockerfile")),
  };
}

/** Check the bundled, deliberately broken practice example. */
export async function runDemo(): Promise<Report> {
  return checkRelease(exampleOptions("broken"));
}
