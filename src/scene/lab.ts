// Dev bench for the scene (served as /scene-lab.html). Mounts createScene on a full-screen canvas and
// builds the FrameState from query params, with sliders for live scrubbing:
//   ?pos=<virtual px>  ?intro=<0..1, default 1>  ?link=<index>  ?open=<project id>
//   ?q=<high|medium|low>  ?px=<-1..1>&py=<-1..1> (pointer)  ?rm=1 (reduced motion)
import { SITE } from '../content/site';
import { buildChapterMap, resolvePosition, wrapPosition, type FrameState, type QualityTier } from '../contracts';
import { createScene } from './index';

const AUTOPLAY_SPEED = 600;
const VELOCITY_SMOOTHING = 8;

const params = new URLSearchParams(location.search);
const map = buildChapterMap(SITE.projects.length);

function numberParam(name: string, fallback: number): number {
  const value = Number(params.get(name));
  return params.has(name) && Number.isFinite(value) ? value : fallback;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Lab markup is missing #${id}`);
  return found as T;
}

const qualityParam = params.get('q');
const quality: QualityTier = qualityParam === 'medium' || qualityParam === 'low' ? qualityParam : 'high';

const state = {
  pos: numberParam('pos', 0),
  intro: Math.min(1, Math.max(0, numberParam('intro', 1))),
  link: Math.round(numberParam('link', 0)),
  open: params.get('open'),
  playing: false,
};

const canvas = element<HTMLCanvasElement>('stage');
const ui = {
  pos: element<HTMLInputElement>('pos'),
  intro: element<HTMLInputElement>('intro'),
  link: element<HTMLInputElement>('link'),
  open: element<HTMLSelectElement>('open'),
  quality: element<HTMLSelectElement>('quality'),
  play: element<HTMLButtonElement>('play'),
  status: element<HTMLElement>('status'),
  error: element<HTMLElement>('error'),
};

ui.pos.max = String(map.loopLength - 10);
ui.link.max = String(SITE.links.length - 1);
ui.open.append(new Option('none', ''), ...SITE.projects.map((project) => new Option(project.id, project.id)));
ui.quality.value = quality;

function syncControls(): void {
  ui.pos.value = String(Math.round(wrapPosition(state.pos, map.loopLength)));
  ui.intro.value = String(state.intro);
  ui.link.value = String(state.link);
  ui.open.value = state.open ?? '';
  element('pos-out').textContent = ui.pos.value;
  element('intro-out').textContent = state.intro.toFixed(2);
  element('link-out').textContent = String(state.link);
}

ui.pos.addEventListener('input', () => (state.pos = Number(ui.pos.value)));
ui.intro.addEventListener('input', () => (state.intro = Number(ui.intro.value)));
ui.link.addEventListener('input', () => (state.link = Number(ui.link.value)));
ui.open.addEventListener('change', () => (state.open = ui.open.value || null));
ui.quality.addEventListener('change', () => {
  params.set('q', ui.quality.value);
  location.search = params.toString();
});
ui.play.addEventListener('click', () => {
  state.playing = !state.playing;
  ui.play.textContent = state.playing ? 'pause' : 'scroll forward';
});

const pointer = { x: numberParam('px', 0), y: numberParam('py', 0) };
canvas.addEventListener('pointermove', (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -((event.clientY / window.innerHeight) * 2 - 1);
});

// Markers that show where the scene reports its HUD anchors, so they can be checked by eye.
const hud = element('hud');
function createMarkers(count: number, className: string, labels: readonly string[]): HTMLElement[] {
  return Array.from({ length: count }, (_, i) => {
    const marker = document.createElement('span');
    marker.className = className;
    marker.textContent = labels[i] ?? '';
    hud.append(marker);
    return marker;
  });
}
const heroMarkers = createMarkers(5, 'hero', ['1', '2', '3', '4', '5']);
const projectMarkers = createMarkers(4, 'project', ['c', 't', 'r', 'x']);

function placeMarker(marker: HTMLElement | undefined, point: { x: number; y: number; visible: boolean } | undefined): void {
  if (!marker) return;
  marker.style.display = point?.visible ? 'block' : 'none';
  if (point) marker.style.transform = `translate(${point.x}px, ${point.y}px)`;
}

function fail(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  ui.error.textContent = message;
  ui.error.style.display = 'block';
}

async function main(): Promise<void> {
  const scene = createScene(canvas, SITE, { quality, reducedMotion: params.get('rm') === '1' });
  scene.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', () => scene.resize(window.innerWidth, window.innerHeight));

  await scene.load((progress) => (ui.status.textContent = `loading ${(progress * 100).toFixed(0)}%`));

  let previousTime = performance.now();
  let previousPos = state.pos;
  let velocity = 0;
  let absolute = state.pos;
  let fps = 60;

  const frame = (now: number): void => {
    try {
      const dt = Math.min(0.1, (now - previousTime) / 1000);
      previousTime = now;
      if (dt > 0) fps += (1 / dt - fps) * 0.05;
      if (state.playing) state.pos += AUTOPLAY_SPEED * dt;

      const delta = state.pos - previousPos;
      previousPos = state.pos;
      absolute += delta;
      // Same shape as the real scroll: a smoothed velocity in virtual px per second.
      if (dt > 0) velocity += ((delta / dt) - velocity) * Math.min(1, VELOCITY_SMOOTHING * dt);

      const resolved = resolvePosition(map, state.pos);
      const current: FrameState = {
        time: now / 1000,
        dt,
        scroll: { ...resolved, position: wrapPosition(state.pos, map.loopLength), absolute, velocity },
        pointer,
        introProgress: state.intro,
        openProjectId: state.open,
        activeLinkIndex: state.link,
        reducedMotion: params.get('rm') === '1',
      };
      scene.update(current);

      const anchors = scene.getAnchors();
      ui.status.textContent =
        `${resolved.chapter} ${resolved.chapterProgress.toFixed(3)}  loop ${map.loopLength}  q ${scene.quality}  ${fps.toFixed(0)} fps` +
        `  hud ${anchors.heroPoints.length} pts  project ${anchors.project.id ?? '-'}`;
      heroMarkers.forEach((marker, i) => placeMarker(marker, anchors.heroPoints[i]));
      const project = anchors.project;
      [project.center, project.title, project.readout, project.cta].forEach((point, i) => placeMarker(projectMarkers[i], project.id ? point : undefined));
      syncControls();
      requestAnimationFrame(frame);
    } catch (error) {
      fail(error);
    }
  };
  requestAnimationFrame(frame);
}

main().catch(fail);
