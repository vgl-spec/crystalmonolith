// Renders SiteContent into the HTML that works without WebGL: the <head> tags crawlers read and the
// semantic page screen readers and no-WebGL browsers get. Both run at build/dev time inside the Vite
// plugin (vite.config.ts), so this file must not touch the DOM.
import type { LinkItem, Project, SiteContent } from '../contracts';

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for element content and for double- or single-quoted attribute values alike. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
}

/** Allow-list, so `javascript:`, `data:` and anything unrecognised is rejected rather than rendered. */
const SAFE_URL = /^(https?:|mailto:)/i;

const OG_IMAGE_PATH = '/brand/zelarion-mark.png';

const STATUS_LABEL: Record<Project['status'], string> = {
  live: 'Live site',
  concept: 'Concept project',
};

function renderLink(href: string, text: string): string {
  if (!SAFE_URL.test(href)) {
    // Content error: stop the build instead of shipping an empty or dangerous link.
    throw new Error(`Refusing to render link "${text}": "${href}" is not an http(s) or mailto URL.`);
  }
  return `<a href="${escapeHtml(href)}" rel="noopener">${escapeHtml(text)}</a>`;
}

function renderMeta(attribute: 'name' | 'property', key: string, value: string): string {
  return `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`;
}

export function renderHeadTags(content: SiteContent): string {
  const { title, description, url } = content.seo;
  // Crawlers need an absolute image URL, which only exists once the domain is chosen.
  const image = url === null ? OG_IMAGE_PATH : new URL(OG_IMAGE_PATH, url).href;

  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    renderMeta('name', 'description', description),
    renderMeta('property', 'og:title', title),
    renderMeta('property', 'og:description', description),
    renderMeta('property', 'og:type', 'website'),
    renderMeta('property', 'og:image', image),
    // The mark is square, so the compact card; "summary_large_image" would crop it.
    renderMeta('name', 'twitter:card', 'summary'),
  ];
  if (url !== null) {
    tags.push(`<link rel="canonical" href="${escapeHtml(url)}" />`, renderMeta('property', 'og:url', url));
  }
  return tags.join('\n    ');
}

function renderHeading(level: 2 | 3, id: string, text: string): string {
  return `<h${level} id="${id}">${escapeHtml(text)}</h${level}>`;
}

function renderSection(id: string, heading: string, body: string[]): string {
  return [`<section aria-labelledby="${id}">`, renderHeading(2, id, heading), ...body, '</section>'].join('\n');
}

function renderProject(project: Project): string {
  // A project's sector can already say "Concept project"; show each label once.
  const meta = [...new Set([project.sector, STATUS_LABEL[project.status]])].map(escapeHtml).join(' / ');
  return [
    '<li><article>',
    `<h3>${escapeHtml(project.name)}</h3>`,
    `<p class="sc__meta">${meta}</p>`,
    `<p>${escapeHtml(project.summary)}</p>`,
    `<p>${renderLink(project.url, `Visit ${project.domain}`)}</p>`,
    '</article></li>',
  ].join('\n');
}

function renderLinkItem(link: LinkItem): string {
  // href null means "not published yet": say so in text, never leave a dead anchor.
  const body = link.href === null ? `${escapeHtml(link.label)} (coming soon)` : renderLink(link.href, link.label);
  return `<li>${body}</li>`;
}

export function renderStaticContent(content: SiteContent): string {
  const { person, manifesto, facts, projects, links, footer } = content;

  const header = [
    '<header>',
    `<h1>${escapeHtml(person.name)}</h1>`,
    `<p>${escapeHtml(person.role)} at ${renderLink(person.companyUrl, person.company)}</p>`,
    `<p>${escapeHtml(person.location)}</p>`,
    '</header>',
  ].join('\n');

  const about = renderSection('sc-about', 'About', manifesto.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`));

  const factList = [
    '<dl class="sc__facts">',
    ...facts.map((fact) => `<div><dt>${escapeHtml(fact.value)}</dt><dd>${escapeHtml(fact.label)}</dd></div>`),
    '</dl>',
  ].join('\n');
  const atAGlance = renderSection('sc-facts', 'At a glance', [factList]);

  const work = renderSection('sc-work', 'Selected work', ['<ol class="sc__projects">', ...projects.map(renderProject), '</ol>']);

  const elsewhere = renderSection('sc-links', 'Elsewhere', ['<ul>', ...links.map(renderLinkItem), '</ul>']);

  const closing = [
    '<footer>',
    renderHeading(2, 'sc-contact', footer.headline),
    `<p>${renderLink(`mailto:${person.email}`, person.email)}</p>`,
    `<p>Stack: ${footer.stack.map(escapeHtml).join(', ')}.</p>`,
    ...footer.credits.map((credit) => `<p>${escapeHtml(credit)}</p>`),
    '</footer>',
  ].join('\n');

  return ['<div class="sc__page">', header, about, atAGlance, work, elsewhere, closing, '</div>'].join('\n');
}
