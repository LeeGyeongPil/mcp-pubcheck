import { parseArgs } from "node:util";
import { runDemo } from "./demo.js";
import { InputError } from "./errors.js";
import { hasKey, isLang, resolveLang, t } from "./i18n/index.js";
import { checkRelease } from "./index.js";
import { renderJson } from "./report/json.js";
import { renderText } from "./report/text.js";
import type { CheckOptions, Lang } from "./types.js";
import { VERSION } from "./version.js";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  isTTY: boolean;
}

const OPTIONS = {
  artifacts: { type: "string", multiple: true },
  npm: { type: "string" },
  wheel: { type: "string" },
  sdist: { type: "string" },
  mcpb: { type: "string" },
  dockerfile: { type: "string" },
  "oci-inspect": { type: "string" },
  "repo-url": { type: "string" },
  schema: { type: "string" },
  json: { type: "boolean" },
  strict: { type: "boolean" },
  "require-all": { type: "boolean" },
  verbose: { type: "boolean" },
  "no-color": { type: "boolean" },
  lang: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/**
 * Run the CLI. Returns the exit code: 0 pass, 1 errors (or warnings with --strict), 2 bad usage or unreadable input.
 * `env` and `io` are injected so tests can run it in-process.
 */
export async function runCli(argv: string[], env: Record<string, string | undefined>, io: Io): Promise<number> {
  let lang: Lang = resolveLang(undefined, env);
  const fail = (message: string): number => {
    io.err(`${t(lang, "cli.error-prefix")} ${message}`);
    return 2;
  };
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    } catch (e) {
      // Parsing failed, so honour --lang by scanning the raw arguments.
      const li = argv.findIndex((a) => a === "--lang" || a.startsWith("--lang="));
      const raw = li < 0 ? undefined : argv[li]!.startsWith("--lang=") ? argv[li]!.slice(7) : argv[li + 1];
      if (raw !== undefined && isLang(raw)) lang = raw;
      const msg = e instanceof Error ? e.message : String(e);
      const opt = /Unknown option '--?([^']+)'/.exec(msg)?.[1];
      if (opt !== undefined) return fail(t(lang, "cli.unknown-option-named", { option: opt }));
      return fail(t(lang, "cli.unknown-option", { detail: msg.split("\n")[0] }));
    }
    const v = parsed.values;
    if (v.lang !== undefined) {
      if (!isLang(v.lang)) return fail(t(lang, "cli.bad-lang", { value: v.lang }));
      lang = v.lang;
    }
    if (v.help) {
      io.out(t(lang, "cli.help", { version: VERSION }));
      return 0;
    }
    if (v.version) {
      io.out(t(lang, "cli.version", { version: VERSION }));
      return 0;
    }
    const color = io.isTTY && !env.NO_COLOR && !v["no-color"] && !v.json;
    const textOpts = { color, verbose: v.verbose ?? false };
    const [first, ...rest] = parsed.positionals;

    if (first === "demo") {
      if (rest.length > 0) return fail(t(lang, "cli.too-many-args", { args: rest.join(" ") }));
      const report = await runDemo();
      if (v.json) {
        io.out(renderJson(report, lang, { demo: true }));
      } else {
        io.out(t(lang, "demo.intro") + "\n");
        io.out(renderText(report, lang, textOpts));
        io.out("\n" + t(lang, "demo.fixed-hint"));
        io.out(t(lang, "demo.outro"));
      }
      return 0;
    }

    if (rest.length > 0) return fail(t(lang, "cli.too-many-args", { args: parsed.positionals.join(" ") }));
    const options: CheckOptions = {
      serverJson: first ?? "server.json",
      artifacts: v.artifacts,
      npm: v.npm,
      wheel: v.wheel,
      sdist: v.sdist,
      mcpb: v.mcpb,
      dockerfile: v.dockerfile,
      ociInspect: v["oci-inspect"],
      repoUrl: v["repo-url"],
      schema: v.schema,
      requireAll: v["require-all"],
    };
    const report = await checkRelease(options);
    io.out(v.json ? renderJson(report, lang) : renderText(report, lang, textOpts));
    const failed = report.summary.errors > 0 || (v.strict === true && report.summary.warnings > 0);
    return failed ? 1 : 0;
  } catch (e) {
    if (e instanceof InputError) {
      const p = { ...e.params };
      if (typeof p.detail === "string" && hasKey("en", `archive.detail.${p.detail}`)) p.detail = t(lang, `archive.detail.${p.detail}`, p);
      return fail(t(lang, e.key, p));
    }
    return fail(e instanceof Error ? e.message : String(e));
  }
}
