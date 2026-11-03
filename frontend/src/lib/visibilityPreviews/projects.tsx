'use client'

import dynamic from 'next/dynamic'
import type { PreviewScreens } from './types'
import { sampleProject } from '@/lib/projectsPreviewSamples'

const noop = () => {}

// Loaded on demand so the Role editor does not carry every previewable screen.
// "Add New Project" = the machine form (components/erp/ProjectForm) with the project-name field.
const ProjectForm = dynamic(() => import('@/components/erp/ProjectForm').then((m) => {
  const Form = m.default
  return function ProjectFormPreview() {
    return (
      <Form title="Add New Project" subtitle="Fill the project and its machine once. Then open the project and add its milestones."
        submitLabel="Create project" serialOptional projectName={{ value: '', onChange: noop }} onCancel={noop} onSubmit={async () => {}} />
    )
  }
}), { ssr: false })
const ProjectDetail = dynamic(() => import('@/app/dashboard/projects/[id]/ProjectWorkspace').then((m) => {
  const Workspace = m.default
  return function ProjectDetailPreview() { return <Workspace project={sampleProject} onProjectUpdate={noop} onDeleted={noop} /> }
}), { ssr: false })
const ProjectList = dynamic(() => import('@/components/projects/ProjectListView').then((m) => {
  const List = m.default
  return function ProjectListPreview() { return <List showProjects showMachines /> }
}), { ssr: false })

/** Project Management screens that "Preview & choose" can mount (catalogue key -> screen code -> component).
 * The task form (projects:overview.tasks) is a popup inside the milestone plan page and has no preview yet. */
export const projectsPreviews: PreviewScreens = {
  'projects:all_projects': { form: ProjectForm, detail: ProjectDetail, list: ProjectList },
}
