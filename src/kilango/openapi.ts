import type { QueryValue } from './client.js';

/** Minimal shape of the bits of the OpenAPI 3.1 document we read. */
export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: unknown;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content?: Record<string, unknown> };
  responses?: Record<string, unknown>;
  ['x-hub-write']?: boolean;
}

export interface OpenApiSpec {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

export interface OperationInfo {
  operationId: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pathTemplate: string;
  pathParams: string[];
  queryParams: string[];
  requiresIfMatch: boolean;
  isWrite: boolean;
  hasRequestBody: boolean;
  summary?: string;
  tags: string[];
}

export interface ResolvedOperation {
  operationId: string;
  method: OperationInfo['method'];
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  requiresIfMatch: boolean;
  isWrite: boolean;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Build a callable operation index from an OpenAPI document. Pure — used by tests. */
export function buildIndex(spec: OpenApiSpec): Map<string, OperationInfo> {
  const index = new Map<string, OperationInfo>();
  for (const [pathTemplate, item] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op?.operationId) {
        continue;
      }
      const params = op.parameters ?? [];
      const httpMethod = method.toUpperCase() as OperationInfo['method'];
      const isWrite =
        typeof op['x-hub-write'] === 'boolean' ? op['x-hub-write'] : MUTATING.has(httpMethod);
      index.set(op.operationId, {
        operationId: op.operationId,
        method: httpMethod,
        pathTemplate,
        pathParams: params.filter(p => p.in === 'path').map(p => p.name),
        queryParams: params.filter(p => p.in === 'query').map(p => p.name),
        requiresIfMatch: params.some(
          p => p.in === 'header' && p.name.toLowerCase() === 'if-match' && p.required === true,
        ),
        isWrite,
        hasRequestBody: Boolean(op.requestBody),
        summary: op.summary,
        tags: op.tags ?? [],
      });
    }
  }
  return index;
}

/** Materialize a callable request from an operationId and explicit path/query/body args. */
export function resolveOperation(
  index: Map<string, OperationInfo>,
  operationId: string,
  args: { path?: Record<string, string | number>; query?: Record<string, QueryValue>; body?: unknown },
): ResolvedOperation {
  const info = index.get(operationId);
  if (!info) {
    throw new Error(`Unknown operationId "${operationId}". Use kilango_search_operations to discover valid ids.`);
  }
  const path = info.pathTemplate.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = args.path?.[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing path parameter "${key}" for ${operationId} (${info.pathTemplate}).`);
    }
    return encodeURIComponent(String(value));
  });
  return {
    operationId,
    method: info.method,
    path,
    query: args.query,
    body: args.body,
    requiresIfMatch: info.requiresIfMatch,
    isWrite: info.isWrite,
  };
}

export function searchOperations(
  index: Map<string, OperationInfo>,
  query: string,
  limit = 20,
): Array<Pick<OperationInfo, 'operationId' | 'method' | 'pathTemplate' | 'summary' | 'tags' | 'isWrite'>> {
  const needle = query.trim().toLowerCase();
  const all = [...index.values()];
  const matched = needle
    ? all.filter(op =>
        [op.operationId, op.summary ?? '', op.tags.join(' '), op.pathTemplate]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : all;
  return matched.slice(0, limit).map(op => ({
    operationId: op.operationId,
    method: op.method,
    pathTemplate: op.pathTemplate,
    summary: op.summary,
    tags: op.tags,
    isWrite: op.isWrite,
  }));
}

export function describeOperation(
  index: Map<string, OperationInfo>,
  operationId: string,
): OperationInfo | undefined {
  return index.get(operationId);
}

// --- In-process contract cache (shared across requests; the contract is public). ---

interface CacheEntry {
  index: Map<string, OperationInfo>;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface LoadContractOptions {
  baseUrl: string; // the /v1 root, e.g. https://api.kilango.com/v1
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  force?: boolean;
  now?: number;
}

/**
 * Fetch + cache the public `/openapi.json` and return the operation index. Throws on
 * failure — callers that treat the escape hatch as best-effort should catch and degrade.
 */
export async function loadContract(options: LoadContractOptions): Promise<Map<string, OperationInfo>> {
  const now = options.now ?? Date.now();
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const cached = cache.get(options.baseUrl);
  if (!options.force && cached && now - cached.fetchedAt < ttl) {
    return cached.index;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}/openapi.json`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to load Kilango OpenAPI contract: HTTP ${response.status}`);
  }
  const spec = (await response.json()) as OpenApiSpec;
  const index = buildIndex(spec);
  cache.set(options.baseUrl, { index, fetchedAt: now });
  return index;
}

/** Test helper: seed the cache so tools can be exercised without a network call. */
export function seedContractForTest(baseUrl: string, spec: OpenApiSpec, now = 0): void {
  cache.set(baseUrl, { index: buildIndex(spec), fetchedAt: now });
}

export function clearContractCache(): void {
  cache.clear();
}
