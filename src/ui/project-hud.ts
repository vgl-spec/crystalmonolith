import type { FrameState, SceneAnchors, ScreenPoint, SiteContent, UIEvents } from '../contracts';
import { bindHover, createClickGuard, decorative, h, presenceWriter, smoothstep, svg, translateWriter } from './dom';
import { hash01 } from './rand';
import { scramble, scrambleDuration } from './scramble';
import { overflowOf } from './viewport';
import type { Viewport } from './viewport';

/** The readout re-rolls a few times a second, like a live instrument. */
const TICK_MS = 140;
/** A repeat click inside this window is a double click on the same intent. */
const CTA_CLICK_WINDOW_MS = 700;
/** Below this the call-to-action is too faint to count as a target. */
const CTA_ACTIVE_ABOVE = 0.4;

export interface ProjectHud {
  update(frame: FrameState, anchors: SceneAnchors): void;
  dispose(): void;
}

/** Which side of its anchor a callout's text sits on, per axis: -1 = left/above, 1 = right/below. */
type Side = -1 | 1;

/**
 * One callout: a container translated onto its scene anchor, with a leader line and a block of text.
 * The measurements are cached (see measure) so choosing a side each frame is plain arithmetic.
 */
interface Callout {
  root: HTMLElement;
  block: HTMLElement;
  ax: Side;
  ay: Side;
  /** Leader length along each axis, and how far the text runs back toward the anchor (px). */
  dx: number;
  dy: number;
  hang: number;
  /** Size of the text block (px). */
  width: number;
  height: number;
  setPosition: (x: number, y: number) => void;
  setPresence: (presence: number) => void;
  setSide: (ax: Side, ay: Side) => void;
  /** Slides the text block sideways (px) without moving its leader, for anchors hard against an edge. */
  setSlide: (offset: number) => void;
}

/**
 * A unit square stretched and mirrored by CSS (size and direction from custom properties), so the
 * diagonal resizes per breakpoint and flips with its callout without recomputing path data.
 */
function leader(): SVGSVGElement {
  const node = decorative(svg('svg', { viewBox: '0 0 1 1', preserveAspectRatio: 'none' }, 'leader'));
  node.append(svg('line', { x1: '0', y1: '0', x2: '1', y2: '1' }));
  return node;
}

/** Default placement of each callout; the clamping flips it when the screen edge is in the way. */
function createCallout(modifier: 'title' | 'readout' | 'cta', block: HTMLElement, ax: Side, ay: Side, activeAbove?: number): Callout {
  const root = h('div', `callout callout--${modifier}`);
  root.append(leader(), decorative(h('i', 'callout__dot')), block);
  const applySide = (nextAx: Side, nextAy: Side): void => {
    root.dataset.ax = String(nextAx);
    root.dataset.ay = String(nextAy);
  };
  applySide(ax, ay);
  let slide = 0;
  const callout: Callout = {
    root,
    block,
    ax,
    ay,
    dx: 0,
    dy: 0,
    hang: 0,
    width: 0,
    height: 0,
    setPosition: translateWriter(root),
    setPresence: presenceWriter(root, activeAbove),
    setSide(nextAx, nextAy) {
      if (nextAx === callout.ax && nextAy === callout.ay) return;
      callout.ax = nextAx;
      callout.ay = nextAy;
      applySide(nextAx, nextAy);
    },
    setSlide(offset) {
      const rounded = Math.round(offset);
      if (rounded === slide) return;
      slide = rounded;
      // The individual `translate` property composes with the block's own transform.
      block.style.translate = rounded === 0 ? '' : `${rounded}px 0`;
    },
  };
  return callout;
}

/** Reads the callout's CSS offsets and text size. Only called on resize and when the text changes size. */
function measure(callout: Callout): void {
  const style = getComputedStyle(callout.root);
  callout.dx = parseFloat(style.getPropertyValue('--dx')) || 0;
  callout.dy = parseFloat(style.getPropertyValue('--dy')) || 0;
  callout.hang = parseFloat(style.getPropertyValue('--hang')) || 0;
  callout.width = callout.block.offsetWidth;
  callout.height = callout.block.offsetHeight;
}

/** Where the text block's left and top edges land for a given side, relative to the screen. */
const blockLeft = (c: Callout, anchorX: number, ax: Side): number => anchorX + ax * (c.dx - c.hang) - (ax < 0 ? c.width : 0);
const blockTop = (c: Callout, anchorY: number, ay: Side): number => anchorY + ay * c.dy - (ay < 0 ? c.height : 0);

/**
 * Keeps the text inside the gutter. A callout switches to the other side of its anchor only while
 * its current side overflows and the other overflows less, so it never flickers between the two.
 * If the chosen side still sticks out sideways (anchor hard against an edge), the block slides in,
 * but never so far that the leader would miss it.
 */
function clampToViewport(c: Callout, anchor: ScreenPoint, viewport: Viewport): void {
  const { width, height, gutter } = viewport;
  const overflowX = (ax: Side): number => overflowOf(blockLeft(c, anchor.x, ax), c.width, width, gutter);
  const overflowY = (ay: Side): number => overflowOf(blockTop(c, anchor.y, ay), c.height, height, gutter);
  const flipX = overflowX(c.ax) > overflowX(-c.ax as Side);
  const flipY = overflowY(c.ay) > overflowY(-c.ay as Side);
  c.setSide(flipX ? (-c.ax as Side) : c.ax, flipY ? (-c.ay as Side) : c.ay);

  const left = blockLeft(c, anchor.x, c.ax);
  const attachX = anchor.x + c.ax * c.dx;
  const wanted = left < gutter ? gutter - left : Math.min(0, width - gutter - (left + c.width));
  c.setSlide(Math.max(attachX - (left + c.width), Math.min(attachX - left, wanted)));
}

