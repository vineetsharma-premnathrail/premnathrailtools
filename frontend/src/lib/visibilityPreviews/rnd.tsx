'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'

const noop = () => {}

// Loaded on demand so the Role editor does not carry every previewable screen.
// R&D calculator tool pages are never part of this (owner rule: untouchable).
const RequirementList = dynamic(() => import('@/app/dashboard/rnd/requirements/page'), { ssr: false })
const ProjectForm = dynamic(() => import('@/app/dashboard/rnd/projects/new/page'), { ssr: false })
const ProjectDetail = dynamic(() => import('@/app/dashboard/rnd/projects/[id]/page'), { ssr: false })
const ProjectList = dynamic(() => import('@/app/dashboard/rnd/projects/page'), { ssr: false })
const TaskForm = dynamic(() => import('@/components/rnd/TaskCreateSheet').then((m) => {
  const Sheet = m.default
  // In preview mode the sheet draws itself in place (no popup) and Create / Cancel are disabled.
  return function TaskFormScreen() { return <Sheet onClose={noop} onCreated={noop} /> }
}), { ssr: false })

/** R&D screens that "Preview & choose" can mount (catalogue key -> screen code -> component). */
export const rndPreviews: PreviewScreens = {
  'rnd:requirements': { list: RequirementList },
  'rnd:projects': { form: ProjectForm, detail: ProjectDetail, list: ProjectList },
  'rnd:tasks': { form: TaskForm },
}
