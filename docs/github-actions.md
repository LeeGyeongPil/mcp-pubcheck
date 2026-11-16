# Using mcp-pubcheck in a release workflow

Put the check **between the build and the first publish**. npm and PyPI versions cannot be reused,
so anything caught after `npm publish` costs a new version number.

```yaml
name: release
on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  id-token: write # for mcp-publisher login github-oidc

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org

      - run: npm ci
      - run: npm pack --pack-destination release

      # Fails the job (exit 1) before anything is published.
      - run: npx mcp-pubcheck server.json --artifacts release --require-all

      - run: npm publish release/*.tgz   # the exact tarball that was checked
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # then the registry step (see https://modelcontextprotocol.io/registry/github-actions)
      - run: mcp-publisher login github-oidc
      - run: mcp-publisher publish
```

For Python packages build first (`uv build --out-dir release`) and keep one build per directory so
`--artifacts release` finds exactly the files you are about to upload. For Docker images pass the
Dockerfile (`--dockerfile Dockerfile`) or `docker inspect IMAGE > inspect.json` with `--oci-inspect inspect.json`.

## Exit codes in CI

| Code | Meaning | Job result |
|---|---|---|
| 0 | No errors (warnings may exist) | continues |
| 1 | Errors, or warnings with `--strict`, or a missing artifact with `--require-all` | fails |
| 2 | Bad usage or an unreadable input (missing file, invalid JSON, corrupt archive) | fails |

Use `--json` for machine-readable output, for example to list only the errors:

```bash
npx mcp-pubcheck server.json --artifacts release --json | jq -r '.findings[] | select(.level=="error") | "\(.rule): \(.message)"'
```

## Version bumps with jq

The documented step `jq '.version = $v'` changes only the top-level `version`. If `packages[].version`
is not updated too, `version-drift` reports it. Update both:

```bash
jq --arg v "$VERSION" '.version = $v | (.packages[] | select(has("version")) | .version) = $v' server.json > server.tmp && mv server.tmp server.json
```
(OCI and MCPB entries have no `version` field, so `select(has("version"))` leaves them alone. Packages whose
version differs from the server version on purpose need their own handling.)
