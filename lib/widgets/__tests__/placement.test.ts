import { describe, it, expect } from 'vitest';
import { overlaps, hasCollision } from '../placement';

const a = (x: number, y: number, w: number, h: number, id = `${x}.${y}`): { id: string; widgetId: string; x: number; y: number; w: number; h: number } => ({ id, widgetId: 'w', x, y, w, h });

describe('overlaps', () => {
  it('identifies strict overlap', () => {
    expect(overlaps(a(0, 0, 2, 2), a(1, 1, 2, 2))).toBe(true);
  });
  it('treats edge-touching as non-overlap (snapped grid, no half-cells)', () => {
    expect(overlaps(a(0, 0, 2, 2), a(2, 0, 2, 2))).toBe(false);
    expect(overlaps(a(0, 0, 2, 2), a(0, 2, 2, 2))).toBe(false);
  });
  it('rejects a totally separate rect', () => {
    expect(overlaps(a(0, 0, 1, 1), a(3, 3, 1, 1))).toBe(false);
  });
  it('detects overlap when one is contained in the other', () => {
    expect(overlaps(a(0, 0, 4, 4), a(1, 1, 1, 1))).toBe(true);
  });
});

describe('hasCollision', () => {
  it('returns false for an empty list', () => {
    expect(hasCollision([], a(0, 0, 1, 1))).toBe(false);
  });
  it('detects any overlap with existing items', () => {
    const items = [a(0, 0, 2, 2, 'A'), a(2, 0, 2, 2, 'B')];
    expect(hasCollision(items, a(1, 1, 2, 2))).toBe(true);
  });
  it('ignores the item being moved (when given its id)', () => {
    const items = [a(0, 0, 2, 2, 'A'), a(2, 0, 2, 2, 'B')];
    expect(hasCollision(items, a(0, 0, 2, 2), 'A')).toBe(false);
  });
  it('still reports other items when ignoring the moving one', () => {
    // A covers (0..2, 0..2). B sits at (3,0) size 1x1 (clear of A). We move B
    // to (1,1) — it should now collide with A, even though we're ignoring B.
    const items = [a(0, 0, 2, 2, 'A'), a(3, 0, 1, 1, 'B')];
    expect(hasCollision(items, a(1, 1, 1, 1), 'B')).toBe(true);
    // Moving A to (3,0) size 1x1 — that exact spot is B's, but ignoring A
    // means we should still collide with B. (Negative-direction check.)
    expect(hasCollision(items, a(3, 0, 1, 1), 'A')).toBe(true);
    // A non-overlapping spot for A (e.g. (4,0)), ignoring A — passes.
    expect(hasCollision(items, a(4, 0, 1, 1), 'A')).toBe(false);
  });
});
