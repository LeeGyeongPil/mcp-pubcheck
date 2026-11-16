// Copies non-TypeScript assets (message tables) next to the compiled output.
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/i18n", { recursive: true });
for (const f of ["en.json", "ko.json"]) cpSync(`src/i18n/${f}`, `dist/i18n/${f}`);
