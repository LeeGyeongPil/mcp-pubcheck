import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import addFormatsModule from "ajv-formats";
import { finding } from "../finding.js";
import { InputError } from "../errors.js";
import { packageRoot } from "../paths.js";
import type { Finding } from "../types.js";

export const BUNDLED_SCHEMA = join(packageRoot, "schemas", "server.schema.2025-12-11.json");

// ajv-formats ships CommonJS; under NodeNext the callable is on `.default`.
const addFormats = addFormatsModule.default;

interface SchemaDoc {
  $id?: string;
}

function loadSchema(path: string): SchemaDoc {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SchemaDoc;
  } catch {
    throw new InputError("input.bad-schema", { file: path }, `cannot read JSON Schema ${path}`);
  }
}

const MAX_SCHEMA_FINDINGS = 12;

/** Validate server.json against the bundled (or user supplied) JSON Schema. */
export function checkSchema(server: Record<string, unknown>, schemaPath: string = BUNDLED_SCHEMA): Finding[] {
  const schema = loadSchema(schemaPath);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const out: Finding[] = [];

  const declared = typeof server.$schema === "string" ? server.$schema : undefined;
  if (declared === undefined) {
    out.push(finding("schema-version.missing", "warn", "$schema", { expected: schema.$id ?? "" }));
  } else if (schema.$id && declared !== schema.$id) {
    out.push(finding("schema-version.other", "warn", "$schema", { expected: schema.$id, actual: declared }));
  }

  if (validate(server)) {
    out.push(finding("schema.ok", "ok", "server.json"));
    return out;
  }
  const seen = new Set<string>();
  const noisy = new Set(["anyOf", "oneOf", "if", "not"]);
  const errors = (validate.errors ?? []).filter((e) => !noisy.has(e.keyword) || (validate.errors ?? []).length === 1);
  for (const e of errors) {
    const path = e.instancePath === "" ? "/" : e.instancePath;
    const detail = `${e.message ?? "is invalid"}${e.params && "allowedValues" in e.params ? ` (${(e.params.allowedValues as unknown[]).join(", ")})` : ""}${e.params && "missingProperty" in e.params ? `: ${String(e.params.missingProperty)}` : ""}`;
    const id = `${path}|${detail}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (seen.size > MAX_SCHEMA_FINDINGS) break;
    out.push(finding("schema.invalid", "error", path, { actual: detail, params: { path, detail } }));
  }
  return out;
}
