import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KilangoClient, type KilangoClientOptions } from './kilango/client.js';
import { StateStore } from './kilango/state.js';
import { registerKilangoTools } from './tools/index.js';

export interface CreateServerOptions {
  client?: KilangoClient;
  clientOptions?: KilangoClientOptions;
  /** Shared across requests so a connect-app browser flow survives the round-trip. */
  states?: StateStore;
  publicBaseUrl?: string;
  /** Gateway-verified end-user identity (X-MCP-User); used for audit attribution. */
  onBehalfOf?: string;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'kilango', version: '0.1.0' });
  const client = options.client ?? new KilangoClient(options.clientOptions);
  const states = options.states ?? new StateStore();
  registerKilangoTools(server, {
    client,
    states,
    publicBaseUrl: options.publicBaseUrl ?? process.env.KILANGO_PUBLIC_BASE_URL,
    onBehalfOf: options.onBehalfOf,
  });
  return server;
}
