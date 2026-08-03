# Changelog

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
