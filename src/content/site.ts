// Every word on the site lives here. The 3D scene, the overlay UI and the static (no-WebGL,
// crawler and screen-reader) page all read this one object, so copy changes happen in one place.
//
// Sources: Vergel's resume, the Zelarion team page (zelarion.tech) and each project's live site.
// Rules that keep this file honest:
//   - Norvane Cold Systems is a fictional concept project; status 'concept' makes the UI label it.
//   - `placeholder: true` marks copy that is a stand-in until Vergel writes the real case study.
//   - A link with `href: null` is not published yet; the UI shows it as "soon", never a dead link.
import type { SiteContent } from '../contracts';

const GITHUB_PATH =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

export const SITE: SiteContent = {
  person: {
    name: 'Vergel A. Bautista',
    wordmark: ['VERGEL', 'BAUTISTA'],
    role: 'Co-founder & Chief Executive Officer',
    company: 'Zelarion',
    companyUrl: 'https://www.zelarion.tech/',
    location: 'Caloocan City, Metro Manila, PH',
    email: 'bautista.vergel.agripa@gmail.com',
  },
  manifesto: [
    'I build software that real people depend on, then I stay to keep it running.',
    'Co-founder and CEO of Zelarion, a software and design studio in the Philippines. A small team that uses AI as leverage, so we ship with the speed of a much larger one.',
  ],
  facts: [
    { value: '69,000+', label: 'residents served by a barangay portal' },
    { value: '7,000+', label: 'active members on a platform I rebuilt' },
    { value: '98%', label: 'fewer member-reported bugs after the rebuild' },
    { value: 'Full stack', label: 'requirements to deployment to retainer' },
    { value: 'PH + CA', label: 'clients in the Philippines and Canada' },
  ],
  scrollHint: 'Scroll down to discover.',
  projects: [
    {
      id: 'goldenstars',
      name: 'Goldenstars Packaging',
      domain: 'goldenstars.ph',
      url: 'https://www.goldenstars.ph/',
      sector: 'Corporate website',
      summary:
        'A company website for a Philippine packaging manufacturer: its story, certifications, the industries it serves and its product range, with a quote request on every page.',
      image: '/projects/goldenstars.webp',
      status: 'live',
      placeholder: true,
    },
    {
      id: 'yor-international',
      name: 'Yor International',
      domain: 'yorinternational.net',
      url: 'https://www.yorinternational.net/',
      sector: 'Brand site and member portal',
      summary:
        'The public site and member portal for a premium fragrance and wellness brand: products, packages and the business opportunity, with a portal login for members.',
      image: '/projects/yor-international.webp',
      status: 'live',
      placeholder: true,
    },
    {
      id: 'ascendrev',
      name: 'AscendRev',
      domain: 'ascend-rev.ca',
      url: 'https://ascend-rev.ca/',
      sector: 'B2B services website',
      summary:
        'The website for a Calgary-led outsourcing company that builds dedicated offshore sales and support teams, written to turn a visitor into a solution-blueprint request.',
      image: '/projects/ascendrev.webp',
      status: 'live',
      placeholder: true,
    },
    {
      id: 'zelarion',
      name: 'Zelarion',
      domain: 'zelarion.tech',
      url: 'https://www.zelarion.tech/',
      sector: 'Studio website',
      summary:
        'The home of our own studio. Custom systems and websites built around how a business actually works, with the portfolio, services and team in one place.',
      image: '/projects/zelarion.webp',
      status: 'live',
      placeholder: true,
    },
    {
      id: 'norvane',
      name: 'Norvane Cold Systems',
      domain: 'norvane-lyart.vercel.app',
      url: 'https://norvane-lyart.vercel.app/',
      sector: 'Concept project',
      summary:
        'A concept website for a fictional commercial-refrigeration company, built to show how we approach a multi-page B2B site. The company, its partners and its clients are invented.',
      image: '/projects/norvane.webp',
      status: 'concept',
      placeholder: true,
    },
    {
      id: 'drezivo',
      name: 'Drezivo',
      domain: 'drezivo.shop',
      url: 'https://drezivo.shop/',
      sector: 'Rental management software',
      summary:
        'Software for clothing rental shops: availability, reservations, deposits, payments and returns in one calm place, so the shop stops running on Messenger.',
      image: '/projects/drezivo.webp',
      status: 'live',
      placeholder: true,
    },
  ],
  links: [
    { id: 'zelarion', label: 'Zelarion', href: 'https://www.zelarion.tech/', shape: { kind: 'image', src: '/brand/zelarion-mark.png' } },
    { id: 'github', label: 'GitHub', href: 'https://github.com/vgl-spec', shape: { kind: 'path', d: GITHUB_PATH, viewBox: 24 } },
    { id: 'linkedin', label: 'LinkedIn', href: null, shape: { kind: 'text', text: 'in', weight: 800 } },
    { id: 'email', label: 'Email', href: 'mailto:bautista.vergel.agripa@gmail.com', shape: { kind: 'text', text: '@', weight: 700 } },
  ],
  footer: {
    headline: "Let's build what your business runs on.",
    stack: ['TypeScript', 'Next.js', 'React', 'Node.js', 'PostgreSQL', 'SQL Server', 'Flutter', 'ASP.NET', 'Linux VPS', 'Docker', 'NGINX'],
    credits: ['Designed and built by Vergel A. Bautista with three.js.', 'Experience inspired by the craft of abeto and Bureaux on igloo.inc.'],
  },
  seo: {
    title: 'Vergel A. Bautista | Co-founder & CEO, Zelarion',
    description:
      'Vergel A. Bautista is the co-founder and CEO of Zelarion, a software and design studio in the Philippines. Full-stack systems for government and business.',
    url: null,
  },
};
