'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

// Loaded on demand so the Role editor does not carry every previewable screen. Each screen reads the preview
// context (useVisibility / useQualityScreen -> vis.preview): sample records, no loading, no saving, no nav / Back.
const NcrForm = dynamic(() => import('@/app/dashboard/quality/ncr/new/page'), { ssr: false })
const NcrDetail = dynamic(() => import('@/app/dashboard/quality/ncr/[id]/page'), { ssr: false })
const NcrList = dynamic(() => import('@/app/dashboard/quality/ncr/page'), { ssr: false })

const LotForm = dynamic(() => import('@/app/dashboard/quality/lots/new/page'), { ssr: false })
const LotDetail = dynamic(() => import('@/app/dashboard/quality/lots/[id]/page'), { ssr: false })
const LotListPreview = dynamic(() => import('@/components/quality/LotList').then((m) => {
  const List = m.default
  return function QualityLotListPreview() { return <List /> }
}), { ssr: false })

const CallForm = dynamic(() => import('@/app/dashboard/quality/inspection-calls/new/page'), { ssr: false })
const CallDetail = dynamic(() => import('@/app/dashboard/quality/inspection-calls/[id]/page'), { ssr: false })
const CallList = dynamic(() => import('@/app/dashboard/quality/inspection-calls/page'), { ssr: false })

const CapaForm = dynamic(() => import('@/app/dashboard/quality/capa/new/page'), { ssr: false })
const CapaDetail = dynamic(() => import('@/app/dashboard/quality/capa/[id]/page'), { ssr: false })
const CapaList = dynamic(() => import('@/app/dashboard/quality/capa/page'), { ssr: false })

const ComplaintForm = dynamic(() => import('@/app/dashboard/quality/complaints/new/page'), { ssr: false })
const ComplaintDetail = dynamic(() => import('@/app/dashboard/quality/complaints/[id]/page'), { ssr: false })
const ComplaintList = dynamic(() => import('@/app/dashboard/quality/complaints/page'), { ssr: false })

/** Quality screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const qualityPreviews: PreviewScreens = {
  'quality:ncr': { form: NcrForm, detail: NcrDetail, list: NcrList },
  'quality:inspection_lots': { form: LotForm, detail: LotDetail, list: LotListPreview },
  'quality:inspection_calls': { form: CallForm, detail: CallDetail, list: CallList },
  'quality:capa': { form: CapaForm, detail: CapaDetail, list: CapaList },
  'quality:complaints': { form: ComplaintForm, detail: ComplaintDetail, list: ComplaintList },
}
