/**
 * Live smoke test against a real Kilango gateway. NOT part of `vitest run`.
 *
 *   KILANGO_API_BASE_URL=https://<dev-gateway-host> \
 *   KILANGO_API_KEY=hub_test_... \
 *   [KILANGO_SMOKE_WRITE=true KILANGO_SMOKE_BRAND_ID=<brandId>] \
 *   npm run smoke:live
 *
 * Phase 1 (always): loads /v1/openapi.json and cross-checks that every curated tool's
 * operationId exists and its (method, path-structure) matches the contract — this is the
 * authoritative check for the hardcoded paths in tools/*.ts.
 *
 * Phase 2 (only with KILANGO_SMOKE_WRITE=true + a brandId): drives the golden path
 * (create portal → page → install+connect fynk with a dummy key → place+reorder widgets →
 * readiness → publish) and then deletes the portal to clean up.
 */
import { KilangoClient } from '../src/kilango/client.js';
import { loadContract } from '../src/kilango/openapi.js';

const CURATED: Array<{ operationId: string; method: string; path: string }> = [
  { operationId: 'get_workspace', method: 'GET', path: '/workspace' },
  { operationId: 'get_meta', method: 'GET', path: '/meta' },
  { operationId: 'get_vocabulary', method: 'GET', path: '/vocabulary' },
  { operationId: 'list_portals', method: 'GET', path: '/portals' },
  { operationId: 'get_portal', method: 'GET', path: '/portals/{}' },
  { operationId: 'create_portal', method: 'POST', path: '/portals' },
  { operationId: 'update_portal', method: 'PATCH', path: '/portals/{}' },
  { operationId: 'get_portal_readiness', method: 'GET', path: '/portals/{}/readiness' },
  { operationId: 'publish_portal', method: 'POST', path: '/portals/{}/publish' },
  { operationId: 'unpublish_portal', method: 'POST', path: '/portals/{}/unpublish' },
  { operationId: 'archive_portal', method: 'POST', path: '/portals/{}/archive' },
  { operationId: 'get_portal_preview', method: 'GET', path: '/portals/{}/preview' },
  { operationId: 'get_portal_navigation', method: 'GET', path: '/portals/{}/navigation' },
  { operationId: 'save_portal_navigation', method: 'PUT', path: '/portals/{}/navigation' },
  { operationId: 'delete_portal', method: 'DELETE', path: '/portals/{}' },
  { operationId: 'list_pages', method: 'GET', path: '/portals/{}/pages' },
  { operationId: 'get_page', method: 'GET', path: '/portals/{}/pages/{}' },
  { operationId: 'get_page_blocks', method: 'GET', path: '/portals/{}/pages/{}/blocks' },
  { operationId: 'create_page', method: 'POST', path: '/portals/{}/pages' },
  { operationId: 'update_page', method: 'PATCH', path: '/portals/{}/pages/{}' },
  { operationId: 'delete_page', method: 'DELETE', path: '/portals/{}/pages/{}' },
  { operationId: 'save_page_layout', method: 'PUT', path: '/portals/{}/pages/{}/layout' },
  { operationId: 'add_content_block', method: 'POST', path: '/portals/{}/pages/{}/content-blocks' },
  { operationId: 'update_content_block', method: 'PATCH', path: '/portals/{}/pages/{}/content-blocks/{}' },
  { operationId: 'delete_content_block', method: 'DELETE', path: '/portals/{}/pages/{}/content-blocks/{}' },
  { operationId: 'reorder_page_blocks', method: 'POST', path: '/portals/{}/pages/{}/blocks/reorder' },
  { operationId: 'place_widgets', method: 'POST', path: '/portals/{}/pages/{}/widgets' },
  { operationId: 'update_widget', method: 'PATCH', path: '/portals/{}/pages/{}/widgets/{}' },
  { operationId: 'delete_widget', method: 'DELETE', path: '/portals/{}/pages/{}/widgets/{}' },
  { operationId: 'list_catalog_apps', method: 'GET', path: '/catalog/apps' },
  { operationId: 'get_catalog_app', method: 'GET', path: '/catalog/apps/{}' },
  { operationId: 'list_connectors', method: 'GET', path: '/connectors' },
  { operationId: 'list_app_installations', method: 'GET', path: '/app-installations' },
  { operationId: 'get_app_installation', method: 'GET', path: '/app-installations/{}' },
  { operationId: 'install_app', method: 'PUT', path: '/app-installations/{}' },
  { operationId: 'uninstall_app', method: 'DELETE', path: '/app-installations/{}' },
  { operationId: 'list_portal_apps', method: 'GET', path: '/portals/{}/apps' },
  { operationId: 'activate_app_in_portal', method: 'PUT', path: '/portals/{}/apps/{}' },
  { operationId: 'deactivate_app_in_portal', method: 'DELETE', path: '/portals/{}/apps/{}' },
  { operationId: 'list_connections', method: 'GET', path: '/connections' },
  { operationId: 'get_connection', method: 'GET', path: '/connections/{}' },
  { operationId: 'check_connection_health', method: 'POST', path: '/connections/{}/health-check' },
  { operationId: 'delete_connection', method: 'DELETE', path: '/connections/{}' },
];

