import { describe, expect, it } from 'vitest';
import { KilangoClient, unwrapEnvelope } from '../src/kilango/client.js';
import { KilangoApiError, redactSecrets } from '../src/errors.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function clientWith(fetchImpl: typeof fetch): KilangoClient {
  return new KilangoClient({ apiKey: 'hub_test_abc123', baseUrl: 'https://api.kilango.com', fetchImpl });
}

describe('unwrapEnvelope', () => {
  it('returns items array for a bare list envelope', () => {
    expect(unwrapEnvelope({ items: [1, 2, 3] })).toEqual([1, 2, 3]);
  });

  it('keeps items + nextCursor for a paged envelope', () => {
    expect(unwrapEnvelope({ items: [1], nextCursor: 'c' })).toEqual({ items: [1], nextCursor: 'c' });
  });

  it('returns a single resource object as-is', () => {
    expect(unwrapEnvelope({ id: 'p1', items: 5 })).toEqual({ id: 'p1', items: 5 });
  });
});

describe('KilangoClient.request', () => {
  it('sends the bearer key and unwraps a paged list', async () => {
    let seenAuth: string | null = null;
    const client = clientWith(async (input, init) => {
      seenAuth = new Headers(init?.headers).get('authorization');
      expect(String(input)).toBe('https://api.kilango.com/v1/portals');
      return jsonResponse({ items: [{ id: 'a' }], nextCursor: 'n1' });
    });
    const res = await client.request('/portals');
    expect(seenAuth).toBe('Bearer hub_test_abc123');
    expect(res.data).toEqual({ items: [{ id: 'a' }], nextCursor: 'n1' });
  });

  it('adds Idempotency-Key on writes and ?dryRun when requested', async () => {
    let seenIdem: string | null = null;
    let seenUrl = '';
    const client = clientWith(async (input, init) => {
      seenUrl = String(input);
      seenIdem = new Headers(init?.headers).get('idempotency-key');
      return jsonResponse({ id: 'p1' });
    });
    await client.request('/portals', { method: 'POST', body: { name: 'x' }, dryRun: true });
    expect(seenIdem).toBeTruthy();
    expect(seenUrl).toContain('dryRun=true');
  });

  it('throws KilangoApiError carrying code, remediation and requestId', async () => {
    const client = clientWith(async () =>
      jsonResponse(
        { error: 'app_not_activated_in_portal', message: 'nope', remediation: 'PUT /v1/portals/x/apps/y', requestId: 'req-9' },
        409,
      ),
    );
    await expect(client.request('/portals/x/pages/y/widgets', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'app_not_activated_in_portal',
      remediation: 'PUT /v1/portals/x/apps/y',
      requestId: 'req-9',
      status: 409,
    });
  });
});

describe('redactSecrets', () => {
  it('redacts hub keys and secret fields', () => {
    expect(redactSecrets('token hub_live_supersecretvalue here')).toContain('hub_live_[REDACTED]');
    expect(redactSecrets('Authorization: Bearer abc.def.ghi')).toContain('[REDACTED]');
    expect(redactSecrets('{"apiKey":"topsecret"}')).toContain('[REDACTED]');
  });

  it('is applied to KilangoApiError messages', () => {
    const err = new KilangoApiError({ status: 400, code: 'x', message: 'bad key hub_live_leak123' });
    expect(err.message).not.toContain('leak123');
  });
});
