import { hasKey, t } from "../i18n/index.js";
import type { Lang, Report } from "../types.js";

/** Params available to message templates. */
/** `expected` text: a localized template (`f.<key>.expected`) when one exists, else the raw value. */
export function expectedText(f: Report["findings"][number], lang: Lang): string | undefined {
  const key = `f.${f.key}.expected`;
  return hasKey("en", key) ? t(lang, key, { ...f.params, where: f.where }) : f.expected;
}

export function templateParams(f: Report["findings"][number]): Record<string, string | number | undefined> {
  return { ...f.params, where: f.where, expected: expectedText(f, "en"), actual: f.actual, source: f.source };
}

/** JSON report (shape: schemas/report.schema.json). Rule IDs and keys never change with the language. */
export function renderJson(report: Report, lang: Lang, extra: Record<string, unknown> = {}): string {
  const findings = report.findings.map((f) => ({
    rule: f.rule,
    level: f.level,
    key: f.key,
    where: f.where,
    ...(f.expected !== undefined ? { expected: expectedText(f, lang) } : {}),
    ...(f.actual !== undefined ? { actual: f.actual } : {}),
    ...(f.source !== undefined ? { source: f.source } : {}),
    message: t(lang, `f.${f.key}.msg`, templateParams(f)),
    ...(f.level === "error" || f.level === "warn" ? { fix: t(lang, `f.${f.key}.fix`, templateParams(f)) } : {}),
  }));
  return JSON.stringify({ ...extra, tool: report.tool, version: report.version, language: lang, serverJson: report.serverJson, summary: report.summary, findings }, null, 2);
}
