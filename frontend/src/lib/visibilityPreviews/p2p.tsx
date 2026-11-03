'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

// Loaded on demand so the Role editor does not carry every previewable screen.
const PrForm = dynamic(() => import('@/app/dashboard/p2p/new/page'), { ssr: false })
const PrDetail = dynamic(() => import('@/app/dashboard/p2p/[id]/page'), { ssr: false })
const PrList = dynamic(() => import('@/components/p2p/P2PRequestList').then((m) => {
  const List = m.default
  return function PrListPreview() { return <List emptyLabel="No requisitions." /> }
}), { ssr: false })

/** Procurement screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const p2pPreviews: PreviewScreens = {
  'p2p:purchase_requisitions': { form: PrForm, detail: PrDetail, list: PrList },
}
