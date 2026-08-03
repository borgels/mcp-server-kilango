import { z } from 'zod/v4';
import { contractIndex, READ_ONLY, runTool, type RegisterFn } from './shared.js';
import { describeOperation, searchOperations } from '../kilango/openapi.js';

export const registerDiscoveryTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    'kilango_get_workspace',
    {
      title: 'Get Kilango Workspace',
      description:
        'Return the workspace this connector is bound to, plus the key role/scopes. Call this first to confirm which workspace and what capability (read vs write, ADMIN) you have.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      runTool(ctx, { tool: 'kilango_get_workspace', operationId: 'get_workspace', method: 'GET', path: '/workspace' }, async () => {
        const res = await ctx.client.request('/workspace');
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_meta',
    {
      title: 'Get Kilango Meta',
      description: 'Return server/tenant metadata for the connected workspace.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      runTool(ctx, { tool: 'kilango_get_meta', operationId: 'get_meta', method: 'GET', path: '/meta' }, async () => {
        const res = await ctx.client.request('/meta');
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_vocabulary',
    {
      title: 'Get Kilango Vocabulary',
      description:
        'Return tenant data to fill argument values: brands, portals, personas, installed apps (with their widget keys), and connected providers. Use this to discover valid ids before creating or editing.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      runTool(ctx, { tool: 'kilango_get_vocabulary', operationId: 'get_vocabulary', method: 'GET', path: '/vocabulary' }, async () => {
        const res = await ctx.client.request('/vocabulary');
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_search_operations',
    {
      title: 'Search Kilango Operations',
      description:
        'Search the full operator API contract (from /v1/openapi.json) for operations not covered by a curated tool. Returns operationIds usable with kilango_call_operation.',
      inputSchema: {
        query: z.string().trim().default(''),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    async input =>
      runTool(ctx, { tool: 'kilango_search_operations' }, async () => {
        const index = await contractIndex(ctx);
        return searchOperations(index, input.query, input.limit);
      }),
  );

  server.registerTool(
    'kilango_describe_operation',
    {
      title: 'Describe Kilango Operation',
      description:
        'Return the method, path, path/query params, whether it needs If-Match, and whether it is a write for a given operationId. Use before kilango_call_operation.',
      inputSchema: {
        operationId: z.string().trim().min(1),
      },
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    async input =>
      runTool(ctx, { tool: 'kilango_describe_operation' }, async () => {
        const index = await contractIndex(ctx);
        return (
          describeOperation(index, input.operationId) ?? {
            error: `Unknown operationId: ${input.operationId}`,
          }
        );
      }),
  );
};
