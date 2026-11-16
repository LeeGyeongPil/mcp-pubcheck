# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-11-17

### Fixed
- The text report no longer prints the "safe to publish" verdict when `--strict` fails the run because of warnings.

## [0.1.0] - 2026-11-17

### Added
- `mcp-pubcheck [server.json]` compares `server.json` with built artifacts, offline: npm tarballs (`mcpName`, name, version), PyPI wheels and sdists (name, version, `mcp-name:` token boundary rule, missing README), MCPB bundles (SHA-256, release URL, manifest version) and OCI images (Dockerfile `LABEL` or `docker inspect` JSON).
- Rules the JSON Schema cannot express: snake_case typo keys, `latest`/range versions, fields forbidden per package type, `registryBaseUrl` allow list, `_meta` dropped keys and 4 KB limit, namespace owner against repository owner, version drift.
- Bundled `server.json` JSON Schema `2025-12-11` (Apache-2.0, see `THIRD_PARTY_NOTICES.md`).
- Human and `--json` output (`schemas/report.schema.json`), exit codes 0/1/2, `--strict`, `--require-all`.
- English and Korean output (`--lang`, `MCP_PUBCHECK_LANG`, `LC_ALL`/`LC_MESSAGES`/`LANG`).
- `mcp-pubcheck demo` with a bundled practice example (`examples/broken`, fixed copy in `examples/fixed`).
- Small programmatic API: `checkRelease()`.
