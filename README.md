# BRDG docs

Public documentation for BRDG, served by Mintlify at docs.brdg.now.

- Pages are MDX. Navigation and theme live in `docs.json`.
- `openapi/openapi.json` is pulled from the running API, not written by hand. Refresh it with
  `BRIDGE_API=https://api.brdg.now node scripts/pull-openapi.mjs` (defaults to `http://localhost:3001`).
  The script drops the `/ops` routes, sets the public server URL and merges the captured examples in
  `openapi/examples/`.
- Preview locally with `mint dev`; `mint validate` and `mint broken-links` must pass before pushing.
