'use client'

import { useRowLabel } from '@payloadcms/ui'

/**
 * The collapsed-row label for `projects.videos`.
 *
 * The rows are collapsed by default (`initCollapsed`) because a project with
 * six videos is otherwise a very long screen. That makes this label the only
 * thing an admin can reorder by — so it has to say WHAT each row is rather than
 * "Item 03". Kind first, because that is what decides how the pane behaves.
 */
const KIND_LABEL: Record<string, string> = {
  video: 'MP4',
  youtube: 'YouTube',
}

export const ProjectVideoRowLabel = () => {
  const { data, rowNumber } = useRowLabel<{ kind?: string; title?: string }>()

  const position = String((rowNumber ?? 0) + 1).padStart(2, '0')
  const kind = data?.kind ? (KIND_LABEL[data.kind] ?? data.kind) : undefined
  const title = data?.title?.trim()

  if (!kind) return <span>{`Item ${position}`}</span>
  return <span>{title ? `${position}. ${kind} — ${title}` : `${position}. ${kind}`}</span>
}
