import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { KilangoClient } from '../src/kilango/client.js';
import { createServer } from '../src/server.js';

async function connect(calls: string[]) {
  const fetchImpl = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const client = new KilangoClient({ apiKey: 'hub_test_x', baseUrl: 'https://api.kilango.com', fetchImpl });
  const server = createServer({ client });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(st), mcp.connect(ct)]);
  return mcp;
}

describe('tool path guards', () => {
  it.each([
    ['kilango_check_connection_health', { provider: '..' }],
    ['kilango_get_connection', { provider: '.' }],
    ['kilango_get_portal', { portalRef: '..' }],
    ['kilango_get_catalog_app', { appKey: '%2e%2e' }],
  ])('%s refuses dot-segment ids without calling the API', async (name, args) => {
    const calls: string[] = [];
    const mcp = await connect(calls);
    const result = await mcp.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Invalid');
    expect(calls).toEqual([]);
  });
});
