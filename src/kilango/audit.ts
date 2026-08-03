import { appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from '../errors.js';

export interface AuditEvent {
  tool: string;
  /** The gateway-verified end user this call acts on behalf of (X-MCP-User). */
  actingAs?: string;
  operationId?: string;
  method?: string;
  path?: string;
  status?: 'ok' | 'error';
  error?: string;
}

/**
 * Append a redacted audit line if KILANGO_AUDIT_LOG is set. Never records the API key or
 * any connection secret.
 */
export async function writeAuditEvent(event: AuditEvent): Promise<void> {
  const auditPath = process.env.KILANGO_AUDIT_LOG;
  if (!auditPath) {
    return;
  }
  const record = {
    timestamp: new Date().toISOString(),
    requestId: randomUUID(),
    ...event,
    path: event.path ? redactSecrets(event.path) : undefined,
    error: event.error ? redactSecrets(event.error) : undefined,
  };
  await appendFile(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
}
