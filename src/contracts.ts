// The one contract every part of the site codes against: content shape, the scroll loop and its
// chapters, the per-frame state, the world layout the 3D modules share, and the public API of
// the scene, the UI and the sound. Change a shape here and the type checker shows every caller.
import type * as THREE from 'three';

// ---------------------------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------------------------

export type ProjectStatus = 'live' | 'concept';

export interface Project {
  /** Stable slug, also the image file name under /projects. */
  id: string;
  name: string;
  /** Bare host shown in the HUD, e.g. "goldenstars.ph". */
  domain: string;
  url: string;
  /** Short label, e.g. "Corporate website". */
  sector: string;
  summary: string;
  /** Public path of the landing screenshot (8:5). */
  image: string;
  /** A concept project is invented work and must always be labelled as one on screen. */
  status: ProjectStatus;
  /** True while the copy is a stand-in; the UI shows a small "PLACEHOLDER" tag. */
  placeholder: boolean;
}

/** How the link particles draw a link. Every kind is sampled into points on a 2D canvas. */
export type ParticleShape =
  /** Opaque pixels of an image (the Zelarion mark). */
  | { kind: 'image'; src: string }
  /** A short glyph string drawn in FONT_FAMILY at the given weight. */
  | { kind: 'text'; text: string; weight: number }
  /** An SVG path in a square viewBox of `viewBox` units (24 for most icon sets). */
  | { kind: 'path'; d: string; viewBox: number };

export interface LinkItem {
  id: string;
  label: string;
  /** null = not published yet. The UI shows it disabled with "SOON"; never render a dead link. */
  href: string | null;
  shape: ParticleShape;
}

export interface SiteContent {
  person: {
    name: string;
    /** Two lines for the top-left wordmark, e.g. ["VERGEL", "BAUTISTA"]. */
    wordmark: [string, string];
    role: string;
    company: string;
    companyUrl: string;
    location: string;
    email: string;
  };
  /** Top-right manifesto block, one string per paragraph. */
  manifesto: string[];
  /** Short facts used by the hero HUD constellation and the static page. */
  facts: { value: string; label: string }[];
  scrollHint: string;
  projects: Project[];
  links: LinkItem[];
  footer: {
    headline: string;
    stack: string[];
    credits: string[];
  };
  /** url is null until the portfolio's domain is chosen; no canonical or og:url is emitted without it. */
  seo: { title: string; description: string; url: string | null };
}

// ---------------------------------------------------------------------------------------------
// Scroll loop and chapters
// ---------------------------------------------------------------------------------------------

/**
 * The page is one endless loop measured in virtual scroll pixels (wheel deltas), the same model
 * as the reference site: hero -> descent -> projects -> portal -> links -> return -> hero ...
 * `return` rebuilds the monolith and lands exactly on the hero, so the wrap has no seam.
 */
export type ChapterId = 'hero' | 'descent' | 'projects' | 'portal' | 'links' | 'return';

export const CHAPTER_ORDER: readonly ChapterId[] = ['hero', 'descent', 'projects', 'portal', 'links', 'return'];

/** Virtual pixels each project holds the screen for. Reference: ~1000 per portfolio crystal. */
export const PROJECT_SLOT = 900;

/** Lengths measured from the reference loop (100 px wheel steps), scaled to six projects. */
export function chapterLengths(projectCount: number): Record<ChapterId, number> {
  return {
    hero: 1000,
    descent: 900,
    projects: PROJECT_SLOT * projectCount,
    portal: 2400,
    links: 3000,
    return: 1100,
  };
}

export interface ChapterSpan {
  id: ChapterId;
  start: number;
  length: number;
}

export interface ChapterMap {
  spans: ChapterSpan[];
  loopLength: number;
  projectCount: number;
}

export function buildChapterMap(projectCount: number): ChapterMap {
  const lengths = chapterLengths(projectCount);
  let start = 0;
  const spans = CHAPTER_ORDER.map((id) => {
    const span = { id, start, length: lengths[id] };
    start += lengths[id];
    return span;
  });
  return { spans, loopLength: start, projectCount };
}

/** Wrap any position into [0, loopLength). */
export function wrapPosition(position: number, loopLength: number): number {
  return ((position % loopLength) + loopLength) % loopLength;
}

export interface ResolvedPosition {
  chapter: ChapterId;
  /** 0..1 inside the chapter. */
  chapterProgress: number;
  /**
   * Projects chapter only: chapterProgress * projectCount, so project i owns [i, i + 1) and is
   * centred on screen at i + 0.5. -1 in every other chapter.
   */
  projectFloat: number;
}

