'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'
import { sampleItem } from '@/lib/storePreviewSamples'

// Loaded on demand so the Role editor does not carry every previewable screen.
const ItemForm = dynamic(() => import('@/app/dashboard/store/new/page'), { ssr: false })
const ItemDetail = dynamic(() => import('@/app/dashboard/store/[id]/page'), { ssr: false })
const ItemList = dynamic(() => import('@/app/dashboard/store/page'), { ssr: false })
// The plant data block alone (its own key, store:items.plant_data), on the sample item.
const PlantData = dynamic(() => import('@/components/store/ItemPlantData').then((m) => {
  const Block = m.default
  return function PlantDataPreview() { return <Block itemId={sampleItem.id} canEdit preview /> }
}), { ssr: false })
const IssueForm = dynamic(() => import('@/components/store/MaterialIssueForm'), { ssr: false })
const IssueList = dynamic(() => import('@/app/dashboard/store/issues/page'), { ssr: false })
const GrnForm = dynamic(() => import('@/app/dashboard/store/grn/new/page'), { ssr: false })
const GrnList = dynamic(() => import('@/app/dashboard/store/grn/page'), { ssr: false })
const AdjustmentForm = dynamic(() => import('@/app/dashboard/store/adjustments/new/page'), { ssr: false })
const AdjustmentList = dynamic(() => import('@/app/dashboard/store/adjustments/page'), { ssr: false })

/** Store screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const storePreviews: PreviewScreens = {
  'store:items': { form: ItemForm, detail: ItemDetail, list: ItemList },
  'store:items.plant_data': { main: PlantData },
  'store:issues': { form: IssueForm, list: IssueList },
  'store:grn': { form: GrnForm, list: GrnList },
  'store:adjustments': { form: AdjustmentForm, list: AdjustmentList },
}
