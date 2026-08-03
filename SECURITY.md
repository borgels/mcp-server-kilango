# Security

## Reporting

Report vulnerabilities privately to the maintainers (security@borgels.com). Do not open a
public issue for anything exploitable.

## Threat model & handling

- **Kilango API key** (`KILANGO_API_KEY`, `hub_live_…`) is a workspace-scoped credential.
  It lives only in the server environment (a `chmod 600` env file on the host), never in
  source, never in a tool argument, never in the model context. It is redacted from all
  errors and logs.
- **Backend connection secrets** (e.g. a fynk API key, or OAuth tokens) are entered by the
  operator in a one-time browser form at `/kilango/connect-app` and passed straight to
  Kilango's `save_connection`, which stores them in Kilango's own AES-256-GCM vault. This
  server never persists them and never logs them.
- **Loopback `/mcp`** is protected by `MCP_HTTP_TOKEN`. Behind the borgels MCP gateway the
  token is supplied via `internal.env`; the enrollment paths (`/kilango/*`) and `/healthz`
  are intentionally open because the browser reaching them has no gateway token — their
  security is the single-use, short-TTL `state`.
- **Write gating**: the Kilango key's own role/scopes are the real capability boundary
  (Kilango enforces 403/ADMIN server-side). `KILANGO_ENABLE_WRITES=false` is an extra
  instance-wide kill-switch that blocks every non-GET operation.
