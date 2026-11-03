'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

// Loaded on demand so the Role editor does not carry every previewable screen. Both Finance pages read
// the previewed screen code from the preview context: Masters draws only the Vendors section (form open
// or list), Payments opens the voucher form or the vouchers list.
const Vendors = dynamic(() => import('@/app/dashboard/finance/masters/page'), { ssr: false })
const Payments = dynamic(() => import('@/app/dashboard/finance/payments/page'), { ssr: false })

/** Finance screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const accountsPreviews: PreviewScreens = {
  'accounts:vendors': { form: Vendors, list: Vendors },
  'accounts:payments': { form: Payments, list: Payments },
}
