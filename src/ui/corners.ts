import { buildChapterMap, CHAPTER_ORDER } from '../contracts';
import type { ChapterId, FrameState, SiteContent, UIEvents } from '../contracts';
import type { ChromeSlots } from './chrome';
import { bindHover, decorative, h, presenceWriter, svg } from './dom';
import type { Presence } from './presence';
import { scramble, scrambleDuration } from './scramble';

const CHAPTER_LABEL: Record<ChapterId, string> = {
  hero: 'HERO',
  descent: 'DESCENT',
  projects: 'PROJECTS',
  portal: 'PORTAL',
  links: 'LINKS',
  return: 'RETURN',
};

const chapterReadout = (chapter: ChapterId): string =>
  `${String(CHAPTER_ORDER.indexOf(chapter) + 1).padStart(2, '0')} / ${CHAPTER_LABEL[chapter]}`;

/** The full title lives in the content; the corner has room for the short form. */
const shortRole = (role: string): string => role.replace('Chief Executive Officer', 'CEO');

/** "Caloocan City, Metro Manila, PH" -> "Caloocan City, PH". */
function shortLocation(location: string): string {
  const parts = location.split(',').map((part) => part.trim());
  return parts.length > 2 ? `${parts[0]}, ${parts[parts.length - 1]}` : location;
}

function speakerIcon(): SVGSVGElement {
  const icon = svg('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, 'sound__icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.append(
    svg('path', { d: 'M3.5 9.5v5h3.8l4.7 3.8V5.7L7.3 9.5z' }),
    svg('path', { d: 'M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.8 7.8 0 0 1 0 10.8' }, 'sound__waves'),
    svg('path', { d: 'M16 9.5l5 5M21 9.5l-5 5' }, 'sound__muted'),
  );
  return icon;
}

export interface Corners {
  update(frame: FrameState, presence: Presence): void;
}

export function createCorners(chrome: HTMLElement, slots: ChromeSlots, content: SiteContent, events: UIEvents): Corners {
  const { person } = content;
  const loopLength = buildChapterMap(content.projects.length).loopLength;

  // Top-left: the wordmark stays on every screen; the two meta lines belong to the hero.
  const wordmark = decorative(h('p', 'wordmark'));
  for (const line of person.wordmark) wordmark.appendChild(h('span', 'wordmark__line')).textContent = line;

  const meta = decorative(h('div', 'meta'));
  const tagline = meta.appendChild(h('p', 'meta__line'));
  const copyright = meta.appendChild(h('p', 'meta__line meta__line--dim'));
  tagline.textContent = `// ${shortRole(person.role)}, ${person.company}`;
  copyright.textContent = `© ${new Date().getFullYear()} · ${shortLocation(person.location)}`;
  slots.tl.append(wordmark, meta);

  // Top-right: the manifesto, hero only.
  const manifesto = decorative(h('div', 'manifesto'));
  manifesto.appendChild(h('p', 'label manifesto__label')).textContent = '////// Manifesto';
  for (const paragraph of content.manifesto) manifesto.appendChild(h('p', 'manifesto__text')).textContent = paragraph;
  slots.tr.append(manifesto);

  // Bottom-left: scroll hint (hero only) above the sound toggle.
  const scrollHint = decorative(h('p', 'scroll-hint'));
  scrollHint.textContent = content.scrollHint;

  const soundButton = h('button', 'sound', { type: 'button' });
  const soundLabel = h('span', 'sound__label');
  soundButton.append(speakerIcon(), soundLabel);
  let soundOn = false;
  const paintSound = (): void => {
    soundLabel.textContent = `Sound: ${soundOn ? 'On' : 'Off'}`;
    soundButton.classList.toggle('is-on', soundOn);
  };
  paintSound();
  // The AudioContext may only start inside a user gesture, so the event is emitted from this handler.
  soundButton.addEventListener('click', () => {
    soundOn = !soundOn;
    paintSound();
    events.onSoundToggle(soundOn);
  });
  bindHover(soundButton, events.onHover);
  slots.bl.append(scrollHint, soundButton);

  // Bottom-right: chapter readout and a thin loop-progress meter.
  const readout = decorative(h('div', 'readout'));
  const readoutText = readout.appendChild(h('p', 'readout__text'));
  const meter = readout.appendChild(h('div', 'meter'));
  const meterFill = meter.appendChild(h('span', 'meter__fill'));
  slots.br.append(readout);

  let currentChapter: ChapterId | null = null;
  let lastMeter = -1;
  let revealed = false;

  const heroPresence = [presenceWriter(meta), presenceWriter(manifesto), presenceWriter(scrollHint)] as const;

  const reveal = (): void => {
    revealed = true;
    chrome.classList.add('is-live');
    const targets = [tagline, copyright, scrollHint, ...manifesto.querySelectorAll<HTMLElement>('p')];
    for (const target of targets) {
      const finalText = target.textContent ?? '';
      void scramble(target, finalText, scrambleDuration(finalText));
    }
  };

  return {
    update(frame, presence) {
      if (presence.live && !revealed) reveal();

      for (const write of heroPresence) write(presence.hero);

      if (frame.scroll.chapter !== currentChapter) {
        currentChapter = frame.scroll.chapter;
        void scramble(readoutText, chapterReadout(currentChapter), revealed ? 320 : 0);
      }

      const meterValue = Math.round((frame.scroll.position / loopLength) * 500) / 500;
      if (meterValue !== lastMeter) {
        lastMeter = meterValue;
        meterFill.style.transform = `scaleX(${meterValue})`;
      }
    },
  };
}
