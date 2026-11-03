'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

// Loaded on demand so the Role editor does not carry every previewable screen.
const RequestForm = dynamic(() => import('@/app/dashboard/maintenance/requests/new/page'), { ssr: false })
const RequestDetail = dynamic(() => import('@/app/dashboard/maintenance/requests/[id]/page'), { ssr: false })
const RequestList = dynamic(() => import('@/app/dashboard/maintenance/requests/page'), { ssr: false })
const WorkOrderForm = dynamic(() => import('@/app/dashboard/maintenance/work-orders/new/page'), { ssr: false })
const WorkOrderDetail = dynamic(() => import('@/app/dashboard/maintenance/work-orders/[id]/page'), { ssr: false })
const WorkOrderList = dynamic(() => import('@/app/dashboard/maintenance/work-orders/page'), { ssr: false })

/** Maintenance screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const maintenancePreviews: PreviewScreens = {
  'maintenance:requests': { form: RequestForm, detail: RequestDetail, list: RequestList },
  'maintenance:work_orders': { form: WorkOrderForm, detail: WorkOrderDetail, list: WorkOrderList },
}
