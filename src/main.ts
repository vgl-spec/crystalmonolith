// Composition root: builds the scene, the UI and the sound, wires them through one FrameState, and
// owns the frame loop. Every failure path ends in the same place, the static page (fallBack below).
import './core/base.css';
import './content/static.css';

import { createSound } from './audio/sound';
import { SITE } from './content/site';
import {
  buildChapterMap,
  resolvePosition,
  wrapPosition,
  type ChapterId,
  type FrameState,
  type SceneAPI,
  type UIEvents,
} from './contracts';
import { createDebug } from './core/debug';
import { resolveStartPosition } from './core/deep-link';
import { createDisposables } from './core/disposables';
import { detectQuality, supportsWebGL2, watchReducedMotion } from './core/env';
import { createIntroClock } from './core/intro';
import { createFrameLoop } from './core/loop';
import { createPointerTracker } from './core/pointer';
import { bindProjectPicking } from './core/project-picking';
import { readQuery } from './core/query';
import { createScrollController } from './core/scroll';
import { createScene } from './scene';
import { createUI } from './ui';

/** Scroll opens up while the intro's last fifth plays, so the HUD scramble-in is not a dead wait. */
const INTRO_UNLOCK_PROGRESS = 0.8;
/** A lost WebGL context usually comes back on its own; give it this long before giving up. */
const CONTEXT_RESTORE_GRACE_MS = 3000;

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`index.html must contain #${id} as a ${type.name}.`);
  return element;
}

function wrapIndex(index: number, count: number): number {
  return count === 0 ? 0 : wrapPosition(index, count);
}

/**
 * While the 3D experience runs, the static page is visually hidden but its links would still take
 * Tab stops the visitor cannot see. The overlay UI is the keyboard interface; screen readers reach
 * the static links through their own navigation.
 */
function setStaticLinksFocusable(root: HTMLElement, focusable: boolean): void {
  for (const link of root.querySelectorAll('a')) {
    if (focusable) link.removeAttribute('tabindex');
    else link.tabIndex = -1;
  }
}