export function resolvePosition(map: ChapterMap, position: number): ResolvedPosition {
  const p = wrapPosition(position, map.loopLength);
  // Spans are contiguous and cover the loop, so the last span is the only possible fallthrough.
  const span = map.spans.find((s) => p < s.start + s.length) ?? map.spans[map.spans.length - 1]!;
  const chapterProgress = Math.min(1, Math.max(0, (p - span.start) / span.length));
  const projectFloat = span.id === 'projects' ? chapterProgress * map.projectCount : -1;
  return { chapter: span.id, chapterProgress, projectFloat };
}

export interface ScrollState extends ResolvedPosition {
  /** Smoothed position inside the loop, 0 <= position < loopLength. */
  position: number;
  /** Smoothed total distance travelled since load, signed and unbounded (direction across the wrap). */
  absolute: number;
  /** Smoothed velocity in virtual px per second; positive = forward. */
  velocity: number;
}

// ---------------------------------------------------------------------------------------------
// Per-frame state (built by src/main.ts, read by scene, UI and sound)
// ---------------------------------------------------------------------------------------------

export type QualityTier = 'high' | 'medium' | 'low';

export interface FrameState {
  /** Seconds since the experience started. */
  time: number;
  /** Seconds since the previous frame, clamped to 0.1. */
  dt: number;
  scroll: ScrollState;
  /** Smoothed pointer in normalised device coords (-1..1, y up). 0,0 when no pointer. */
  pointer: { x: number; y: number };
  /** 0..1 intro timeline; 1 once the intro has played (or immediately with reduced motion). */
  introProgress: number;
  /** Project whose detail panel is open, else null. Scroll input is locked while set. */
  openProjectId: string | null;
  /** Selected entry of the links carousel (index into content.links). */
  activeLinkIndex: number;
  reducedMotion: boolean;
}

// ---------------------------------------------------------------------------------------------
// World layout shared by the 3D modules. Units are metres-ish; +Y is up.
// The camera rig (src/scene/engine) frames these exact stations; zone modules place objects here.
// ---------------------------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

export const WORLD = {
  hero: {
    /** Monolith base sits on the ground at the origin; it is ~6.5 tall. */
    monolithBase: [0, 0, 0] as Vec3,
    camera: { position: [0, 3.4, 15] as Vec3, target: [0, 3.0, 0] as Vec3 },
  },
  projects: {
    /** Each shard is centred here when its slot is at 0.5; camera holds still facing -Z. */
    center: [0, -60, 0] as Vec3,
    camera: { position: [0, -60, 10] as Vec3, target: [0, -60, 0] as Vec3 },
    /** Vertical travel of a shard per project slot: enters from below, leaves above. */
    shardSpacing: 9,
  },
  portal: {
    /** Rings are stacked down the -Y axis between these heights; the camera looks straight down. */
    top: -100,
    bottom: -150,
    /** Ring heights, top to bottom. The portal builds them here and post-processing flares as the camera passes each. */
    rings: [-120, -126, -132, -138, -144] as readonly number[],
  },
  links: {
    /** Particle cloud centre; the platform's top face is 3 units below it. */
    center: [0, -160, 0] as Vec3,
    /** Links starts top-down (camera above the cloud looking down) and ends on this side view. */
    cameraTopDown: { position: [0, -146, 0.01] as Vec3, target: [0, -160, 0] as Vec3 },
    cameraSide: { position: [0, -159, 11] as Vec3, target: [0, -160, 0] as Vec3 },
  },
} as const;

export const CAMERA_FOV = 40;

// ---------------------------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------------------------

/** Taken from the Zelarion mark (faceted crystal Z between code brackets) and zelarion.tech tokens. */
export const PALETTE = {
  void: '#05070A',
  deep: '#08121C',
  surface: '#0B0F14',
  navy: '#0E3A5C',
  blue: '#1F8FE0',
  cyan: '#22C8EE',
  teal: '#2DD4C4',
  ink: '#E8EDF2',
  dim: '#8A97A6',
} as const;

/** Self-hosted via @fontsource-variable/jetbrains-mono (imported once by the UI). */
export const FONT_FAMILY = '"JetBrains Mono Variable", ui-monospace, monospace';

// ---------------------------------------------------------------------------------------------
// Scene (src/scene/index.ts exports `createScene`)
// ---------------------------------------------------------------------------------------------

/** A point projected to CSS pixels of the viewport. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** False when behind the camera or outside the viewport. */
  visible: boolean;
}

