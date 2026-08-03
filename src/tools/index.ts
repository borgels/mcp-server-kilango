import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './shared.js';
import { registerDiscoveryTools } from './discovery.js';
import { registerPortalTools } from './portals.js';
import { registerPageTools } from './pages.js';
import { registerAppTools } from './apps.js';
import { registerConnectionTools } from './connections.js';
import { registerOperationTools } from './operations.js';

export function registerKilangoTools(server: McpServer, ctx: ToolContext): void {
  registerDiscoveryTools(server, ctx);
  registerPortalTools(server, ctx);
  registerPageTools(server, ctx);
  registerAppTools(server, ctx);
  registerConnectionTools(server, ctx);
  registerOperationTools(server, ctx);
}
