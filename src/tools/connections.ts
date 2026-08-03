import { z } from 'zod/v4';
import { DESTRUCTIVE, READ_ONLY, runTool, type RegisterFn } from './shared.js';
import { assertWritesEnabled } from '../kilango/policy.js';

const ref = (v: string) => encodeURIComponent(v);

export const registerConnectionTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    'kilango_list_connections',
    {
      title: 'List Connections',
      description: 'List the workspace\'s backend connections (one per provider). Secrets are never returned.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      runTool(ctx, { tool: 'kilango_list_connections', operationId: 'list_connections', method: 'GET', path: '/connections' }, async () => {
        const res = await ctx.client.request('/connections');
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_connection',
    {
      title: 'Get Connection',
      description: 'Return the connection for one provider (status/health, never the secret).',
      inputSchema: { provider: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_get_connection', operationId: 'get_connection', method: 'GET', path: '/connections/{provider}' }, async () => {
        const res = await ctx.client.request(`/connections/${ref(input.provider)}`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_check_connection_health',
    {
      title: 'Check Connection Health',
      description: 'Verify a connection\'s credentials against the source system.',
      inputSchema: { provider: z.string().trim().min(1) },
      annotations: { ...READ_ONLY, idempotentHint: false },
    },
    async input =>
      runTool(ctx, { tool: 'kilango_check_connection_health', operationId: 'check_connection_health', method: 'POST', path: '/connections/{provider}/health-check' }, async () => {
        const res = await ctx.client.request(`/connections/${ref(input.provider)}/health-check`, { method: 'POST', body: {} });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_delete_connection',
    {
      title: 'Delete Connection',
      description: 'Remove a backend connection (drops the stored secret from Kilango\'s vault).',
      inputSchema: { provider: z.string().trim().min(1), dryRun: z.boolean().default(false) },
      annotations: DESTRUCTIVE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_delete_connection', operationId: 'delete_connection', method: 'DELETE', path: '/connections/{provider}' }, async () => {
        assertWritesEnabled('delete_connection');
        const res = await ctx.client.request(`/connections/${ref(input.provider)}`, { method: 'DELETE', dryRun: input.dryRun });
        return res.data;
      }),
  );

  // Note: setting a connection SECRET is only offered through the browser form
  // (kilango_connect_app), never as a tool argument — secrets must not enter the chat.
};