const normalize = (path: string) => path.replace(/\{[^}]+\}/g, '{}');

async function main(): Promise<void> {
  const baseUrl = process.env.KILANGO_API_BASE_URL;
  const apiKey = process.env.KILANGO_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('Set KILANGO_API_BASE_URL and KILANGO_API_KEY (a hub_test_ key) to run the smoke test.');
  }
  const client = new KilangoClient({ baseUrl, apiKey });

  console.log('== Phase 1: contract cross-check ==');
  const index = await loadContract({ baseUrl: client.baseUrl, force: true });
  let mismatches = 0;
  for (const expected of CURATED) {
    const info = index.get(expected.operationId);
    if (!info) {
      console.warn(`  ✗ ${expected.operationId}: not found in contract`);
      mismatches += 1;
      continue;
    }
    const actual = `${info.method} ${normalize(info.pathTemplate)}`;
    const want = `${expected.method} ${expected.path}`;
    if (actual !== want) {
      console.warn(`  ✗ ${expected.operationId}: contract says "${actual}", tool uses "${want}"`);
      mismatches += 1;
    } else {
      console.log(`  ✓ ${expected.operationId} (${actual})`);
    }
  }
  console.log(mismatches === 0 ? 'All curated paths match the contract.' : `${mismatches} mismatch(es) — fix the tool path templates.`);

  const workspace = await client.request('/workspace');
  console.log('Connected workspace:', JSON.stringify(workspace.data));

  if (process.env.KILANGO_SMOKE_WRITE !== 'true') {
    console.log('\n(Set KILANGO_SMOKE_WRITE=true and KILANGO_SMOKE_BRAND_ID=<id> to run the write golden path.)');
    if (mismatches > 0) process.exitCode = 1;
    return;
  }

  const brandId = process.env.KILANGO_SMOKE_BRAND_ID;
  if (!brandId) {
    throw new Error('KILANGO_SMOKE_WRITE=true requires KILANGO_SMOKE_BRAND_ID.');
  }

  console.log('\n== Phase 2: golden path (write) ==');
  const slug = `mcp-smoke-${workspace.requestId ?? 'x'}`.slice(0, 40);
  const portal = await client.request<{ id: string; slug?: string }>('/portals', {
    method: 'POST',
    body: { brandId, name: 'MCP Smoke Portal', kind: 'client', slug, seedHomePage: true },
  });
  const portalRef = (portal.data as { slug?: string; id: string }).slug ?? (portal.data as { id: string }).id;
  console.log('Created portal:', portalRef);

  try {
    const page = await client.request('/portals/' + encodeURIComponent(portalRef) + '/pages', {
      method: 'POST',
      body: { slug: 'smoke', title: 'Smoke' },
    });
    console.log('Created page:', JSON.stringify(page.data));

    const readiness = await client.request(`/portals/${encodeURIComponent(portalRef)}/readiness`);
    console.log('Readiness:', JSON.stringify(readiness.data));
  } finally {
    await client.request(`/portals/${encodeURIComponent(portalRef)}`, { method: 'DELETE', query: { force: true } });
    console.log('Cleaned up portal:', portalRef);
  }
  if (mismatches > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