async function start(): Promise<void> {
  const query = readQuery();
  const canvas = requireElement('gl', HTMLCanvasElement);
  const uiRoot = requireElement('ui', HTMLElement);
  const staticContent = requireElement('static-content', HTMLElement);

  const disposables = createDisposables();
  const motion = watchReducedMotion();
  disposables.add(() => motion.dispose());

  const map = buildChapterMap(SITE.projects.length);
  const startPosition = resolveStartPosition(query, map);
  // Playing the hero intro while the visitor was sent to another chapter would lock them out of it for no reason.
  const landsOnHero = resolvePosition(map, startPosition).chapter === 'hero';
  const intro = createIntroClock(motion.reduced || !query.intro || !landsOnHero);

  const scroll = createScrollController(map, { reducedMotion: motion.reduced, start: startPosition });
  disposables.add(() => scroll.dispose());
  motion.onChange((reduced) => scroll.setReducedMotion(reduced));

  const pointer = createPointerTracker();
  disposables.add(() => pointer.dispose());

  const sound = createSound();
  disposables.add(() => sound.dispose());

  // The one object handed to scene, UI and sound every frame; only this file writes to it.
  const frame: FrameState = {
    time: 0,
    dt: 0,
    scroll: scroll.state,
    pointer: pointer.state,
    introProgress: intro.progress,
    openProjectId: null,
    activeLinkIndex: wrapIndex(query.link ?? 0, SITE.links.length),
    reducedMotion: motion.reduced,
  };

  const updateScrollLock = (): void => {
    scroll.setLocked(frame.openProjectId !== null || frame.introProgress < INTRO_UNLOCK_PROGRESS);
  };
  updateScrollLock();

  const projectIds = new Set(SITE.projects.map((project) => project.id));
  const events: UIEvents = {
    onProjectOpen(id) {
      // Already open, or an id we never rendered: ignore. A double click must not stack two panels.
      if (frame.openProjectId !== null || !projectIds.has(id)) return;
      frame.openProjectId = id;
      updateScrollLock();
      sound.cue('open');
      ui.openProject(id);
    },
    onProjectClose() {
      if (frame.openProjectId === null) return;
      frame.openProjectId = null;
      updateScrollLock();
      sound.cue('close');
      ui.closeProject();
    },
    onLinkSelect(index) {
      frame.activeLinkIndex = wrapIndex(index, SITE.links.length);
      sound.cue('link');
    },
    onSoundToggle(enabled) {
      // Called straight from the click handler, as the AudioContext needs a user gesture to start.
      sound.setEnabled(enabled).catch((error: unknown) => console.error('Sound toggle failed', error));
    },
    onHover() {
      sound.cue('hover');
    },
  };
  const ui = createUI(uiRoot, SITE, events);

  /** Drops every running resource and shows the static page. Safe to call from any stage, and more than once. */
  function fallBack(reason: string, cause?: unknown): void {
    if (disposables.disposed) return;
    if (cause !== undefined) console.error(`Showing the static page (${reason})`, cause);
    disposables.disposeAll();
    setStaticLinksFocusable(staticContent, true);
    ui.showFallback(reason);
  }

  if (!supportsWebGL2()) return fallBack('webgl2-unavailable');
  setStaticLinksFocusable(staticContent, false);

  let contextLossTimer: number | undefined;
  const onContextLost = (event: Event): void => {
    // Without preventDefault the browser never fires webglcontextrestored.
    event.preventDefault();
    contextLossTimer = window.setTimeout(() => fallBack('context-lost'), CONTEXT_RESTORE_GRACE_MS);
  };
  const onContextRestored = (): void => window.clearTimeout(contextLossTimer);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  disposables.add(() => {
    window.clearTimeout(contextLossTimer);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
  });

  let scene: SceneAPI;
  try {
    scene = createScene(canvas, SITE, { quality: detectQuality(query.quality), reducedMotion: motion.reduced });
  } catch (error) {
    return fallBack('scene-init-failed', error);
  }
  disposables.add(() => scene.dispose());
  scene.resize(window.innerWidth, window.innerHeight);

  // Resizes arrive many times per drag; apply the latest one once per frame.
  let resizePending = false;
  const onResize = (): void => {
    resizePending = true;
  };
  window.addEventListener('resize', onResize);
  disposables.add(() => window.removeEventListener('resize', onResize));

  const picking = bindProjectPicking({
    pick: (ndcX, ndcY) => scene.pickProject(ndcX, ndcY),
    isEnabled: () => frame.openProjectId === null && frame.scroll.chapter === 'projects',
    onSelect: (id) => events.onProjectOpen(id),
  });
  disposables.add(() => picking.dispose());

  const debug = createDebug(query.debug, {
    frame,
    map,
    quality: () => scene.quality,
    jumpTo: (position, immediate) => scroll.jumpTo(position, immediate),
  });
  disposables.add(() => debug.dispose());

  let lastChapter: ChapterId = frame.scroll.chapter;

  function tick(dt: number, time: number): void {
    if (resizePending) {
      resizePending = false;
      scene.resize(window.innerWidth, window.innerHeight);
    }

    pointer.update(dt);
    intro.update(dt);
    frame.time = time;
    frame.dt = dt;
    frame.introProgress = intro.progress;
    frame.reducedMotion = motion.reduced;
    updateScrollLock();
    scroll.update(dt);

    if (frame.scroll.chapter !== lastChapter) {
      lastChapter = frame.scroll.chapter;
      sound.cue('chapter');
    }
    // A panel can open under a hovering pointer with no pointermove to reset the shard cursor.
    if (frame.openProjectId !== null) picking.clearCursor();

    scene.update(frame);
    ui.update(frame, scene.getAnchors());
    sound.update(frame);
    debug.update(dt);
  }

  try {
    await scene.load((progress) => ui.setLoadProgress(progress));
  } catch (error) {
    return fallBack('scene-load-failed', error);
  }
  if (disposables.disposed) return;

  // The loop starts before the preloader leaves so the canvas is already drawing behind its exit.
  const loop = createFrameLoop(tick, (error) => fallBack('runtime-error', error));
  disposables.add(() => loop.stop());
  loop.start();

  try {
    await ui.finishLoading();
  } catch (error) {
    return fallBack('ui-failed', error);
  }
  if (disposables.disposed) return;
  intro.start();
}

start().catch((error: unknown) => {
  // Last resort when even the UI could not start: the class showFallback would have set, so the static page still shows.
  console.error(error);
  document.documentElement.classList.add('no-webgl');
});
