import { z } from 'zod/v4';
import { DESTRUCTIVE, READ_ONLY, runTool, WRITE, type RegisterFn } from './shared.js';
import { assertWritesEnabled } from '../kilango/policy.js';

const ref = (v: string) => encodeURIComponent(v);

export const registerPortalTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    'kilango_list_portals',
    {
      title: 'List Portals',
      description: 'List portals in the workspace. Optional filters: kind, status, brandId, q (free text). Paged with cursor.',
      inputSchema: {
        kind: z.string().trim().optional(),
        status: z.enum(['DRAFT', 'LIVE', 'ARCHIVED']).optional(),
        brandId: z.string().trim().optional(),
        q: z.string().trim().optional(),
        cursor: z.string().trim().optional(),
      },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_list_portals', operationId: 'list_portals', method: 'GET', path: '/portals' }, async () => {
        const res = await ctx.client.request('/portals', {
          query: { kind: input.kind, status: input.status, brandId: input.brandId, q: input.q, cursor: input.cursor },
        });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_portal',
    {
      title: 'Get Portal',
      description: 'Fetch one portal by uuid or slug. Returns counts, domains, urls, navigation, theme overrides, and the navigation ETag.',
      inputSchema: { portalRef: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_get_portal', operationId: 'get_portal', method: 'GET', path: '/portals/{portalRef}' }, async () => {
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_create_portal',
    {
      title: 'Create Portal',
      description:
        'Create a portal in a brand. With seedHomePage (default true) it gets an "overblik" page + a navigation entry and starts as DRAFT with a preview token. Slug is not editable after creation.',
      inputSchema: {
        brandId: z.string().trim().min(1),
        name: z.string().trim().min(1).max(120),
        kind: z.string().trim().min(1).describe('PortalKind — see kilango_get_vocabulary / the OpenAPI enum.'),
        slug: z.string().trim().max(60).optional(),
        defaultPersonaId: z.string().trim().nullable().optional(),
        seedHomePage: z.boolean().default(true),
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_create_portal', operationId: 'create_portal', method: 'POST', path: '/portals' }, async () => {
        assertWritesEnabled('create_portal');
        const res = await ctx.client.request('/portals', {
          method: 'POST',
          dryRun: input.dryRun,
          body: {
            brandId: input.brandId,
            name: input.name,
            kind: input.kind,
            ...(input.slug ? { slug: input.slug } : {}),
            defaultPersonaId: input.defaultPersonaId ?? null,
            seedHomePage: input.seedHomePage,
          },
        });
        return res.dryRun ? { dryRun: true, wouldCreate: res.data } : res.data;
      }),
  );

  server.registerTool(
    'kilango_update_portal',
    {
      title: 'Update Portal',
      description: 'Update a portal (name / kind / defaultPersonaId). Slug cannot be changed.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        name: z.string().trim().min(1).max(120).optional(),
        kind: z.string().trim().optional(),
        defaultPersonaId: z.string().trim().nullable().optional(),
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_update_portal', operationId: 'update_portal', method: 'PATCH', path: '/portals/{portalRef}' }, async () => {
        assertWritesEnabled('update_portal');
        const body: Record<string, unknown> = {};
        if (input.name !== undefined) body.name = input.name;
        if (input.kind !== undefined) body.kind = input.kind;
        if (input.defaultPersonaId !== undefined) body.defaultPersonaId = input.defaultPersonaId;
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}`, { method: 'PATCH', body, dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_portal_readiness',
    {
      title: 'Get Portal Readiness',
      description: 'Return { ready, blockers[], warnings[] } for a portal. Each problem carries a code and whether it is overridable. Check before publishing.',
      inputSchema: { portalRef: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_get_portal_readiness', operationId: 'get_portal_readiness', method: 'GET', path: '/portals/{portalRef}/readiness' }, async () => {
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/readiness`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_publish_portal',
    {
      title: 'Publish Portal',
      description: 'Publish a portal (idempotent). Pass force=true to publish despite overridable readiness blockers.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        force: z.boolean().default(false),
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_publish_portal', operationId: 'publish_portal', method: 'POST', path: '/portals/{portalRef}/publish' }, async () => {
        assertWritesEnabled('publish_portal');
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/publish`, { method: 'POST', body: { force: input.force }, dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_unpublish_portal',
    {
      title: 'Unpublish Portal',
      description: 'Take a portal offline (back to DRAFT).',
      inputSchema: { portalRef: z.string().trim().min(1), dryRun: z.boolean().default(false) },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_unpublish_portal', operationId: 'unpublish_portal', method: 'POST', path: '/portals/{portalRef}/unpublish' }, async () => {
        assertWritesEnabled('unpublish_portal');
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/unpublish`, { method: 'POST', body: {}, dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_archive_portal',
    {
      title: 'Archive Portal (ADMIN)',
      description: 'Archive a portal. Requires an ADMIN key.',
      inputSchema: { portalRef: z.string().trim().min(1), dryRun: z.boolean().default(false) },
      annotations: DESTRUCTIVE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_archive_portal', operationId: 'archive_portal', method: 'POST', path: '/portals/{portalRef}/archive' }, async () => {
        assertWritesEnabled('archive_portal');
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/archive`, { method: 'POST', body: {}, dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_portal_preview',
    {
      title: 'Get Portal Preview',
      description: 'Return { previewUrl, token } for previewing a DRAFT portal.',
      inputSchema: { portalRef: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_get_portal_preview', operationId: 'get_portal_preview', method: 'GET', path: '/portals/{portalRef}/preview' }, async () => {
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/preview`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_portal_navigation',
    {
      title: 'Get Portal Navigation',
      description: 'Return the portal navigation tree { navigation, etag }. The etag is needed to save navigation.',
      inputSchema: { portalRef: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_get_portal_navigation', operationId: 'get_portal_navigation', method: 'GET', path: '/portals/{portalRef}/navigation' }, async () => {
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/navigation`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_save_portal_navigation',
    {
      title: 'Save Portal Navigation',
      description:
        'Replace the portal navigation tree (whole-document write). Each entry is { pageSlug, label, icon? }. The current ETag is fetched and sent as If-Match automatically; a concurrent change makes it retry once.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        navigation: z.array(z.object({ pageSlug: z.string(), label: z.string(), icon: z.string().optional() })),
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_save_portal_navigation', operationId: 'save_portal_navigation', method: 'PUT', path: '/portals/{portalRef}/navigation' }, async () => {
        assertWritesEnabled('save_portal_navigation');
        const path = `/portals/${ref(input.portalRef)}/navigation`;
        const res = await ctx.client.writeWithIfMatch('PUT', path, {
          body: { navigation: input.navigation },
          etagFromPath: path,
          dryRun: input.dryRun,
        });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_delete_portal',
    {
      title: 'Delete Portal (ADMIN)',
      description: 'Delete a portal. Requires an ADMIN key. Refuses if it has pages or accesses unless force=true.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        force: z.boolean().default(false),
        dryRun: z.boolean().default(false),
      },
      annotations: DESTRUCTIVE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_delete_portal', operationId: 'delete_portal', method: 'DELETE', path: '/portals/{portalRef}' }, async () => {
        assertWritesEnabled('delete_portal');
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}`, {
          method: 'DELETE',
          query: { force: input.force || undefined },
          dryRun: input.dryRun,
        });
        return res.data;
      }),
  );
};
