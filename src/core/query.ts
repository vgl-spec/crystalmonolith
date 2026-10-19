// The URL switches the site understands, parsed once and validated at the boundary. Anything
// unrecognised becomes "not set" rather than being passed on.
import { CHAPTER_ORDER, type ChapterId, type QualityTier } from '../contracts';

const QUALITY_TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

export interface QueryOptions {
  /** ?quality=high|medium|low forces a tier. */
  quality: QualityTier | null;
  /** False for ?intro=0, which skips the intro animation. */
  intro: boolean;
  /** ?debug shows the stats panel and exposes window.__portfolio for automated tests. */
  debug: boolean;
  /** ?at=<chapter id> deep link. */
  at: ChapterId | null;
  /** ?pos=<virtual px> deep link; wins over ?at. */
  pos: number | null;
  /** ?link=<index> initial carousel selection. */
  link: number | null;
}

export function readQuery(search: string = window.location.search): QueryOptions {
  const params = new URLSearchParams(search);
  const link = parseFiniteNumber(params.get('link'));
  return {
    quality: pickOne(params.get('quality'), QUALITY_TIERS),
    intro: params.get('intro') !== '0',
    debug: params.has('debug'),
    at: pickOne(params.get('at'), CHAPTER_ORDER),
    pos: parseFiniteNumber(params.get('pos')),
    link: link === null ? null : Math.trunc(link),
  };
}

function pickOne<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

function parseFiniteNumber(raw: string | null): number | null {
  // Number('') is 0, which would silently turn an empty "?pos=" into a jump to the hero.
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
