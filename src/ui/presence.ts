import type { ChapterId, FrameState } from '../contracts';
import { clamp01, smoothstep } from './dom';

/** The HUD scrambles in once the intro has crystallised the monolith (docs/experience-spec.md). */
const INTRO_GATE = 0.85;

/**
 * How much of each overlay group is showing this frame, 0..1. One place decides what belongs to
 * which chapter, so the modules only ask "how visible am I" and never read the scroll themselves.
 */
export interface Presence {
  /** False until the intro is far enough along for the UI to appear. */
  live: boolean;
  /** Hero-only text and the constellation: gone by ~20% into the descent, back as the hero rebuilds. */
  hero: number;
  /** Faint dot grid: projects and links. */
  grid: number;
  /** Large blurred numbers: projects only. */
  numbers: number;
  /** Wall of mono text: links only. */
  wall: number;
  /** Carousel, arrows and footer: the links chapter. */
  links: number;
}

const rampIn = (progress: number, from: number, to: number): number => smoothstep(from, to, progress);
const rampOut = (progress: number, from: number, to: number): number => 1 - smoothstep(from, to, progress);

type Curve = (progress: number) => number;
type Curves = Partial<Record<ChapterId, Curve>>;

const HERO: Curves = {
  hero: () => 1,
  descent: (p) => rampOut(p, 0, 0.2),
  return: (p) => rampIn(p, 0.7, 1),
};

const NUMBERS: Curves = {
  descent: (p) => rampIn(p, 0.7, 1),
  projects: () => 1,
  portal: (p) => rampOut(p, 0, 0.08),
};

const GRID: Curves = {
  descent: (p) => rampIn(p, 0.6, 1),
  projects: () => 1,
  // The portal is a blank stretch between two grid chapters: out at its start, back in at its end.
  portal: (p) => Math.max(rampOut(p, 0, 0.1), rampIn(p, 0.9, 1)),
  links: (p) => rampOut(p, 0.9, 1),
};

const WALL: Curves = {
  portal: (p) => rampIn(p, 0.9, 1),
  links: (p) => Math.min(rampIn(p, 0, 0.2), rampOut(p, 0.9, 1)),
  return: (p) => rampOut(p, 0, 0.15),
};

// In quickly: a deep link lands at the start of the chapter and must show its controls straight away.
const LINKS: Curves = {
  links: (p) => Math.min(rampIn(p, 0.02, 0.2), rampOut(p, 0.9, 1)),
};

const sample = (curves: Curves, frame: FrameState): number => {
  const { chapter, chapterProgress } = frame.scroll;
  return clamp01(curves[chapter]?.(chapterProgress) ?? 0);
};

export function computePresence(frame: FrameState): Presence {
  return {
    live: frame.introProgress >= INTRO_GATE,
    hero: sample(HERO, frame),
    grid: sample(GRID, frame),
    numbers: sample(NUMBERS, frame),
    wall: sample(WALL, frame),
    links: sample(LINKS, frame),
  };
}
