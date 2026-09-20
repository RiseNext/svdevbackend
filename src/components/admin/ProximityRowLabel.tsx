'use client'

import { useRowLabel } from '@payloadcms/ui'

export const ProximityRowLabel = () => {
  const { data, rowNumber } = useRowLabel<{ measure?: string; place?: string }>()
  const fallback = `Item ${String((rowNumber ?? 0) + 1).padStart(2, '0')}`
  const place = data?.place?.trim()
  const measure = data?.measure?.trim()
  if (!place) return <span>{fallback}</span>
  return <span>{measure ? `${measure} — ${place}` : place}</span>
}
