const SECRET_PATTERNS = [
  // Kilango API keys.
  /hub_(live|test)_[A-Za-z0-9_-]+/g,
  // Authorization headers.
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // Connection secret fields (fynk apiKey, OAuth tokens, passwords, etc.).
  /("?(?:secret|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|password|token|clientSecret|client_secret)"?\s*[:=]\s*)("?)[^"',\s}]+\2/gi,
];

/**
 * `remediation` is Kilango's best affordance: the exact call that fixes the
 * error. It arrives STRUCTURED as `{ method, path }` (packages/control's
 * `Remediation` type), not as a string — this server assumed a string, ran it
 * through `redactSecrets`, and died with "current.replace is not a function".
 * The real error was replaced by a meaningless one, so the field that exists to
 * tell an agent what to do next was the field that hid what went wrong.
 */
export type KilangoRemediation = string | { method?: unknown; path?: unknown };

export interface KilangoErrorEnvelope {
  error?: string;
  message?: string;
  details?: unknown;
  remediation?: KilangoRemediation;
  requestId?: string;
  [key: string]: unknown;
}

/** "POST /accesses/{id}/resend-invite" from either shape; undefined when there is nothing to say. */
export function formatRemediation(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { method, path } = value as { method?: unknown; path?: unknown };
  const parts = [method, path].filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  return parts.length ? parts.join(' ') : undefined;
}

/**
 * Structured error for a non-2xx Kilango operator API response. Carries the stable
 * snake_case `code` and the `remediation` string (which names the exact fixing call) so
 * the tool layer can surface them verbatim to the agent.
 */
export class KilangoApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly remediation?: string;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly method?: string;
  readonly path?: string;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    remediation?: string;
    requestId?: string;
    details?: unknown;
    method?: string;
    path?: string;
  }) {
    super(redactSecrets(input.message));
    this.name = 'KilangoApiError';
    this.status = input.status;
    this.code = input.code;
    this.remediation = input.remediation ? redactSecrets(input.remediation) : undefined;
    this.requestId = input.requestId;
    this.details = input.details;
    this.method = input.method;
    this.path = input.path ? redactSecrets(input.path) : undefined;
  }

  /** Compact, model-facing summary: the code, the message, and the fixing call if any. */
  toClientPayload(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      ...(this.remediation ? { remediation: this.remediation } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
      status: this.status,
    };
  }
}

export function fromErrorEnvelope(
  status: number,
  body: unknown,
  context: { method: string; path: string },
): KilangoApiError {
  const envelope = isErrorEnvelope(body) ? body : undefined;
  const code = typeof envelope?.error === 'string' ? envelope.error : `http_${status}`;
  const message =
    (typeof envelope?.message === 'string' ? envelope.message : undefined) ??
    (typeof body === 'string' && body ? body : `Kilango API request failed with HTTP ${status}`);
  return new KilangoApiError({
    status,
    code,
    message,
    // Structured { method, path } becomes "POST /path"; a plain string passes through.
    remediation: formatRemediation(envelope?.remediation),
    requestId: typeof envelope?.requestId === 'string' ? envelope.requestId : undefined,
    details: envelope?.details,
    method: context.method,
    path: context.path,
  });
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof KilangoApiError) {
    return redactSecrets(`${error.code}: ${error.message}`);
  }
  if (error instanceof Error) {
    return redactSecrets(error.message);
  }
  return redactSecrets(String(error));
}

/**
 * Takes `unknown`, not `string`, on purpose. This runs inside error handling,
 * where the input is by definition whatever went wrong — and a throw HERE
 * replaces the real error with a confusing one about redaction. Coercing is
 * strictly better than crashing on the path whose job is to explain a crash.
 */
export function redactSecrets(value: unknown): string {
  const text = typeof value === 'string' ? value : safeStringify(value);
  return SECRET_PATTERNS.reduce((current, pattern) => {
    pattern.lastIndex = 0;
    return current.replace(pattern, (match, ...groups) => {
      // The field-name pattern captures the "key:" prefix (group 0) and quote (group 1);
      // keep the prefix, redact the value.
      if (typeof groups[0] === 'string' && /[:=]/.test(groups[0])) {
        const quote = typeof groups[1] === 'string' ? groups[1] : '';
        return `${groups[0]}${quote}[REDACTED]${quote}`;
      }
      // Token patterns: preserve a short recognizable prefix where useful.
      if (match.startsWith('hub_')) {
        const kind = match.slice(0, match.indexOf('_', 4));
        return `${kind}_[REDACTED]`;
      }
      return '[REDACTED]';
    });
  }, text);
}

/** JSON when it works, String() when it does not (cycles, BigInt, throwing toJSON). */
function safeStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') {
      return json;
    }
  } catch {
    // fall through
  }
  try {
    return String(value);
  } catch {
    return '[unprintable]';
  }
}

function isErrorEnvelope(value: unknown): value is KilangoErrorEnvelope {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
