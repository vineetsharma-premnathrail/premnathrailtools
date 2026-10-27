'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { erpApi, projectsApi, usersApi } from '@/lib/api'
import { DirectoryUser } from '@/types'
import { FormPage, SHEET, SheetSection, Optional, Req, sheetBtn, sheetInput, sheetLabel } from '@/components/shared/FormSheet'
import ProjectsNav from '@/components/projects/ProjectsNav'
import { ProjectBudgetSection, ProjectFormValues, emptyProjectForm } from '@/components/projects/ProjectForm'
import MachineForm from '@/components/erp/ProjectForm'
import DateField from '@/components/erp/DateField'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { Notice } from '@/components/projects/work/pmUi'
import { recordPath } from '@/lib/recordRef'

const SUBTITLE = 'Fill the project and its machine once. Then open the project and add its milestones — the first milestone releases it to the departments.'

export default function NewProjectPage() {
  const { user, isAuthorized, isLoading } = useRequireApp('projects')
  const router = useRouter()
  const [pf, setPf] = useState<ProjectFormValues>(emptyProjectForm())
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [canCreate, setCanCreate] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isAuthorized) return
    projectsApi.meta().then((m) => setCanCreate(m.can_create)).catch(() => setCanCreate(false))
    usersApi.directory().then(setUsers).catch(() => setUsers([]))
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

  const set = (k: keyof ProjectFormValues, v: string) => setPf((f) => ({ ...f, [k]: v }))
  const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14 }

  // Client company and customer PO are typed once, in the machine tabs; the server copies them to the project.
  const validate = (): string[] => {
    const missing: string[] = []
    if (!pf.name.trim()) missing.push('Project name is required. Enter it on the Project tab.')
    if (!pf.sales_order_ref.trim()) missing.push('Sales order (SO) number is required. Enter the SO number this project is delivered under.')
    else if (pf.sales_order_ref.trim().length > 100) missing.push('Sales order (SO) number can be at most 100 characters.')
    if (!pf.start_date) missing.push('Start date is required.')
    if (!pf.target_handover_date) missing.push('Closing date is required.')
    if (pf.start_date && pf.target_handover_date && pf.target_handover_date < pf.start_date) missing.push('Closing date is before the start date.')
    return missing
  }

  const renderProjectTab = () => (
    <>
      <SheetSection icon="list" title="Project">
        <div style={row}>
          <div data-tour="pm-form-name" style={{ flex: '1 1 300px', maxWidth: 520 }}>
            <label style={sheetLabel}>Project name <Req /></label>
            <input style={sheetInput} value={pf.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. CAM Injection Car for IRCON MAHSR-T2" />
          </div>
          <div data-tour="pm-form-so" style={{ flex: '1 1 220px', maxWidth: 300 }}>
            <label style={sheetLabel}>Sales order (SO) number <Req /></label>
            <input style={sheetInput} value={pf.sales_order_ref} maxLength={100} onChange={(e) => set('sales_order_ref', e.target.value)} placeholder="e.g. SO-2026-0042" />
          </div>
        </div>
        <div style={row}>
          <div data-tour="pm-form-start" style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={sheetLabel}>Start date <Req /></label>
            <DateField value={pf.start_date} onChange={(v) => set('start_date', v)} />
          </div>
          <div data-tour="pm-form-handover" style={{ flex: '0 1 170px', minWidth: 160 }}>
            <label style={sheetLabel}>Closing date <Req /></label>
            <DateField value={pf.target_handover_date} onChange={(v) => set('target_handover_date', v)} />
          </div>
        </div>
      </SheetSection>
      <ProjectBudgetSection value={pf.internal_order_id} onChange={(v) => set('internal_order_id', v)} />
      <SheetSection icon="user" title="Ownership & Scope" extra={<Optional />}>
        <div style={row}>
          <div data-tour="pm-form-code" style={{ flex: '0 1 240px', minWidth: 170 }}>
            <label style={sheetLabel}>Project number</label>
            <input style={sheetInput} value={pf.project_code} onChange={(e) => set('project_code', e.target.value.toUpperCase())} placeholder="Blank = next number, e.g. PEW-78" />
          </div>
          <div data-tour="pm-form-pm" style={{ flex: '1 1 260px', maxWidth: 360 }}>
            <label style={sheetLabel}>Project manager</label>
            <SearchableSelect
              value={pf.project_manager_id}
              onChange={(v) => set('project_manager_id', v)}
              options={users.map((u) => ({ value: String(u.id), label: `${u.name}${u.designation ? ` — ${u.designation}` : ''}` }))}
              placeholder="Blank = you"
            />
          </div>
        </div>
        <div data-tour="pm-form-description">
          <label style={sheetLabel}>Description / scope</label>
          <textarea style={{ ...sheetInput, minHeight: 80, resize: 'vertical' }} value={pf.description} onChange={(e) => set('description', e.target.value)} placeholder="What is being delivered" />
        </div>
      </SheetSection>
    </>
  )

  return (
    <MachineForm
      nav={<ProjectsNav />}
      title="Add New Project"
      subtitle={SUBTITLE}
      submitLabel="Create project"
      currentUserId={user?.id}
      serialOptional
      projectTab={{ label: 'Project', render: renderProjectTab, validate }}
      onCancel={() => router.back()}
      onSubmit={async (machine, files, shareOptions) => {
        const created = await projectsApi.createWithMachine({
          project_code: pf.project_code.trim() || null,
          name: pf.name.trim(),
          sales_order_ref: pf.sales_order_ref.trim(),
          description: pf.description.trim() || null,
          project_manager_id: pf.project_manager_id ? Number(pf.project_manager_id) : null,
          start_date: pf.start_date,
          target_handover_date: pf.target_handover_date,
          internal_order_id: pf.internal_order_id ? Number(pf.internal_order_id) : null,
          machine,
        })
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
