'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { erpApi, projectsApi } from '@/lib/api'
import { FormPage, SHEET, sheetBtn } from '@/components/shared/FormSheet'
import ProjectsNav from '@/components/projects/ProjectsNav'
import MachineForm from '@/components/erp/ProjectForm'
import { Notice } from '@/components/projects/work/pmUi'
import { recordPath } from '@/lib/recordRef'
import { useFormDraft } from '@/lib/formDraft'
import DraftBanner from '@/components/shared/DraftBanner'

const SUBTITLE = 'Fill the project and its machine once. Then open the project and add its milestones — the first milestone releases it to the departments.'

export default function NewProjectPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('projects')
  const router = useRouter()
  // The project name is the only project field; it sits on the machine form's Machine Identity tab.
  // Project number (next PEW), project manager (= creator), SO number and dates are not asked: they
  // default or stay empty and are set later on the project's Overview / milestones. Client company and
  // customer PO are typed in the machine tabs; the server copies them to the project.
  const [name, setName] = useState('')
  const [canCreate, setCanCreate] = useState<boolean | null>(null)
  // The machine fields have their own draft inside the machine form.
  const draft = useFormDraft(canCreate ? 'projects-project-name-new' : null, { name },
    (d) => setName(d.name || ''))

  useEffect(() => {
    if (!isAuthorized) return
    projectsApi.meta().then((m) => setCanCreate(m.can_create)).catch(() => setCanCreate(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  if (canCreate === false) {
    return (
      <FormPage nav={<ProjectsNav />} icon="flag" title="Add New Project" subtitle={SUBTITLE} onBack={() => router.back()} backTour="pm-new-back" tour="pm-new-form"
        footer={<button data-tour="pm-new-cancel" type="button" onClick={() => router.back()} style={sheetBtn('secondary', SHEET.INK)}>Back</button>}>
        <div style={{ padding: '20px 24px' }}>
          <Notice tone="warn">
            Only authorised management can create projects — Partners, Directors, or users an admin grants
            &quot;Project Management › All Projects › Create&quot; in Users › Permission Matrix.
          </Notice>
        </div>
      </FormPage>
    )
  }
  if (canCreate === null) return null

  return (
    <MachineForm
      nav={<ProjectsNav />}
      title="Add New Project"
      subtitle={SUBTITLE}
      submitLabel="Create project"
      currentUserId={user?.id}
      serialOptional
      projectName={{ value: name, onChange: setName, banner: draft.restored ? <DraftBanner draft={draft} /> : null }}
      onCancel={() => router.back()}
      onSubmit={async (machine, files, shareOptions) => {
        const created = await projectsApi.createWithMachine({
          name: name.trim(),
          machine,
        })
        draft.clear()
        let uploadFailed = false
        if (files.length > 0 && created.machine_id) {
          try { await erpApi.uploadProjectAttachments(created.machine_id, files, shareOptions) } catch { uploadFailed = true }
        }
        // The project exists either way; if the files did not upload, Overview says so and the files can be added on the machine record.
        router.push(`${recordPath('/dashboard/projects', created)}${uploadFailed ? '?files=failed' : ''}`)
      }}
    />
  )
}
