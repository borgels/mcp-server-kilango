const SECRET_PATTERNS = [
  // Kilango API keys.
  /hub_(live|test)_[A-Za-z0-9_-]+/g,
  // Authorization headers.
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // Connection secret fields (fynk apiKey, OAuth tokens, passwords, etc.).
  /("?(?:secret|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|password|token|clientSecret|client_secret)"?\s*[:=]\s*)("?)[^"',\s}]+\2/gi,
];

export interface KilangoErrorEnvelope {
  error?: string;
  message?: string;
  details?: unknown;
  remediation?: string;
  requestId?: string;
  [key: string]: unknown;
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
  const code = envelope?.error ?? `http_${status}`;
  const message =
    envelope?.message ??
    (typeof body === 'string' && body ? body : `Kilango API request failed with HTTP ${status}`);
  return new KilangoApiError({
    status,
    code,
    message,
    remediation: envelope?.remediation,
    requestId: envelope?.requestId,
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

export function redactSecrets(value: string): string {
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
  }, value);
}

function isErrorEnvelope(value: unknown): value is KilangoErrorEnvelope {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
