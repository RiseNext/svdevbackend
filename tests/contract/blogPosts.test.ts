import { beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import { getTestPayload } from '../setup'
import { resetTestDatabase } from '../resetDb'
import { publicFind, publicFindOne } from '@/lib/publicFind'
import {
  PUBLIC_BLOG_POST_CARD_SELECT,
  PUBLIC_BLOG_POST_SELECT,
  toPublicBlogPost,
  toPublicBlogPostCard,
} from '@/serializers/toPublicBlogPost'

/**
 * `blog-posts` — THE CONTRACT TESTS.
 *
 * 🔴 EVERY ASSERTION BELOW TRACES TO A LINE IN THE FRONTEND, which wrote this
 * contract BEFORE the endpoint existed: `svfrontend/src/types/blog.ts` and
 * `svfrontend/src/lib/api/blog.ts`. Where a comment anywhere disagrees with
 * those two files, they win — and `check:drift` now byte-compares the first of
 * them against `src/types/frontend-contract-blog.ts`, so it cannot drift
 * silently.
 *
 * 🔴 WHY `tests/contract/` AND NOT `tests/integration/`. `package.json` has
 * carried a `test:contract` script pointing at this directory since before it
 * existed, so the script has never run. These are genuinely contract tests —
 * they assert the SHAPE the other repository consumes rather than internal
 * behaviour — so creating the directory the script already named is the fix.
 */

let payload: Payload

const CTX = { skipAudit: true, skipRevalidate: true }

let coverId: string

const jpegBytes = async (w: number, h: number): Promise<Buffer> => {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 30, g: 70, b: 40 } },
  })
    .jpeg()
    .toBuffer()
}

/** The minimum a post needs to PUBLISH: the three required fields + content. */
const article = (slug: string, publishedAt: string, extra: Record<string, unknown> = {}) => ({
  slug,
  title: `Post ${slug}`,
  excerpt: 'A summary written by hand, not a truncated paragraph.',
  publishedAt,
  body: [`First paragraph of ${slug}.`, `Second paragraph of ${slug}.`],
  ...extra,
})

const create = async (data: Record<string, unknown>, status: 'draft' | 'published') =>
  payload.create({
    collection: 'blog-posts',
    overrideAccess: true,
    data: { ...data, _status: status } as never,
    context: CTX,
  })

beforeAll(async () => {
  payload = await getTestPayload()
  await resetTestDatabase(payload)

  coverId = (
    await payload.create({
      collection: 'media',
      overrideAccess: true,
      file: {
        data: await jpegBytes(1600, 900),
        name: 'cover.jpg',
        mimetype: 'image/jpeg',
        size: 1,
      },
      data: { alt: 'A cover photograph' },
      context: CTX,
    })
  ).id as string
})

