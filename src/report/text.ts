import { t } from "../i18n/index.js";
import type { Finding, Lang, Report } from "../types.js";
import { expectedText, templateParams } from "./json.js";

export interface TextOptions {
  color: boolean;
  verbose: boolean;
  /** Treat warnings as failures (mirrors the `--strict` exit code). */
  strict?: boolean;
}

const COLORS: Record<string, string> = { error: "31", warn: "33", info: "36", ok: "32" };

function paint(opts: TextOptions, level: string, text: string): string {
  return opts.color ? `\u001b[${COLORS[level] ?? "0"}m${text}\u001b[0m` : text;
}

function plural(lang: Lang, base: string, n: number): string {
  return t(lang, `${base}.${n === 1 ? "one" : "other"}`, { n });
}

/** Summary line, e.g. `4 errors, 1 warning, 9 checks passed`. */
export function summaryLine(report: Report, lang: Lang): string {
  const s = report.summary;
  return [plural(lang, "summary.errors", s.errors), plural(lang, "summary.warnings", s.warnings), t(lang, "summary.passed", { n: s.passed })].join(", ");
}

function block(f: Finding, lang: Lang, opts: TextOptions): string[] {
  const p = templateParams(f);
  const indent = "       ";
  const lines = [`${paint(opts, f.level, f.level.padEnd(5))}  ${f.rule}  ${f.where}`];
  const message = t(lang, `f.${f.key}.msg`, p);
  lines.push(`${indent}${message}`);
  const row = (label: string, value: string): string => `${indent}${label}: ${value}`;
  if (f.expected !== undefined && f.level !== "ok") lines.push(row(t(lang, "label.expected"), expectedText(f, lang) ?? f.expected));
  if (f.actual !== undefined && f.level !== "ok") lines.push(row(t(lang, "label.actual"), f.actual));
  if (f.source !== undefined && f.level !== "ok" && !message.includes(f.source)) lines.push(row(t(lang, "label.file"), f.source));
  if (f.level === "error" || f.level === "warn") lines.push(row(t(lang, "label.fix"), t(lang, `f.${f.key}.fix`, p)));
  return lines;
}

/** Human readable report. Problems first as blocks; passed checks only with `verbose`. */
export function renderText(report: Report, lang: Lang, opts: TextOptions): string {
  const out: string[] = [t(lang, "report.header", { version: report.version, file: report.serverJson }), ""];
  const shown = report.findings.filter((f) => f.level !== "ok" || opts.verbose);
  for (const f of shown) {
    out.push(...block(f, lang, opts), "");
  }
  const errored = report.summary.errors > 0;
  const failed = errored || (opts.strict === true && report.summary.warnings > 0);
  const verdictKey = !failed ? "summary.verdict.pass" : errored ? "summary.verdict.fail" : "summary.verdict.fail-strict";
  out.push(summaryLine(report, lang));
  out.push(paint(opts, failed ? "error" : "ok", t(lang, verdictKey)));
  return out.join("\n");
}
