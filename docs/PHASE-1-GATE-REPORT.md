# PHASE-1-GATE-REPORT.md — the D-015 validation gate

> **Executed:** 20 September 2026, during the master implementation run.
> **Subject:** whether Payload CMS 3 on PostgreSQL can express the full `Project`
> model and emit the exact documented public contract.
> **Method:** measured against a real PostgreSQL 15 database with the five real
> project records seeded. Every value below was OBSERVED, not asserted.
>
> ## VERDICT: **D-015 CONFIRMED.** The Directus fallback is NOT triggered.

---

## 1. How this differed from the plan, and why

`MASTER-IMPLEMENTATION-PLAN.md` §29 Phase 1 specifies a throwaway spike in a temp
directory, deleted at step 49. This run executed every gate criterion against the
real `svbackend` foundation instead, under the conditions recorded in **D-116**:

1. **No migration was created until the schema facts were measured.** The sandbox
   ran on Drizzle `push` throughout. The irreversibility the throwaway protects
   against was therefore still protected against.
2. This report was written before any phase beyond 4 proceeded.
3. A gate failure would have been reported as a failure and stopped backend
   expansion. Two genuine defects *were* found and are recorded in §5 — neither
   voids D-015, and both are fixed.

---

## 2. Environment

| | |
|---|---|
| Node | v24.11.0 |
| npm | 11.6.1 |
| PostgreSQL | 15-alpine, in Docker (`psql` is absent from PATH; all client tooling goes through `docker exec`) |
| `payload` | **3.90.1** (npm `latest`, verified live) |
| `@payloadcms/next` | 3.90.1 — published peer range `>=15.2.9 <15.3.0 \|\| >=15.3.9 <15.4.0 \|\| >=15.4.11 <15.5.0 \|\| >=16.3.3 <17.0.0`, **confirming the plan's §3.3 claim verbatim** |
| `next` | **16.3.3** exact · `react`/`react-dom` **19.2.6** exact |
| Dependency discipline | `npm ls react` → exactly one copy, deduped. Every `@payloadcms/*` at 3.90.1. |

---

## 3. The gate criteria

### GATE #1 — the full `Project` model is representable ✅ PASS

All 25 contract fields exist and round-trip. The collection generates **50
physical Postgres tables** across the whole application — inside the predicted
40–60 band, and confirming that `AI-CONTEXT.md`'s "15 core tables … do not add
tables" rule had to be amended to "15 core **logical entities**" (D-120).

### GATE #2 — `description` round-trips as `string[]` ✅ PASS

This is the criterion that, failing, would have voided D-015.

**Storage, measured from `src/payload-generated.schema.ts`:**

```
projects_texts
  id       serial PRIMARY KEY
  order    integer NOT NULL          <- ORDER IS EXPLICITLY PRESERVED
  parent   uuid NOT NULL             -> projects.id ON DELETE CASCADE
  path     varchar NOT NULL          <- discriminates which hasMany-text field
  text     varchar
  INDEX projects_texts_order_parent (order, parent)
```

`text` + `hasMany: true` is stored in a shared **child table**, not `text[]` and
not JSON. The plan listed all three as possible and unverified.

**Type layer** — `src/payload-types.ts` emits `description: string[]`.

**Runtime layer** — measured:

```
Array.isArray(description)      : true
every element typeof === string : true
has .value property?            : false      <- NOT [{id, value}]
unique (React key safety)       : true
```

**HTTP layer** — `GET /api/v1/projects/siri-vanam-gummadavelli` returns:

```json
"description": [
  "Siri Vanam is a farm villa plot development at Gummadavelli, Jeedikal, near Aler.",
  "The brochure features the plantation of mahogany and mango trees across the layout, the cottage built on site, and spot registration."
]
```

**The array fallback was not needed.** The serialiser is an identity
pass-through, as designed.

### GATE #3 — absent optional fields are ABSENT ✅ PASS

The thin record (`siri-vanam-gummadavelli`) over HTTP:

```
EXACT KEY SET: [category, description, featured, highlights, image,
                locality, name, slug, summary, tagline]
```

Ten keys — exactly the set the plan specifies. **Leaked keys: NONE.**
Tested with `k in data`, not `=== undefined`.

Absent and correctly omitted: `status`, `developer`, `stats`, `amenities`,
`approvals`, `locationHighlights`, `proximity`, `area`, `roadDetails`,
`gallery`, `layoutImage`, `locationMap`, `cta`, `seo`.

Stripped internals: `id`, `_status`, `_order`, `publishedAt`, `deletedAt`,
`createdAt`, `updatedAt`, `projectStatus`.

