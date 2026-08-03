import { describe, expect, it } from 'vitest';
import { StateStore } from '../src/kilango/state.js';

const payload = {
  appKey: 'fynk',
  provider: 'fynk',
  connectionFields: [{ key: 'apiKey', type: 'password', required: true }],
};

describe('StateStore', () => {
  it('peek does not consume; consume is single-use', () => {
    const store = new StateStore();
    const token = store.create(payload, 0);
    expect(store.peek(token, 1)?.appKey).toBe('fynk');
    expect(store.peek(token, 2)?.appKey).toBe('fynk'); // still there
    expect(store.consume(token, 3)?.provider).toBe('fynk');
    expect(store.peek(token, 4)).toBeUndefined(); // gone after consume
  });

  it('expires after the TTL', () => {
    const store = new StateStore();
    const token = store.create(payload, 0);
    const past = 10 * 60 * 1000 + 1;
    expect(store.peek(token, past)).toBeUndefined();
  });

  it('rejects unknown tokens', () => {
    const store = new StateStore();
    expect(store.consume('nope')).toBeUndefined();
  });

  it('binds no secrets — only app/provider/fields', () => {
    const store = new StateStore();
    const token = store.create({ ...payload, user: 'abo@borgels.com' }, 0);
    const entry = store.peek(token, 1)!;
    expect(Object.keys(entry)).toEqual(expect.arrayContaining(['appKey', 'provider', 'connectionFields', 'user', 'createdAt']));
    expect(JSON.stringify(entry)).not.toContain('secret');
  });
});
