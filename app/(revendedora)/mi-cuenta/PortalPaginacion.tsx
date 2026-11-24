'use client'

import { useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Pagination } from '@/components/ui/Pagination'

export function PortalPaginacion({
  basePath,
  page,
  pageSize,
  total,
}: {
  basePath: string
  page: number
  pageSize: number
  total: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function onPageChange(next: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (next <= 1) params.delete('pagina')
    else params.set('pagina', String(next))
    const qs = params.toString()
    startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath))
  }

  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={onPageChange}
      disabled={pending}
    />
  )
}
