// The pointer as the scene sees it: normalised device coordinates, eased so the camera parallax and
// the particle push never snap. Touch pointers are ignored on purpose: a finger has no hover, and a
// parallax that jumps to every tap would feel broken.

/** Seconds for the smoothed pointer to close ~63% of the gap to the real one. */
const POINTER_TAU = 0.25;

export interface Ndc {
  x: number;
  y: number;
}

/** Converts viewport pixels to NDC (-1..1, y up). The canvas is fixed and full-screen, so the viewport is its frame. */
export function clientToNdc(clientX: number, clientY: number, out: Ndc = { x: 0, y: 0 }): Ndc {
  out.x = (clientX / window.innerWidth) * 2 - 1;
  out.y = 1 - (clientY / window.innerHeight) * 2;
  return out;
}

export interface PointerTracker {
  /** Smoothed NDC, mutated in place; FrameState.pointer points at this object. */
  readonly state: Ndc;
  update(dt: number): void;
  dispose(): void;
}

export function createPointerTracker(): PointerTracker {
  const state: Ndc = { x: 0, y: 0 };
  const target: Ndc = { x: 0, y: 0 };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    clientToNdc(event.clientX, event.clientY, target);
  };
  const onPointerLeave = (): void => {
    target.x = 0;
    target.y = 0;
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  // `pointerleave` on the root element fires when the pointer exits the page, which window never reports.
  document.documentElement.addEventListener('pointerleave', onPointerLeave);

  return {
    state,
    update(dt) {
      const blend = 1 - Math.exp(-dt / POINTER_TAU);
      state.x += (target.x - state.x) * blend;
      state.y += (target.y - state.y) * blend;
    },
    dispose() {
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}