export interface SceneAnchors {
  /** Hero: five points on the monolith for the numbered HUD constellation. Empty outside hero. */
  heroPoints: ScreenPoint[];
  /** Projects: anchors on the shard nearest the centre, or id null when none is on screen. */
  project: {
    id: string | null;
    /** 0..1, how centred the shard is (1 at slot 0.5); the UI fades its callouts with it. */
    presence: number;
    center: ScreenPoint;
    /** Upper-left vertex: the title callout's leader line ends here. */
    title: ScreenPoint;
    /** Right-hand vertex: the readout callout attaches here. */
    readout: ScreenPoint;
    /** Lower-right vertex: the "Click to explore" callout attaches here. */
    cta: ScreenPoint;
  };
}

export interface SceneAPI {
  /** Load textures, build geometry, compile shaders. Reports 0..1 and resolves when ready to draw. */
  load(onProgress: (progress: number) => void): Promise<void>;
  /** Advance and render one frame. Pure function of the frame state plus idle time-based motion. */
  update(frame: FrameState): void;
  /** Anchors computed during the last update(). */
  getAnchors(): SceneAnchors;
  /** Project id under the pointer (NDC), or null. Only answers in the projects chapter. */
  pickProject(ndcX: number, ndcY: number): string | null;
  resize(width: number, height: number): void;
  readonly quality: QualityTier;
  dispose(): void;
}

export interface SceneOptions {
  quality: QualityTier;
  reducedMotion: boolean;
}

export type CreateScene = (canvas: HTMLCanvasElement, content: SiteContent, options: SceneOptions) => SceneAPI;

// ---------------------------------------------------------------------------------------------
// Scene internals: the contract between the engine (src/scene/index.ts) and the zone modules
// ---------------------------------------------------------------------------------------------

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  content: SiteContent;
  quality: QualityTier;
  reducedMotion: boolean;
  /** Shared loading manager; every texture or file load goes through it so progress is real. */
  manager: THREE.LoadingManager;
  /** Pre-filtered environment map for reflective materials. */
  environment: THREE.Texture;
}

export interface SceneModule {
  /** Added to the scene by the engine. Modules never add objects to ctx.scene directly. */
  readonly root: THREE.Object3D;
  init(): Promise<void>;
  update(frame: FrameState): void;
  dispose(): void;
}

export interface ProjectAnchorsWorld {
  id: string | null;
  presence: number;
  center: THREE.Vector3;
  title: THREE.Vector3;
  readout: THREE.Vector3;
  cta: THREE.Vector3;
}

/** src/scene/projects/shards.ts exports `createProjectShards(ctx)`. */
export interface ProjectShardsModule extends SceneModule {
  pick(raycaster: THREE.Raycaster): string | null;
  getAnchorsWorld(): ProjectAnchorsWorld;
}

/** src/scene/portal/portal.ts exports `createPortal(ctx)`; src/scene/links/particles.ts exports `createLinkParticles(ctx)`. */
export type CreateModule<M extends SceneModule = SceneModule> = (ctx: SceneContext) => M;

// ---------------------------------------------------------------------------------------------
// UI (src/ui/index.ts exports `createUI`)
// ---------------------------------------------------------------------------------------------

export interface UIEvents {
  /** The visitor asked to open a project (CTA button, keyboard, or a click on the shard). */
  onProjectOpen(id: string): void;
  onProjectClose(): void;
  /** Links carousel moved; index into content.links (already wrapped). */
  onLinkSelect(index: number): void;
  /** Called from inside the click handler, so the sound can start its AudioContext. */
  onSoundToggle(enabled: boolean): void;
  /** Any hover on an interactive control, for the UI tick sound. */
  onHover(): void;
}

export interface UIAPI {
  setLoadProgress(progress: number): void;
  /** Play the preloader exit; resolves when the canvas is fully visible. */
  finishLoading(): Promise<void>;
  update(frame: FrameState, anchors: SceneAnchors): void;
  openProject(id: string): void;
  closeProject(): void;
  /** WebGL unavailable or failed: drop the overlay and show the static page. */
  showFallback(reason: string): void;
  dispose(): void;
}

export type CreateUI = (root: HTMLElement, content: SiteContent, events: UIEvents) => UIAPI;

// ---------------------------------------------------------------------------------------------
// Sound (src/audio/sound.ts exports `createSound`). Procedural Web Audio, off by default.
// ---------------------------------------------------------------------------------------------

export type SoundCue = 'hover' | 'click' | 'open' | 'close' | 'link' | 'chapter';

export interface SoundAPI {
  readonly enabled: boolean;
  /** Call from inside a user gesture handler; creates or resumes the AudioContext. */
  setEnabled(enabled: boolean): Promise<void>;
  /** Ambient layers follow the chapter and the scroll velocity. */
  update(frame: FrameState): void;
  cue(name: SoundCue): void;
  dispose(): void;
}

export type CreateSound = () => SoundAPI;
