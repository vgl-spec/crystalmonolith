import type { SceneAnchors, ScreenPoint, SiteContent } from '../contracts';
import { decorative, presenceWriter, svg } from './dom';
import { overflowOf } from './viewport';
import type { Viewport } from './viewport';

// The scene reports five points; a few spare slots keep a content change from silently dropping one.
const MAX_POINTS = 8;
// Reference-style two-digit tags; cycled when there are more points than entries.
const TAGS = ['29', '27', '31', '21', '28', '24', '33', '26'] as const;

// Label geometry, mirroring hud.css. JetBrains Mono advances 0.6 em per glyph, so a label's width is
// known from its text without touching layout.
const LABEL_OFFSET = 9;
const NUMBER_CHAR_WIDTH = 12 * 0.6;
const VALUE_CHAR_WIDTH = 9 * (0.6 + 0.04);

const translate = (x: number, y: number): string => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

/** Shows or hides an SVG node, writing only when the state flips. */
function visibilityWriter(node: SVGElement): (visible: boolean) => void {
  let shown = true;
  return (visible) => {
    if (visible === shown) return;
    shown = visible;
    node.style.display = visible ? '' : 'none';
  };
}

export interface HeroHud {
  update(anchors: SceneAnchors, presence: number): void;
}

/**
 * Numbered constellation joined by hairlines. Everything that moves per frame is a CSS transform:
 * each line is one unit-length segment that is translated, rotated and stretched into place, so a
 * frame never rewrites SVG geometry.
 */
export function createHeroHud(parent: HTMLElement, content: SiteContent, viewport: Viewport): HeroHud {
  const root = decorative(svg('svg', {}, 'hero-hud'));
  const fade = presenceWriter(root);

  const segments = Array.from({ length: MAX_POINTS - 1 }, () => {
    const line = svg('line', { x1: '0', y1: '0', x2: '1', y2: '0' }, 'hero-hud__segment');
    root.append(line);
    return { line, setVisible: visibilityWriter(line) };
  });

  const points = Array.from({ length: MAX_POINTS }, (_, i) => {
    const group = svg('g', {}, 'hero-hud__point');
    const number = svg('text', { x: String(LABEL_OFFSET), y: '-6' }, 'hero-hud__number');
    const value = svg('text', { x: String(LABEL_OFFSET), y: '7' }, 'hero-hud__value');
    number.textContent = TAGS[i % TAGS.length] ?? '';
    value.textContent = content.facts[i]?.value ?? '';
    group.append(svg('path', { d: 'M-5 0H5M0 -5V5' }, 'hero-hud__cross'), number, value);
    root.append(group);
    const labelWidth = Math.max((number.textContent?.length ?? 0) * NUMBER_CHAR_WIDTH, (value.textContent?.length ?? 0) * VALUE_CHAR_WIDTH);
    let labelOnLeft = false;
    return {
      group,
      setVisible: visibilityWriter(group),
      /** Right of the crosshair unless that runs past the gutter and the left side fits better. */
      placeLabel(x: number): void {
        const overflowRight = overflowOf(x + LABEL_OFFSET, labelWidth, viewport.width, viewport.gutter);
        const overflowLeft = overflowOf(x - LABEL_OFFSET - labelWidth, labelWidth, viewport.width, viewport.gutter);
        const onLeft = overflowRight > 0 && overflowLeft < overflowRight;
        if (onLeft === labelOnLeft) return;
        labelOnLeft = onLeft;
        group.classList.toggle('is-flipped', onLeft);
        const labelX = String(onLeft ? -LABEL_OFFSET : LABEL_OFFSET);
        number.setAttribute('x', labelX);
        value.setAttribute('x', labelX);
      },
    };
  });
  parent.append(root);

  const placeSegment = (line: SVGLineElement, from: ScreenPoint, to: ScreenPoint): void => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    line.style.transform = `${translate(from.x, from.y)} rotate(${Math.atan2(dy, dx).toFixed(4)}rad) scale(${Math.hypot(dx, dy).toFixed(1)}, 1)`;
  };

  return {
    update({ heroPoints }, presence) {
      // Outside the hero the scene reports no points; nothing is drawn and nothing is written.
      fade(heroPoints.length === 0 ? 0 : presence);
      if (heroPoints.length === 0 || presence <= 0) return;

      points.forEach((point, i) => {
        const anchor = heroPoints[i];
        const visible = anchor?.visible === true;
        point.setVisible(visible);
        if (anchor && visible) {
          point.placeLabel(anchor.x);
          point.group.style.transform = translate(anchor.x, anchor.y);
        }
      });
      segments.forEach((segment, i) => {
        const from = heroPoints[i];
        const to = heroPoints[i + 1];
        const visible = from?.visible === true && to?.visible === true;
        segment.setVisible(visible);
        if (from && to && visible) placeSegment(segment.line, from, to);
      });
    },
  };
}
