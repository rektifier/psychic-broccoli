import { describe, it, expect } from 'vitest';
import {
  computeInsertSlot,
  targetIndexForSlot,
  reorderBySlot,
  type CachedRect,
} from './dragReorder';

/** Four items, 40px tall, stacked from y=0: midlines at 20, 60, 100, 140. */
const rects: CachedRect[] = [
  { top: 0, height: 40 },
  { top: 40, height: 40 },
  { top: 80, height: 40 },
  { top: 120, height: 40 },
];

const HYSTERESIS = 8;

describe('computeInsertSlot', () => {
  it('returns slot 0 when the cursor is above the first midline', () => {
    expect(computeInsertSlot(rects, 10, 2, -1, HYSTERESIS)).toBe(0);
  });

  it('returns an in-between slot for a cursor between midlines', () => {
    // Between item 0 midline (20) and item 1 midline (60) -> slot 1
    expect(computeInsertSlot(rects, 40, 2, -1, HYSTERESIS)).toBe(1);
  });

  it('returns the last slot when the cursor is below every midline', () => {
    expect(computeInsertSlot(rects, 150, 1, -1, HYSTERESIS)).toBe(rects.length);
  });

  it('returns -1 for the slot directly above the dragged item', () => {
    // Cursor between midlines 40..80 -> slot 2 == draggingIndex 2 -> no-op
    expect(computeInsertSlot(rects, 70, 2, -1, HYSTERESIS)).toBe(-1);
  });

  it('returns -1 for the slot directly below the dragged item', () => {
    // Cursor between midlines 100..140 -> slot 3 == draggingIndex 2 + 1 -> no-op
    expect(computeInsertSlot(rects, 110, 2, -1, HYSTERESIS)).toBe(-1);
  });

  it('keeps the current slot inside the hysteresis deadzone', () => {
    // Cursor lands in slot 2 territory (60..100) but within 8px of the
    // boundary midline (rects[2] midline = 100) -> stay on active slot 1
    expect(computeInsertSlot(rects, 95, 3, 1, HYSTERESIS)).toBe(1);
    expect(computeInsertSlot(rects, 99, 3, 1, HYSTERESIS)).toBe(1);
  });

  it('switches slots once the cursor moves past the deadzone', () => {
    // Same setup, cursor 8px or more from the boundary midline -> switch to slot 2
    expect(computeInsertSlot(rects, 92, 3, 1, HYSTERESIS)).toBe(2);
    expect(computeInsertSlot(rects, 63, 3, 1, HYSTERESIS)).toBe(2);
  });

  it('applies no hysteresis when no slot is active', () => {
    // currentSlot -1: cursor inside what would be the deadzone still resolves
    expect(computeInsertSlot(rects, 95, 3, -1, HYSTERESIS)).toBe(2);
  });

  it('anchors the deadzone to the last rect for the after-last slot', () => {
    // Active slot 2, cursor near the last midline (140) heading to slot 4
    expect(computeInsertSlot(rects, 141, 0, 2, HYSTERESIS)).toBe(2);
    expect(computeInsertSlot(rects, 148, 0, 2, HYSTERESIS)).toBe(4);
  });
});

describe('targetIndexForSlot', () => {
  it('keeps the slot as index when moving up', () => {
    expect(targetIndexForSlot(3, 1)).toBe(1);
  });

  it('shifts the slot down by one when moving down', () => {
    expect(targetIndexForSlot(0, 3)).toBe(2);
  });
});

describe('reorderBySlot', () => {
  it('moves an item up', () => {
    expect(reorderBySlot(['a', 'b', 'c', 'd'], 2, 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('moves an item down', () => {
    expect(reorderBySlot(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item to the end', () => {
    expect(reorderBySlot(['a', 'b', 'c', 'd'], 1, 4)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    reorderBySlot(input, 0, 3);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});
