import { describe, expect, it } from 'vitest';
import { formatRemediation, fromErrorEnvelope, redactSecrets } from '../src/errors.js';

/**
 * Kilango sends `remediation` as `{ method, path }` — the exact call that fixes
 * the error. Treating it as a string crashed the whole error path with
 * "current.replace is not a function", so the field meant to say what to do next
 * was the one that hid what went wrong. Found on a real resend_access_invite.
 */

describe('formatRemediation', () => {
  it('renders the structured form Kilango actually sends', () => {
    expect(formatRemediation({ method: 'POST', path: '/accesses/abc/resend-invite' })).toBe(
      'POST /accesses/abc/resend-invite',
    );
  });

  it('passes a plain string through', () => {
    expect(formatRemediation('POST /accesses/abc/resend-invite')).toBe('POST /accesses/abc/resend-invite');
  });

  it('uses whichever half is present', () => {
    expect(formatRemediation({ path: '/accesses' })).toBe('/accesses');
    expect(formatRemediation({ method: 'POST' })).toBe('POST');
  });

  it('gives undefined for nothing usable, rather than an empty string', () => {
    expect(formatRemediation(undefined)).toBeUndefined();
    expect(formatRemediation(null)).toBeUndefined();
    expect(formatRemediation('   ')).toBeUndefined();
    expect(formatRemediation({})).toBeUndefined();
    expect(formatRemediation({ method: 42, path: false })).toBeUndefined();
  });
});

describe('fromErrorEnvelope with a structured remediation', () => {
  const ctx = { method: 'POST', path: '/accesses/abc/resend-invite' };

  it('does not throw, and keeps the real code and message', () => {
    const err = fromErrorEnvelope(
      409,
      {
        error: 'access_already_exists',
        message: 'The person already has that access to this portal.',
        remediation: { method: 'POST', path: '/v1/accesses/abc/resend-invite' },
      },
      ctx,
    );
    expect(err.code).toBe('access_already_exists');
    expect(err.message).toBe('The person already has that access to this portal.');
    expect(err.remediation).toBe('POST /v1/accesses/abc/resend-invite');
  });

  it('survives a non-string message without losing the status', () => {
    const err = fromErrorEnvelope(500, { error: 'internal_error', message: { nested: true } }, ctx);
    expect(err.status).toBe(500);
    expect(err.code).toBe('internal_error');
    // Falls back to the generic sentence rather than crashing on the object.
    expect(err.message).toContain('HTTP 500');
  });

  it('still reports something useful when the body is not an envelope at all', () => {
    const err = fromErrorEnvelope(502, 'upstream exploded', ctx);
    expect(err.code).toBe('http_502');
    expect(err.message).toBe('upstream exploded');
  });
});

describe('redactSecrets tolerates non-strings', () => {
  it('does not throw on an object', () => {
    expect(() => redactSecrets({ method: 'POST' })).not.toThrow();
    expect(redactSecrets({ method: 'POST' })).toContain('POST');
  });

  it('returns an empty string for null/undefined', () => {
    expect(redactSecrets(null)).toBe('');
    expect(redactSecrets(undefined)).toBe('');
  });

  it('survives a circular object', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => redactSecrets(circular)).not.toThrow();
  });

  it('still redacts secrets in ordinary strings', () => {
    expect(redactSecrets('key hub_live_abc123def')).toBe('key hub_live_[REDACTED]');
    expect(redactSecrets('apiKey: sk-supersecret')).toContain('[REDACTED]');
  });

  it('redacts a secret carried inside an object too', () => {
    expect(redactSecrets({ token: 'hub_live_abc123def' })).toContain('[REDACTED]');
  });
});
