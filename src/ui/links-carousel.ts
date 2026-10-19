import type { FrameState, LinkItem, SiteContent, UIEvents } from '../contracts';
import type { ChromeSlots } from './chrome';
import { bindHover, decorative, h, presenceWriter, svg, wrapIndex } from './dom';
import type { Presence } from './presence';
import { scramble } from './scramble';

/** Below this the controls are too faint to be a real target. */
const CONTROL_ACTIVE_ABOVE = 0.3;
/** The carousel only answers the keyboard once it is mostly faded in. */
const KEYBOARD_ACTIVE_ABOVE = 0.5;
const LABEL_SCRAMBLE_MS = 380;

export interface LinksCarousel {
  update(frame: FrameState, presence: Presence): void;
  dispose(): void;
}

function arrowIcon(direction: 'prev' | 'next'): SVGSVGElement {
  const icon = decorative(svg('svg', { viewBox: '0 0 76 12', fill: 'none', stroke: 'currentColor', 'stroke-width': '1' }, 'arrow__icon'));
  icon.append(
    svg('path', {
      d: direction === 'prev' ? 'M75 6H1M7 1L1 6l6 5' : 'M1 6h74M69 1l6 5-6 5',
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  return icon;
}

const isExternal = (href: string): boolean => /^https?:/i.test(href);

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function createLinksCarousel(
  parent: HTMLElement,
  slots: ChromeSlots,
  content: SiteContent,
  events: UIEvents,
): LinksCarousel {
  const { links, footer, person } = content;
  const count = links.length;
  const layer = h('div', 'links');

  // Arrows at mid-left and mid-right.
  const makeArrow = (direction: 'prev' | 'next'): HTMLButtonElement => {
    const button = h('button', `arrow arrow--${direction}`, { type: 'button', 'aria-label': direction === 'prev' ? 'Previous link' : 'Next link' });
    button.append(arrowIcon(direction));
    bindHover(button, events.onHover);
    return button;
  };
  const prevArrow = makeArrow('prev');
  const nextArrow = makeArrow('next');
  layer.append(prevArrow, nextArrow);
  parent.append(layer);

  // Bottom-centre carousel: previous (dim), selected (bracketed), next (dim). The side labels
  // duplicate the arrows for pointer users, so they stay out of the tab order and the a11y tree.
  const makeSide = (direction: 'prev' | 'next'): HTMLButtonElement => {
    const button = h('button', `carousel__side carousel__side--${direction}`, { type: 'button', tabindex: '-1', 'aria-hidden': 'true' });
    bindHover(button, events.onHover);
    return button;
  };
  const prevSide = makeSide('prev');
  const nextSide = makeSide('next');

  const linkText = h('span', 'carousel__text');
  const currentLink = h('a', 'carousel__current');
  currentLink.append(linkText);
  const soonButton = h('button', 'carousel__current carousel__current--soon', { type: 'button', disabled: '' });
  const soonText = h('span', 'carousel__text');
  soonButton.append(soonText);
  const selected = h('div', 'carousel__selected');
  selected.append(currentLink, soonButton, ...['tl', 'tr', 'bl', 'br'].map((corner) => h('i', `bracket bracket--${corner}`, { 'aria-hidden': 'true' })));
  bindHover(currentLink, events.onHover);

  const carousel = h('nav', 'carousel', { 'aria-label': 'Links' });
  carousel.append(prevSide, selected, nextSide);
  slots.bc.append(carousel);

  // Footer: headline and email top-right, stack bottom-right, credits top-left.
  const footerHead = h('div', 'footer-head');
  const headline = decorative(h('p', 'footer-head__text'));
  headline.textContent = footer.headline;
  const mail = h('a', 'footer-head__mail', { href: `mailto:${person.email}`, 'aria-label': `Email ${person.email}` });
  mail.textContent = person.email;
  bindHover(mail, events.onHover);
  footerHead.append(headline, mail);
  slots.tr.append(footerHead);

  const stack = decorative(h('div', 'stack'));
  stack.appendChild(h('p', 'label')).textContent = '/// Stack';
  const stackList = stack.appendChild(h('ul', 'stack__list'));
  for (const item of footer.stack) stackList.appendChild(h('li')).textContent = item;
  slots.br.prepend(stack);

  const credits = decorative(h('div', 'credits'));
  for (const line of footer.credits) credits.appendChild(h('p', 'credits__line')).textContent = line;
  slots.tl.append(credits);

  const fadeDecor = [presenceWriter(stack), presenceWriter(credits)];
  const fadeControls = [
    presenceWriter(layer, CONTROL_ACTIVE_ABOVE),
    presenceWriter(carousel, CONTROL_ACTIVE_ABOVE),
    presenceWriter(footerHead, CONTROL_ACTIVE_ABOVE),
  ];

  let activeIndex = 0;
  let renderedIndex = -1;
  let keyboardReady = false;

  const select = (offset: number): void => {
    if (count < 2) return;
    events.onLinkSelect(wrapIndex(activeIndex + offset, count));
  };
  prevArrow.addEventListener('click', () => select(-1));
  nextArrow.addEventListener('click', () => select(1));
  prevSide.addEventListener('click', () => select(-1));
  nextSide.addEventListener('click', () => select(1));

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!keyboardReady || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
    if (event.key === 'ArrowLeft') select(-1);
    else if (event.key === 'ArrowRight') select(1);
  };
  document.addEventListener('keydown', onKeyDown);

  const showCurrent = (link: LinkItem, animate: boolean): void => {
    const published = link.href !== null;
    currentLink.hidden = !published;
    soonButton.hidden = published;
    const target = published ? linkText : soonText;
    const text = published ? link.label : `${link.label} · SOON`;
    if (link.href !== null) {
      currentLink.href = link.href;
      currentLink.setAttribute('aria-label', link.label);
      if (isExternal(link.href)) {
        currentLink.target = '_blank';
        currentLink.rel = 'noopener noreferrer';
      } else {
        currentLink.removeAttribute('target');
        currentLink.removeAttribute('rel');
      }
    }
    void scramble(target, text, animate ? LABEL_SCRAMBLE_MS : 0);
  };

  const render = (index: number, animate: boolean): void => {
    const current = links[index];
    if (!current) return;
    showCurrent(current, animate);
    const hasNeighbours = count > 1;
    prevSide.hidden = nextSide.hidden = !hasNeighbours;
    prevArrow.hidden = nextArrow.hidden = !hasNeighbours;
    prevSide.textContent = links[wrapIndex(index - 1, count)]?.label ?? '';
    nextSide.textContent = links[wrapIndex(index + 1, count)]?.label ?? '';
  };

  return {
    update(frame, presence) {
      activeIndex = frame.activeLinkIndex;
      if (activeIndex !== renderedIndex) {
        render(activeIndex, renderedIndex !== -1);
        renderedIndex = activeIndex;
      }
      for (const write of fadeDecor) write(presence.links);
      for (const write of fadeControls) write(presence.links);
      keyboardReady = presence.links > KEYBOARD_ACTIVE_ABOVE && frame.openProjectId === null;
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