**Array rows carrying an `id`: NONE.** Confirmed necessary — the measured schema
shows array rows DO carry `id varchar PRIMARY KEY` and `_order integer`, so the
serialiser strip is load-bearing rather than theoretical.

`ImageRef` key set: exactly `[alt, height, src, width]`, with `width`/`height`
as numbers.

### GATE #4 — the response satisfies the real `Project` type ✅ PASS

`src/types/frontend-contract.ts` is a **byte-identical** copy of
`svfrontend/src/types/content.ts` (3 720 bytes, verified). `tsc --noEmit` passes
under `strict: true`. **No `null` appears where the contract declares
`T | undefined`.**

### GATE #5 — an invalid icon is rejected at the API *and* the database ✅ PASS

`enumName: 'enum_icon_name'` materialises a **real Postgres enum type**, which is
stronger than the CHECK constraint D-007 planned — that planned migration is
therefore unnecessary.

**Resolves an explicitly unverified question:** the plan asked whether Payload
deduplicates an identical `enumName` across fields into a single PG type, and
warned to expect six. **Measured: `enum_icon_name` is emitted EXACTLY ONCE**
despite the icon field appearing on six project arrays plus `site-settings.social`
plus `heroTicker`, and again on every `_v` table. **Payload does deduplicate.**

### GATE #6 — the admin editor is usable with zero custom components ✅ PASS

`/admin` returns 200. All 25 fields, 6 repeatable lists and 4 media pickers
render from configuration. Three tiny `RowLabel` components were added so rows
read as their titles rather than "Item 03" — ergonomics, not a gate dependency.

### GATE #7 — seeded records match `projects.ts` ✅ PASS

Five projects seeded. Spot-checked byte-for-byte:

```
raw bytes around the dash : b' \xe2\x80\x94 pr'
expected em-dash UTF-8    : b'\xe2\x80\x94'
round-trips to frontend   : True
```

`[BRACKETED]` placeholders preserved verbatim through the full round trip:
`"[EMAIL@DOMAIN]"`, `"[910000000000]"`, `["[BUILDING, STREET]", "[AREA, CITY]", "[STATE] — [PIN]"]`.

**Idempotency:** the seed was run twice. Result: **5 projects, 5 media, 2 users** — not 10.

### GATE #8 — ordering ✅ PASS, and the unresolved fact is now MEASURED

The plan flagged this as *"the one unresolved fact"*: the name of the column
`orderable: true` creates was not documented, and therefore neither was how to
sort a public query by it.

**Measured:**

```
projects._order   varchar("_order")
INDEX projects__order_idx ON (_order)
```

It is a **fractional-index string**, which is why a plain lexicographic `sort`
reproduces drag order exactly. `payload.find({ sort: '_order' })` returns the
five projects in admin order. `_order` is never exposed publicly.

**D-121 / OQ-29 is closed on measured evidence.** No derived integer mirror was
built — that would have created a second source of truth that drifts the moment
anyone reorders through the API rather than the UI.

---

## 4. Other facts measured that the plan listed as unverified

| Question | Measured answer |
|---|---|
| Array rows: do they carry `id` and `_order`? | **Yes, both.** `id varchar PRIMARY KEY`, `_order integer NOT NULL` |
| Do named groups flatten into prefixed columns? | **Yes** — `cta_title`, `cta_description`, `seo_title`, `seo_description` |
| Is `_status` indexed? | **Yes, automatically** — `projects__status_idx`. The plan said to add it manually; unnecessary |
| `createdAt`/`updatedAt` column type | **`timestamp(3) with time zone`** = `timestamptz`, and indexed by default |
| UUID version | `uuid DEFAULT gen_random_uuid()` — **v4**, a native `uuid` column, not `varchar` |
| Upload relations in `_rels`? | **Only `hasMany` ones.** Single-valued uploads are **direct FK columns** (`image_id`, `layout_image_id`, `location_map_id`) — a correction to the plan's §16.3 |
| Referential integrity for uploads | **It exists, and it is `ON DELETE SET NULL`** on the direct FK columns, `ON DELETE CASCADE` on `_rels` and array child tables. The plan said Payload documents none — it *documents* none, but it *generates* them, and `SET NULL` on a REQUIRED `image` is the dangerous variant. This makes the media delete guard load-bearing, not merely prudent |
| Does `useSessions` add a table? | **Yes** — `users_sessions`. Not "a field on the user document" |
| Payload-internal tables | `payload_migrations`, `payload_preferences(+_rels)`, `payload_locked_documents(+_rels)`, `payload_jobs`, `payload_jobs_log`, and **`payload_kv`** — the last appears in nobody's count |
| Are completed jobs retained? | **NO — deleted by default.** See §5 defect 3 |

