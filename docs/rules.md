# Rules

Every finding has a stable **rule ID** (never translated), a **key** (`<rule>.<variant>`, also stable) and a level:
`error` (exit 1), `warn` (exit 0, or 1 with `--strict`), `info`, `ok`.
Sources were checked on 2026-11-17. The registry can change; the bundled schema is dated 2025-12-11.

The checks come from the public docs and observed behaviour of the official MCP Registry. They are
a pre-flight, not a guarantee: the registry has the last word.

## server.json

| Rule | Level | What it checks | Fix |
|---|---|---|---|
| `schema` | error | The file matches the bundled JSON Schema (`schemas/server.schema.2025-12-11.json`). | Change the field named in the message. |
| `schema-version` | warn | `$schema` is missing or names another schema version than the bundled one (`--schema <file>` swaps the copy). | Use the current `$schema` URL. |
| `typo-key` | error | A key such as `registry_type`, `file_sha256`, `registry_base_url`, `runtime_hint` (snake_case, kebab-case or wrong case). The schema allows extra keys, so the registry ignores them silently. | Rename to the suggested camelCase key. |
| `version-range` | error | `version` is `latest` or a range (`^1.2.0`, `~1.2`, `1.x`, `>=1`, `1.0 - 2.0`), at the top level or in a package. | Use one exact version. |
| `forbidden-field` | error | Fields the registry rejects per type: OCI `version` and `registryBaseUrl`; npm, PyPI, NuGet, Cargo `fileSha256`; MCPB `registryBaseUrl`. | Remove the field (OCI keeps the version in the identifier tag). |
| `registry-base-url` | error | `registryBaseUrl` is not the public registry (npm `https://registry.npmjs.org`, PyPI `https://pypi.org`, NuGet `https://api.nuget.org/v3/index.json`, Cargo `https://crates.io`). | Use that URL or drop the field. |
| `meta-keys` | warn | `_meta` has keys other than `io.modelcontextprotocol.registry/publisher-provided`; the registry drops them silently. | Move what you want to keep under that key. |
| `meta-size` | error | The publisher-provided `_meta` is over 4096 bytes of JSON. | Shrink it. |
| `namespace-owner` | error / warn | For `io.github.<owner>/...` the owner differs from the repository owner (`repository.url`, `--repo-url`, or `.git/config` origin, read as a file). A difference only in letter case is a warning, because the registry compares case-sensitively. | Write exactly `io.github.<owner>`. |

Invalid UTF-8, a lone surrogate escape (`\ud83d` without its pair) and invalid JSON stop the run with exit code 2 and a line and column.

## Version drift

| Rule | Level | What it checks |
|---|---|---|
| `version-drift` | warn | `packages[].version` equals the top-level `version`. The registry does not compare them, and the documented `jq '.version = $v'` step changes only the top-level one. |

## npm tarball (`npm pack`)

The values are read from `package/package.json` **inside the tarball**, not from your source tree, because `prepack` scripts and stale builds change what gets published (registry issue 1525).

| Rule | Level | What it checks |
|---|---|---|
| `npm-identifier` | error | Tarball `name` equals `packages[].identifier`. |
| `npm-version` | error | Tarball `version` equals the package version in `server.json`. |
| `npm-mcp-name` | error | Tarball `mcpName` equals the server `name`. Variants: `missing`, `mismatch`, `case`. |

## PyPI (wheel and sdist)

The description is the README text in `*.dist-info/METADATA` (body, or the `Description` header) or `PKG-INFO`.

| Rule | Level | What it checks |
|---|---|---|
| `pypi-name` | error | Distribution `Name` equals the identifier after PEP 503 normalisation (`Demo_MCP` = `demo-mcp`). |
| `pypi-version` | error | Wheel `Version` equals the package version. |
| `sdist-version` | error | sdist `PKG-INFO` `Version` equals the package version. |
| `pypi-mcp-name` | error | The README has `mcp-name: <server name>`. After the name must come the end of the line, a space, `<`, or `-->`; a name character (letter, digit, `.`, `_`, `/`, `-`) makes it `glued`. Variants: `glued`, `case-only`, `spacing` (not exactly one space after the colon), `different` (another name), `missing`, `no-readme` (the metadata carries no README at all; set `readme` in `pyproject.toml`). |

If both files exist the wheel is checked for the token (that is what `pip` users get); the sdist only when there is no wheel.

## MCPB (`.mcpb`)

| Rule | Level | What it checks |
|---|---|---|
| `mcpb-sha256` | error | SHA-256 of the file equals `fileSha256`. The message prints the correct value. The registry does not check this; clients do, before installing. |
| `mcpb-url` | error | The identifier is an `https` GitHub release asset URL (`https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`) or a GitLab release URL, and contains `mcp`. Variants: `bad`, `no-mcp`. |
| `mcpb-manifest` | warn | `manifest.json` inside the bundle has a different `version` than `server.json`, or cannot be read. |

## OCI images

Only the last build stage of a Dockerfile counts; `LABEL` in quotes, without quotes, several per line and with `\` continuations are understood. `ARG`/`ENV` substitutions cannot be resolved offline, so such a label gives `oci-label.unresolved` (warn): inspect the built image instead: `docker inspect IMAGE > inspect.json` and `--oci-inspect inspect.json`.

| Rule | Level | What it checks |
|---|---|---|
| `oci-label` | error / warn | Label `io.modelcontextprotocol.server.name` equals the server name. Variants: `missing`, `mismatch`, `case`, `unresolved`. |
| `oci-tag` | warn | The identifier tag equals the server version (a leading `v` is ignored; digests are skipped); no tag at all is flagged. |

## Run-level

| Rule | Level | What it checks |
|---|---|---|
| `skipped` | warn / error | A package in `server.json` has no artifact to compare. An error with `--require-all`. |
| `ambiguous` | error | More than one artifact could belong to a package (for example old builds in `dist/`) and the version does not decide it. Pass the exact file. |
| `unsupported-registry` | info | NuGet and Cargo packages are not compared yet. |
| `no-packages` | info | `server.json` has no `packages[]`. |

## Sources

- https://modelcontextprotocol.io/registry/package-types (ownership markers per package type)
- https://modelcontextprotocol.io/registry/quickstart
- https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md (base URLs, `_meta`)
- https://github.com/modelcontextprotocol/registry/issues/1525 (tarball value differs from source)
- https://github.com/modelcontextprotocol/registry/issues/531 (PyPI `mcp-name` not found)
- https://github.com/modelcontextprotocol/registry/issues/689 (namespace letter case)
