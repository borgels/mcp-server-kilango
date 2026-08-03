import { z } from 'zod/v4';
import { DESTRUCTIVE, READ_ONLY, runTool, WRITE, type RegisterFn } from './shared.js';
import { assertWritesEnabled } from '../kilango/policy.js';
import {
  assertCompletePermutation,
  assertSinglePosition,
  blockIdsOf,
  computeReorder,
  summarizeRendering,
  type Position,
} from '../kilango/widgets.js';

// NOTE: the exact page/block/widget sub-paths below follow the researched REST structure
// (reorder = POST .../blocks/reorder, layout = PUT .../layout, blocks list = GET .../blocks).
// They are cross-checked against GET /v1/openapi.json in test/live-smoke.ts; if any differ,
// correct the template here (values are substituted directly, so param NAMES don't matter).
const ref = (v: string) => encodeURIComponent(v);
const pageBase = (portalRef: string, pageRef: string) =>
  `/portals/${ref(portalRef)}/pages/${ref(pageRef)}`;

const positionSchema = z
  .object({
    index: z.number().int().min(0).optional(),
    before: z.string().optional(),
    after: z.string().optional(),
  })
  .optional();

export const registerPageTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    'kilango_list_pages',
    {
      title: 'List Pages',
      description: 'List the pages of a portal, ordered by sortOrder.',
      inputSchema: { portalRef: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_list_pages', operationId: 'list_pages', method: 'GET', path: '/portals/{portalRef}/pages' }, async () => {
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/pages`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_page',
    {
      title: 'Get Page',
      description: 'Fetch one page (by slug or id) including its layout.',
      inputSchema: { portalRef: z.string().trim().min(1), pageRef: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_get_page', operationId: 'get_page', method: 'GET', path: '/portals/{portalRef}/pages/{pageRef}' }, async () => {
        const res = await ctx.client.request(pageBase(input.portalRef, input.pageRef));
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_get_page_blocks',
    {
      title: 'Get Page Blocks',
      description: 'Return the ordered blocks of a page. Each block has a stable blockId; app-widget blocks carry a widgetInstanceId.',
      inputSchema: { portalRef: z.string().trim().min(1), pageRef: z.string().trim().min(1) },
      annotations: READ_ONLY,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_get_page_blocks', operationId: 'get_page_blocks', method: 'GET', path: '/portals/{portalRef}/pages/{pageRef}/blocks' }, async () => {
        const res = await ctx.client.request(`${pageBase(input.portalRef, input.pageRef)}/blocks`);
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_create_page',
    {
      title: 'Create Page',
      description: 'Create a page in a portal. sortOrder controls page order in navigation. Layout is added separately with kilango_save_page_layout / kilango_add_content_block.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        slug: z.string().trim().min(1),
        title: z.string().trim().min(1),
        sortOrder: z.number().int().optional(),
        visibility: z.record(z.string(), z.unknown()).optional(),
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_create_page', operationId: 'create_page', method: 'POST', path: '/portals/{portalRef}/pages' }, async () => {
        assertWritesEnabled('create_page');
        const res = await ctx.client.request(`/portals/${ref(input.portalRef)}/pages`, {
          method: 'POST',
          dryRun: input.dryRun,
          body: {
            slug: input.slug,
            title: input.title,
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            ...(input.visibility ? { visibility: input.visibility } : {}),
          },
        });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_update_page',
    {
      title: 'Update Page',
      description: 'Update a page (title / sortOrder / visibility).',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        pageRef: z.string().trim().min(1),
        title: z.string().trim().min(1).optional(),
        sortOrder: z.number().int().optional(),
        visibility: z.record(z.string(), z.unknown()).optional(),
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_update_page', operationId: 'update_page', method: 'PATCH', path: '/portals/{portalRef}/pages/{pageRef}' }, async () => {
        assertWritesEnabled('update_page');
        const body: Record<string, unknown> = {};
        if (input.title !== undefined) body.title = input.title;
        if (input.sortOrder !== undefined) body.sortOrder = input.sortOrder;
        if (input.visibility !== undefined) body.visibility = input.visibility;
        const res = await ctx.client.request(pageBase(input.portalRef, input.pageRef), { method: 'PATCH', body, dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_delete_page',
    {
      title: 'Delete Page (ADMIN)',
      description: 'Delete a page. Requires an ADMIN key.',
      inputSchema: { portalRef: z.string().trim().min(1), pageRef: z.string().trim().min(1), dryRun: z.boolean().default(false) },
      annotations: DESTRUCTIVE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_delete_page', operationId: 'delete_page', method: 'DELETE', path: '/portals/{portalRef}/pages/{pageRef}' }, async () => {
        assertWritesEnabled('delete_page');
        const res = await ctx.client.request(pageBase(input.portalRef, input.pageRef), { method: 'DELETE', dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_save_page_layout',
    {
      title: 'Save Page Layout',
      description:
        'Replace the whole page layout (a Puck payload { root, content: [...] }). Whole-document write: the current ETag is fetched and sent as If-Match automatically. Preserve each app-widget block\'s widgetInstanceId verbatim, or the widget row is recreated.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        pageRef: z.string().trim().min(1),
        layout: z.record(z.string(), z.unknown()),
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_save_page_layout', operationId: 'save_page_layout', method: 'PUT', path: '/portals/{portalRef}/pages/{pageRef}/layout' }, async () => {
        assertWritesEnabled('save_page_layout');
        const path = `${pageBase(input.portalRef, input.pageRef)}/layout`;
        const res = await ctx.client.writeWithIfMatch('PUT', path, { body: { layout: input.layout }, etagFromPath: path, dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_add_content_block',
    {
      title: 'Add Content Block',
      description:
        'Add a Hub-native content block (e.g. Heading, RichText, WidgetGrid) to a page at an optional position (at most one of index/before/after).',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        pageRef: z.string().trim().min(1),
        type: z.string().trim().min(1),
        props: z.record(z.string(), z.unknown()).optional(),
        position: positionSchema,
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_add_content_block', operationId: 'add_content_block', method: 'POST', path: '/portals/{portalRef}/pages/{pageRef}/content-blocks' }, async () => {
        assertWritesEnabled('add_content_block');
        assertSinglePosition(input.position as Position | undefined);
        const res = await ctx.client.request(`${pageBase(input.portalRef, input.pageRef)}/content-blocks`, {
          method: 'POST',
          dryRun: input.dryRun,
          body: { type: input.type, props: input.props ?? {}, ...(input.position ? { position: input.position } : {}) },
        });
        const note = summarizeRendering(res.data);
        return note ? { result: res.data, note } : res.data;
      }),
  );

  server.registerTool(
    'kilango_update_content_block',
    {
      title: 'Update Content Block',
      description: 'Update a content block\'s props and/or move it (position). Position is at most one of index/before/after.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        pageRef: z.string().trim().min(1),
        blockId: z.string().trim().min(1),
        props: z.record(z.string(), z.unknown()).optional(),
        position: positionSchema,
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_update_content_block', operationId: 'update_content_block', method: 'PATCH', path: '/portals/{portalRef}/pages/{pageRef}/content-blocks/{blockId}' }, async () => {
        assertWritesEnabled('update_content_block');
        assertSinglePosition(input.position as Position | undefined);
        const body: Record<string, unknown> = {};
        if (input.props !== undefined) body.props = input.props;
        if (input.position !== undefined) body.position = input.position;
        const res = await ctx.client.request(`${pageBase(input.portalRef, input.pageRef)}/content-blocks/${ref(input.blockId)}`, { method: 'PATCH', body, dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_delete_content_block',
    {
      title: 'Delete Content Block',
      description: 'Remove a block from a page.',
      inputSchema: { portalRef: z.string().trim().min(1), pageRef: z.string().trim().min(1), blockId: z.string().trim().min(1), dryRun: z.boolean().default(false) },
      annotations: DESTRUCTIVE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_delete_content_block', operationId: 'delete_content_block', method: 'DELETE', path: '/portals/{portalRef}/pages/{pageRef}/content-blocks/{blockId}' }, async () => {
        assertWritesEnabled('delete_content_block');
        const res = await ctx.client.request(`${pageBase(input.portalRef, input.pageRef)}/content-blocks/${ref(input.blockId)}`, { method: 'DELETE', dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_place_widget',
    {
      title: 'Place App Widget',
      description:
        'Place an app widget on a page. The app must be installed AND activated in the portal first (otherwise the app_not_activated_in_portal error names the fixing call). Visual position follows the widget\'s renderRole tier — read the returned rendering note; index 0 is not necessarily top of page.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        pageRef: z.string().trim().min(1),
        appKey: z.string().trim().min(1),
        widgetKey: z.string().trim().min(1),
        position: positionSchema,
        config: z.record(z.string(), z.unknown()).optional(),
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_place_widget', operationId: 'place_widgets', method: 'POST', path: '/portals/{portalRef}/pages/{pageRef}/widgets' }, async () => {
        assertWritesEnabled('place_widgets');
        assertSinglePosition(input.position as Position | undefined);
        const res = await ctx.client.request(`${pageBase(input.portalRef, input.pageRef)}/widgets`, {
          method: 'POST',
          dryRun: input.dryRun,
          body: {
            appKey: input.appKey,
            widgetKey: input.widgetKey,
            ...(input.config ? { config: input.config } : {}),
            ...(input.position ? { position: input.position } : {}),
          },
        });
        const note = summarizeRendering(res.data);
        return note ? { result: res.data, note } : res.data;
      }),
  );

  server.registerTool(
    'kilango_update_widget',
    {
      title: 'Update App Widget',
      description: 'Update an app-widget block\'s config and/or position.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        pageRef: z.string().trim().min(1),
        blockId: z.string().trim().min(1),
        config: z.record(z.string(), z.unknown()).optional(),
        position: positionSchema,
        dryRun: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_update_widget', operationId: 'update_widget', method: 'PATCH', path: '/portals/{portalRef}/pages/{pageRef}/widgets/{blockId}' }, async () => {
        assertWritesEnabled('update_widget');
        assertSinglePosition(input.position as Position | undefined);
        const body: Record<string, unknown> = {};
        if (input.config !== undefined) body.config = input.config;
        if (input.position !== undefined) body.position = input.position;
        const res = await ctx.client.request(`${pageBase(input.portalRef, input.pageRef)}/widgets/${ref(input.blockId)}`, { method: 'PATCH', body, dryRun: input.dryRun });
        return res.data;
      }),
  );

  server.registerTool(
    'kilango_delete_widget',
    {
      title: 'Delete App Widget',
      description: 'Remove an app-widget block from a page.',
      inputSchema: { portalRef: z.string().trim().min(1), pageRef: z.string().trim().min(1), blockId: z.string().trim().min(1), dryRun: z.boolean().default(false) },
      annotations: DESTRUCTIVE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_delete_widget', operationId: 'delete_widget', method: 'DELETE', path: '/portals/{portalRef}/pages/{pageRef}/widgets/{blockId}' }, async () => {
        assertWritesEnabled('delete_widget');
        const res = await ctx.client.request(`${pageBase(input.portalRef, input.pageRef)}/widgets/${ref(input.blockId)}`, { method: 'DELETE', dryRun: input.dryRun });
        return res.data;
      }),
  );

  // --- Drag-and-drop reordering ---

  server.registerTool(
    'kilango_move_block',
    {
      title: 'Move Block (drag-and-drop)',
      description:
        'Move one block to a new position (index, or before/after another blockId). Fetches the current order, computes the complete permutation, and calls reorder with If-Match. Position within a render tier follows the widget renderRole, so the visual result may differ from the array index — read the rendering note.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        pageRef: z.string().trim().min(1),
        blockId: z.string().trim().min(1),
        position: z.object({
          index: z.number().int().min(0).optional(),
          before: z.string().optional(),
          after: z.string().optional(),
        }),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_move_block', operationId: 'reorder_page_blocks', method: 'POST', path: '/portals/{portalRef}/pages/{pageRef}/blocks/reorder' }, async () => {
        assertWritesEnabled('reorder_page_blocks');
        const blocksPath = `${pageBase(input.portalRef, input.pageRef)}/blocks`;
        const current = await ctx.client.getWithEtag(blocksPath);
        const order = blockIdsOf(current.data);
        const nextOrder = computeReorder(order, input.blockId, input.position as Position);
        const res = await ctx.client.writeWithIfMatch('POST', `${blocksPath}/reorder`, {
          body: { order: nextOrder },
          ifMatch: current.etag,
          etagFromPath: blocksPath,
        });
        const note = summarizeRendering(res.data);
        return { order: nextOrder, result: res.data, ...(note ? { note } : {}) };
      }),
  );

  server.registerTool(
    'kilango_reorder_blocks',
    {
      title: 'Reorder Blocks',
      description:
        'Set the full block order on a page. `order` must be a complete permutation of every existing blockId (no adds/drops). Sent to reorder with If-Match.',
      inputSchema: {
        portalRef: z.string().trim().min(1),
        pageRef: z.string().trim().min(1),
        order: z.array(z.string().trim().min(1)).min(1),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_reorder_blocks', operationId: 'reorder_page_blocks', method: 'POST', path: '/portals/{portalRef}/pages/{pageRef}/blocks/reorder' }, async () => {
        assertWritesEnabled('reorder_page_blocks');
        const blocksPath = `${pageBase(input.portalRef, input.pageRef)}/blocks`;
        const current = await ctx.client.getWithEtag(blocksPath);
        assertCompletePermutation(blockIdsOf(current.data), input.order);
        const res = await ctx.client.writeWithIfMatch('POST', `${blocksPath}/reorder`, {
          body: { order: input.order },
          ifMatch: current.etag,
          etagFromPath: blocksPath,
        });
        return res.data;
      }),
  );
};
