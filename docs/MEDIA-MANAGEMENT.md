# MEDIA-MANAGEMENT.md

> ### ⚠️ D-015 reconciliation banner — 20 Sep 2026
>
> Storage/validation **intent is unchanged**; the structure is corrected.
>
> | This document says | Corrected |
> |---|---|
> | **7 media roles** | The DB/API contract defines **5** (`cover`, `gallery`, `layout`, `location_map`, `brochure`). The site-level `document` role had no table, column or endpoint — it is now a **`documents` upload collection** (D-032), which closes the master-plan-PDF gap |
> | One `media_assets` table + a `project_media` join | **Two upload collections** — `media` (images) and `documents` (PDFs). `project_media` is **not built**; roles are named `upload` fields on `Project` (D-032) |
> | §11 migration uploads the existing **SVG** placeholders | 🔴 **Contradiction.** §6 and `SECURITY.md` §10 reject SVG **always**, and `image/svg+xml` is not in the MIME allow-list. The documented migration cannot run through the documented endpoint. Resolution in plan §8: the seed **stores path strings and uploads nothing**; SVG placeholders are never ingested |
> | Provider choice open (OQ-7) | ✅ **CLOSED 20 Sep 2026 — Cloudinary** (owner decision, D-123). See §5 |
>
> Payload validates the **declared** MIME type only — magic-byte sniffing is our code.
>
> **Authoritative for execution:** [`MASTER-IMPLEMENTATION-PLAN.md`](./MASTER-IMPLEMENTATION-PLAN.md) · Correction detail: [`DOCUMENTATION-CORRECTIONS.md`](./DOCUMENTATION-CORRECTIONS.md)

---

Requirements for storing, serving and managing images and documents. **Provider choice is deliberately left open — OQ-7.**

---

## 1. What the frontend actually does today

| Asset | Location | Current state |
|---|---|---|
| Project cover ×5 | `public/images/projects/*.svg` | **Generated placeholder title cards.** No real photography |
| Master plan | `public/images/master-plan.svg` | Placeholder |
| Plot sizes | `public/images/plot-sizes.svg` | Placeholder |
| Location thumb | `public/images/location-thumb.svg` | Placeholder |
| Logo | `public/images/logo/sv-developers-mark.jpg` | **Real asset.** Opaque JPEG, 146 KB, **duplicated** (the original WhatsApp export sits beside it) |
| `hero.svg`, `hero-portrait.svg` | referenced in `pages.ts:19,24` | **Files do not exist.** Dead keys — nothing renders them |
| Master-plan PDF | `pages.ts:254` | `[MASTER_PLAN_PDF_URL]` — never uploaded |
| Gallery, layout plans, location maps, brochures | `types/content.ts:92-98` | **Fields exist; no project populates them** |

**All images are served from `public/` and rendered through `next/image`.** There is no upload path of any kind.

## 2. Hard constraints inherited from the frontend

These are not preferences — violating them breaks the site.

| Constraint | Source | Consequence if broken |
|---|---|---|
| **Every image needs `width` + `height`** | `ImageRef` in `types/content.ts:29-34` | CLS budget < 0.05 fails; layout shifts on load |
| **Every image needs `alt`** | Same type; a11y work | AA compliance breaks |
| **Only quality 75 and 90** | `next.config.mjs:14` | Next 16 makes undeclared qualities a hard error |
| **AVIF/WebP output** | `next.config.mjs:11` | — |
| Layout plans and maps rendered **contained, never cropped** | `Media.tsx` `Plate`, `Lightbox` | Plot numbering — the content — becomes unreadable |
| Covers rendered **cropped** to ratio | `Frame`, `ProjectCard` (4:3) | — |
| `dangerouslyAllowSVG` is **temporary** | `next.config.mjs:19-21` | Must be removed once real raster art lands |

> **`dangerouslyAllowSVG` is on only because the placeholders are SVG.** SVG can carry script; it is currently neutralised by a CSP (`script-src 'none'; sandbox`). **The CMS must not accept SVG uploads** — an admin-uploaded SVG is a stored-XSS vector that the placeholder-only rationale does not cover.

## 3. Required capabilities

