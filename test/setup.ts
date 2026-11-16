// Every test runs with a fetch that records calls and throws: the tool must work fully offline.
import { beforeEach } from "vitest";

export const network = { calls: 0 };

beforeEach(() => {
  network.calls = 0;
  globalThis.fetch = (async () => {
    network.calls++;
    throw new Error("network access is not allowed in tests");
  }) as typeof fetch;
});
