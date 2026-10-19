// Where on the loop the visitor lands: the hero, unless the URL names a chapter or a pixel position.
import { PROJECT_SLOT, wrapPosition, type ChapterMap } from '../contracts';
import type { QueryOptions } from './query';

/**
 * The camera swings from top-down to the side view over the first 30% of links (see the camera rig),
 * so a links deep link lands just after the swing, where the particle figure and carousel read.
 */
const LINKS_SETTLED = 0.35;

/**
 * ?pos=<px> wins over ?at=<chapter id>. A chapter link lands on the chapter's start, except where the
 * start is not a readable frame: projects lands with the first project centred, links after the swing.
 */
export function resolveStartPosition(query: Pick<QueryOptions, 'at' | 'pos'>, map: ChapterMap): number {
  if (query.pos !== null) return wrapPosition(query.pos, map.loopLength);
  const span = map.spans.find((candidate) => candidate.id === query.at);
  if (span === undefined) return 0;
  if (span.id === 'projects') return span.start + PROJECT_SLOT / 2;
  if (span.id === 'links') return span.start + span.length * LINKS_SETTLED;
  return span.start;
}