// ---------------------------------------------------------------------------
describe('the empty collection', () => {
  it('returns an EMPTY LIST, not a 404 — the frontend fallback depends on it', async () => {
    const result = await publicFind({
      collection: 'blog-posts',
      select: PUBLIC_BLOG_POST_CARD_SELECT,
      sort: '-publishedAt',
      depth: 1,
    })
    // `getBlogPosts()` sets `fallback: []`, which exists so a missing endpoint
    // cannot fail the production build. A published-but-empty blog must be
    // distinguishable from an outage, so it is a 200 with an empty array.
    expect(result.docs).toEqual([])
  })

  it('returns null for any slug, which the route turns into 404 and never 403', async () => {
    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'nothing-here' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    expect(doc).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('published-only, and ordered newest first', () => {
  beforeAll(async () => {
    // Deliberately created OUT of date order, so a passing sort cannot be
    // insertion order wearing a disguise.
    await create(article('middle-post', '2026-06-15'), 'published')
    await create(article('oldest-post', '2026-01-02'), 'published')
    await create(article('newest-post', '2026-10-09'), 'published')
    await create(article('a-draft-post', '2026-12-01'), 'draft')
  })

  it('EXCLUDES drafts from the public list', async () => {
    const result = await publicFind({
      collection: 'blog-posts',
      select: PUBLIC_BLOG_POST_CARD_SELECT,
      sort: '-publishedAt',
      depth: 1,
    })
    const slugs = result.docs.map((d) => (d as { slug: string }).slug)
    expect(slugs).not.toContain('a-draft-post')
    expect(slugs).toHaveLength(3)
  })

  it('orders NEWEST FIRST — the frontend does not sort, so this IS the page order', async () => {
    const result = await publicFind({
      collection: 'blog-posts',
      select: PUBLIC_BLOG_POST_CARD_SELECT,
      sort: '-publishedAt',
      depth: 1,
    })
    expect(result.docs.map((d) => (d as { slug: string }).slug)).toEqual([
      'newest-post',
      'middle-post',
      'oldest-post',
    ])
  })

  it('returns a DRAFT as null from the detail read — 404, never 403', async () => {
    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'a-draft-post' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    // A 403 would confirm the draft exists. Returning null is what lets the
    // route answer 404 for "unpublished" and "never existed" identically.
    expect(doc).toBeNull()
  })

  it('returns an ARCHIVED (trashed) post as null too', async () => {
    const created = await create(article('to-be-archived', '2026-05-05'), 'published')
    // Soft delete — `trash: true` on the collection.
    await payload.delete({
      collection: 'blog-posts',
      id: created.id,
      overrideAccess: true,
      context: CTX,
    })

    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'to-be-archived' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    expect(doc).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('the LIST shape never contains `body`', () => {
  it('omits `body` from the card payload', async () => {
    const result = await publicFind({
      collection: 'blog-posts',
      select: PUBLIC_BLOG_POST_CARD_SELECT,
      sort: '-publishedAt',
      depth: 1,
    })
    const card = toPublicBlogPostCard(result.docs[0] as never)
    // Not merely absent from the serialiser — never SELECTED, so the paragraphs
    // are not read out of Postgres for the index at all.
    expect('body' in card).toBe(false)
  })

  it('does not even name `body` in the card SELECT', () => {
    expect('body' in PUBLIC_BLOG_POST_CARD_SELECT).toBe(false)
    // And the detail select is the card select PLUS body — not a third object
    // that could drift from it.
    expect('body' in PUBLIC_BLOG_POST_SELECT).toBe(true)
  })

  it('carries exactly the four required card fields and nothing invented', async () => {
    const result = await publicFind({
      collection: 'blog-posts',
      where: { slug: { equals: 'newest-post' } },
      select: PUBLIC_BLOG_POST_CARD_SELECT,
      depth: 1,
    })
    const card = toPublicBlogPostCard(result.docs[0] as never)
    expect(Object.keys(card).sort()).toEqual(['excerpt', 'publishedAt', 'slug', 'title'])
  })
})

// ---------------------------------------------------------------------------
describe('the DETAIL shape', () => {
  it('returns `body` as an array of plain paragraph STRINGS', async () => {
    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'newest-post' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    const post = toPublicBlogPost(doc as never)

    expect(Array.isArray(post.body)).toBe(true)
    expect(post.body).toEqual([
      'First paragraph of newest-post.',
      'Second paragraph of newest-post.',
    ])
    // 🔴 NOT rich text, NOT HTML, NOT Lexical JSON. The frontend maps straight
    // to one <p> per entry with no sanitiser.
    for (const paragraph of post.body!) expect(typeof paragraph).toBe('string')
  })

  it('OMITS `body` entirely on a post that has none, rather than emitting []', async () => {
    await create(
      {
        slug: 'video-only-post',
        title: 'A video with no commentary',
        excerpt: 'The walkthrough speaks for itself.',
        publishedAt: '2026-09-01',
        video: { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', duration: '2:14' },
      },
      'published',
    )

    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'video-only-post' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    const post = toPublicBlogPost(doc as never)
    expect('body' in post).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('the YouTube half', () => {
  it('stores and emits the pasted URL VERBATIM, tracking tail and all', async () => {
    const pasted = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=AbCdEfGhIjKlMnOp'
    await create(
      article('verbatim-url-post', '2026-08-08', { video: { youtubeUrl: pasted } }),
      'published',
    )

    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'verbatim-url-post' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    const post = toPublicBlogPost(doc as never)
    // 🔴 NOT reduced to an id. The frontend parses it with `youtubeId()`, which
    // accepts every share-button form; a backend that extracted an id would
    // break the moment someone pasted a Shorts link.
    expect(post.video?.youtubeUrl).toBe(pasted)
  })

  it('OMITS `video` entirely on an article — so `postKind()` cannot misread it', async () => {
    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'oldest-post' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    const post = toPublicBlogPost(doc as never)
    /* 🔴 THE REGRESSION THIS PINS. A Payload group materialises as nullable
       columns, so an untouched video group reads back as
       `{youtubeUrl: null, duration: null}` — an OBJECT. Emitting that would
       make `postKind()` classify EVERY article as a video post and render a
       dead player on each one. */
    expect('video' in post).toBe(false)
  })

  it('omits `duration` when blank but keeps the URL', async () => {
    await create(
      article('no-duration-post', '2026-07-07', {
        video: { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' },
      }),
      'published',
    )
    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'no-duration-post' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    const post = toPublicBlogPost(doc as never)
    expect(post.video?.youtubeUrl).toBeTruthy()
    expect('duration' in (post.video as object)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('the cover image', () => {
  it('emits `{src, alt, width, height}` on the existing media path', async () => {
    await create(article('with-cover-post', '2026-04-04', { cover: coverId }), 'published')

    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'with-cover-post' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    const post = toPublicBlogPost(doc as never)

    expect(Object.keys(post.cover!).sort()).toEqual(['alt', 'height', 'src', 'width'])
    expect(post.cover!.width).toBe(1600)
    expect(post.cover!.height).toBe(900)
    expect(post.cover!.alt).toBe('A cover photograph')
    // Cloudinary is intentionally unconfigured in this suite, so `buildSrc`
    // falls back to Payload's own URL. The CDN path itself is pinned by
    // `tests/unit/cloudinaryUrl.test.ts` for all seven extensions.
    expect(typeof post.cover!.src).toBe('string')
    expect(post.cover!.src.length).toBeGreaterThan(0)
  })

  it('OMITS `cover` when none is set', async () => {
    const doc = await publicFindOne({
      collection: 'blog-posts',
      where: { slug: { equals: 'oldest-post' } },
      select: PUBLIC_BLOG_POST_SELECT,
      depth: 1,
    })
    expect('cover' in toPublicBlogPost(doc as never)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('the publish gate — a published post must have something to show', () => {
  it('REFUSES to publish with no body, no video and no externalUrl', async () => {
    await expect(
      create(
        {
          slug: 'empty-published-post',
          title: 'Nothing to see',
          excerpt: 'This should not publish.',
          publishedAt: '2026-03-03',
        },
        'published',
      ),
    ).rejects.toThrow()
  })

  it('ALLOWS a draft with nothing — drafts are scratch, publish is validated', async () => {
    const draft = await create(
      {
        slug: 'bare-draft-post',
        title: 'Started, not finished',
        excerpt: 'Come back tomorrow.',
        publishedAt: '2026-03-04',
      },
      'draft',
    )
    expect(draft.id).toBeTruthy()
  })

  it('ALLOWS publishing with ONLY an externalUrl', async () => {
    const post = await create(
      {
        slug: 'external-only-post',
        title: 'Published elsewhere',
        excerpt: 'The article lives on a news site.',
        publishedAt: '2026-02-02',
        externalUrl: 'https://example.com/the-article',
      },
      'published',
    )
    expect(post._status).toBe('published')
  })

  it('ALLOWS publishing with ONLY a video', async () => {
    const post = await create(
      {
        slug: 'video-gate-post',
        title: 'Just a walkthrough',
        excerpt: 'Footage only.',
        publishedAt: '2026-02-03',
        video: { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' },
      },
      'published',
    )
    expect(post._status).toBe('published')
  })

  it('does NOT count a video group that carries no URL', async () => {
    await expect(
      create(
        {
          slug: 'hollow-video-post',
          title: 'An empty group is not content',
          excerpt: 'Should be refused.',
          publishedAt: '2026-02-04',
          video: { duration: '2:14' },
        },
        'published',
      ),
    ).rejects.toThrow()
  })

  it('does NOT count an all-whitespace body', async () => {
    await expect(
      create(
        {
          slug: 'whitespace-body-post',
          title: 'Blank paragraphs are not content',
          excerpt: 'Should be refused.',
          publishedAt: '2026-02-05',
          body: ['   '],
        },
        'published',
      ),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
describe('the slug', () => {
  it('is derived from the TITLE on create when none is typed', async () => {
    const post = await payload.create({
      collection: 'blog-posts',
      overrideAccess: true,
      data: {
        title: 'What To Check Before You Buy A Plot',
        excerpt: 'Derived slug test.',
        publishedAt: '2026-01-20',
        body: ['A paragraph.'],
        _status: 'draft',
      } as never,
      context: CTX,
    })
    expect(post.slug).toBe('what-to-check-before-you-buy-a-plot')
  })

  it('is LOCKED once the post is published', async () => {
    const post = await create(article('locked-slug-post', '2026-01-21'), 'published')

    await expect(
      payload.update({
        collection: 'blog-posts',
        id: post.id,
        overrideAccess: true,
        data: { slug: 'a-different-address' } as never,
        context: CTX,
      }),
    ).rejects.toThrow(/cannot be changed/i)
  })

  it('stays EDITABLE on a draft that merely has a publishedAt date set', async () => {
    /* 🔴 THE REASON `blogSlugLock` EXISTS SEPARATELY FROM `slugLock`. The
       project version treats a non-null `publishedAt` as proof of publication,
       which is true there because a hook stamps it. Here the author types it,
       so a draft can carry a date — and its slug must still be editable. */
    const draft = await payload.create({
      collection: 'blog-posts',
      overrideAccess: true,
      data: {
        slug: 'draft-with-a-date',
        title: 'Scheduled for next Monday',
        excerpt: 'Still a draft.',
        publishedAt: '2026-12-25',
        body: ['A paragraph.'],
        _status: 'draft',
      } as never,
      context: CTX,
    })

    const renamed = await payload.update({
      collection: 'blog-posts',
      id: draft.id,
      overrideAccess: true,
      data: { slug: 'renamed-while-draft' } as never,
      context: CTX,
    })
    expect(renamed.slug).toBe('renamed-while-draft')
  })
})
