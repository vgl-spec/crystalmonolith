import { h } from './dom';

/**
 * The four corners and the bottom-centre of the screen. They are cells of one CSS grid rather than
 * independently positioned boxes, so content added to neighbouring cells (footer text beside the
 * carousel, say) can never overlap at any width: the grid gives each cell the space that is left.
 */
export interface ChromeSlots {
  tl: HTMLElement;
  tr: HTMLElement;
  bl: HTMLElement;
  bc: HTMLElement;
  br: HTMLElement;
}

export interface Chrome {
  element: HTMLElement;
  slots: ChromeSlots;
}

export function createChrome(parent: HTMLElement): Chrome {
  const element = h('div', 'chrome');
  const slot = (name: keyof ChromeSlots): HTMLElement => element.appendChild(h('div', `slot slot--${name}`));
  const slots: ChromeSlots = { tl: slot('tl'), tr: slot('tr'), bl: slot('bl'), bc: slot('bc'), br: slot('br') };
  parent.append(element);
  return { element, slots };
}
