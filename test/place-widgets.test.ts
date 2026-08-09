import { describe, expect, it } from 'vitest';
import { assertPlaceForm, collectPlaceWidgets } from '../src/kilango/widgets.js';
import { normalizeBody } from '../src/tools/operations.js';

/**
 * The two bugs these cover were both found in production while building a real
 * portal, and both made a tool completely unusable rather than subtly wrong —
 * so they are the kind that a single test would have caught the day the
 * contract moved.
 */

describe('collectPlaceWidgets', () => {
  it('promotes the single-widget shorthand into a one-item list', () => {
    // The route takes { widgets: [...] } even for one widget. Sending the bare
    // object was the bug: "expected array, received undefined" on /widgets.
    expect(collectPlaceWidgets({ appKey: 'economic', widgetKey: 'invoices' })).toEqual([
      { appKey: 'economic', widgetKey: 'invoices' },
    ]);
  });

  it('carries config, position and visibility into the entry', () => {
    const out = collectPlaceWidgets({
      widgetType: 'invoices',
      config: { title: 'Fakturaer' },
      position: { index: 0 },
      visibility: { personas: ['client-contact'] },
    });
    expect(out).toEqual([
      {
        widgetType: 'invoices',
        config: { title: 'Fakturaer' },
        position: { index: 0 },
        visibility: { personas: ['client-contact'] },
      },
    ]);
  });

  it('passes a widgets list through, validating each entry', () => {
    const widgets = [
      { widgetType: 'invoices' },
      { appKey: 'hjem', widgetKey: 'velkomst' },
    ];
    expect(collectPlaceWidgets({ widgets })).toEqual(widgets);
  });

  it('refuses the list and the shorthand at the same time', () => {
    expect(() =>
      collectPlaceWidgets({ widgets: [{ widgetType: 'invoices' }], widgetType: 'contracts' }),
    ).toThrow(/either the widgets list or the single-widget fields/i);
  });

  it('omits absent optional fields rather than sending undefined', () => {
    // exactOptionalPropertyTypes aside, an explicit undefined would serialize
    // as a present key and can trip a strict body schema.
    expect(Object.keys(collectPlaceWidgets({ widgetType: 'contracts' })[0]!)).toEqual(['widgetType']);
  });
});

describe('assertPlaceForm', () => {
  it('accepts the typed form, with and without a pinned supplier', () => {
    expect(() => assertPlaceForm({ widgetType: 'invoices' })).not.toThrow();
    expect(() => assertPlaceForm({ widgetType: 'invoices', supplierAppKey: 'economic' })).not.toThrow();
  });

  it('accepts the app-owned form', () => {
    expect(() => assertPlaceForm({ appKey: 'snipe-it', widgetKey: 'jeres-udstyr' })).not.toThrow();
  });

  it('rejects mixing the two forms', () => {
    expect(() => assertPlaceForm({ widgetType: 'invoices', appKey: 'economic', widgetKey: 'invoices' })).toThrow(
      /not both/i,
    );
  });

  it('rejects neither form', () => {
    expect(() => assertPlaceForm({ config: { title: 'x' } })).toThrow(/either widgetType, or appKey \+ widgetKey/i);
  });

  it('rejects a half-given app-owned form, naming what is missing', () => {
    expect(() => assertPlaceForm({ appKey: 'snipe-it' })).toThrow(/BOTH appKey and widgetKey/i);
    expect(() => assertPlaceForm({ widgetKey: 'jeres-udstyr' })).toThrow(/BOTH appKey and widgetKey/i);
  });
});

describe('normalizeBody', () => {
  it('passes objects and arrays through untouched', () => {
    const obj = { name: 'Spitze ApS' };
    expect(normalizeBody(obj)).toBe(obj);
    const arr = [1, 2];
    expect(normalizeBody(arr)).toBe(arr);
  });

  it('decodes a JSON-encoded string body', () => {
    // This is what an MCP client sends when the schema is untyped — and what
    // made every body-carrying operation fail with "received string".
    expect(normalizeBody('{"name":"Spitze ApS"}')).toEqual({ name: 'Spitze ApS' });
  });

  it('treats an empty string as no body', () => {
    expect(normalizeBody('')).toBeUndefined();
    expect(normalizeBody('   ')).toBeUndefined();
  });

  it('throws a readable error on a string that is not JSON', () => {
    expect(() => normalizeBody('name=Spitze')).toThrow(/not valid JSON/i);
  });

  it('leaves undefined alone', () => {
    expect(normalizeBody(undefined)).toBeUndefined();
  });
});
