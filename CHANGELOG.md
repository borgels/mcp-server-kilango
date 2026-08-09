# Changelog

## 0.1.1 (unreleased)

- **Fix: `kilango_place_widget` could not place anything.** It sent the bare
  single-widget object, but the route takes `{ widgets: [...] }` — a list, even
  for one — so every call failed with `expected array, received undefined` on
  `/widgets`. The gateway renamed `place_widget` → `place_widgets` when typed
  widgets landed, and this server never followed.
- **Added the typed form to `kilango_place_widget`.** `{ widgetType,
  supplierAppKey? }` places Kilango's own concept (invoices, contracts, …) and
  is now the primary way to build a page: the supplier is derived from the
  portal's activated apps on every save, so it cannot fail. The app-owned form
  (`appKey` + `widgetKey`) still works. Several widgets can be placed in one
  call via `widgets`.
- **Fix: `kilango_call_operation` could not send a body.** The `body` parameter
  was `z.unknown()`, which compiles to an empty JSON Schema, so clients sent it
  as a string and Kilango rejected it with `expected object, received string` —
  making every body-carrying operation (`create_organization`,
  `save_organization_link`, …) unusable. The parameter now declares its arms and
  decodes a JSON-encoded string.

## 0.1.0 (unreleased)

- Initial operator MCP server for Kilango.
- Curated golden-path tools: portals, pages, blocks/widgets (place/move/reorder), apps
  (install/activate/connect), connections, discovery.
- Contract-driven escape hatch (`kilango_call_operation` / `kilango_search_operations` /
  `kilango_describe_operation`) backed by the public `/v1/openapi.json`.
- App-connection browser form at `/kilango/connect-app` for API-key apps (secrets never
  pass through the model context). OAuth apps return a clear "not supported yet" message
  until the Kilango-side OAuth flow ships.
- Shared, workspace-bound API-key auth; one host per company workspace.
