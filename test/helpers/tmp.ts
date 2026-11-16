import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const made: string[] = [];

/** Fresh temp directory removed after the test file finishes. */
export function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "pubcheck-test-"));
  made.push(d);
  return d;
}

afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