| ID | Capability |
|---|---|
| FR-MEDIA-01 | Admin uploads images |
| FR-MEDIA-02 | Server validates type, size, magic bytes |
| FR-MEDIA-03 | Dimensions + metadata extracted **server-side** |
| FR-MEDIA-04 | Alt text required before public attachment |
| FR-MEDIA-05 | Attach to a project by role |
| FR-MEDIA-06 | Ordered collections |
| FR-MEDIA-07 | Replace in place |
| FR-MEDIA-08 | Delete, guarded against in-use |
| FR-MEDIA-09 | Stable public URLs for `next/image` |
| FR-MEDIA-10 | Documents (PDF) |
| FR-MEDIA-11 | Orphan detection |
| FR-MEDIA-12 | **No public upload endpoint** |
| FR-MEDIA-13 | Replaceable logo |

## 4. Media roles

| Role | Cardinality | Rendering | Required |
|---|---|---|---|
| `cover` | **1** | Cropped 4:3 card, 16:9 hero | **Yes** |
| `gallery` | 0..n ordered | Cropped 4:3 grid | No |
| `layout` | 0..1 | **Contained**, zoomable lightbox | No |
| `location_map` | 0..1 | **Contained** | No |
| `brochure` | 0..n ordered | Supporting documents | No |
| `logo` | 0..1 (site) | Circular badge | No |
| `document` | 0..n (site) | Download link | No |

Single-valued roles enforced by a partial unique index (`DATABASE-SCHEMA.md` §8).

## 5. Storage — ✅ **DECIDED: Cloudinary** (owner, 20 Sep 2026 · D-123)

> The options table that stood here recommended S3-compatible storage and listed Cloudinary under *"Managed media provider"* with the note "duplicates what `next/image` already does; vendor lock-in". **The owner chose Cloudinary.** That recommendation is superseded; the observation behind it is not, and is recorded below so nobody re-litigates it from memory.

| | |
|---|---|
| **Production** | Cloudinary. `CLOUDINARY_CLOUD_NAME` is the enable switch |
| **Local development** | Nothing to run. Leave the Cloudinary variables empty and uploads fall back to local disk at `svbackend/media/` |
| **Implementation** | `src/media/cloudinary.ts` — a hand-written adapter on `@payloadcms/plugin-cloud-storage`. **Payload publishes no Cloudinary adapter**, and Cloudinary exposes no S3-compatible endpoint, so `@payloadcms/storage-s3` could not be repointed and was removed |
| **Configuration** | [`PRODUCTION-CONFIG.md`](./PRODUCTION-CONFIG.md) §3 — storage layout, the image/raw split, and the account checklist |

**What the earlier recommendation got right, and which still applies:** the frontend optimises through `next/image`, so **no Cloudinary transformation is used**. The adapter stores and serves original bytes and nothing else. That keeps the lock-in to a key prefix and a hostname — the same surface an S3 bucket would have had — and it is why moving away later would be a re-upload, not a rewrite.

**What changed as a result:** no MinIO service in `docker-compose.yml`, no bucket to provision, no CDN to put in front, and **no `media.<domain>` DNS record** (D-125).

## 6. Upload validation — FR-MEDIA-02

**Every check server-side. Client-side checks are UX only.**

| Check | Rule |
|---|---|
| **Extension allow-list** | `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif` (images) · `.pdf` (documents) |
| **MIME allow-list** | `image/jpeg`, `image/png`, `image/webp`, `image/avif` · `application/pdf` |
| **Magic bytes** | Sniff actual content. **A `.jpg` extension proves nothing** |
| **SVG** | ❌ **Rejected.** Script-carrying vector — stored-XSS risk |
| **Max size** | Images 10 MB · PDF 25 MB. `413` on exceed |
| **Max dimensions** | Reject > 10000 px on a side (decompression-bomb guard) |
| **Min dimensions** | Warn below 1200 px wide for a cover (it renders at 1200×800) |
| **Content-Type header** | Must match; `415` otherwise |
| **Strip EXIF** | Removes GPS and camera metadata — a site photo can leak coordinates |
| **Re-encode images** | Recommended: decode and re-encode to drop embedded payloads entirely |

## 7. Filename and path handling

**Never use the uploaded filename as the storage key.** The repo already contains a cautionary example: `WhatsApp Image 2026-09-15 at 11.27.17 AM.jpeg` — spaces, colons, mixed case.

