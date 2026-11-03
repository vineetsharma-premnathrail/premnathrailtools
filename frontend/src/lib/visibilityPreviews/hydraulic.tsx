'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

// Loaded on demand so the Role editor does not carry every previewable screen.
const SystemNew = dynamic(() => import('@/app/dashboard/hydraulic/systems/new/page'), { ssr: false })
const SystemDetail = dynamic(() => import('@/app/dashboard/hydraulic/systems/[id]/page'), { ssr: false })
const SystemList = dynamic(() => import('@/app/dashboard/hydraulic/systems/page'), { ssr: false })
const TestNew = dynamic(() => import('@/app/dashboard/hydraulic/testing/new/page'), { ssr: false })
const TestDetail = dynamic(() => import('@/app/dashboard/hydraulic/testing/[id]/page'), { ssr: false })
const TestList = dynamic(() => import('@/app/dashboard/hydraulic/testing/page'), { ssr: false })

/** Hydraulic & Pneumatic screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const hydraulicPreviews: PreviewScreens = {
  'hydraulic:systems': { form: SystemNew, detail: SystemDetail, list: SystemList },
  'hydraulic:testing': { form: TestNew, detail: TestDetail, list: TestList },
}
