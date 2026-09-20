'use client'

import { useRowLabel } from '@payloadcms/ui'

export const StatRowLabel = () => {
  const { data, rowNumber } = useRowLabel<{ label?: string; value?: string }>()
  const fallback = `Item ${String((rowNumber ?? 0) + 1).padStart(2, '0')}`
  const label = data?.label?.trim()
  const value = data?.value?.trim()
  if (!label) return <span>{fallback}</span>
  return <span>{value ? `${label} — ${value}` : label}</span>
}
