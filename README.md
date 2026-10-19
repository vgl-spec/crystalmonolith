# Crystal Monolith

Portfolio of **Vergel A. Bautista**, co-founder and CEO of [Zelarion](https://www.zelarion.tech/).
A real-time WebGL experience that loops forever: a faceted crystal monolith, a descent into the
project crystals, a portal of rings, and the links drawn in particles, then back to the monolith.

The structure and pacing follow igloo.inc (abeto and Bureaux). Every asset, shader and line of
code here is our own; see `docs/experience-spec.md` for what was measured and how it maps.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check, then build to dist/
npm run preview    # serve dist/
```

Query flags (dev and production): `?debug` (fps panel and the `window.__portfolio` test hook),
`?intro=0` (skip the intro), `?at=hero|descent|projects|portal|links|return`, `?pos=<px>`,
`?link=<index>`, `?quality=high|medium|low`.

## Where things live

| Path | What |
|---|---|
| `src/content/site.ts` | Every word on the site: bio, projects, links, footer, SEO |
| `src/contracts.ts` | Shared types, the scroll loop and its chapters, world layout, palette |
| `src/main.ts` | Composition root: wires scroll, scene, UI and sound into one frame loop |
| `src/core/` | Virtual scroll, pointer, intro clock, environment checks, debug hook |
| `src/scene/` | three.js: engine (camera rig, post-processing, quality), world (monolith, terrain), projects, portal, links |
| `src/ui/`, `src/styles/` | DOM overlay: preloader, HUD callouts, project panel, links carousel |
| `src/audio/sound.ts` | Procedural Web Audio, off until the visitor turns it on |
| `src/content/static-html.ts` | The no-WebGL / screen-reader / crawler version of the page, rendered at build time |
| `public/projects/` | Landing screenshots used inside the project crystals |
| `scene-lab.html`, `zone-lab.html`, `src/ui/lab/` | Dev-only test benches; not part of the build |

## Adding or changing a project

Edit `PROJECTS` in `src/content/site.ts` and drop an 8:5 screenshot (1280x800 webp) in
`public/projects/`. The loop length, crystals, HUD and static page all follow the list. A concept
project must keep `status: 'concept'` so it is labelled as one. Set `placeholder: false` once the
real copy is in.

## Checks

```bash
npx tsc --noEmit
node scripts/e2e.mjs --out qa-e2e          # 30 browser checks in the installed Chrome
node scripts/shoot.mjs --page index.html --states "intro=0&at=projects" --out qa-shots
```

Pass `--page` without a leading slash (Git Bash rewrites `/x.html` into a Windows path).

## Deploy (Vercel)

Import the repository; Vercel detects Vite. Build command `npm run build`, output `dist`.
No environment variables are needed.

## Open items

- LinkedIn URL (shows as "soon" until `href` is set in `site.ts`).
- The portfolio's own domain (`seo.url` is null, so no canonical or `og:url` is emitted).
- Real case-study copy for each project (all six are marked placeholder).
