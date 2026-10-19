// Developer aid, active only with ?debug in the URL: a small stats panel and `window.__portfolio`, the
// handle automated tests use to read the frame state and move around the loop. Without ?debug
// nothing is drawn and nothing is exposed on window.
import type { ChapterMap, FrameState, QualityTier } from '../contracts';

export interface DebugHandle {
  frame: FrameState;
  map: ChapterMap;
  /** Teleports by default, so a test can screenshot a chapter without waiting out the scroll smoothing. */
  jumpTo(position: number, immediate?: boolean): void;
}

declare global {
  interface Window {
    __portfolio?: DebugHandle;
  }
}

export interface DebugSources {
  frame: FrameState;
  map: ChapterMap;
  /** Read on every refresh because the scene may lower its tier at runtime. */
  quality(): QualityTier;
  jumpTo(position: number, immediate: boolean): void;
}

export interface Debug {
  update(dt: number): void;
  dispose(): void;
}

const NOOP_DEBUG: Debug = { update() {}, dispose() {} };

/** Panel text refreshes this often; per-frame DOM writes would distort the very fps being measured. */
const REFRESH_SECONDS = 0.25;

export function createDebug(enabled: boolean, sources: DebugSources): Debug {
  if (!enabled) return NOOP_DEBUG;

  const panel = document.createElement('pre');
  panel.setAttribute('aria-hidden', 'true');
  panel.style.cssText = [
    'position:fixed',
    'top:8px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'margin:0',
    'padding:6px 10px',
    'background:rgba(5,7,10,0.8)',
    'border:1px solid rgba(34,200,238,0.4)',
    'color:#e8edf2',
    'font:11px/1.4 ui-monospace,monospace',
    'pointer-events:none',
    'white-space:pre',
  ].join(';');
  document.body.append(panel);

  window.__portfolio = {
    frame: sources.frame,
    map: sources.map,
    jumpTo: (position, immediate = true) => sources.jumpTo(position, immediate),
  };

  let elapsed = 0;
  let frames = 0;

  return {
    update(dt) {
      elapsed += dt;
      frames += 1;
      if (elapsed < REFRESH_SECONDS) return;
      const { scroll } = sources.frame;
      panel.textContent = [
        `fps      ${Math.round(frames / elapsed)}`,
        `chapter  ${scroll.chapter}`,
        `position ${Math.round(scroll.position)}`,
        `quality  ${sources.quality()}`,
      ].join('\n');
      elapsed = 0;
      frames = 0;
    },
    dispose() {
      panel.remove();
      delete window.__portfolio;
    },
  };
}
