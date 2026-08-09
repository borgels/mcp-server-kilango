import { z } from 'zod/v4';
import { contractIndex, runTool, WRITE, type RegisterFn } from './shared.js';
import { resolveOperation } from '../kilango/openapi.js';
import { assertWritesEnabled } from '../kilango/policy.js';

const queryValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * The request body, as an object/array — or as a JSON STRING.
 *
 * The string arm is not politeness, it is the difference between this tool
 * working and not. `z.unknown()` compiles to an empty JSON Schema (`{}`), which
 * tells an MCP client nothing about the type, and clients then send the
 * argument as a string. Kilango's zod body schemas reject that with
 * "expected object, received string", so EVERY operation with a body was
 * unusable through this escape hatch — create_organization,
 * save_organization_link, the lot.
 *
 * Declaring the arms fixes the schema for well-behaved clients; parsing the
 * string arm fixes the ones that stringify anyway.
 */
const bodyValue = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.string(),
]);

/** JSON-decode a stringified body; anything else passes through untouched. */
export function normalizeBody(body: unknown): unknown {
  if (typeof body !== 'string') {
    return body;
  }
  const trimmed = body.trim();
  if (trimmed === '') {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(
      'body was sent as a string that is not valid JSON. Pass the body as an object, or as a JSON-encoded string.',
    );
  }
}

export const registerOperationTools: RegisterFn = (server, ctx) => {
  server.registerTool(
    'kilango_call_operation',
    {
      title: 'Call Kilango Operation',
      description:
        'Escape hatch: call any operator API operation by its operationId (discover ids with kilango_search_operations / kilango_describe_operation). Provide path params, query, and body separately. If-Match operations fetch and send the current ETag automatically. Mutating calls are gated by KILANGO_ENABLE_WRITES and by the API key\'s own scopes.',
      inputSchema: {
        operationId: z.string().trim().min(1),
        path: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Path parameters, e.g. { portalRef: "acme" }.'),
        query: z.record(z.string(), queryValue).optional(),
        body: bodyValue.optional().describe(
          'Request body as an object (or array). A JSON-encoded string is also accepted and decoded.',
        ),
        dryRun: z.boolean().default(false),
        idempotencyKey: z.string().trim().min(8).optional(),
      },
      annotations: WRITE,
    },
    async input =>
      runTool(ctx, { tool: 'kilango_call_operation', operationId: input.operationId }, async () => {
        const index = await contractIndex(ctx);
        const resolved = resolveOperation(index, input.operationId, {
          path: input.path,
          query: input.query,
          body: normalizeBody(input.body),
        });

        if (resolved.isWrite) {
          assertWritesEnabled(input.operationId);
        }

        if (resolved.requiresIfMatch) {
          const res = await ctx.client.writeWithIfMatch(resolved.method, resolved.path, {
            body: resolved.body,
            query: resolved.query,
            etagFromPath: resolved.path,
            idempotencyKey: input.idempotencyKey,
            dryRun: input.dryRun,
          });
          return res.data;
        }

        const res = await ctx.client.request(resolved.path, {
          method: resolved.method,
          body: resolved.body,
          query: resolved.query,
          idempotencyKey: input.idempotencyKey,
          dryRun: input.dryRun,
        });
        return res.data;
      }),
  );
};
