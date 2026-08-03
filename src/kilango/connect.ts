import type { KilangoClient } from './client.js';
import { KilangoApiError } from '../errors.js';

export interface ConnectionField {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  help?: string;
  placeholder?: string;
}

export interface CatalogApp {
  appKey: string;
  name?: string;
  kind?: string;
  appClass?: string;
  authMode?: string;
  provider?: string;
  connectionFields?: ConnectionField[];
}

export type BeginConnectResult =
  | { kind: 'installed'; appKey: string; result: unknown }
  | { kind: 'form'; appKey: string; provider: string; connectionFields: ConnectionField[]; portalRef?: string; app: CatalogApp }
  | { kind: 'oauth_unsupported'; appKey: string; provider: string; message: string };

// --- Raw operator API calls used by both the tools and the enrollment form ---

export async function fetchCatalogApp(client: KilangoClient, appKey: string): Promise<CatalogApp> {
  const res = await client.request<CatalogApp>(`/catalog/apps/${encodeURIComponent(appKey)}`);
  return res.data;
}

export async function installApp(client: KilangoClient, appKey: string, dryRun = false): Promise<unknown> {
  const res = await client.request(`/app-installations/${encodeURIComponent(appKey)}`, {
    method: 'PUT',
    body: {},
    dryRun,
  });
  return res.data;
}

export async function saveConnection(
  client: KilangoClient,
  provider: string,
  secret: Record<string, string>,
  extra?: { name?: string; baseUrl?: string },
): Promise<unknown> {
  const res = await client.request(`/connections/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    body: { secret, ...(extra?.name ? { name: extra.name } : {}), ...(extra?.baseUrl ? { baseUrl: extra.baseUrl } : {}) },
  });
  return res.data;
}

export async function activateAppInPortal(
  client: KilangoClient,
  portalRef: string,
  appKey: string,
  config?: unknown,
): Promise<unknown> {
  const res = await client.request(
    `/portals/${encodeURIComponent(portalRef)}/apps/${encodeURIComponent(appKey)}`,
    { method: 'PUT', body: config === undefined ? {} : { config } },
  );
  return res.data;
}

export async function checkConnectionHealth(client: KilangoClient, provider: string): Promise<unknown> {
  const res = await client.request(`/connections/${encodeURIComponent(provider)}/health-check`, {
    method: 'POST',
    body: {},
  });
  return res.data;
}

// --- Orchestration ---

function providerOf(app: CatalogApp): string {
  // The manifest's connection provider; falls back to the appKey. Verify against a real
  // get_catalog_app response during the e2e smoke test (see plan gap #4).
  return app.provider ?? app.appKey;
}

function authModeOf(app: CatalogApp): string {
  return (app.authMode ?? 'apikey').toLowerCase();
}

/**
 * Decide how to connect an app. Native/scaffold apps with no connection fields are
 * installed (and optionally activated) immediately. API-key apps return a browser form.
 * OAuth apps are not connectable yet (Kilango returns 501 until the OAuth flow ships).
 */
export async function beginConnectApp(
  client: KilangoClient,
  appKey: string,
  portalRef?: string,
): Promise<BeginConnectResult> {
  const app = await fetchCatalogApp(client, appKey);
  const authMode = authModeOf(app);
  const fields = app.connectionFields ?? [];

  if (authMode === 'oauth') {
    return {
      kind: 'oauth_unsupported',
      appKey,
      provider: providerOf(app),
      message:
        `"${app.name ?? appKey}" authenticates via OAuth, which Kilango has not implemented yet ` +
        `(the operator API returns 501 oauth_flow_not_implemented). API-key apps can be connected today; ` +
        `OAuth support is a planned fast-follow.`,
    };
  }

  if (fields.length === 0) {
    // Nothing to authenticate — just install (and activate if a portal was named).
    const install = await installApp(client, appKey);
    let activation: unknown;
    if (portalRef) {
      activation = await activateAppInPortal(client, portalRef, appKey);
    }
    return { kind: 'installed', appKey, result: { install, ...(portalRef ? { activation } : {}) } };
  }

  return { kind: 'form', appKey, provider: providerOf(app), connectionFields: fields, portalRef, app };
}

export interface SubmitConnectResult {
  appKey: string;
  provider: string;
  install: unknown;
  connection: unknown;
  activation?: unknown;
  health: unknown;
}

/** Run install → save_connection → (activate) → health-check with the collected secrets. */
export async function submitConnectApp(
  client: KilangoClient,
  params: { appKey: string; provider: string; portalRef?: string; secret: Record<string, string> },
): Promise<SubmitConnectResult> {
  const install = await installApp(client, params.appKey);
  const connection = await saveConnection(client, params.provider, params.secret);
  let activation: unknown;
  if (params.portalRef) {
    activation = await activateAppInPortal(client, params.portalRef, params.appKey);
  }
  const health = await checkConnectionHealth(client, params.provider);
  return {
    appKey: params.appKey,
    provider: params.provider,
    install,
    connection,
    ...(params.portalRef ? { activation } : {}),
    health,
  };
}

// --- HTML rendering for the browser enrollment form ---

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, bodyInner: string, ok = true): string {
  return (
    `<!doctype html><meta charset=utf-8>` +
    `<meta name=viewport content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#111">` +
    `<h1 style="font-size:1.4rem">${ok ? '🔌' : '⚠️'} ${escapeHtml(title)}</h1>` +
    bodyInner +
    `</body>`
  );
}

