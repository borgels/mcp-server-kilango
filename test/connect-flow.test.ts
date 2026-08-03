import { afterEach, describe, expect, it, vi } from 'vitest';
import { KilangoClient } from '../src/kilango/client.js';
import { beginConnectApp, submitConnectApp } from '../src/kilango/connect.js';
import { assertWritesEnabled, writesEnabled } from '../src/kilango/policy.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientFor(routes: Record<string, (init?: RequestInit) => Response>): { client: KilangoClient; hits: string[] } {
  const hits: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    hits.push(key);
    const handler = routes[key];
    if (!handler) {
      return json({ error: 'not_found', message: key }, 404);
    }
    return handler(init);
  }) as typeof fetch;
  return { client: new KilangoClient({ apiKey: 'hub_test_x', baseUrl: 'https://api.kilango.com', fetchImpl }), hits };
}

describe('beginConnectApp', () => {
  it('returns oauth_unsupported for an OAuth app', async () => {
    const { client } = clientFor({
      'GET /v1/catalog/apps/sharepoint': () => json({ appKey: 'sharepoint', name: 'SharePoint', authMode: 'oauth', provider: 'sharepoint' }),
    });
    const result = await beginConnectApp(client, 'sharepoint');
    expect(result.kind).toBe('oauth_unsupported');
  });

  it('installs directly when the app has no connection fields', async () => {
    const { client, hits } = clientFor({
      'GET /v1/catalog/apps/hjem': () => json({ appKey: 'hjem', authMode: 'apikey', provider: 'hub', connectionFields: [] }),
      'PUT /v1/app-installations/hjem': () => json({ installed: true }),
      'PUT /v1/portals/acme/apps/hjem': () => json({ activated: true }),
    });
    const result = await beginConnectApp(client, 'hjem', 'acme');
    expect(result.kind).toBe('installed');
    expect(hits).toContain('PUT /v1/app-installations/hjem');
    expect(hits).toContain('PUT /v1/portals/acme/apps/hjem');
  });

  it('returns a form for an API-key app', async () => {
    const { client } = clientFor({
      'GET /v1/catalog/apps/fynk': () =>
        json({ appKey: 'fynk', name: 'Fynk', authMode: 'apikey', provider: 'fynk', connectionFields: [{ key: 'apiKey', type: 'password', required: true }] }),
    });
    const result = await beginConnectApp(client, 'fynk', 'acme');
    expect(result).toMatchObject({ kind: 'form', provider: 'fynk', portalRef: 'acme' });
  });
});

describe('submitConnectApp', () => {
  it('installs, saves the connection, activates and health-checks', async () => {
    const { client, hits } = clientFor({
      'PUT /v1/app-installations/fynk': () => json({ installed: true }),
      'PUT /v1/connections/fynk': () => json({ saved: true }),
      'PUT /v1/portals/acme/apps/fynk': () => json({ activated: true }),
      'POST /v1/connections/fynk/health-check': () => json({ healthy: true }),
    });
    const result = await submitConnectApp(client, { appKey: 'fynk', provider: 'fynk', portalRef: 'acme', secret: { apiKey: 'k' } });
    expect(result.activation).toEqual({ activated: true });
    expect(hits).toEqual([
      'PUT /v1/app-installations/fynk',
      'PUT /v1/connections/fynk',
      'PUT /v1/portals/acme/apps/fynk',
      'POST /v1/connections/fynk/health-check',
    ]);
  });
});

describe('write gating', () => {
  const original = process.env.KILANGO_ENABLE_WRITES;
  afterEach(() => {
    if (original === undefined) delete process.env.KILANGO_ENABLE_WRITES;
    else process.env.KILANGO_ENABLE_WRITES = original;
    vi.unstubAllEnvs();
  });

  it('defaults to enabled', () => {
    delete process.env.KILANGO_ENABLE_WRITES;
    expect(writesEnabled()).toBe(true);
  });

  it('blocks writes when disabled', () => {
    process.env.KILANGO_ENABLE_WRITES = 'false';
    expect(writesEnabled()).toBe(false);
    expect(() => assertWritesEnabled('create_portal')).toThrow(/disabled/);
  });
});
