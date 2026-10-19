import type { FrameState } from '../contracts';
import { decorative, h, presenceWriter, translateWriter } from './dom';
import type { Presence } from './presence';
import { createRandom } from './rand';

// Large numbers that drift behind the projects. Fixed strings: the point is texture, not data.
const NUMBERS = ['2924', '07.31', '5120', '88', '14.07', '306', '0.442', '7710'] as const;
/** Drift speed in screen px per virtual scroll px; the spread gives parallax between numbers. */
const DRIFT = [0.1, 0.16, 0.07, 0.2, 0.12, 0.09, 0.18, 0.13] as const;
/** The numbers wrap around a band taller than the screen so a wrap always happens off-screen. */
const WRAP_PADDING = 220;

const WALL_ROWS = 18;
const WALL_ROW_LENGTH = 420;
const WALL_WORDS = ['SYS', 'NODE', 'LINK', 'SYNC', 'ZLR', 'BUF', 'CRC', 'OK', 'IDLE', 'TX', 'RX', 'VEC', 'MESH', 'CORE', 'HASH'];

/** Rows of plausible-looking telemetry; seeded so the wall is identical on every visit. */
function buildWallRows(): string[] {
  const random = createRandom(0x5eed);
  return Array.from({ length: WALL_ROWS }, () => {
    let row = '';
    while (row.length < WALL_ROW_LENGTH) {
      const word = WALL_WORDS[Math.floor(random() * WALL_WORDS.length)] ?? 'SYS';
      const value = random() < 0.5 ? Math.floor(random() * 0xffff).toString(16).toUpperCase().padStart(4, '0') : (random() * 99).toFixed(2);
      row += `${word} ${value}  `;
    }
    return row;
  });
}

export interface Backdrop {
  update(frame: FrameState, presence: Presence): void;
  dispose(): void;
}

/** DOM layers behind the HUD: a dot grid, drifting blurred numbers and a faint wall of mono text. */
export function createBackdrop(parent: HTMLElement): Backdrop {
  const root = decorative(h('div', 'backdrop'));

  const grid = root.appendChild(h('div', 'backdrop__grid'));
  const numbersLayer = root.appendChild(h('div', 'backdrop__numbers'));
  const wall = root.appendChild(h('div', 'backdrop__wall'));

  const numbers = NUMBERS.map((value, i) => {
    const node = h('span', 'backdrop__number');
    node.textContent = value;
    // Spread across the width in a fixed, uneven rhythm.
    node.style.left = `${6 + ((i * 37) % 84)}%`;
    node.style.setProperty('--scale', String(1 + (i % 3) * 0.4));
    numbersLayer.append(node);
    return { move: translateWriter(node), offset: i / NUMBERS.length, speed: DRIFT[i] ?? 0.1 };
  });
  for (const row of buildWallRows()) wall.appendChild(h('p', 'backdrop__row')).textContent = row;

  const fadeGrid = presenceWriter(grid);
  const fadeNumbers = presenceWriter(numbersLayer);
  const fadeWall = presenceWriter(wall);
  parent.append(root);

  // Cached so update() never has to read layout.
  let viewportHeight = window.innerHeight;
  const onResize = (): void => {
    viewportHeight = window.innerHeight;
  };
  window.addEventListener('resize', onResize);

  return {
    update(frame, presence) {
      fadeGrid(presence.grid);
      fadeNumbers(presence.numbers);
      fadeWall(presence.wall);
      if (presence.numbers <= 0) return;

      const band = viewportHeight + WRAP_PADDING * 2;
      for (const number of numbers) {
        const y = (((number.offset * band - frame.scroll.absolute * number.speed) % band) + band) % band;
        number.move(0, y - WRAP_PADDING);
      }
    },
    dispose() {
      window.removeEventListener('resize', onResize);
    },
  };
}
