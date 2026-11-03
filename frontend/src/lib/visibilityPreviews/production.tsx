'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

// Loaded on demand so the Role editor does not carry every previewable screen.
const WoForm = dynamic(() => import('@/app/dashboard/production/work-orders/new/page'), { ssr: false })
const WoDetail = dynamic(() => import('@/app/dashboard/production/work-orders/[id]/page'), { ssr: false })
const WoList = dynamic(() => import('@/app/dashboard/production/work-orders/page'), { ssr: false })
const BomFormScreen = dynamic(() => import('@/app/dashboard/production/bom/new/page'), { ssr: false })
const BomDetail = dynamic(() => import('@/app/dashboard/production/bom/[id]/page'), { ssr: false })
const BomList = dynamic(() => import('@/app/dashboard/production/bom/page'), { ssr: false })
const PlanningPage = dynamic(() => import('@/app/dashboard/production/planning/page'), { ssr: false })
const MrpPage = dynamic(() => import('@/app/dashboard/production/planning/mrp/page'), { ssr: false })
const PlannedOrderForm = dynamic(() => import('@/components/production/PlannedOrderForm'), { ssr: false })

/** Production screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const productionPreviews: PreviewScreens = {
  'production:work_orders': { form: WoForm, detail: WoDetail, list: WoList },
  'production:bom': { form: BomFormScreen, detail: BomDetail, list: BomList },
  'production:planning': { planning: PlanningPage, mrp: MrpPage, form: PlannedOrderForm },
}
