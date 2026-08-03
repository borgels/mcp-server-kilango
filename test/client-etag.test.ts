import { describe, expect, it } from 'vitest';
import { KilangoClient } from '../src/kilango/client.js';

interface Call {
  method: string;
  url: string;
  ifMatch: string | null;
}

function recording(handlers: Array<(call: Call) => Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      ifMatch: new Headers(init?.headers).get('if-match'),
    };
    calls.push(call);
    const handler = handlers[Math.min(i, handlers.length - 1)]!;
    i += 1;
    return handler(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('KilangoClient.writeWithIfMatch', () => {
  it('fetches the current ETag and sends it as If-Match', async () => {
    const { fetchImpl, calls } = recording([
      call => (call.method === 'GET' ? json({ navigation: [] }, 200, { etag: 'v1' }) : json({ ok: true })),
    ]);
    const client = new KilangoClient({ apiKey: 'hub_test_x', baseUrl: 'https://api.kilango.com', fetchImpl });
    await client.writeWithIfMatch('PUT', '/portals/p/navigation', { body: { navigation: [] } });
    expect(calls[0]?.method).toBe('GET');
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.ifMatch).toBe('v1');
  });

  it('re-reads and retries once on 412, then succeeds', async () => {
    const responses = [
      () => json({}, 200, { etag: 'v1' }), // initial GET
      () => json({ error: 'precondition_failed', message: 'stale' }, 412), // first PUT
      () => json({}, 200, { etag: 'v2' }), // re-GET
      () => json({ ok: true }), // retry PUT
    ];
    let i = 0;
    const calls: Call[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(input), ifMatch: new Headers(init?.headers).get('if-match') });
      const r = responses[i]!();
      i += 1;
      return r;
    }) as typeof fetch;
    const client = new KilangoClient({ apiKey: 'hub_test_x', baseUrl: 'https://api.kilango.com', fetchImpl });
    const res = await client.writeWithIfMatch('PUT', '/portals/p/navigation', { body: {} });
    expect(res.data).toEqual({ ok: true });
    expect(calls.map(c => c.method)).toEqual(['GET', 'PUT', 'GET', 'PUT']);
    expect(calls[3]?.ifMatch).toBe('v2');
  });

  it('throws concurrent_modification when the retry also 412s', async () => {
    const responses = [
      () => json({}, 200, { etag: 'v1' }),
      () => json({ error: 'precondition_failed' }, 412),
      () => json({}, 200, { etag: 'v2' }),
      () => json({ error: 'precondition_failed' }, 412),
    ];
    let i = 0;
    const fetchImpl = (async () => {
      const r = responses[Math.min(i, responses.length - 1)]!();
      i += 1;
      return r;
    }) as typeof fetch;
    const client = new KilangoClient({ apiKey: 'hub_test_x', baseUrl: 'https://api.kilango.com', fetchImpl });
    await expect(client.writeWithIfMatch('PUT', '/portals/p/navigation', { body: {} })).rejects.toMatchObject({
      code: 'concurrent_modification',
      status: 412,
    });
  });

  it('does not retry when an explicit ifMatch is supplied', async () => {
    let puts = 0;
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') {
        puts += 1;
        return json({ error: 'precondition_failed' }, 412);
      }
      return json({}, 200, { etag: 'v9' });
    }) as typeof fetch;
    const client = new KilangoClient({ apiKey: 'hub_test_x', baseUrl: 'https://api.kilango.com', fetchImpl });
    await expect(
      client.writeWithIfMatch('PUT', '/portals/p/navigation', { body: {}, ifMatch: 'given' }),
    ).rejects.toMatchObject({ status: 412 });
    expect(puts).toBe(1);
  });
});
