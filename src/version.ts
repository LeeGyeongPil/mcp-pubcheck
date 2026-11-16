import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./paths.js";

/** Version from package.json (single source of truth). */
export const VERSION: string = (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }).version;