const text = (className: string, content = ''): HTMLSpanElement => {
  const node = h('span', className);
  node.textContent = content;
  return node;
};

const signed = (value: number): string => `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(2).padStart(5, '0')}`;

export function createProjectHud(parent: HTMLElement, content: SiteContent, events: UIEvents, viewport: Viewport): ProjectHud {
  const layer = h('div', 'phud');

  // Title: PROJECT_01 / NAME underlined, with the status tags. Decorative: the CTA names the project.
  const code = text('callout__code');
  const conceptTag = text('tag tag--concept', 'CONCEPT');
  const placeholderTag = text('tag tag--placeholder', 'PLACEHOLDER');
  const nameEl = h('p', 'callout__name');
  const titleBlock = decorative(h('div', 'callout__block callout__block--title'));
  const codeRow = h('p', 'callout__row');
  codeRow.append(code, conceptTag, placeholderTag);
  titleBlock.append(codeRow, nameEl);
  const title = createCallout('title', titleBlock, -1, -1);

  // Readout: SYS 99.21 / +00.47, ticking.
  const sysValue = text('readout-value');
  const deltaValue = text('readout-value');
  const readoutBlock = decorative(h('div', 'callout__block callout__block--readout'));
  readoutBlock.append(text('readout-key', 'SYS'), sysValue, text('readout-key'), deltaValue);
  const readout = createCallout('readout', readoutBlock, 1, -1);

  // Call to action: the one real control in the HUD.
  const domainEl = text('cta__domain');
  const cta = h('button', 'callout__block callout__block--cta', { type: 'button' });
  cta.append(domainEl, text('cta__action', 'CLICK TO EXPLORE'));
  const ctaCallout = createCallout('cta', cta, -1, -1, CTA_ACTIVE_ABOVE);

  layer.append(title.root, readout.root, ctaCallout.root);
  parent.append(layer);

  // Sizes are read when something that can change them happens (a resize, a text change), never per frame.
  const callouts = [title, readout, ctaCallout];
  const measureAll = (): void => callouts.forEach(measure);
  const sizeObserver = new ResizeObserver(measureAll);
  for (const callout of callouts) sizeObserver.observe(callout.block);
  window.addEventListener('resize', measureAll);

  const projectIndex = new Map(content.projects.map((project, index) => [project.id, index] as const));

  /** The project the callouts currently describe; null when the scene reports none or one we do not know. */
  let activeId: string | null = null;
  let activeIndex = 0;
  let lastTick = -1;
  let lastDisabled: boolean | null = null;
  const acceptClick = createClickGuard(CTA_CLICK_WINDOW_MS);

  cta.addEventListener('click', () => {
    if (activeId === null || lastDisabled === true || !acceptClick()) return;
    events.onProjectOpen(activeId);
  });
  bindHover(cta, events.onHover);

  const showProject = (id: string, index: number): void => {
    const project = content.projects[index];
    if (!project) return;
    activeId = id;
    activeIndex = index;
    conceptTag.hidden = project.status !== 'concept';
    placeholderTag.hidden = !project.placeholder;
    cta.setAttribute('aria-label', `Click to explore ${project.name} (${project.domain})`);
    void scramble(code, `PROJECT_${String(index + 1).padStart(2, '0')}`, 420);
    void scramble(nameEl, project.name.toUpperCase(), scrambleDuration(project.name));
    void scramble(domainEl, project.domain, scrambleDuration(project.domain));
    lastTick = -1;
  };

  const paintReadout = (time: number, reducedMotion: boolean): void => {
    const tick = reducedMotion ? 0 : Math.floor((time * 1000) / TICK_MS);
    if (tick === lastTick) return;
    lastTick = tick;
    const seed = activeIndex + 1;
    sysValue.textContent = (98 + hash01(seed, 0) * 1.8 + (hash01(seed, tick) - 0.5) * 0.8).toFixed(2);
    deltaValue.textContent = signed((hash01(seed, tick + 7919) - 0.5) * 1.6);
  };

  const place = (callout: Callout, point: ScreenPoint, presence: number): void => {
    callout.setPresence(point.visible ? presence : 0);
    if (!point.visible) return;
    clampToViewport(callout, point, viewport);
    callout.setPosition(point.x, point.y);
  };

  return {
    update(frame, anchors) {
      const { project } = anchors;
      // Fail closed: an id the content does not know describes nothing, rather than showing stale text.
      const index = project.id === null ? undefined : projectIndex.get(project.id);
      if (project.id === null || index === undefined) {
        activeId = null;
      } else if (project.id !== activeId) {
        showProject(project.id, index);
      }

      // main owns the open state; the control just mirrors it so a click mid-open is absorbed.
      const disabled = frame.openProjectId !== null;
      if (disabled !== lastDisabled) {
        lastDisabled = disabled;
        cta.setAttribute('aria-disabled', String(disabled));
      }

      const presence = frame.scroll.chapter === 'projects' && activeId !== null ? smoothstep(0.25, 0.75, project.presence) : 0;
      place(title, project.title, presence);
      place(readout, project.readout, presence);
      place(ctaCallout, project.cta, presence);
      if (presence > 0) paintReadout(frame.time, frame.reducedMotion);
    },
    dispose() {
      sizeObserver.disconnect();
      window.removeEventListener('resize', measureAll);
    },
  };
}
