/**
 * Block positioning helpers. Kilango stores block order as the array order of
 * `Page.layout.content[]`; each block carries a stable `blockId` in `props.blockId`.
 * The operator API mutates order with:
 *   - single-block position via `positionSchema` (at most one of index/before/after), or
 *   - `reorder_page_blocks` which requires a COMPLETE permutation of every blockId.
 *
 * Visual placement is decided by each widget's manifest `renderRole` tier
 * (hero/metric/list/card) — array index 0 is NOT necessarily top-of-page. Read
 * `renderedIn` on responses to confirm where a block actually landed.
 */

export interface Position {
  index?: number;
  before?: string;
  after?: string;
}

export function countPositionHints(position: Position | undefined): number {
  if (!position) {
    return 0;
  }
  return [position.index !== undefined, position.before !== undefined, position.after !== undefined].filter(
    Boolean,
  ).length;
}

export function assertSinglePosition(position: Position | undefined): void {
  if (countPositionHints(position) > 1) {
    throw new Error('Give at most one of position.index, position.before, position.after.');
  }
}

/**
 * Produce the complete reordered blockId list for moving `blockId` to `position`.
 * Every other id keeps its relative order — the result is a full permutation suitable
 * for `reorder_page_blocks`.
 */
export function computeReorder(currentOrder: string[], blockId: string, position: Position): string[] {
  assertSinglePosition(position);
  if (!currentOrder.includes(blockId)) {
    throw new Error(`Block "${blockId}" is not on this page.`);
  }
  const rest = currentOrder.filter(id => id !== blockId);

  let insertAt: number;
  if (position.index !== undefined) {
    insertAt = clamp(position.index, 0, rest.length);
  } else if (position.before !== undefined) {
    const at = rest.indexOf(position.before);
    if (at === -1) {
      throw new Error(`position.before references unknown block "${position.before}".`);
    }
    insertAt = at;
  } else if (position.after !== undefined) {
    const at = rest.indexOf(position.after);
    if (at === -1) {
      throw new Error(`position.after references unknown block "${position.after}".`);
    }
    insertAt = at + 1;
  } else {
    throw new Error('Provide position.index, position.before, or position.after to move a block.');
  }

  return [...rest.slice(0, insertAt), blockId, ...rest.slice(insertAt)];
}

/** Validate that `order` is a complete permutation of `currentOrder` (no adds/drops). */
export function assertCompletePermutation(currentOrder: string[], order: string[]): void {
  const a = [...currentOrder].sort();
  const b = [...order].sort();
  const same = a.length === b.length && a.every((id, i) => id === b[i]);
  if (!same) {
    throw new Error(
      `order must be a complete permutation of the page's blockIds. expected=${JSON.stringify(
        currentOrder,
      )} received=${JSON.stringify(order)}`,
    );
  }
}

/** Extract the ordered blockIds from a get_page_blocks-style response. */
export function blockIdsOf(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) {
    return [];
  }
  const ids: string[] = [];
  for (const block of blocks) {
    const id = readBlockId(block);
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

function readBlockId(block: unknown): string | undefined {
  if (typeof block !== 'object' || block === null) {
    return undefined;
  }
  const record = block as Record<string, unknown>;
  if (typeof record.blockId === 'string') {
    return record.blockId;
  }
  const props = record.props;
  if (typeof props === 'object' && props !== null && typeof (props as Record<string, unknown>).blockId === 'string') {
    return (props as Record<string, unknown>).blockId as string;
  }
  return undefined;
}

/**
 * Build a short human-readable note about where a placed/moved block rendered, from any
 * `renderedIn` / `renderRole` / `slotKey` fields on the API response. Empty string if none.
 */
export function summarizeRendering(response: unknown): string {
  const notes: string[] = [];
  collectRendering(response, notes, 0);
  return notes.length ? `Rendered: ${[...new Set(notes)].join('; ')}. (Position within a tier follows the widget's renderRole, so index 0 is not necessarily the top of the page.)` : '';
}

function collectRendering(value: unknown, notes: string[], depth: number): void {
  if (depth > 4 || typeof value !== 'object' || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRendering(item, notes, depth + 1);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  const renderedIn = record.renderedIn ?? record.renderRole ?? record.slotKey;
  if (typeof renderedIn === 'string') {
    notes.push(renderedIn);
  }
  for (const nested of Object.values(record)) {
    collectRendering(nested, notes, depth + 1);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
