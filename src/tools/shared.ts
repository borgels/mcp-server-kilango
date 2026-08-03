import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KilangoClient } from '../kilango/client.js';
import type { StateStore } from '../kilango/state.js';
import { loadContract, type OperationInfo } from '../kilango/openapi.js';
import { writeAuditEvent } from '../kilango/audit.js';
import { formatUnknownError, KilangoApiError } from '../errors.js';

export interface ToolContext {
  client: KilangoClient;
  /** Gateway-verified end user (X-MCP-User); recorded in the audit log only. */
  onBehalfOf?: string;
  /** Public origin of this host, used to build the connect-app enrollment URL. */
  publicBaseUrl?: string;
  states: StateStore;
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export function jsonToolResult(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Run a tool body, audit the outcome, and turn a KilangoApiError into a structured,
 * model-facing result that preserves the `remediation` hint (which names the exact
 * fixing call). Other errors become a generic redacted error result.
 */
export async function runTool(
  ctx: ToolContext,
  info: { tool: string; operationId?: string; method?: string; path?: string },
  fn: () => Promise<unknown>,
): Promise<ToolResult> {
  try {
    const data = await fn();
    await writeAuditEvent({
      tool: info.tool,
      actingAs: ctx.onBehalfOf,
      operationId: info.operationId,
      method: info.method,
      path: info.path,
      status: 'ok',
    });
    return jsonToolResult(data);
  } catch (error) {
    await writeAuditEvent({
      tool: info.tool,
      actingAs: ctx.onBehalfOf,
      operationId: info.operationId,
      method: info.method,
      path: info.path,
      status: 'error',
      error: formatUnknownError(error),
    });
    if (error instanceof KilangoApiError) {
      return jsonToolResult(error.toClientPayload(), true);
    }
    return jsonToolResult({ error: 'tool_error', message: formatUnknownError(error) }, true);
  }
}

/** Load the operator API contract index (cached in-process, shared across users). */
export async function contractIndex(ctx: ToolContext): Promise<Map<string, OperationInfo>> {
  return loadContract({ baseUrl: ctx.client.baseUrl });
}

/** Shared MCP annotation presets. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export type RegisterFn = (server: McpServer, ctx: ToolContext) => void;
