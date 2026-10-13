import { describe, expect, it } from 'vitest'

import { validateMediaRows } from '@/fields/mediaRows'
import { validateParagraphs } from '@/fields/paragraphs'
import { validateYoutubeUrl, youtubeId } from '@/fields/youtubeUrl'
import { validateProjectCta, validateProjectVideoRows } from '@/collections/Projects'
import { validateBlogParagraphs } from '@/collections/BlogPosts'
import { validateAddressLines, validateHeroMediaRows } from '@/globals/SiteSettings'
import { validateAlt } from '@/collections/Media'

/**
 * THE SHARED VALIDATORS — one definition per rule, tested once.
 *
 * These are the functions D-1 made visible. Each is attached to its field (API
 * enforcement + the required asterisk) AND handed to `surfaceValidationErrors`,
 * so a bug here is a bug in both places at once — which is the point, and why
 * they are worth unit-testing directly rather than only through a collection.
 */

describe('validateAlt — the conditional rule', () => {
  it('requires alt when the image is not decorative', () => {
    expect(validateAlt('', { isDecorative: false })).toMatch(/Alt text is required/)
    expect(validateAlt(undefined, undefined)).toMatch(/Alt text is required/)
    expect(validateAlt('   ', {})).toMatch(/Alt text is required/)
  })

  it('accepts a blank alt when decorative is ticked — the escape hatch', () => {
    expect(validateAlt('', { isDecorative: true })).toBe(true)
    expect(validateAlt(undefined, { isDecorative: true })).toBe(true)
  })

  it('accepts real alt text, and rejects an over-long one', () => {
    expect(validateAlt('A gated plot layout at dusk', {})).toBe(true)
    expect(validateAlt('x'.repeat(5000), {})).toMatch(/at most/)
  })
})

describe('validateParagraphs — shared by projects.description and blog-posts.body', () => {
  const required = validateParagraphs({
    maxRows: 3,
    maxChars: 20,
    caseInsensitiveUniqueness: true,
    uniquenessMessage: 'Must be unique.',
    required: true,
  })
  const optional = validateParagraphs({
    maxRows: 3,
    maxChars: 20,
    caseInsensitiveUniqueness: true,
    uniquenessMessage: 'Must be unique.',
    required: false,
  })

  it('enforces required vs optional', () => {
    expect(required(undefined)).toMatch(/at least one paragraph/)
    expect(required([])).toMatch(/at least one paragraph/)
    expect(optional(undefined)).toBe(true)
    expect(optional([])).toBe(true)
  })

  it('rejects empty entries, over-long entries and too many rows', () => {
    expect(required(['ok', '  '])).toMatch(/cannot be empty/)
    expect(required(['x'.repeat(21)])).toMatch(/at most 20 characters/)
    expect(required(['a', 'b', 'c', 'd'])).toMatch(/At most 3 paragraphs/)
  })

  it('🔴 closes the drift: uniqueness is case- and whitespace-insensitive on BOTH fields', () => {
    /**
     * `projects.description` compared `trim().toLowerCase()`; `blog-posts.body`
     * compared exact strings. So these two paragraphs were rejected on a
     * project and ACCEPTED on a post, where they then collided as React keys on
     * the rendered page — the exact failure the rule exists to prevent.
     */
    expect(required(['Same thing', 'same thing '])).toMatch(/unique/i)
    expect(validateBlogParagraphs(['Same thing', 'same thing '])).toMatch(/unique/i)
  })

  it('accepts genuinely distinct paragraphs', () => {
    expect(required(['One', 'Two'])).toBe(true)
  })
})

