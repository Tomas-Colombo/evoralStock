'use client'

import { useState } from 'react'
import { BandAction } from '@/components/shell/BandAction'
import { VenderModal } from './VenderModal'

export function VenderBandAction() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <BandAction
        tone="primary"
        title="Vender"
        description="Escaneá o buscá artículos de tu stock"
        onClick={() => setOpen(true)}
      />
      <VenderModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
