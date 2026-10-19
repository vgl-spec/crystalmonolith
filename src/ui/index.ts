import '@fontsource-variable/jetbrains-mono';
import '../styles/ui.css';
import { FONT_FAMILY, PALETTE } from '../contracts';
import type { CreateUI } from '../contracts';
import { createBackdrop } from './backdrop';
import { createChrome } from './chrome';
import { createCorners } from './corners';
import { h } from './dom';
import { createHeroHud } from './hero-hud';
import { createLinksCarousel } from './links-carousel';
import { computePresence } from './presence';
import { createPreloader } from './preloader';
import { createProjectHud } from './project-hud';
import { createProjectPanel } from './project-panel';
import { trackViewport } from './viewport';

/** The stylesheet reads the brand from contracts.ts through these properties, so a colour lives in one place. */
function applyTheme(root: HTMLElement): void {
  for (const [name, value] of Object.entries(PALETTE)) root.style.setProperty(`--c-${name}`, value);
  root.style.setProperty('--font-mono', FONT_FAMILY);
}

/**
 * The overlay. Layers, bottom to top: backdrop, hero HUD, project HUD, links, project panel,
 * chrome (corners, carousel and footer cells) and the preloader. Chrome sits above the panel so the
 * wordmark and the sound toggle stay put behind a project, as in the reference; its root ignores
 * the pointer, so only real controls take clicks.
 */
export const createUI: CreateUI = (root, content, events) => {
  root.classList.add('ui');
  applyTheme(root);
  const { viewport, dispose: stopTrackingViewport } = trackViewport(root);

  const backdrop = createBackdrop(root);
  const hudLayer = h('div', 'layer layer--hud');
  root.append(hudLayer);
  const heroHud = createHeroHud(hudLayer, content, viewport);
  const projectHud = createProjectHud(hudLayer, content, events, viewport);

  const linksLayer = h('div', 'layer layer--links');
  root.append(linksLayer);

  // Everything behind a modal dialog is inert so neither focus nor a screen reader can reach it.
  const panel = createProjectPanel(root, content, events, (visible) => {
    root.classList.toggle('has-panel', visible);
    hudLayer.inert = visible;
    linksLayer.inert = visible;
  });

  const chrome = createChrome(root);
  const corners = createCorners(chrome.element, chrome.slots, content, events);
  const links = createLinksCarousel(linksLayer, chrome.slots, content, events);
  const preloader = createPreloader(root);

  let fallen = false;
  const releaseResources = (): void => {
    stopTrackingViewport();
    projectHud.dispose();
    panel.dispose();
    backdrop.dispose();
    links.dispose();
    preloader.dispose();
  };

  return {
    setLoadProgress: (progress) => preloader.setProgress(progress),
    finishLoading: () => preloader.finish(),

    update(frame, anchors) {
      if (fallen) return;
      const presence = computePresence(frame);
      backdrop.update(frame, presence);
      heroHud.update(anchors, presence.live ? presence.hero : 0);
      projectHud.update(frame, anchors);
      corners.update(frame, presence);
      links.update(frame, presence);
    },

    openProject: (id) => panel.open(id),
    closeProject: () => panel.close(),

    showFallback(reason) {
      if (fallen) return;
      fallen = true;
      // The static page is revealed by this class; the reason stays on the element for debugging.
      document.documentElement.dataset.fallbackReason = reason;
      document.documentElement.classList.add('no-webgl');
      root.hidden = true;
      releaseResources();
    },

    dispose() {
      fallen = true;
      releaseResources();
      root.replaceChildren();
      root.classList.remove('ui', 'has-panel');
    },
  };
};
