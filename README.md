# mcp-server-kilango

Operator MCP server for [Kilango](https://kilango.com). It wraps Kilango's operator/control
API (`/v1` on the gateway) as MCP tools so an AI assistant can **build and manage portals**
in a Kilango workspace: create/manage portals, pages, blocks and app widgets (including
drag-and-drop reordering), install apps, and connect them to their backend systems.

Portal end-users only ever see widgets — Kilango holds the broad backend access. This
server operates the *studio/operator* plane on the operator's behalf.

## Auth & tenancy model

One host maps to one company's Kilango **workspace**
(`kilango.bos.mcp.borgels.com`, `kilango.spz…`, `kilango.one…`), exactly like the
`e-conomic` servers in the fleet. Access is gated by the Entra group `SG-MCP-kilango-<company>`
at the borgels MCP gateway; the gateway forwards the verified user as `X-MCP-User` (recorded
in the audit log). The server authenticates to Kilango with a single **shared,
workspace-bound API key** (`KILANGO_API_KEY`, a `hub_live_…` key that self-scopes to that
one workspace). Mint an **ADMIN write** key so full portal building (incl. deletes/publish)
works. The key's own role/scopes are the real capability boundary — Kilango enforces them
server-side.

## Tools

Hybrid surface — curated golden-path tools plus a contract-driven escape hatch:

- **Discovery** — `kilango_get_workspace`, `kilango_get_meta`, `kilango_get_vocabulary`,
  `kilango_search_operations`, `kilango_describe_operation`.
- **Portals** — list/get/create/update, readiness, publish/unpublish/archive, preview,
  get/save navigation, delete.
- **Pages & blocks** — list/get pages, get blocks, create/update/delete page, save layout,
  add/update/delete content block, `kilango_place_widget`, `kilango_update_widget`,
  `kilango_delete_widget`, and drag-and-drop: `kilango_move_block` / `kilango_reorder_blocks`.
- **Apps** — catalog list/get, connectors, installations list/get, install/uninstall,
  list/activate/deactivate per portal, and `kilango_connect_app` (see below).
- **Connections** — list/get/health-check/delete.
- **Escape hatch** — `kilango_call_operation(operationId, {path, query, body})` covers every
  operation in `/v1/openapi.json` not wrapped by a curated tool.

Whole-document writes (save layout, save navigation, reorder blocks) require an `If-Match`
ETag; the client fetches and sends it automatically and retries once on a `412`.

## Connecting apps

`kilango_connect_app(appKey, portalRef?)`:

- **No credentials** (native/scaffold apps) → installs (and activates if a portal is given).
- **API-key apps** (fynk, pipedrive, dalux, …) → returns a **one-time browser URL**
  (`/kilango/connect-app`) where the operator enters the secret. It goes straight to
  Kilango's encrypted vault via `save_connection` — never through the chat, never persisted
  or logged here. Then the app is installed, connected, activated (if a portal was given),
  and health-checked.
- **OAuth apps** (e.g. SharePoint) → returns a clear "not supported yet" message. Kilango's
  OAuth connect flow is a planned fast-follow (it currently returns `501
  oauth_flow_not_implemented`); once it ships, this tool switches to the redirect flow.

## Configuration

See `.env.example`. Key vars: `KILANGO_API_BASE_URL`, `KILANGO_PUBLIC_BASE_URL`,
`KILANGO_API_KEY`, `KILANGO_ENABLE_WRITES` (coarse kill-switch), `KILANGO_AUDIT_LOG`,
`MCP_HTTP_TOKEN` (protects the loopback `/mcp`).

## Develop

```
npm install
npm run typecheck
npm test
npm run dev        # stdio transport
npm run dev:http   # HTTP transport on :3000
```

Live smoke test against a real (dev) Kilango gateway — also cross-checks the curated tool
paths against the live `/v1/openapi.json`:

```
KILANGO_API_BASE_URL=https://<dev-gateway> KILANGO_API_KEY=hub_test_... npm run smoke:live
```

## Deploy

See `deploy/` for the docker-compose service block, `hosts.json` entries, Caddy site blocks,
and example env files to copy into `~/mcp` on borgels-1 (mirrored in `bos-server-config`).
The image publishes to `ghcr.io/borgels/mcp-server-kilango:latest` on push to `main`.
