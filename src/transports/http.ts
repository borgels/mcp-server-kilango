import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer as createMcpServer } from '../server.js';
import { KilangoClient } from '../kilango/client.js';
import { StateStore } from '../kilango/state.js';
import {
  renderConnectForm,
  renderResultPage,
  renderErrorPage,
  renderExpiredPage,
  submitConnectApp,
  connectErrorMessage,
} from '../kilango/connect.js';
import {
  assertAllowedOrigin,
  assertAuthorized,
  corsHeaders,
  firstHeader,
  getHttpConfig,
  HttpRequestError,
  parseFormBody,
  readJsonBody,
  readTextBody,
  sendHtml,
  sendJson,
} from './http-helpers.js';

const config = getHttpConfig();

// Long-lived, shared across requests: one workspace-scoped client + the connect-app state
// store (a browser form created in one request must survive to the GET/POST that follows).
const client = new KilangoClient();
const states = new StateStore();
const publicBaseUrl = process.env.KILANGO_PUBLIC_BASE_URL;

if (!config.httpToken && (process.env.KILANGO_TRUST_FORWARDED_USER ?? '') !== '') {
  console.error(
    'WARNING: MCP_HTTP_TOKEN is not set — the loopback /mcp path is unauthenticated. Set it in internal.env behind the gateway.',
  );
}

const httpServer = createNodeServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    // Public enrollment surface — Caddy routes /kilango/* straight to this container,
    // bypassing the gateway Entra auth. Security is the single-use, short-TTL state.
    if (url.pathname === '/kilango/connect-app') {
      await handleConnectApp(req, res, url);
      return;
    }

    if (url.pathname !== '/mcp') {
      sendJson(res, 404, { error: 'Not found' }, req);
      return;
    }

    assertAllowedOrigin(req);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' }, req, { Allow: 'POST' });
      return;
    }

    assertAuthorized(req, config);
    const body = await readJsonBody(req, config.maxBodyBytes);
    const onBehalfOf = firstHeader(req.headers['x-mcp-user']);

    const mcpServer = createMcpServer({ client, states, publicBaseUrl, onBehalfOf });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      if (error instanceof HttpRequestError) {
        sendJson(res, error.status, { error: error.message }, req);
        return;
      }
      sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }, req);
    }
  }
});

async function handleConnectApp(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method === 'GET') {
    const token = url.searchParams.get('state') ?? '';
    const entry = states.peek(token);
    if (!entry) {
      sendHtml(res, 400, renderExpiredPage());
      return;
    }
    sendHtml(res, 200, renderConnectForm({
      token,
      appName: entry.appKey,
      provider: entry.provider,
      connectionFields: entry.connectionFields,
      portalRef: entry.portalRef,
    }));
    return;
  }

  if (req.method === 'POST') {
    const form = parseFormBody(await readTextBody(req, config.maxBodyBytes));
    const token = form.state ?? '';
    const entry = states.consume(token);
    if (!entry) {
      sendHtml(res, 400, renderExpiredPage());
      return;
    }
    try {
      const secret: Record<string, string> = {};
      for (const field of entry.connectionFields) {
        const value = form[field.key];
        if ((value === undefined || value === '') && field.required !== false) {
          throw new Error(`Missing required field "${field.label ?? field.key}".`);
        }
        if (value !== undefined && value !== '') {
          secret[field.key] = value;
        }
      }
      const result = await submitConnectApp(client, {
        appKey: entry.appKey,
        provider: entry.provider,
        portalRef: entry.portalRef,
        secret,
      });
      sendHtml(res, 200, renderResultPage(result));
    } catch (error) {
      sendHtml(res, 400, renderErrorPage(connectErrorMessage(error)));
    }
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' }, req, { Allow: 'GET, POST' });
}

httpServer.listen(config.port, config.host, () => {
  console.error(
    `Kilango MCP HTTP server listening on http://${config.host}:${config.port} (/mcp + /kilango/connect-app + /healthz)`,
  );
});
