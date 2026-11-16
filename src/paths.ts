import { fileURLToPath } from "node:url";

/** Absolute path of the package root (works from `src/` and from `dist/`). */
export const packageRoot: string = fileURLToPath(new URL("../", import.meta.url));