describe('validateMediaRows — shared by heroMedia and projects.videos', () => {
  it('heroMedia: each kind demands its own source', () => {
    expect(validateHeroMediaRows([{ kind: 'image' }])).toMatch(/Row 1: choose a photograph/)
    expect(validateHeroMediaRows([{ kind: 'video' }])).toMatch(/Row 1: choose an uploaded video/)
    expect(validateHeroMediaRows([{ kind: 'youtube' }])).toMatch(/Row 1: paste a YouTube link/)
    expect(
      validateHeroMediaRows([{ kind: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }]),
    ).toMatch(/Row 1: a YouTube entry needs a poster image/)
  })

  it('heroMedia: a complete row of each kind passes', () => {
    expect(validateHeroMediaRows([{ kind: 'image', image: 'id' }])).toBe(true)
    expect(validateHeroMediaRows([{ kind: 'video', video: 'id' }])).toBe(true)
    expect(
      validateHeroMediaRows([
        { kind: 'youtube', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', poster: 'id' },
      ]),
    ).toBe(true)
  })

  it('heroMedia: an invalid YouTube link is caught AT THE ROW, naming the row', () => {
    const r = validateHeroMediaRows([
      { kind: 'youtube', youtubeUrl: 'https://vimeo.com/1', poster: 'id' },
    ])
    expect(r).toMatch(/Row 1/)
    expect(r).toMatch(/not a YouTube video link/i)
  })

  it('reports EVERY offending row, not just the first', () => {
    const r = validateHeroMediaRows([{ kind: 'image' }, { kind: 'video' }, { kind: 'youtube' }])
    expect(r).toMatch(/Row 1/)
    expect(r).toMatch(/Row 2/)
    expect(r).toMatch(/Row 3/)
  })

  it('projects.videos has no image kind, so an image row is not policed there', () => {
    // `kinds: { video, youtube }` — an 'image' kind cannot be chosen in the UI
    // and is not a row shape this field claims to support.
    expect(validateProjectVideoRows([{ kind: 'video', video: 'id' }])).toBe(true)
    expect(validateProjectVideoRows([{ kind: 'video' }])).toMatch(/Row 1: choose an uploaded video/)
  })

  it('an absent or null array is allowed — the field is optional', () => {
    expect(validateHeroMediaRows(undefined)).toBe(true)
    expect(validateHeroMediaRows(null)).toBe(true)
    expect(validateHeroMediaRows([null])).toBe(true)
  })

  it('a non-array is reported with the field noun', () => {
    expect(validateHeroMediaRows('nope')).toMatch(/Hero media must be a list/)
    expect(validateProjectVideoRows('nope')).toMatch(/Videos must be a list/)
  })
})

describe('validateProjectCta — both-or-neither', () => {
  it('accepts both filled or both blank', () => {
    expect(validateProjectCta(null)).toBe(true)
    expect(validateProjectCta({})).toBe(true)
    expect(validateProjectCta({ title: 'T', description: 'D' })).toBe(true)
  })

  it('rejects exactly one', () => {
    expect(validateProjectCta({ title: 'T' })).toMatch(/both the title and the description/)
    expect(validateProjectCta({ description: 'D' })).toMatch(/both the title and the description/)
    expect(validateProjectCta({ title: '  ', description: 'D' })).toMatch(/both the title/)
  })
})

describe('validateAddressLines', () => {
  it('requires at least one non-empty, unique, in-length line', () => {
    expect(validateAddressLines([])).toMatch(/at least one line/)
    expect(validateAddressLines(['A', '  '])).toMatch(/cannot be empty/)
    expect(validateAddressLines(['x'.repeat(200)])).toMatch(/at most/)
    expect(validateAddressLines(['Same', 'same '])).toMatch(/must be unique/)
    expect(validateAddressLines(['Line one', 'Line two'])).toBe(true)
  })
})

describe('validateYoutubeUrl / youtubeId', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    'dQw4w9WgXcQ',
  ])('accepts %s', (url) => {
    expect(youtubeId(url)).toBe('dQw4w9WgXcQ')
    expect(validateYoutubeUrl(url)).toBe(true)
  })

  it.each([
    'https://vimeo.com/123456789',
    'https://www.youtube.com/@SVDevelopers',
    'https://www.youtube.com/playlist?list=PLabc',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://studio.youtube.com/video/dQw4w9WgXcQ/edit',
    'https://www.youtube.com/watch?v=short',
    'banana',
  ])('rejects %s', (url) => {
    expect(youtubeId(url)).toBeNull()
    expect(validateYoutubeUrl(url)).toMatch(/not a YouTube video link/i)
  })

  it('treats empty as valid — requiredness belongs to the surrounding field', () => {
    expect(validateYoutubeUrl('')).toBe(true)
    expect(validateYoutubeUrl(undefined)).toBe(true)
    expect(validateYoutubeUrl('   ')).toBe(true)
  })

  it('does not accept a host that merely ENDS WITH a youtube domain', () => {
    expect(youtubeId('https://youtube.com.evil.net/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})
