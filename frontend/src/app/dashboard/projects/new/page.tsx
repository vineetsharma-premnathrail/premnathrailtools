'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { projectsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { FormPage, SHEET, SheetIcon, sheetBtn } from '@/components/shared/FormSheet'
import ProjectsNav from '@/components/projects/ProjectsNav'
import ProjectForm, { emptyProjectForm, formToPayload, validateProjectForm } from '@/components/projects/ProjectForm'
import { ErrorBanner, Notice } from '@/components/projects/work/pmUi'
import { recordPath } from '@/lib/recordRef'

export default function NewProjectPage() {
  const { isAuthorized, isLoading } = useRequireApp('projects')
  const router = useRouter()
  const [form, setForm] = useState(emptyProjectForm())
  const [canCreate, setCanCreate] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (isAuthorized) projectsApi.meta().then((m) => setCanCreate(m.can_create)).catch(() => setCanCreate(false))
  }, [isAuthorized])

  if (isLoading || !isAuthorized) return null

  const save = async () => {
    const missing = validateProjectForm(form)
    if (missing.length) { setError(missing); return }
    setSaving(true)
    setError('')
    try {
      const p = await projectsApi.create(formToPayload(form))
      router.push(recordPath('/dashboard/projects', p))
    } catch (err) {
      setError(extractErrorMessages(err, 'Could not create the project.'))
      setSaving(false)
    }
  }

  const subtitle = 'Name, client and timeline. Then open the project, and add the milestones it needs — the first milestone releases it to the departments.'

  if (canCreate === false) {
    return (
      <FormPage nav={<ProjectsNav />} icon="flag" title="New Project" subtitle={subtitle} onBack={() => router.back()} backTour="pm-new-back" tour="pm-new-form"
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

  return (
    <FormPage nav={<ProjectsNav />} icon="flag" title="New Project" subtitle={subtitle} onBack={() => router.back()} backTour="pm-new-back" tour="pm-new-form"
      footer={<>
        <button data-tour="pm-new-cancel" type="button" onClick={() => router.back()} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
        {canCreate && <button data-tour="pm-new-create-btn" type="button" onClick={save} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}><SheetIcon name="plus" size={16} />{saving ? 'Creating…' : 'Create project'}</button>}
      </>}>
      <div style={{ padding: '20px 24px', maxWidth: 980 }}>
        <ErrorBanner error={error} />
        <ProjectForm value={form} onChange={setForm} />
      </div>
    </FormPage>
  )
}
