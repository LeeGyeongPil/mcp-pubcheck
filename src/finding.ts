import type { Finding, Level, Params } from "./types.js";

/** Build a finding. `key` is `<rule>.<variant>`; the rule ID is the part before the dot. */
export function finding(
  key: string,
  level: Level,
  where: string,
  extra: { expected?: string; actual?: string; source?: string; params?: Params } = {},
): Finding {
  const rule = key.slice(0, key.indexOf("."));
  return { rule, level, key, where, params: extra.params ?? {}, ...(extra.expected !== undefined ? { expected: extra.expected } : {}), ...(extra.actual !== undefined ? { actual: extra.actual } : {}), ...(extra.source !== undefined ? { source: extra.source } : {}) };
}