---

## 5. Defects found by the gate, and fixed

The gate did its job: three real defects were caught that would each have shipped
silently.

### Defect 1 — `req.data` mutation in `beforeOperation` does not persist

`originalFilename` came back `null` on every seeded asset while the upload guard
was plainly running (the UUID rename, which mutates `req.file`, worked).

**Cause:** `req.file` is the live object the upload pipeline consumes, so
mutations to it take effect; `req.data` is not that object for an upload create.

**Fix:** the guard stashes its values on `context`; a separate `beforeChange`
hook writes them onto the document.

### Defect 2 — 🔴 `media.access.read: isAdmin` silently breaks every public image

The plan specifies `read: isAdmin` on `media`, reasoning that "the FILES are
public via the CDN; the DOCUMENTS are not."

**Measured with `overrideAccess: false, user: undefined`** — which every public
read uses by construction:

```
anon + depth:1 + select   ->  BARE ID STRING
anon direct media read    ->  THREW "You are not allowed to perform this action."
```

**Payload does not throw and does not return null — it silently degrades the
populated relation to an id.** Had `toImageRef()` not thrown
`UnpopulatedUploadError`, every project would have shipped
`{ src: '', alt: '', width: 0, height: 0 }`: every image broken site-wide, the
CLS budget (< 0.05) blown, and **no error anywhere**.

**Fix:** `media.access.read` and `documents.access.read` are `anyone`, with the
genuinely internal fields (`uploadedBy`, `originalFilename`,
`supersededFilenames`) locked by **field-level** `read` access. All three public-read
layers remain intact; nothing that was actually protected was given away — the
file is served from a public CDN under a UUID key, and its URL is public by
construction.

### Defect 3 — `_status: 'draft'` in `data` does NOT select the draft path

Creating a project with `_status: 'draft'` in `data` still ran **full
validation** and was rejected by the required `image` upload.

`draft: true` must be passed as an **operation argument**.
`versions.drafts.validate: false` governs the draft *operation*, not the value of
the status field.

This matters beyond the probe: it is exactly the mechanism the plan's §17.4
stage-1 "seed with no media" strategy depends on, so the seed would have failed
on a media-less run. Both the seed and the probe now pass `draft: true`.

### Defect 4 — completed jobs are deleted by default

The plan says to leave `jobs.deleteJobOnComplete` unset "because we WANT
retention — a successfully sent lead notification is an operational record", and
notes the option appears nowhere in the live docs.

**Measured: leaving it unset produces the OPPOSITE.** Completed
`sendLeadNotification` rows vanished from `payload_jobs` while
`leads.notifiedAt` was correctly stamped. `deleteJobOnComplete: false` is
accepted and now set explicitly. (The watchdog was unaffected either way — a
failed job is not complete, so `hasError: true` rows are retained regardless.)

---

## 6. Security assertions, measured

| Assertion | Result |
|---|---|
| A never-published project returns **404, not 403** | ✅ (403 would confirm existence) |
| `?draft=true` cannot surface a draft | ✅ 404 |
| `?where[_status][equals]=draft` returns no draft data | ✅ |
| A draft is absent from the public list | ✅ |
| **No public route returns lead data in any shape** (T-135) | ✅ across 13 routes, canary name and phone, including Payload's own `/payload-api/leads`, `/users`, `/audit-log`, `/projects/versions` |
| Anonymous Local API `leads.find` | ✅ throws |
| `GET /payload-api/graphql` and `/graphql-playground` | ✅ 404 — the route files are not present at all, so the 404 is structural |
| Source spoofing: POST `"source":"whatsapp"` | ✅ stored as `contact_form` |
| Honeypot response | ✅ byte-identical 201, **0 rows stored** |
| Windowed dedupe | ✅ second submission returns 201, still 1 row |
| ETag / 304 | ✅ `public, max-age=60, stale-while-revalidate=600` + 304 on `If-None-Match` |
| Security headers on `/admin` | ✅ CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Error envelope | ✅ opaque message + `requestId`, **no stack, SQL, file path or driver string** |

---

## 7. Verdict

Every exit criterion passes. The four criteria capable of voiding D-015 — the
full model (#1), `description` as `string[]` (#2), the type contract (#4), and
the icon enum at the database (#5) — pass on measured evidence.

**D-015 CONFIRMED. Payload CMS 3 on PostgreSQL is the architecture. Directus is
not triggered and should not be reopened.**

The gate's real value was not the verdict: it was defects 2 and 3, both of which
were **silent**, and defect 2 of which would have broken every image on the
public website with no error in any log.
