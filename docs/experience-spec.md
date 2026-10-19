# Experience spec, V1

The site is a real-time WebGL loop in the style of igloo.inc (abeto, Awwwards Site of the Year 2024):
same structure, pacing and interaction model, but with our own world, assets and content. Nothing of
theirs (meshes, textures, audio, code, the igloo/ice concept) is copied. Measured values below come
from a bounded capture of the reference on 2026-10-19 (1440x900, 100 px wheel steps).

## What the reference measured

| Thing | Measured |
|---|---|
| Loop | Infinite. One full cycle is ~118 wheel steps (~11,800 px). The end rebuilds the hero and continues. |
| Scroll feel | Virtual scroll, heavy smoothing. One 300 px notch peaks at ~0.5 s and settles by ~2.4 s (time constant ~0.8 s). No DOM scroll. |
| Frame rate | 176-180 fps on a desktop GPU. Budget per frame is small; everything is baked or procedural. |
| Pointer | Gentle camera parallax in the hero; particles in the links section push away from the pointer. |
| Sound | Off by default, "Sound: Off" toggle bottom-left on every screen. |
| Mobile | Same loop in portrait, driven by touch drag; UI shrinks, nothing removed. |

Chapter map of the reference (wheel steps):

| Steps | Chapter | What happens |
|---|---|---|
| intro | Preloader | Grey void, centred ASCII bar `==------==` fills with load progress. Then a white wireframe lattice and a glowing disc appear; the igloo assembles as frost spreads; camera pulls back to reveal mountains; UI scrambles in. |
| 0-10 | Hero | Igloo on snow. Blocks "breathe": they lift apart with glowing seams and settle, every few seconds. HUD constellation: 4-5 numbered points on blocks joined by thin lines. Top-left logo + copyright, top-right `////// Manifesto` + mission paragraph (right-aligned, mono, small), bottom-left "Scroll down to discover." + sound toggle. |
| 11-18 | Descent | Camera tilts down and sinks; fog rises to a whiteout; chromatic-aberration fringes along the horizon and edges. Hero text fades out early (by step 12). |
| 19-39 | Projects | One crystal per portfolio company rises from the bottom, holds centre while rotating slowly, leaves through the top (~10 steps each). HUD callouts tied to crystal vertices with thin leader lines: title top-left (`PORTFOLIO_CO_01` / `PUDGY PENGUINS`, underlined), a numeric readout right (`TEMP 35.54 / +01.97`, ticking), bottom-right `D 01.02.2020` / `CLICK TO EXPLORE` (underlined). Behind: faint dot grid over the whole screen and large blurred numbers drifting. |
| click | Project view | Crystal glitches (RGB split + blocky displacement, ~1 s), then a dark overlay: dim crystal behind, centred mono text column (`////// Summary`, paragraphs, `/// Discover` link chips `[X] [IG]`, `/// Visit` `[website]`), `Close` button top-right inside corner brackets. Text scrambles in line by line. Escape or Close returns. |
| 40-44 | Portal build | Looking straight down: a shattered ring's segments fly in and lock together. |
| 45-75 | Portal | Camera descends through a stack of thick glowing rings; each ring rushes past with a light flare; a bright particle core waits at the bottom. |
| 76-112 | Links | The core lands on a tiered circular platform with a glowing rim; camera swings from top-down to side view. Particles form a figure. Arrows `←` `→` at mid-left/right; carousel bottom-centre `Medium [ LinkedIn ] X / Twitter` with corner brackets around the selected item. Changing link: particles scatter and brighten with speed, then reform into the new logo over ~1.2 s. Faint wall of mono text behind. |
| 110-122 | Return | Ripple with RGB split across the platform, terrain re-emerges, the figure dissolves upward, igloo blocks fly in and assemble into the hero. |

## Our world: the Zelarion monolith

Palette and type are in `src/contracts.ts` (`PALETTE`, `FONT_FAMILY`). Night instead of snow:
navy-black void, mist, cyan light. The brand mark is a faceted crystal Z between `< >` brackets, so
every 3D object is faceted crystal with flat-shaded planes and cyan light living inside it.

| Chapter (ours) | Reference beat | Our version |
|---|---|---|
| Preloader | ASCII bar | Same idea: centred mono bar `[==------]` + percent, real progress from the loading manager. |
| Intro (introProgress 0-1, ~7 s) | lattice, disc, igloo builds, camera pulls back | Cyan wireframe lattice and a glowing disc on dark ground; the monolith crystallises bottom-to-top (dissolve with a hot edge); circuit lines ignite outward through the ground; camera dollies back to the hero framing; HUD scrambles in at 0.85+. |
| Hero | igloo breathing, HUD constellation | A tall faceted crystal monolith (~6.5 units) made of 7-9 stacked segments. Segments breathe apart with glowing cyan seams and settle (stagger, ~6 s cycle). Inside, a faint Z core light. Two bracket shards `<` `>` hover either side, slowly orbiting. Dark rocky terrain with faint cyan circuit traces, distant faceted ridges, low mist, slow drifting dust. Pointer gives a small camera parallax. |
| Descent | fog whiteout + RGB fringes | Camera tilts down and sinks into a navy data-mist: streaks of cyan particles rush upward past the camera, chromatic aberration ramps with speed, the hero fades. |
| Projects (6 slots) | ice crystal per company | One unique crystal shard per project (seeded, never two alike). Inside each, the project's landing screenshot as a glowing hologram plane. Same rise/hold/leave choreography and the same three HUD callouts: `PROJECT_01` / `GOLDENSTARS PACKAGING`, readout (`SYS 99.21 / +00.47`, ticking), `goldenstars.ph` / `CLICK TO EXPLORE`. Concept projects show `CONCEPT` in the title callout; placeholder copy shows a small `PLACEHOLDER` tag. Dot grid + large blurred numbers behind. |
| Project view | dark overlay text column | Same layout: `////// Summary`, summary, `/// Sector`, `/// Visit` `[domain] ↗`, the screenshot as a framed image above the text, `Close` in corner brackets. Glitch-out of the shard on open, scramble-in text. |
| Portal build + portal | shattered ring, ring tunnel | Faceted ring segments assemble into a data ring, then the camera falls through five rings that flare cyan as they pass; a bright particle core waits at the bottom. |
| Links | particle figure + carousel | The core lands on a tiered dark platform with a cyan rim; camera swings to side view; particles form the selected link's shape (Zelarion mark, GitHub mark, "in", "@"). Arrows + bracketed carousel exactly like the reference. Footer content (headline, email, stack, credits) sits in the corners of this chapter. |
| Return | ripple, rebuild | RGB ripple across the platform, flash, then the monolith segments fly in from scattered positions and assemble back into the hero pose. The loop position wraps to 0 seamlessly. |

## Non-negotiables

- Text the visitor reads is real DOM text (crawlable, selectable); the reference draws its UI in
  WebGL, we do not. The static page (`#static-content`) carries every word for screen readers and
  for browsers without WebGL.
- `prefers-reduced-motion`: no intro, no scramble, no chromatic aberration, no breathing; chapters
  crossfade. Scrolling still works.
- Sound starts only from a click on the toggle. Never autoplay.
- Never hijack keyboard focus. Tab reaches every control: sound, project CTA, panel close, links.
- One WebGL context. Device pixel ratio capped (high 1.75, medium 1.5, low 1). Quality drops a tier
  if the frame rate stays under 45 fps for 2 s.
- Every scene object is procedural or one of our own files. No third-party models or textures.
