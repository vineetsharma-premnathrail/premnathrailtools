'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

// Loaded on demand so the Role editor does not carry every previewable screen.
const JobNew = dynamic(() => import('@/app/dashboard/electrical/jobs/new/page'), { ssr: false })
const JobDetail = dynamic(() => import('@/app/dashboard/electrical/jobs/[id]/page'), { ssr: false })
const JobList = dynamic(() => import('@/app/dashboard/electrical/jobs/page'), { ssr: false })
const TestRegister = dynamic(() => import('@/app/dashboard/electrical/testing/page'), { ssr: false })
// The Record Test form lives in a popup on a job's Tests tab; in the preview TestsTab draws it inline on a sample job.
const TestForm = dynamic(() => Promise.all([import('@/components/electrical/TestsTab'), import('@/lib/electricalPreviewSamples')]).then(([m, s]) => {
  const TestsTab = m.default
  return function RecordTestPreview() {
    return <TestsTab job={s.sampleJobDetail} meta={s.sampleMeta} canEdit onChanged={() => {}} />
  }
}), { ssr: false })

/** Electrical screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const electricalPreviews: PreviewScreens = {
  'electrical:jobs': { form: JobNew, detail: JobDetail, list: JobList },
  'electrical:testing': { form: TestForm, list: TestRegister },
}
