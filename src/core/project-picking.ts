// Pointer interaction with the project shards: a pointer cursor while one is under the pointer, and a
// click or tap opens it. Picking runs only on pointer events, never per frame.
import { clientToNdc, type Ndc } from './pointer';

/** Controls that own their own clicks; a press on them must never also pick the shard behind. */
const CONTROL_SELECTOR = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"]';

export interface ProjectPickingOptions {
  /** NDC -> project id under that point, or null. */
  pick(ndcX: number, ndcY: number): string | null;
  /** True while shards can be picked: in the projects chapter with no panel open. */
  isEnabled(): boolean;
  onSelect(id: string): void;
}

export interface ProjectPicking {
  /** Drops a stale pointer cursor, e.g. when a panel opens over the shard. */
  clearCursor(): void;
  dispose(): void;
}

/**
 * Listens on the window rather than the canvas: the UI overlay sits above the canvas, so the canvas
 * itself would not receive the events whenever an overlay element covers it.
 */
export function bindProjectPicking(options: ProjectPickingOptions): ProjectPicking {
  const ndc: Ndc = { x: 0, y: 0 };
  let cursorIsPointer = false;

  function setCursor(isPointer: boolean): void {
    if (isPointer === cursorIsPointer) return;
    cursorIsPointer = isPointer;
    // On the root so it is inherited whichever layer is under the pointer; '' hands control back to the CSS.
    document.documentElement.style.cursor = isPointer ? 'pointer' : '';
  }

  function pickAt(event: MouseEvent): string | null {
    if (!options.isEnabled()) return null;
    if (event.target instanceof Element && event.target.closest(CONTROL_SELECTOR) !== null) return null;
    clientToNdc(event.clientX, event.clientY, ndc);
    return options.pick(ndc.x, ndc.y);
  }

  function onPointerMove(event: PointerEvent): void {
    // Touch has no hover; its only gesture is the tap handled by onClick.
    if (event.pointerType === 'touch') return;
    setCursor(pickAt(event) !== null);
  }

  function onClick(event: MouseEvent): void {
    const id = pickAt(event);
    if (id === null) return;
    setCursor(false);
    options.onSelect(id);
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('click', onClick);

  return {
    clearCursor: () => setCursor(false),
    dispose() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('click', onClick);
      setCursor(false);
    },
  };
}
