import { randomUUID } from 'node:crypto';
import { fromErrorEnvelope, KilangoApiError } from '../errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined;

export interface KilangoClientOptions {
  apiKey?: string;
  /** Origin of the Kilango gateway, e.g. https://api.kilango.com. `/v1` is appended. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface KilangoRequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  body?: unknown;
  idempotencyKey?: string;
  dryRun?: boolean;
  ifMatch?: string;
  headers?: Record<string, string>;
}

export interface KilangoResponse<T> {
  data: T;
  etag?: string;
  requestId?: string;
  dryRun: boolean;
}

const MUTATING: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class KilangoClient {
  private readonly apiKey?: string;
  private readonly apiRoot: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: KilangoClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.KILANGO_API_KEY;
    const baseUrl = trimTrailingSlash(
      options.baseUrl ?? process.env.KILANGO_API_BASE_URL ?? 'https://api.kilango.com',
    );
    assertSafeBaseUrl(baseUrl, 'KILANGO_API_BASE_URL');
    this.apiRoot = `${baseUrl}/v1`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.KILANGO_TIMEOUT_MS ?? 30_000);
  }

  get baseUrl(): string {
    return this.apiRoot;
  }

  async request<T = unknown>(path: string, options: KilangoRequestOptions = {}): Promise<KilangoResponse<T>> {
    this.assertConfigured();

    const method = options.method ?? 'GET';
    const query = { ...(options.query ?? {}) };
    if (options.dryRun) {
      query.dryRun = true;
    }
    const url = appendQuery(`${this.apiRoot}${normalizePath(path)}`, query);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey ?? ''}`,
      ...options.headers,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.ifMatch) {
      headers['If-Match'] = options.ifMatch;
    }
    if (MUTATING.has(method)) {
      headers['Idempotency-Key'] = options.idempotencyKey ?? randomUUID();
    }

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const body = await readResponseBody(response);
    const etag = response.headers.get('etag') ?? bodyEtag(body) ?? undefined;
    const requestId =
      response.headers.get('x-request-id') ??
      (isRecord(body) && typeof body.requestId === 'string' ? body.requestId : undefined) ??
      undefined;

    if (!response.ok) {
      throw fromErrorEnvelope(response.status, body, { method, path: normalizePath(path) });
    }

    return {
      data: unwrapEnvelope(body) as T,
      etag,
      requestId,
      dryRun: response.headers.get('x-hub-dry-run') === 'true' || Boolean(options.dryRun),
    };
  }

  /** GET a resource and return its data plus the ETag needed for a subsequent If-Match write. */
  async getWithEtag<T = unknown>(
    path: string,
    query?: Record<string, QueryValue>,
  ): Promise<KilangoResponse<T>> {
    return this.request<T>(path, { method: 'GET', query });
  }

  /**
   * Whole-document write that requires an If-Match. When `ifMatch` is not supplied it
   * fetches the current ETag from `etagFromPath` (defaulting to `path`), sends the write,
   * and on a 412 re-reads the ETag and retries once. A second 412 throws a clear
   * `concurrent_modification` error telling the agent to re-read.
   */
  async writeWithIfMatch<T = unknown>(
    method: HttpMethod,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, QueryValue>;
      ifMatch?: string;
      etagFromPath?: string;
      idempotencyKey?: string;
      dryRun?: boolean;
    } = {},
  ): Promise<KilangoResponse<T>> {
    const etagSource = options.etagFromPath ?? path;
    let ifMatch = options.ifMatch;
    const explicit = Boolean(options.ifMatch);

    if (!ifMatch) {
      const current = await this.getWithEtag(etagSource);
      ifMatch = current.etag;
      if (!ifMatch) {
        throw new KilangoApiError({
          status: 0,
          code: 'missing_etag',
          message: `Could not obtain an ETag from ${etagSource} for an If-Match write to ${path}.`,
        });
      }
    }

    try {
      return await this.request<T>(path, {
        method,
        body: options.body,
        query: options.query,
        idempotencyKey: options.idempotencyKey,
        dryRun: options.dryRun,
        ifMatch,
      });
    } catch (error) {
      if (explicit || !(error instanceof KilangoApiError) || error.status !== 412) {
        throw error;
      }
      // Stale ETag — re-read once and retry.
      const current = await this.getWithEtag(etagSource);
      if (!current.etag) {
        throw error;
      }
      try {
        return await this.request<T>(path, {
          method,
          body: options.body,
          query: options.query,
          idempotencyKey: options.idempotencyKey,
          dryRun: options.dryRun,
          ifMatch: current.etag,
        });
      } catch (retryError) {
        if (retryError instanceof KilangoApiError && retryError.status === 412) {
          throw new KilangoApiError({
            status: 412,
            code: 'concurrent_modification',
            message: `${path} was modified concurrently; re-read it and try again.`,
            method,
            path,
          });
        }
        throw retryError;
      }
    }
  }

  private assertConfigured(): void {
    if (!this.apiKey) {
      throw new Error(
        'Missing Kilango credentials. Set KILANGO_API_KEY (a workspace-bound hub_live_… key) in the MCP server environment.',
      );
    }
  }
}

/**
 * Unwrap the Kilango response envelope (doc 20.5): a list `{items}` → the array; a paged
 * list `{items, nextCursor}` → `{items, nextCursor}`; a single resource object → itself.
 */
export function unwrapEnvelope(body: unknown): unknown {
  if (isRecord(body) && 'items' in body) {
    const keys = Object.keys(body);
    if (keys.every(key => key === 'items' || key === 'nextCursor')) {
      return 'nextCursor' in body ? { items: body.items, nextCursor: body.nextCursor } : body.items;
    }
  }
  return body;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return text;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function bodyEtag(body: unknown): string | undefined {
  if (isRecord(body)) {
    for (const key of ['etag', 'navigationEtag']) {
      const value = body[key];
      if (typeof value === 'string' && value) {
        return value;
      }
    }
  }
  return undefined;
}

function appendQuery(urlValue: string, query?: Record<string, QueryValue>): string {
  const url = new URL(urlValue);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSafeBaseUrl(baseUrl: string, envName: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`${envName} is not a valid URL: ${baseUrl}`);
  }
  if (parsed.protocol === 'https:') {
    return;
  }
  if (parsed.protocol === 'http:' && isLocalHost(parsed.hostname)) {
    return;
  }
  throw new Error(
    `Refusing to send the Kilango API key over ${parsed.protocol}//. Use https:// (loopback http:// is allowed for local mocks).`,
  );
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
