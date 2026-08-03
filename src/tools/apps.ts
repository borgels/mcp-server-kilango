import { z } from 'zod/v4';
import { DESTRUCTIVE, READ_ONLY, runTool, WRITE, type RegisterFn } from './shared.js';
import { assertWritesEnabled } from '../kilango/policy.js';
import { beginConnectApp } from '../kilango/connect.js';

const ref = (v: string) => encodeURIComponent(v);

export const registerAppTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    'kilango_list_catalog_apps',
    {
      title: 'List Catalog Apps',
      description: 'List installable apps with their manifests (appClass, authMode, connectionFields, widgets).',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      runTool(ctx, { tool: 'kilango_list_catalog_apps', operationId: 'list_catalog_apps', method: 'GET', path: '/catalog/apps' }, async () => {
        const res = await ctx.client.request('/catalog/apps');
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_catalog_app',
    {
      title: 'Get Catalog App',
      description: 'Return one app manifest: appClass, authMode (apikey/oauth), the connectionFields a human must supply, and its widgets (widgetKey + renderRole).',
      inputSchema: { appKey: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_get_catalog_app', operationId: 'get_catalog_app', method: 'GET', path: '/catalog/apps/{appKey}' }, async () => {
        const res = await ctx.client.request(`/catalog/apps/${ref(input.appKey)}`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_list_connectors',
    {
      title: 'List Connectors',
      description: 'List providers and their scope capabilities.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      runTool(ctx, { tool: 'kilango_list_connectors', operationId: 'list_connectors', method: 'GET', path: '/connectors' }, async () => {
        const res = await ctx.client.request('/connectors');
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_list_app_installations',
    {
      title: 'List App Installations',
      description: 'List apps installed in the workspace.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      runTool(ctx, { tool: 'kilango_list_app_installations', operationId: 'list_app_installations', method: 'GET', path: '/app-installations' }, async () => {
        const res = await ctx.client.request('/app-installations');
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_app_installation',
    {
      title: 'Get App Installation',
      description: 'Return the installation record (pinned manifest version, config, status) for one app.',
      inputSchema: { appKey: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_get_app_installation', operationId: 'get_app_installation', method: 'GET', path: '/app-installations/{appKey}' }, async () => {
        const res = await ctx.client.request(`/app-installations/${ref(input.appKey)}`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_install_app',
    {
      title: 'Install App',
      description: 'Install an app into the workspace (idempotent; pins the manifest version). Installing does NOT make it visible — activate it per portal with kilango_activate_app_in_portal. For apps that need credentials, use kilango_connect_app instead.',
      inputSchema: { appKey: z.string().trim().min(1), dryRun: z.boolean().default(false) },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_install_app', operationId: 'install_app', method: 'PUT', path: '/app-installations/{appKey}' }, async () => {
        assertWritesEnabled('install_app');
        const res = await ctx.client.request(`/app-installations/${ref(input.appKey)}`, { method: 'PUT', body: {}, dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_uninstall_app',
    {
      title: 'Uninstall App (ADMIN)',
      description: 'Uninstall an app from the workspace. Requires an ADMIN key. Cascades: removes its widgets from all pages.',
      inputSchema: { appKey: z.string().trim().min(1), dryRun: z.boolean().default(false) },
      annotations: DESTRUCTIVE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_uninstall_app', operationId: 'uninstall_app', method: 'DELETE', path: '/app-installations/{appKey}' }, async () => {
        assertWritesEnabled('uninstall_app');
        const res = await ctx.client.request(`/app-installations/${ref(input.appKey)}`, { method: 'DELETE', dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_list_portal_apps',
    {
      title: 'List Portal Apps',
      description: 'List which installed apps are activated in a given portal.',
      inputSchema: { portalRef: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_list_portal_apps', operationId: 'list_portal_apps', method: 'GET', path: '/portals/{portalRef}/apps' }, async () => {
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/apps`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_activate_app_in_portal',
    {
      title: 'Activate App in Portal',
      description: 'Activate an installed app in a portal (precondition for placing its widgets). Optional per-portal config.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        appKey: z.string().trim().min(1),
        config: z.record(z.string(), z.unknown()).optional(),
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_activate_app_in_portal', operationId: 'activate_app_in_portal', method: 'PUT', path: '/portals/{portalRef}/apps/{appKey}' }, async () => {
        assertWritesEnabled('activate_app_in_portal');
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/apps/${ref(input.appKey)}`, {
          method: 'PUT',
          body: input.config === undefined ? {} : { config: input.config },
          dryRun: input.dryRun,
        });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_deactivate_app_in_portal',
    {
      title: 'Deactivate App in Portal',
      description: 'Deactivate an app in a portal. Cascades widget removal within that portal.',
      inputSchema: { portalRef: z.string().trim().min(1), appKey: z.string().trim().min(1), dryRun: z.boolean().default(false) },
      annotations: DESTRUCTIVE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_deactivate_app_in_portal', operationId: 'deactivate_app_in_portal', method: 'DELETE', path: '/portals/{portalRef}/apps/{appKey}' }, async () => {
        assertWritesEnabled('deactivate_app_in_portal');
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/apps/${ref(input.appKey)}`, { method: 'DELETE', dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_connect_app',
    {
      title: 'Connect App',
      description:
        'Install and connect an app to its backend. For apps that need credentials (API key), returns a one-time browser URL where the operator enters the secrets — they go straight to Kilango\'s vault, never through this chat. Apps without credentials are installed (and activated if a portal is given) immediately. OAuth apps are not connectable yet.',
      inputSchema: {
        appKey: z.string().trim().min(1),
        portalRef: z.string().trim().min(1).optional().describe('If given, the app is also activated in this portal after connecting.'),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_connect_app', operationId: 'connect_app', method: 'POST', path: '/app-installations' }, async () => {
        assertWritesEnabled('connect_app');
        const result = await beginConnectApp(ctx.client, input.appKey, input.portalRef);

        if (result.kind === 'installed') {
          return {
            status: 'connected',
            note: 'App needed no credentials; installed' + (input.portalRef ? ' and activated in the portal.' : '.'),
            result: result.result,
          };
        }
        if (result.kind === 'oauth_unsupported') {
          return { status: 'oauth_unsupported', message: result.message };
        }

        if (!ctx.publicBaseUrl) {
          throw new Error('KILANGO_PUBLIC_BASE_URL is not configured, so the connect-app browser form cannot be offered.');
        }
        const token = ctx.states.create({
          appKey: result.appKey,
          provider: result.provider,
          portalRef: result.portalRef,
          connectionFields: result.connectionFields,
          user: ctx.onBehalfOf,
        });
        const enrollmentUrl = `${ctx.publicBaseUrl.replace(/\/+$/, '')}/kilango/connect-app?state=${token}`;
        return {
          status: 'action_required',
          enrollmentUrl,
          message:
            `Open this URL in a browser to enter the credentials for "${result.app.name ?? result.appKey}". ` +
            `The secret is sent straight to Kilango and is never shown here. The link is single-use and expires in 10 minutes.`,
          fields: result.connectionFields.map(f => ({ key: f.key, label: f.label ?? f.key, required: f.required !== false })),
        };
      }),
  );
};
