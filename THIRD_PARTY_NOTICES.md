# Third-party notices

## MCP Registry `server.json` JSON Schema (bundled copy)

- File: `schemas/server.schema.2025-12-11.json`
- Source: https://raw.githubusercontent.com/modelcontextprotocol/registry/main/internal/validators/schemas/2025-12-11.json
- Project: https://github.com/modelcontextprotocol/registry
- License: Apache License 2.0 (full text: https://www.apache.org/licenses/LICENSE-2.0)
- Retrieved: 2026-11-17, unmodified.

The checks in `src/rules/` are written from the public documentation of the registry
(https://modelcontextprotocol.io/registry/package-types and the "official registry requirements"
page) and from observed behaviour; no registry source code is included.

## Runtime dependencies (installed from npm, not copied into this repository)

| Package | Version | License |
|---|---|---|
| ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |

Their own dependencies (`fast-deep-equal`, `fast-uri`, `json-schema-traverse`, `require-from-string`)
keep their licenses in `node_modules/` after `npm ci`.
