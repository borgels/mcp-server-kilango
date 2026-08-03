import { randomBytes } from 'node:crypto';
import type { ConnectionField } from './connect.js';

export interface ConnectAppState {
  appKey: string;
  provider: string;
  portalRef?: string;
  connectionFields: ConnectionField[];
  /** Gateway-verified user who initiated the connect (audit only; may be undefined). */
  user?: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000;

/**
 * In-memory, single-use, short-TTL store binding a connect-app browser form to the tool
 * call that created it. Holds NO secrets — only which app/provider/fields the form is for.
 * A container restart drops pending states; the operator simply re-runs kilango_connect_app.
 */
export class StateStore {
  private readonly entries = new Map<string, ConnectAppState>();

  create(payload: Omit<ConnectAppState, 'createdAt'>, now = Date.now()): string {
    this.gc(now);
    const token = randomBytes(32).toString('base64url');
    this.entries.set(token, { ...payload, createdAt: now });
    return token;
  }

  /** Read without consuming (for rendering the form on GET). */
  peek(token: string, now = Date.now()): ConnectAppState | undefined {
    const entry = this.entries.get(token);
    if (!entry) {
      return undefined;
    }
    if (now - entry.createdAt > TTL_MS) {
      this.entries.delete(token);
      return undefined;
    }
    return entry;
  }

  /** Read and delete (single-use, for the form POST). */
  consume(token: string, now = Date.now()): ConnectAppState | undefined {
    const entry = this.peek(token, now);
    if (entry) {
      this.entries.delete(token);
    }
    return entry;
  }

  gc(now = Date.now()): void {
    for (const [token, entry] of this.entries) {
      if (now - entry.createdAt > TTL_MS) {
        this.entries.delete(token);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
