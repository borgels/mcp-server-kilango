import { describe, expect, it } from 'vitest';
import { buildIndex, resolveOperation, searchOperations, type OpenApiSpec } from '../src/kilango/openapi.js';

const spec: OpenApiSpec = {
  openapi: '3.1.0',
  paths: {
    '/portals': {
      get: { operationId: 'list_portals', summary: 'List portals', tags: ['portals'], parameters: [{ name: 'q', in: 'query' }] },
      post: { operationId: 'create_portal', tags: ['portals'], requestBody: { required: true } },
    },
    '/portals/{portalRef}/pages/{pageRef}/blocks/reorder': {
      post: {
        operationId: 'reorder_page_blocks',
        tags: ['pages'],
        parameters: [
          { name: 'portalRef', in: 'path', required: true },
          { name: 'pageRef', in: 'path', required: true },
          { name: 'If-Match', in: 'header', required: true },
        ],
        requestBody: { required: true },
      },
    },
    '/connections/{provider}/health-check': {
      post: { operationId: 'check_connection_health', tags: ['connections'], 'x-hub-write': false, parameters: [{ name: 'provider', in: 'path', required: true }] },
    },
  },
};

describe('buildIndex', () => {
  it('indexes operations with method, params, write and if-match flags', () => {
    const index = buildIndex(spec);
    expect(index.size).toBe(4);

    const list = index.get('list_portals')!;
    expect(list.method).toBe('GET');
    expect(list.isWrite).toBe(false);
    expect(list.queryParams).toEqual(['q']);

    const reorder = index.get('reorder_page_blocks')!;
    expect(reorder.method).toBe('POST');
    expect(reorder.isWrite).toBe(true);
    expect(reorder.requiresIfMatch).toBe(true);
    expect(reorder.pathParams).toEqual(['portalRef', 'pageRef']);

    // x-hub-write:false forces a POST to read-only.
    expect(index.get('check_connection_health')!.isWrite).toBe(false);
  });
});

describe('resolveOperation', () => {
  it('materializes the path from path params', () => {
    const index = buildIndex(spec);
    const resolved = resolveOperation(index, 'reorder_page_blocks', {
      path: { portalRef: 'acme', pageRef: 'home' },
      body: { order: ['a', 'b'] },
    });
    expect(resolved.path).toBe('/portals/acme/pages/home/blocks/reorder');
    expect(resolved.requiresIfMatch).toBe(true);
    expect(resolved.method).toBe('POST');
  });

  it('throws on a missing path param', () => {
    const index = buildIndex(spec);
    expect(() => resolveOperation(index, 'reorder_page_blocks', { path: { portalRef: 'acme' } })).toThrow(/pageRef/);
  });

  it('throws on an unknown operationId', () => {
    const index = buildIndex(spec);
    expect(() => resolveOperation(index, 'nope', {})).toThrow(/Unknown operationId/);
  });
});

describe('searchOperations', () => {
  it('matches on id, summary, tags and path', () => {
    const index = buildIndex(spec);
    expect(searchOperations(index, 'portal').map(o => o.operationId)).toContain('list_portals');
    expect(searchOperations(index, 'reorder').map(o => o.operationId)).toEqual(['reorder_page_blocks']);
    expect(searchOperations(index, '', 2)).toHaveLength(2);
  });
});
