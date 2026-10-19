// Dev QA helper. Starts Vite inside this process, opens the installed Chrome (real GPU) through
// playwright-core, screenshots one page in several query-string states, prints every console
// error and page error, then shuts the browser and the server down. Nothing is left running.
//
//   node scripts/shoot.mjs --page index.html --states "debug&at=hero;debug&at=projects" --out <dir>
//        [--wait 4000] [--port 5180] [--size 1440x900] [--mobile]
//
// Pass --page WITHOUT a leading slash: Git Bash rewrites "/x.html" into a Windows path.
// Exit code 1 when the page threw or logged an error, so a broken build cannot pass silently.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const page = `/${String(arg('page', 'index.html')).replace(/^\/+/, '')}`;
const states = String(arg('states', '')).split(';').map((s) => s.trim());
const out = path.resolve(String(arg('out', 'qa-shots')));
const wait = Number(arg('wait', 4000));
const port = Number(arg('port', 5180));
const [width, height] = String(arg('size', '1440x900')).split('x').map(Number);
const mobile = arg('mobile', false) === true;
fs.mkdirSync(out, { recursive: true });

const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { port, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});

let failures = 0;
try {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width, height } },
  );
  for (const [i, state] of states.entries()) {
    const tab = await ctx.newPage();
    const errors = [];
    tab.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
    tab.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    const url = `http://localhost:${port}${page}${state ? (page.includes('?') ? '&' : '?') + state : ''}`;
    await tab.goto(url, { waitUntil: 'load' });
    await tab.waitForTimeout(wait);
    const file = path.join(out, `${String(i).padStart(2, '0')}_${state.replace(/[^a-z0-9=._-]+/gi, '_') || 'default'}.png`);
    await tab.screenshot({ path: file });
    const real = errors.filter((e) => !e.startsWith('[warning]'));
    failures += real.length;
    console.log(`${file}\n${errors.length ? errors.map((e) => `  ${e}`).join('\n') : '  (no console errors)'}`);
    await tab.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures ? 1 : 0);