export function renderConnectForm(state: {
  token: string;
  appName: string;
  provider: string;
  connectionFields: ConnectionField[];
  portalRef?: string;
}): string {
  const inputs = state.connectionFields
    .map(field => {
      const label = escapeHtml(field.label ?? field.key);
      const type = field.type === 'password' || field.type === undefined ? 'password' : 'text';
      const required = field.required === false ? '' : 'required';
      const help = field.help ? `<div style="font-size:.8rem;color:#666;margin:.15rem 0 .4rem">${escapeHtml(field.help)}</div>` : '';
      const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : '';
      return (
        `<label style="display:block;margin:.8rem 0 .2rem;font-weight:600">${label}</label>` +
        help +
        `<input name="${escapeHtml(field.key)}" type="${type}" ${required} autocomplete="off" ${placeholder} ` +
        `style="width:100%;padding:.55rem;border:1px solid #ccc;border-radius:.4rem;font-size:1rem">`
      );
    })
    .join('');

  const inner =
    `<p>Enter the credentials for <strong>${escapeHtml(state.appName)}</strong>` +
    (state.portalRef ? ` (will be activated in portal <code>${escapeHtml(state.portalRef)}</code>)` : '') +
    `. They are sent straight to Kilango's encrypted vault and never shown to the AI assistant.</p>` +
    `<form method="post" action="/kilango/connect-app">` +
    `<input type="hidden" name="state" value="${escapeHtml(state.token)}">` +
    inputs +
    `<button type="submit" style="margin-top:1.2rem;padding:.6rem 1.2rem;border:0;border-radius:.4rem;` +
    `background:#111;color:#fff;font-size:1rem;cursor:pointer">Connect</button>` +
    `</form>`;
  return page(`Connect ${state.appName}`, inner, true);
}

export function renderResultPage(result: SubmitConnectResult): string {
  const healthy = isHealthy(result.health);
  const inner =
    `<p><strong>${escapeHtml(result.appKey)}</strong> is installed and connected to <code>${escapeHtml(
      result.provider,
    )}</code>${result.activation ? ' and activated in the portal' : ''}.</p>` +
    `<p>Connection health: <strong>${healthy ? 'healthy ✅' : 'check the health status ⚠️'}</strong></p>` +
    `<p>You can close this tab and return to the assistant.</p>`;
  return page('App connected', inner, true);
}

export function renderErrorPage(message: string): string {
  return page('Connection failed', `<p>${escapeHtml(message)}</p><p>Return to the assistant and run the connect step again.</p>`, false);
}

export function renderExpiredPage(): string {
  return page(
    'Link expired',
    `<p>This connect link is invalid or has expired. Ask the assistant to start the app connection again.</p>`,
    false,
  );
}

function isHealthy(health: unknown): boolean {
  if (typeof health !== 'object' || health === null) {
    return false;
  }
  const record = health as Record<string, unknown>;
  return record.healthy === true || record.status === 'connected' || record.ok === true;
}

export function connectErrorMessage(error: unknown): string {
  if (error instanceof KilangoApiError) {
    return error.remediation ? `${error.message} (${error.remediation})` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