```
Stored key:  media/{yyyy}/{mm}/{uuid}.{ext}
Original:    kept in media_assets.original_filename for display only
```

This prevents path traversal, collisions, case-sensitivity bugs across platforms, and URL-encoding problems.

## 8. Serving

Public URL must be stable and CDN-cacheable. Because the key contains a UUID, content is immutable → `Cache-Control: public, max-age=31536000, immutable`.

> **Under Cloudinary (D-123) the URL is** `<base>/image/upload/media/<uuid>.<ext>` for images and `<base>/raw/upload/documents/<uuid>.pdf` for PDFs, with **no version component** — Cloudinary's docs make the version optional and needed only on overwrite, and this system never overwrites. The cache policy is Cloudinary's; the immutability that makes a long max-age safe is ours, and rests on the UUID key. Composition lives in **one** function, `cloudinaryFileUrl()`, called by both the storage adapter and the public serialiser so the stored URL and the emitted `ImageRef.src` cannot drift.

**Replace (FR-MEDIA-07) writes a NEW key and updates `public_url`**, rather than overwriting — otherwise CDN caches serve the old bytes for a year. The attachment rows keep pointing at the same `media_asset` record, so nothing breaks.

If the storage bucket is private, serve through a backend proxy or signed URLs — but **public marketing images should simply be public**; signing them adds latency and breaks `next/image` caching for no security gain.

## 9. Deletion and orphans

**Two-stage, guarded:**

1. `DELETE /admin/media/{id}` → `409` if attached anywhere, listing what uses it (FR-MEDIA-08). `?force=true` detaches then deletes.
2. On confirm → soft delete (`deleted_at`), immediately hidden from the library.
3. A **sweeper** removes the storage object after a grace period (e.g. 30 days), so an accidental delete is recoverable.

**Orphan detection (FR-MEDIA-11):** assets with no `project_media` row and not referenced by `site_settings` or `testimonials`. Surfaced as an "unused" filter, **never auto-deleted** — an asset may be staged before attachment.

**FK is `ON DELETE RESTRICT`** from `project_media` → `media_assets`: the database refuses to orphan a live page.

## 10. Security

- **No public upload endpoint** (FR-MEDIA-12). Uploads require a session.
- Rate-limit uploads per session.
- Serve from a **separate origin/subdomain** so uploaded content cannot script against the app origin. ✅ **Satisfied, and more strongly than planned**: Cloudinary's delivery host is a different *registrable domain*, not a sibling subdomain.
- `X-Content-Type-Options: nosniff` on all media responses.
- ⚠️ `Content-Disposition: attachment` for PDFs — **NOT SATISFIED under Cloudinary, and not claimed.** This was an S3 bucket-policy line; Cloudinary sets its own delivery headers for `raw` assets and they are not configurable per object from here. The separate-origin control above is what the requirement was defending, and it holds. Recorded in D-123 rather than quietly dropped.
- Never echo absolute filesystem paths, bucket names or cloud names in errors.

## 11. Migration of existing assets

1. Upload the 5 project SVGs → attach as `cover` **so nothing renders blank** during cutover.
2. Upload the logo (deduplicated, ideally converted to SVG/transparent PNG first).
3. Upload `master-plan.svg`, `plot-sizes.svg`, `location-thumb.svg` as site assets.
4. **Do not migrate `hero.svg` / `hero-portrait.svg`** — the files do not exist and nothing references them. Delete the dead keys from `pages.ts` during frontend integration.
5. Once real raster photography replaces every SVG, **remove `dangerouslyAllowSVG` from `next.config.mjs`** (3 lines) and reject SVG permanently.

## 12. Open questions

| ID | Question |
|---|---|
| ~~OQ-7~~ | ~~Which storage provider?~~ ✅ **RESOLVED 20 Sep 2026 — Cloudinary (D-123)** |
| OQ-16 | Does the backend generate responsive variants, or is `next/image` alone sufficient? *(Recommendation: `next/image` alone — and this is now settled in practice: no Cloudinary transformation is used.)* |
| OQ-17 | Retention for replaced/deleted assets — is 30 days right? |
| OQ-18 | Should brochure PDFs be public, or gated behind a lead capture? *(Currently public via the Lightbox download button.)* |
