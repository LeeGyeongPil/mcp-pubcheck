# Practice examples

`broken/` and `fixed/` are a small, fictional MCP server release (`io.github.example-user/demo-mcp`,
not a real project). Their `dist/` folders hold real artifacts made by the real tools:

| File | Made with |
|---|---|
| `example-user-demo-mcp-1.2.0.tgz` | `npm pack` |
| `demo_mcp-1.2.0-py3-none-any.whl`, `demo_mcp-1.2.0.tar.gz` | `uv build` (hatchling) |
| `demo-mcp.mcpb` | `zip` (manifest.json + index.js) |
| `Dockerfile` | written by hand (only the `LABEL` lines matter) |

`broken/` has these planted mistakes:

1. `npm-version`: the tarball was built from 1.2.0 while `server.json` says 1.2.1.
2. `pypi-mcp-name`: the README says `mcp-name: io.github.example-user/demo-mcp.` (a period glued to the name).
3. `mcpb-sha256`: `fileSha256` was never updated after the bundle was rebuilt.
4. `oci-label`: the image label says `io.github.Example-User/...` (letter case differs).
5. `version-drift` (a warning): only the top-level `version` was bumped to 1.2.1; the PyPI package entry still says 1.2.0.

`fixed/` is the same release with all of them corrected.

Regenerate everything (needs `npm`, `uv` and `zip`; the MCPB hash changes on every run and is rewritten into `server.json`):

```bash
node scripts/build-examples.mjs
```

Try them:

```bash
node dist/cli.js examples/broken/server.json --artifacts examples/broken/dist --dockerfile examples/broken/Dockerfile
node dist/cli.js examples/fixed/server.json  --artifacts examples/fixed/dist  --dockerfile examples/fixed/Dockerfile
```
