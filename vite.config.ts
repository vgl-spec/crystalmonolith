import { defineConfig, type Plugin } from 'vite';
import { SITE } from './src/content/site';
import { renderHeadTags, renderStaticContent } from './src/content/static-html';

const HEAD_PLACEHOLDER = '<!--head-tags-->';
const CONTENT_PLACEHOLDER = '<!--static-content-->';

/**
 * Bakes the crawlable, no-JavaScript version of the site into index.html at build and dev time, from
 * the same SITE object the 3D scene and the overlay read, so the three can never disagree.
 */
function staticContentPlugin(): Plugin {
  return {
    name: 'portfolio-static-content',
    transformIndexHtml(html, { path }) {
      // Dev labs (scene-lab.html and friends) have no placeholders and must pass through untouched.
      if (path !== '/index.html') return html;
      for (const placeholder of [HEAD_PLACEHOLDER, CONTENT_PLACEHOLDER]) {
        if (!html.includes(placeholder)) {
          throw new Error(`index.html is missing ${placeholder}; the static page and SEO tags would be lost.`);
        }
      }
      // Replacer functions, not strings: site copy may contain "$&" or "$1", which String.replace would expand.
      return html
        .replace(HEAD_PLACEHOLDER, () => renderHeadTags(SITE))
        .replace(CONTENT_PLACEHOLDER, () => renderStaticContent(SITE));
    },
  };
}

export default defineConfig({
  plugins: [staticContentPlugin()],
  build: {
    target: 'es2022',
    // Only the portfolio itself ships; the *-lab.html dev pages are served by the dev server alone.
    rolldownOptions: { input: 'index.html' },
  },
});
