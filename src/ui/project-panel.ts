import type { Project, SiteContent, UIEvents } from '../contracts';
import { bindHover, createClickGuard, h, svg } from './dom';
import { prefersReducedMotion } from './motion';
import { scramble, scrambleDuration } from './scramble';

/** Lets the scene's glitch-out play before the text covers it (the reference waits about as long). */
const OPEN_DELAY_MS = 650;
const FADE_MS = 280;
/** Delay between one line starting to decode and the next. */
const LINE_STAGGER_MS = 110;
const CLOSE_CLICK_WINDOW_MS = 700;
const TITLE_ID = 'ui-panel-title';

type PanelState = 'idle' | 'opening' | 'open' | 'closing';

export interface ProjectPanel {
  open(id: string): void;
  close(): void;
  dispose(): void;
}

interface Line {
  node: HTMLElement;
  text: string;
  /** Element hidden until its line starts decoding; keeps the layout final from the first frame. */
  reveal: HTMLElement;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function externalArrow(): SVGSVGElement {
  const icon = svg('svg', { viewBox: '0 0 12 12', width: '10', height: '10', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3' }, 'panel__arrow');
  icon.setAttribute('aria-hidden', 'true');
  icon.append(svg('path', { d: 'M2.5 9.5l7-7M3.5 2.5h6v6' }));
  return icon;
}

/** `////// Summary`: the slashes are decoration, so only the word is exposed to assistive tech. */
function createLabel(slashes: string, word: string): { root: HTMLElement; word: HTMLElement } {
  const root = h('h3', 'label panel__label');
  const slashEl = h('span', 'label__slashes', { 'aria-hidden': 'true' });
  slashEl.textContent = `${slashes} `;
  const wordEl = h('span', 'label__word');
  wordEl.textContent = word;
  root.append(slashEl, wordEl);
  return { root, word: wordEl };
}

function createCloseButton(): HTMLButtonElement {
  const button = h('button', 'panel__close', { type: 'button' });
  const label = h('span', 'panel__close-label');
  label.textContent = 'Close';
  button.append(label, ...['tl', 'tr', 'bl', 'br'].map((corner) => h('i', `bracket bracket--${corner}`, { 'aria-hidden': 'true' })));
  return button;
}

export function createProjectPanel(
  parent: HTMLElement,
  content: SiteContent,
  events: UIEvents,
  onVisibilityChange: (visible: boolean) => void,
): ProjectPanel {
  const projects = new Map(content.projects.map((project) => [project.id, project] as const));

  // Close is first in the DOM so it is the first tab stop and shift+tab from it wraps to the last link.
  const root = h('div', 'panel', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': TITLE_ID });
  root.hidden = true;
  const closeButton = createCloseButton();

  const scroller = h('div', 'panel__scroll');
  const column = h('article', 'panel__column');

  const figure = h('figure', 'panel__shot');
  const image = h('img', 'panel__image', { width: '1600', height: '1000', decoding: 'async' });
  figure.append(image, ...['tl', 'tr', 'bl', 'br'].map((corner) => h('i', `bracket bracket--${corner}`, { 'aria-hidden': 'true' })));

  const heading = h('h2', 'panel__title', { id: TITLE_ID });
  const summaryLabel = createLabel('//////', 'Summary');
  const placeholderTag = h('span', 'tag tag--placeholder');
  placeholderTag.textContent = 'PLACEHOLDER COPY';
  summaryLabel.root.append(placeholderTag);
  const summary = h('p', 'panel__text');
  const sectorLabel = createLabel('///', 'Sector');
  const sector = h('p', 'panel__text');
  const statusLabel = createLabel('///', 'Status');
  const status = h('p', 'panel__text panel__status');
  const visitLabel = createLabel('///', 'Visit');
  const visitText = h('span', 'panel__link-text');
  const visitNote = h('span', 'sr-only');
  visitNote.textContent = ' (opens in a new tab)';
  const visitLink = h('a', 'panel__link', { target: '_blank', rel: 'noopener noreferrer' });
  visitLink.append(visitText, externalArrow(), visitNote);

  const section = (...nodes: HTMLElement[]): HTMLElement => {
    const wrapper = h('section', 'panel__section');
    wrapper.append(...nodes);
    return wrapper;
  };
  column.append(
    figure,
    heading,
    section(summaryLabel.root, summary),
    section(sectorLabel.root, sector),
    section(statusLabel.root, status),
    section(visitLabel.root, visitLink),
  );
  scroller.append(column);
  root.append(closeButton, scroller);
  parent.append(root);

  let state: PanelState = 'idle';
  let returnFocusTo: HTMLElement | null = null;
  let openTimer = 0;
  /** Bumped whenever the panel is torn down, so decode steps from an earlier open never write late. */
  let generation = 0;
  let queuedId: string | null = null;
  /** The closing fade holds opacity 0 until the panel is hidden, then is cancelled so the next open can fade in. */
  let closeFade: Animation | null = null;
  const acceptClose = createClickGuard(CLOSE_CLICK_WINDOW_MS);

  const lines = (project: Project): Line[] => [
    { node: heading, text: project.name, reveal: heading },
    { node: summaryLabel.word, text: 'Summary', reveal: summaryLabel.root },
    { node: summary, text: project.summary, reveal: summary },
    { node: sectorLabel.word, text: 'Sector', reveal: sectorLabel.root },
    { node: sector, text: project.sector, reveal: sector },
    { node: statusLabel.word, text: 'Status', reveal: statusLabel.root },
    { node: status, text: project.status === 'concept' ? 'CONCEPT' : 'LIVE', reveal: status },
    { node: visitLabel.word, text: 'Visit', reveal: visitLabel.root },
    { node: visitText, text: `[${project.domain}]`, reveal: visitLink },
  ];

  /** Writes the final text and layout immediately but keeps each line hidden until its turn to decode. */
  const fill = (project: Project): Line[] => {
    image.src = project.image;
    image.alt = `Screenshot of the ${project.name} website`;
    visitLink.href = project.url;
    placeholderTag.hidden = !project.placeholder;
    status.classList.toggle('is-concept', project.status === 'concept');
    heading.setAttribute('aria-label', project.name);
    const all = lines(project);
    for (const line of all) {
      line.node.textContent = line.text;
      line.reveal.dataset.pending = '';
    }
    return all;
  };

  const decode = async (all: Line[], token: number): Promise<void> => {
    root.setAttribute('aria-busy', 'true');
    const stagger = prefersReducedMotion() ? 0 : LINE_STAGGER_MS;
    await Promise.all(
      all.map(async (line, i) => {
        await sleep(i * stagger);
        if (token !== generation) return;
        delete line.reveal.dataset.pending;
        await scramble(line.node, line.text, scrambleDuration(line.text));
      }),
    );
    if (token === generation) root.removeAttribute('aria-busy');
  };

  const reveal = (all: Line[]): void => {
    state = 'open';
    root.hidden = false;
    if (!prefersReducedMotion()) root.animate({ opacity: [0, 1] }, { duration: FADE_MS, easing: 'ease-out' });
    onVisibilityChange(true);
    scroller.scrollTop = 0;
    closeButton.focus({ preventScroll: true });
    void decode(all, generation);
  };

  const open = (id: string): void => {
    if (state === 'closing') {
      // The visitor picked another project while the last one was still fading; run it right after.
      queuedId = id;
      return;
    }
    if (state !== 'idle') return;
    const project = projects.get(id);
    if (!project) return;

    state = 'opening';
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const all = fill(project);
    const token = ++generation;
    openTimer = window.setTimeout(() => {
      if (token === generation) reveal(all);
    }, prefersReducedMotion() ? 0 : OPEN_DELAY_MS);
  };

  const finishClose = (): void => {
    root.hidden = true;
    closeFade?.cancel();
    closeFade = null;
    state = 'idle';
    onVisibilityChange(false);
    returnFocusTo?.focus({ preventScroll: true });
    returnFocusTo = null;
    if (queuedId !== null) {
      const next = queuedId;
      queuedId = null;
      open(next);
    }
  };

  const close = (): void => {
    queuedId = null;
    if (state === 'opening') {
      clearTimeout(openTimer);
      generation++;
      state = 'idle';
      return;
    }
    if (state !== 'open') return;
    state = 'closing';
    generation++;
    root.removeAttribute('aria-busy');
    if (prefersReducedMotion()) {
      finishClose();
      return;
    }
    closeFade = root.animate({ opacity: [1, 0] }, { duration: FADE_MS, easing: 'ease-in', fill: 'forwards' });
    void closeFade.finished.then(finishClose, finishClose);
  };

  /** The panel never closes itself: it asks, and main answers by calling closeProject(). */
  const requestClose = (): void => {
    if ((state !== 'open' && state !== 'opening') || !acceptClose()) return;
    events.onProjectClose();
  };

  const trapFocus = (event: KeyboardEvent): void => {
    const stops = Array.from(root.querySelectorAll<HTMLElement>('button, a[href]')).filter((node) => node.dataset.pending === undefined);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (!root.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && (state === 'open' || state === 'opening')) {
      event.preventDefault();
      requestClose();
    } else if (event.key === 'Tab' && state === 'open') {
      trapFocus(event);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  closeButton.addEventListener('click', requestClose);
  bindHover(closeButton, events.onHover);
  bindHover(visitLink, events.onHover);

  return {
    open,
    close,
    dispose() {
      clearTimeout(openTimer);
      generation++;
      document.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
