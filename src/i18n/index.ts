import { readFileSync } from "node:fs";
import type { Lang } from "../types.js";

type Table = Record<string, string | string[]>;

function load(lang: Lang): Table {
  return JSON.parse(readFileSync(new URL(`./${lang}.json`, import.meta.url), "utf8")) as Table;
}

const tables: Record<Lang, Table> = { en: load("en"), ko: load("ko") };

/** Both message tables (exported for the key-parity test). */
export function messageTables(): Record<Lang, Table> {
  return tables;
}

export function isLang(value: string): value is Lang {
  return value === "en" || value === "ko";
}

function fromLocale(value: string | undefined): Lang | undefined {
  if (value === undefined || value === "") return undefined;
  return value.toLowerCase().startsWith("ko") ? "ko" : "en";
}

/**
 * Choose the output language: `--lang` > MCP_PUBCHECK_LANG > LC_ALL > LC_MESSAGES > LANG.
 * Anything that does not start with "ko" means English.
 */
export function resolveLang(flag: Lang | undefined, env: Record<string, string | undefined>): Lang {
  if (flag) return flag;
  for (const name of ["MCP_PUBCHECK_LANG", "LC_ALL", "LC_MESSAGES", "LANG"]) {
    const l = fromLocale(env[name]);
    if (l) return l;
  }
  return "en";
}

/** Look up `key` and fill `{placeholders}`. Unknown keys fall back to English, then to the key itself. */
export function t(lang: Lang, key: string, params: Record<string, string | number | undefined> = {}): string {
  const raw = tables[lang][key] ?? tables.en[key];
  if (raw === undefined) return key;
  const text = Array.isArray(raw) ? raw.join("\n") : raw;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (params[name] !== undefined ? String(params[name]) : m));
}

export function hasKey(lang: Lang, key: string): boolean {
  return key in tables[lang];
}
