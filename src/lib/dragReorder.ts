// Pure logic for drag-and-drop list reordering with insertion slots.
// A "slot" is a gap between items: 0 = before the first item, 1 = between the
// first and second, ..., items.length = after the last item. The stateful DOM
// wiring lives in dragReorder.svelte.ts; this module is unit tested.

/** Vertical extent of a list item, snapshotted at drag start so mid-drag
 *  layout changes (drop indicator insertion) cannot feed back into slot math. */
export interface CachedRect {
  top: number;
  height: number;
}

/**
 * Compute the insertion slot for the current cursor position.
 *
 * Returns -1 when the cursor sits right above or below the dragged item
 * (a no-op drop, so no indicator should show). When a slot is already active,
 * a hysteresis deadzone around the boundary keeps the indicator from
 * flickering: the cursor must move at least `hysteresis` px past the target
 * boundary midline before the slot switches.
 */
export function computeInsertSlot(
  rects: CachedRect[],
  clientY: number,
  draggingIndex: number,
  currentSlot: number,
  hysteresis: number,
): number {
  // Find which insertion slot the cursor is closest to using cached rects
  let newSlot = rects.length; // default: after last

  for (let i = 0; i < rects.length; i++) {
    const midY = rects[i].top + rects[i].height / 2;
    if (clientY < midY) {
      newSlot = i;
      break;
    }
  }

  // Don't show indicator right above or below the dragged item (no-op drop)
  if (newSlot === draggingIndex || newSlot === draggingIndex + 1) {
    return -1;
  }

  // Hysteresis: if we already have a slot, require cursor to move past deadzone
  if (currentSlot !== -1 && newSlot !== currentSlot) {
    const boundaryIdx = newSlot < rects.length ? newSlot : rects.length - 1;
    const mid = rects[boundaryIdx].top + rects[boundaryIdx].height / 2;
    if (Math.abs(clientY - mid) < hysteresis) return currentSlot;
  }

  return newSlot;
}

/** Translate an insertion slot into the target index after the dragged item
 *  is removed from the array. */
export function targetIndexForSlot(from: number, insertSlot: number): number {
  return insertSlot > from ? insertSlot - 1 : insertSlot;
}

/** Return a new array with the item at `from` moved into `insertSlot`. */
export function reorderBySlot<T>(items: T[], from: number, insertSlot: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(targetIndexForSlot(from, insertSlot), 0, moved);
  return next;
}
