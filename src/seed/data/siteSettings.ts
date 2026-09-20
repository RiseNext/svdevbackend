/**
 * `site-settings` seed — transcribed from `svfrontend/src/content/site.ts`
 * WITH EVERY BRACKETED PLACEHOLDER PRESERVED BYTE-FOR-BYTE.
 *
 * 🔴 THE BRACKETS ARE THE POINT, NOT A MISTAKE.
 *
 * `svfrontend/src/lib/href.ts` renders a bracketed destination INERT, so a
 * placeholder can never ship looking like a working link. Strip them to "tidy
 * up" and that guard stops firing — a live-looking dead link ships, which is
 * the exact failure the frontend was carefully built to prevent. The site is
 * `noindex` + `Disallow: /` BECAUSE of these values.
 *
 * Seeding them verbatim keeps the gap VISIBLE rather than leaving the global
 * empty and the public site 500-ing.
 *
 * ⚠️ TWO DELIBERATE DEVIATIONS FROM A LITERAL COPY:
 *
 * 1. `url` is `https://www.example.com` in the source — THE ONE UNBRACKETED
 *    PLACEHOLDER IN THE ENTIRE REPOSITORY. `isPlaceholder()` requires the whole
 *    string to start `[` and end `]`, so the inert-link guard NEVER FIRES on it,
 *    and it feeds `metadataBase`, all 12 sitemap URLs and `robots.txt`. It is
 *    seeded as a BRACKETED placeholder instead, so it behaves like every other
 *    unresolved value and cannot quietly ship as a real canonical.
 *
 * 2. `legal.copyright` is NOT seeded and is NOT a field. The source stores
 *    "© [YEAR] ${legalName}. All rights reserved." with [YEAR] embedded
 *    MID-STRING, so `isPlaceholder()` returns false and the literal text
 *    "© [YEAR] SV Developers." renders live in the footer TODAY. The serialiser
 *    COMPUTES `copyrightText` instead, which deletes the whole class of bug.
 */

export const seedSiteSettings = {
  name: 'SV Developers',
  legalName: 'SV Developers',
  tagline: 'Approved residential plots',
  description:
    'SV Developers builds gated, fully developed residential plot layouts with clear title, laid infrastructure and immediate registration.',
  // See deviation 1 above.
  url: '[SITE_URL]',
  email: '[EMAIL@DOMAIN]',
  phone: '[+91 00000 00000]',
  // Digits only, country code first.
  whatsapp: '[910000000000]',
  address: ['[BUILDING, STREET]', '[AREA, CITY]', '[STATE] — [PIN]'],
  mapUrl: '[GOOGLE_MAPS_URL]',
  officeHours: 'Site visits seven days a week, 9am – 7pm',

  social: [
    { label: 'Facebook', href: '[FACEBOOK_URL]', icon: 'facebook' as const },
    { label: 'Instagram', href: '[INSTAGRAM_URL]', icon: 'instagram' as const },
    { label: 'YouTube', href: '[YOUTUBE_URL]', icon: 'youtube' as const },
  ],

  legalLinks: [
    { label: 'Privacy policy', href: '[PRIVACY_URL]' },
    { label: 'Terms of use', href: '[TERMS_URL]' },
  ],

  // From `pages.ts:342-343`. ⚖️ This is the CONSENT ARTEFACT — it is rendered
  // next to the submit button and is the promise the business makes. Note it
  // still contains the literal token [LINK TO PRIVACY POLICY], rendered as
  // plain text, which is precisely the compliance gap OQ-24 names.
  formNote:
    'We will only use your number to talk to you about this project. [LINK TO PRIVACY POLICY]',

  cta: {
    title: 'Come and walk the layout',
    body: 'We will meet you at the gate any day of the week.',
  },

  // From `pages.ts:59-65`. ⚠️ `Hero.tsx:83` writes `item.icon as IconName` — a
  // TYPE ASSERTION, because the source ticker is an untyped `as const` literal.
  // It is the only icon-bearing list in the codebase that is NOT compile-time
  // validated, and once the data is fetched that cast becomes a lie TypeScript
  // will no longer catch. THE DATABASE ENUM IS WHAT ACTUALLY PROTECTS IT.
  heroTicker: [
    { icon: 'shield' as const, text: 'DTCP & RERA approved layouts' },
    { icon: 'document' as const, text: 'Clear title' },
    { icon: 'key' as const, text: 'Spot registration' },
    { icon: 'road' as const, text: 'Laid roads and drainage' },
    { icon: 'compass' as const, text: '100% Vaasthu planning' },
  ],
}
