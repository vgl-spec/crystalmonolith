// End-to-end checks against the real app in real Chrome. Each check states the behaviour it
// protects and fails loudly; the run exits 1 if any check fails. Uses the ?debug test hook
// (window.__portfolio = { frame, map, jumpTo }), which only exists when ?debug is present.
//
//   node scripts/e2e.mjs [--out <dir>] [--port 5190]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv;
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const out = path.resolve(opt('out', 'qa-e2e'));
const port = Number(opt('port', 5190));
fs.mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const server = await createServer({ root: process.cwd(), logLevel: 'error', server: { port, strictPort: true } });
await server.listen();
const base = `http://localhost:${port}/`;
const gpuArgs = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

async function open(browser, query, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctxOpts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?${query}`, { waitUntil: 'load' });
  return { ctx, page, errors };
}
const frame = (page) => page.evaluate(() => {
  const f = window.__portfolio?.frame;
  return f ? { pos: f.scroll.position, chapter: f.scroll.chapter, intro: f.introProgress, open: f.openProjectId, link: f.activeLinkIndex } : null;
});
const waitReady = (page) => page.waitForFunction(() => window.__portfolio?.frame?.introProgress >= 1, null, { timeout: 30000 });

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: gpuArgs });
try {
  // 1. Boots without errors, intro skippable, every chapter renders.
  {
    const { ctx, page, errors } = await open(browser, 'debug&intro=0');
    await waitReady(page);
    const map = await page.evaluate(() => window.__portfolio.map);
    check('loop map has 6 chapters', map.spans.length === 6, `loop ${map.loopLength}px`);
    for (const span of map.spans) {
      const at = span.id === 'projects' ? span.start + 450 : span.start + span.length * 0.5;
      await page.evaluate((p) => window.__portfolio.jumpTo(p, true), at);
      await page.waitForTimeout(span.id === 'links' ? 2500 : 1500);
      const f = await frame(page);
      check(`jump lands in ${span.id}`, f.chapter === span.id, `got ${f.chapter} @ ${Math.round(f.pos)}`);
      await page.screenshot({ path: path.join(out, `chapter_${span.id}.png`) });
    }
    // 2. The loop wraps forward with no dead end.
    await page.evaluate((p) => window.__portfolio.jumpTo(p, true), map.loopLength - 150);
    await page.waitForTimeout(400);
    await page.mouse.move(720, 450);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(60); }
    await page.waitForTimeout(2500);
    const wrapped = await frame(page);
    check('wheel past the end wraps to the hero', wrapped.chapter === 'hero' && wrapped.pos < 1000, `pos ${Math.round(wrapped.pos)}`);
    // 3. Wheel backwards from the hero goes to the return chapter (loop works in both directions).
    await page.evaluate(() => window.__portfolio.jumpTo(100, true));
    await page.waitForTimeout(300);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -150); await page.waitForTimeout(60); }
    await page.waitForTimeout(2500);
    const back = await frame(page);
    check('wheel backwards from the hero wraps to the end', back.chapter === 'return', `${back.chapter} @ ${Math.round(back.pos)}`);
    check('no console errors during the loop', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 4. Project open: double-open guard, focus into dialog, scroll locked, Escape closes, focus returns.
  {
    const { ctx, page, errors } = await open(browser, 'debug&intro=0&at=projects');
    await waitReady(page);
    await page.waitForTimeout(2500);
    const cta = page.getByRole('button', { name: /explore/i }).first();
    const ctaVisible = await cta.isVisible().catch(() => false);
    check('project CTA button is visible', ctaVisible);
    if (ctaVisible) {
      await cta.focus();
      // Two clicks in the same task: the second lands before any re-render could disable the button,
      // so only the handler's own guard can stop a second open.
      await cta.evaluate((el) => { el.click(); el.click(); });
      await page.waitForTimeout(1500);
      const dialogs = await page.locator('[role="dialog"]:visible').count();
      check('double click opens exactly one dialog', dialogs === 1, `visible dialogs ${dialogs}`);
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      check('focus moves to Close', /close/i.test(focused), `focused "${focused}"`);
      await page.screenshot({ path: path.join(out, 'project_open.png') });
      const before = await frame(page);
      for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(50); }
      await page.waitForTimeout(1200);
      const after = await frame(page);
      check('scroll is locked while the panel is open', Math.abs(after.pos - before.pos) < 2, `moved ${Math.round(after.pos - before.pos)}px`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
      const closed = await frame(page);
      check('Escape closes the panel', closed.open === null && (await page.locator('[role="dialog"]:visible').count()) === 0);
      const refocused = await page.evaluate(() => /explore/i.test(document.activeElement?.textContent ?? ''));
      check('focus returns to the CTA', refocused);
    }
    // Canvas click on the shard also opens.
    await page.mouse.click(720, 450);
    await page.waitForTimeout(1500);
    const viaCanvas = await frame(page);
    check('clicking the centred shard opens its project', viaCanvas.open !== null, `open=${viaCanvas.open}`);
    await page.keyboard.press('Escape');
    check('no console errors around the panel', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 5. Links: keyboard carousel, unpublished link is not a dead link.
  {
    const { ctx, page, errors } = await open(browser, 'debug&intro=0&at=links');
    await waitReady(page);
    await page.evaluate(() => { const m = window.__portfolio.map; const s = m.spans.find((x) => x.id === 'links'); window.__portfolio.jumpTo(s.start + s.length * 0.5, true); });
    await page.waitForTimeout(2500);
    const l0 = (await frame(page)).link;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1600);
    const l1 = (await frame(page)).link;
    check('ArrowRight selects the next link', l1 === (l0 + 1) % 4, `${l0} -> ${l1}`);
    await page.screenshot({ path: path.join(out, 'links_next.png') });
    // LinkedIn has no URL yet (index 2): it must show as a disabled "soon" control, never a dead link.
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1600);
    const soon = await page.getByText(/LinkedIn\s*·\s*SOON/i).isVisible().catch(() => false);
    check('unpublished LinkedIn shows as SOON', soon);
    const deadLinks = await page.locator('a[href=""]:visible, a:not([href]):visible').count();
    check('no visible dead links in the overlay', deadLinks === 0, `count ${deadLinks}`);
    check('no console errors in links', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 6. Reduced motion: no intro wait.
  {
    const { ctx, page } = await open(browser, 'debug', { reducedMotion: 'reduce' });
    const ok = await page.waitForFunction(() => window.__portfolio?.frame?.introProgress === 1, null, { timeout: 15000 }).then(() => true, () => false);
    check('reduced motion skips the intro', ok);
    await ctx.close();
  }

  // 7. Frame rate in the heaviest chapters (desktop GPU).
  {
    const { ctx, page } = await open(browser, 'debug&intro=0');
    await waitReady(page);
    for (const id of ['hero', 'links']) {
      await page.evaluate((cid) => { const m = window.__portfolio.map; const s = m.spans.find((x) => x.id === cid); window.__portfolio.jumpTo(s.start + s.length * 0.5, true); }, id);
      await page.waitForTimeout(1500);
      const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n / 2); }; requestAnimationFrame(tick); }));
      check(`${id} holds >= 50 fps on this GPU`, fps >= 50, `${fps} fps`);
    }
    await ctx.close();
  }

  // 8. Mobile portrait renders and shows the sound toggle.
  {
    const { ctx, page, errors } = await open(browser, 'debug&intro=0', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await waitReady(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, 'mobile_hero.png') });
    check('mobile shows the sound toggle', await page.getByRole('button', { name: /sound/i }).isVisible());
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check('mobile has no horizontal overflow', !overflow);
    check('no console errors on mobile', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

// 9. No WebGL: the static page must carry the content.
{
  const nogl = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-webgl', '--disable-3d-apis'] });
  try {
    const ctx = await nogl.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    const fallback = await page.evaluate(() => document.documentElement.classList.contains('no-webgl'));
    check('without WebGL the fallback class is set', fallback);
    const visible = await page.locator('#static-content h1').isVisible().catch(() => false);
    check('without WebGL the static page is visible', visible);
    await page.screenshot({ path: path.join(out, 'no_webgl.png'), fullPage: true });
  } finally {
    await nogl.close();
  }
}

await server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
