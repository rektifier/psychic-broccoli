// Reactive drag-and-drop reorder controller for vertical lists.
//
// Wraps the pure slot math in dragReorder.ts with the DOM event wiring a
// component needs: a handle-gated drag start, cached item rects (snapshotted
// at drag start so mid-drag layout shifts do not cause flicker), a hysteresis
// deadzone when switching slots, and a drop callback.
//
// Usage (list container and items identified by CSS selectors):
//
//   const drag = new DragReorder({
//     listSelector: '.steps-list',
//     itemSelector: '.step-card',
//     onDrop: (from, insertSlot) => { ...reorder your array... },
//   });
//
//   <div class="steps-list" ondragover={drag.handleListDragOver}
//        ondrop={drag.handleListDrop} ondragleave={drag.handleListDragLeave}>
//     {#each items as item, i (item.id)}
//       {#if drag.insertSlot === i}<div class="drop-indicator"></div>{/if}
//       <div class="step-card" class={{ dragging: drag.draggingIndex === i }}
//            draggable="true" ondragstart={(e) => drag.handleDragStart(e, i)}
//            ondragend={drag.handleDragEnd}>
//         <span class="drag-handle" onmousedown={drag.grabHandle}
//               onmouseup={drag.releaseHandle}>...</span>
//       </div>
//     {/each}
//     {#if drag.insertSlot === items.length}<div class="drop-indicator"></div>{/if}
//   </div>

import { computeInsertSlot, type CachedRect } from './dragReorder';

export interface DragReorderOptions {
  /** Selector for the list container, resolved via closest() from the dragged item. */
  listSelector: string;
  /** Selector for the reorderable items inside the list container. */
  itemSelector: string;
  /** Called on a valid drop with the dragged index and the insertion slot. */
  onDrop: (from: number, insertSlot: number) => void;
  /** Px deadzone before the active slot switches (default 8). */
  hysteresis?: number;
}

export class DragReorder {
  /** Index of the item being dragged, -1 when idle. */
  draggingIndex = $state(-1);
  /** Active insertion slot: 0 = before first, 1 = after first / before second, etc.
   *  -1 when no indicator should show. */
  insertSlot = $state(-1);

  #options: DragReorderOptions;
  /** Cached item positions from drag start - prevents layout-feedback flicker. */
  #cachedRects: CachedRect[] = [];
  #handleGrabbed = false;

  constructor(options: DragReorderOptions) {
    this.#options = options;
  }

  /** Attach to the drag handle's mousedown so drags only start from the handle. */
  grabHandle = () => {
    this.#handleGrabbed = true;
  };

  /** Attach to the drag handle's mouseup. */
  releaseHandle = () => {
    this.#handleGrabbed = false;
  };

  /** Attach to the item's dragstart. */
  handleDragStart = (e: DragEvent, index: number) => {
    // Only allow drag from the drag handle
    if (!this.#handleGrabbed) {
      e.preventDefault();
      return;
    }
    this.draggingIndex = index;
    // Snapshot item positions before any visual changes
    const item = e.currentTarget as HTMLElement;
    const list = item.closest(this.#options.listSelector);
    if (list) {
      const items = list.querySelectorAll(this.#options.itemSelector);
      this.#cachedRects = Array.from(items).map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, height: r.height };
      });
    }
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  };

  /** Attach to the list container's dragover. */
  handleListDragOver = (e: DragEvent) => {
    if (this.draggingIndex === -1 || this.#cachedRects.length === 0) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    this.insertSlot = computeInsertSlot(
      this.#cachedRects,
      e.clientY,
      this.draggingIndex,
      this.insertSlot,
      this.#options.hysteresis ?? 8,
    );
  };

  /** Attach to the list container's drop. */
  handleListDrop = (e: DragEvent) => {
    e.preventDefault();
    if (this.draggingIndex !== -1 && this.insertSlot !== -1) {
      this.#options.onDrop(this.draggingIndex, this.insertSlot);
    }
    this.draggingIndex = -1;
    this.insertSlot = -1;
    this.#cachedRects = [];
  };

  /** Attach to the item's dragend. */
  handleDragEnd = () => {
    this.draggingIndex = -1;
    this.insertSlot = -1;
    this.#cachedRects = [];
    this.#handleGrabbed = false;
  };

  /** Attach to the list container's dragleave; hides the indicator when the
   *  cursor leaves the list entirely. */
  handleListDragLeave = (e: DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) this.insertSlot = -1;
  };
}
