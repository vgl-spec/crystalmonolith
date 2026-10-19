// Dev harness for the overlay: mounts createUI over a dark stand-in for the canvas and feeds it a
// fake FrameState and SceneAnchors chosen by the query string, so every state can be screenshotted
// without the 3D scene.
//
//   ?chapter=preload|hero|descent|projects|portal|links|return
//   &project=<id>   shard shown in the projects chapter (default: first)
//   &open=<id>      open that project's panel
//   &link=<index>   selected link in the links chapter
//   &dx=<px> &dy=<px>  shift every anchor, to push callouts against a screen edge
import { SITE } from '../../content/site';
import { buildChapterMap } from '../../contracts';
import type { ChapterId, FrameState, SceneAnchors, ScreenPoint } from '../../contracts';
import { createUI } from '../index';

// Every event the UI emits, in order, so a Playwright script can assert on behaviour.
declare global {
  interface Window {
    __uiEvents: string[];
  }
}
window.__uiEvents = [];

const params = new URLSearchParams(window.location.search);
const chapterParam = params.get('chapter') ?? 'hero';
const preload = chapterParam === 'preload';
const chapter: ChapterId = preload ? 'hero' : (chapterParam as ChapterId);
const projectIndex = Math.max(0, SITE.projects.findIndex((project) => project.id === params.get('project')));
const chapterMap = buildChapterMap(SITE.projects.length);

const state = { openProjectId: null as string | null, activeLinkIndex: Number(params.get('link') ?? 0) };

const root = document.getElementById('ui');
if (!root) throw new Error('ui-lab: #ui is missing');

const ui = createUI(root, SITE, {
  onProjectOpen(id) {
    window.__uiEvents.push(`open:${id}`);
    state.openProjectId = id;
    ui.openProject(id);
  },
  onProjectClose() {
    window.__uiEvents.push('close');
    state.openProjectId = null;
    ui.closeProject();
  },
  onLinkSelect(index) {
    window.__uiEvents.push(`link:${index}`);
    state.activeLinkIndex = index;
  },
  onSoundToggle(enabled) {
    window.__uiEvents.push(`sound:${enabled}`);
  },
  onHover() {
    window.__uiEvents.push('hover');
  },
});

const span = chapterMap.spans.find((candidate) => candidate.id === chapter);
const progress = chapter === 'projects' ? (projectIndex + 0.5) / SITE.projects.length : chapter === 'hero' ? 0.2 : 0.6;
const position = (span?.start ?? 0) + (span?.length ?? 0) * progress;

const shiftX = Number(params.get('dx') ?? 0);
const shiftY = Number(params.get('dy') ?? 0);

// Like the real scene, a point outside the viewport is reported as not visible.
const point = (dx: number, dy: number): ScreenPoint => {
  const scale = window.innerHeight / 900;
  const x = window.innerWidth / 2 + dx * scale + shiftX;
  const y = window.innerHeight / 2 + dy * scale + shiftY;
  return { x, y, visible: x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight };
};

const anchors = (): SceneAnchors => {
  const narrow = window.innerWidth < 640;
  const project = SITE.projects[projectIndex];
  return {
    heroPoints: chapter === 'hero' ? [point(-120, -48), point(15, -48), point(78, -140), point(-57, 60), point(78, 50)] : [],
    project: {
      id: chapter === 'projects' && project ? project.id : null,
      presence: 1,
      center: point(0, 0),
      title: point(narrow ? -36 : -85, -232),
      readout: point(narrow ? 52 : 145, -175),
      cta: point(narrow ? 46 : 130, 175),
    },
  };
};

const frame = (time: number): FrameState => ({
  time,
  dt: 1 / 60,
  scroll: {
    chapter,
    chapterProgress: progress,
    projectFloat: chapter === 'projects' ? progress * SITE.projects.length : -1,
    position,
    absolute: position,
    velocity: 0,
  },
  pointer: { x: 0, y: 0 },
  introProgress: preload ? 0 : 1,
  openProjectId: state.openProjectId,
  activeLinkIndex: state.activeLinkIndex,
  reducedMotion: false,
});

if (preload) {
  ui.setLoadProgress(0.42);
} else {
  ui.setLoadProgress(1);
  void ui.finishLoading();
}

const openId = params.get('open');
if (openId) {
  state.openProjectId = openId;
  ui.openProject(openId);
}

const tick = (now: number): void => {
  ui.update(frame(now / 1000), anchors());
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
