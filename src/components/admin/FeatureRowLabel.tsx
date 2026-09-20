'use client'

import { useRowLabel } from '@payloadcms/ui'

/**
 * So a collapsed repeater row reads as its own title rather than "Item 03".
 *
 * Small, and disproportionately valuable: a project has SIX repeatable lists and
 * up to eleven rows in some of them. Without this, reordering a legally
 * sensitive approvals list means expanding every row to find out what it says.
 */
export const FeatureRowLabel = () => {
  const { data, rowNumber } = useRowLabel<{ title?: string }>()
  const fallback = `Item ${String((rowNumber ?? 0) + 1).padStart(2, '0')}`
  return <span>{data?.title?.trim() || fallback}</span>
}
