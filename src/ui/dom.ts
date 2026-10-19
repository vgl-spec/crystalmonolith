// Small DOM helpers shared by every UI module. The per-frame writers exist because update() runs
// at display rate: each one remembers the last value it wrote and skips the style write when
// nothing changed, so a still frame costs no style invalidation at all.

const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Attrs,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  className?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  if (attrs) for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/** Decorative text is hidden from assistive tech; the static page carries the readable content. */
export function decorative<T extends Element>(node: T): T {
  node.setAttribute('aria-hidden', 'true');
  return node;
}

export const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Writes opacity only when the 1% step changes and flips `is-off` (visibility hidden, no pointer
 * events) once the element is too faint to be a real target, so a transparent control can never be
 * clicked or tabbed to. Starts hidden.
 */
export function presenceWriter(node: Element & ElementCSSInlineStyle, activeAbove = 0.02): (presence: number) => void {
  let lastOpacity = -1;
  let off = true;
  node.classList.add('is-off');
  return (presence) => {
    const opacity = Math.round(clamp01(presence) * 100) / 100;
    if (opacity === lastOpacity) return;
    lastOpacity = opacity;
    node.style.opacity = String(opacity);
    const nextOff = opacity < activeAbove;
    if (nextOff !== off) {
      off = nextOff;
      node.classList.toggle('is-off', off);
    }
  };
}

/** Writes a translate3d at quarter-pixel precision: fine enough to look smooth, coarse enough to skip idle frames. */
export function translateWriter(node: Element & ElementCSSInlineStyle): (x: number, y: number) => void {
  let last = '';
  return (x, y) => {
    const value = `translate3d(${(Math.round(x * 4) / 4).toFixed(2)}px, ${(Math.round(y * 4) / 4).toFixed(2)}px, 0)`;
    if (value === last) return;
    last = value;
    node.style.transform = value;
  };
}

/** Mouse hover and keyboard focus both feed the UI tick sound; programmatic focus (focus handoff on open) does not. */
export function bindHover(node: HTMLElement, onHover: () => void): void {
  node.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') onHover();
  });
  node.addEventListener('focus', () => {
    if (node.matches(':focus-visible')) onHover();
  });
}

/**
 * Click guard for controls that emit an intent once: a repeat inside the window is a double click,
 * not a second request. State stays in main; this only absorbs the burst.
 */
export function createClickGuard(windowMs: number): () => boolean {
  let lastAccepted = Number.NEGATIVE_INFINITY;
  return () => {
    const now = performance.now();
    if (now - lastAccepted < windowMs) return false;
    lastAccepted = now;
    return true;
  };
}

export const wrapIndex = (index: number, length: number): number => ((index % length) + length) % length;
