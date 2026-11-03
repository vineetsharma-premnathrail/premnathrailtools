'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

// Loaded on demand so the Role editor does not carry every previewable screen.
const DocNew = dynamic(() => import('@/app/dashboard/design/documents/new/page'), { ssr: false })
const DocDetail = dynamic(() => import('@/app/dashboard/design/documents/[id]/page'), { ssr: false })
const DocList = dynamic(() => import('@/app/dashboard/design/documents/page'), { ssr: false })
const EcrNew = dynamic(() => import('@/app/dashboard/design/change-requests/new/page'), { ssr: false })
const EcrDetail = dynamic(() => import('@/app/dashboard/design/change-requests/[id]/page'), { ssr: false })
// The change requests list is the ECR half of the Changes page (it opens on that half in the preview).
const EcrList = dynamic(() => import('@/app/dashboard/design/change-notices/page'), { ssr: false })

/** Design screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const designPreviews: PreviewScreens = {
  'design:documents': { form: DocNew, detail: DocDetail, list: DocList },
  'design:change_notices': { form: EcrNew, detail: EcrDetail, list: EcrList },
}
