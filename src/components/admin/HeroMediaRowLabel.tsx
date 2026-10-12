'use client'

import { useRowLabel } from '@payloadcms/ui'

/**
 * The collapsed-row label for `site-settings.heroMedia`.
 *
 * The rows are collapsed by default (`initCollapsed`) because a hero with six
 * entries is otherwise a very long screen. That makes the label the only thing
 * an admin has to reorder by — so it has to say WHAT each row is, not "Item 03".
 *
 * Kind first, because that is what decides how the slide behaves — and in
 * particular which one will not autoplay.
 */
const KIND_LABEL: Record<string, string> = {
  image: 'Photograph',
  video: 'Video',
  youtube: 'YouTube',
}

export const HeroMediaRowLabel = () => {
  const { data, rowNumber } = useRowLabel<{ kind?: string; title?: string }>()

  const position = String((rowNumber ?? 0) + 1).padStart(2, '0')
  const kind = data?.kind ? (KIND_LABEL[data.kind] ?? data.kind) : undefined
  const title = data?.title?.trim()

  if (!kind) return <span>{`Item ${position}`}</span>
  return <span>{title ? `${position}. ${kind} — ${title}` : `${position}. ${kind}`}</span>
}
