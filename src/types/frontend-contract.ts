import type { IconName } from '@/components/ui/Icon';

export type NavLink = {
  label: string;
  href: string;
  children?: readonly NavLink[];
};

export type FeatureItem = {
  icon: IconName;
  title: string;
  body?: string;
};

export type ProximityItem = {
  icon: IconName;
  measure: string;
  place: string;
};

export type Testimonial = {
  id: string;
  name: string;
  role: string;
  rating: number;
  body: string;
};

export type ImageRef = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

/**
 * A reusable video asset, as published by the CMS.
 *
 * PLACEMENT IS NOT PART OF THIS CONTRACT, DELIBERATELY. The backend answers
 * only "which video is currently active"; where — and whether — it is rendered
 * is a decision this repository owns. The same value can back a full-bleed
 * hero today and a section band later with no CMS change.
 *
 * `poster` is an `ImageRef` rather than a bare URL for two reasons: it is an
 * ordinary image from the same media library as everything else, and carrying
 * its dimensions is what lets a call site use `next/image` without reflowing.
 * It is REQUIRED because a silent autoplaying video is not guaranteed to start
 * — iOS Low Power Mode, Data Saver and `prefers-reduced-motion` all refuse it —
 * and the poster is what the visitor sees when it does not.
 */
export type VideoRef = {
  src: string;
  mimeType: string;
  poster: ImageRef;
};

export type ProjectStatus = 'Open for booking' | 'Nearing sell-out' | 'Completed' | 'Coming soon';

/** The four catalogue categories. A project carries one only when the
 *  brochure supports it — see the note at the top of content/projects.ts. */
export type ProjectCategory =
  | 'Premium Villa Plots'
  | 'Farm Villa Plots'
  | 'Residential Plots'
  | 'Apartments';

/**
 * One project record. `content/projects.ts` is the single source of truth:
 * the cards, the catalogue, the detail route, the homepage and the sitemap
 * all read from it, and adding an object here is enough to publish a project.
 *
 * Required fields are the ones every brochure supplies. EVERYTHING ELSE IS
 * OPTIONAL BY DESIGN — a project with no location map simply omits the field
 * and the detail template drops that section, rather than rendering an empty
 * shell or inviting invented filler. Do not add a field to make a section
 * look complete.
 */
export type Project = {
  slug: string;
  name: string;
  /** Catalogue category, shown on the card badge. */
  category: ProjectCategory;
  /** Sales status. Optional: no brochure states one, so none is claimed. */
  status?: ProjectStatus;
  /** Place as written on the brochure, e.g. 'Gummadavelli, Jeedikal, Aler'. */
  locality: string;
  /** Set ONLY when the developer differs from `site.name`, so the catalogue
   *  can attribute it separately instead of silently absorbing it. */
  developer?: string;
  /** Short positioning line lifted from the brochure cover. */
  tagline?: string;
  summary: string;
  description: readonly string[];
  stats?: readonly { label: string; value: string }[];
  highlights: readonly FeatureItem[];
  /** Infrastructure and on-site facilities, kept separate from positioning. */
  amenities?: readonly FeatureItem[];
  /** Title, approval and registration assurances. */
  approvals?: readonly FeatureItem[];
  /** Named surroundings. No distance is implied — see `proximity`. */
  locationHighlights?: readonly FeatureItem[];
  /** Distance/drive-time claims. Populate ONLY from figures printed on the
   *  brochure; an unmeasured proximity claim is the one most likely to be
   *  challenged on a land page. */
  proximity?: readonly ProximityItem[];
  /** Total extent exactly as printed, e.g. '6 Acres 22.50 Guntas'. */
  area?: string;
  /** Road widths and surfacing as printed, e.g. "60' & 30' wide BT roads". */
  roadDetails?: string;
  /** Card and hero image. */
  image: ImageRef;
  /** Site photography, plantation and cottage shots. */
  gallery?: readonly ImageRef[];
  /** Plot layout / master plan. Rendered contained and zoomable, never cropped. */
  layoutImage?: ImageRef;
  /** Location map from the brochure. Rendered contained, never cropped. */
  locationMap?: ImageRef;
  /** Scanned brochure pages, offered as supporting documents. */
  brochureImages?: readonly ImageRef[];
  /** Downloadable brochure PDF, when the project has one attached. `href` is an
   *  absolute CDN URL, so it is rendered as an external download rather than a
   *  route. Distinct from `brochureImages`, which is page SCANS. */
  brochure?: { title: string; href: string };
  /** Overrides the shared CTA banner copy for this project. */
  cta?: { title: string; description: string };
  /** Overrides the generated SEO title/description. */
  seo?: { title?: string; description?: string };
  /** Surfaced in the homepage Featured Projects section. */
  featured?: boolean;
};
