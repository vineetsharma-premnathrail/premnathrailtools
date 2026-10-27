'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { erpApi } from '@/lib/api'
import { PmProject, Project } from '@/types'
import { formatDate } from '@/lib/format'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'
import { secondaryBtnStyle, DetailCard, DetailGroup, DetailRow } from '@/components/shared/ui'
import { ErrorBanner, Notice } from '@/components/projects/work/pmUi'

const STATUS_LABELS: Record<string, string> = {
  active: 'Active', under_service: 'Under Service', manufacturing_under_progress: 'Manufacturing Under Progress',
  work_in_progress: 'Work in Progress', standby: 'Standby', inactive: 'Inactive', decommissioned: 'Decommissioned', cancel: 'Cancel',
}

/** Machine details of a project, shown inside Overview: every machine linked to the project (identity, client & site, specs, timeline & warranty), with a link to edit each. */
export default function ProjectMachineDetails({ project }: { project: PmProject }) {
  const [machines, setMachines] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | string[]>('')
  const [forbidden, setForbidden] = useState(false)
  // Set by Add New Project when the project saved but its files did not upload.
  const filesFailed = useSearchParams().get('files') === 'failed'

  useEffect(() => {
    let live = true
    setError(''); setForbidden(false); setMachines(null)
    const fallback = async (): Promise<Project[]> => (project.machine_id ? [await erpApi.getProject(project.machine_id)] : [])
    const status = (e: unknown) => (e as { response?: { status?: number } })?.response?.status
    ;(async () => {
      try {
        let list: Project[]
        try {
          const r = await erpApi.listProjects({ pm_project_id: project.id, limit: 50 })
          list = (Array.isArray(r) ? r : r?.items || []) as Project[]
          if (list.length === 0 && project.machine_id) list = await fallback()
        } catch (e) {
          if (status(e) === 403) throw e
          list = await fallback()
        }
        list.sort((a, b) => a.serial_number.localeCompare(b.serial_number, undefined, { numeric: true }))
        if (live) setMachines(list)
      } catch (err) {
        if (!live) return
        if (status(err) === 403) setForbidden(true)
        else setError(extractErrorMessages(err, 'Could not load the machine details of this project. Reload the page; if it keeps failing, open the machine from All Projects › Past.'))
        setMachines([])
      }
    })()
    return () => { live = false }
  }, [project.id, project.machine_id])

  if (machines === null) return <DetailCard><p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Loading machine details…</p></DetailCard>
  if (forbidden) {
    return <DetailCard tour="pm-ov-machine"><Notice tone="warn">You cannot view this project&apos;s machine details: the machine is outside your data scope. Ask an admin to widen your Project Management data scope, or to add &apos;View&apos; on Project Management › Past Projects to one of your roles (Organization › Role &amp; Permissions).</Notice></DetailCard>
  }
  if (error) return <DetailCard tour="pm-ov-machine"><ErrorBanner error={error} /></DetailCard>
  if (machines.length === 0) {
    return <DetailCard tour="pm-ov-machine"><Notice tone="info">This project was created before projects carried their machine details. Past machines are listed under All Projects › Past.</Notice></DetailCard>
  }
  return <>
    {filesFailed && <Notice tone="warn">The project and its machine were saved, but the documents did not upload. Open the machine record below and add them under Documents.</Notice>}
    {machines.map((m) => <MachineCard key={m.id} m={m} />)}
  </>
}

function MachineCard({ m }: { m: Project }) {
  const site = [m.site_name, m.site_location, m.is_export ? m.site_country : m.site_state].filter(Boolean).join(', ')
  const hasSpecs = !!(m.specifications || m.installed_options || m.software_version || m.tech_notes)
  return (
    <DetailCard tour="pm-ov-machine">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0f172a' }}>Machine {m.serial_number}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href={recordPath('/dashboard/projects/service-projects', m)} style={{ ...secondaryBtnStyle, textDecoration: 'none' }}>Open machine record</Link>
          <Link data-tour="pm-ov-machine-edit" href={`${recordPath('/dashboard/projects/service-projects', m)}/edit`} style={{ ...secondaryBtnStyle, textDecoration: 'none' }}>Edit machine</Link>
        </div>
      </div>
      {m.approval_status && m.approval_status !== 'approved' && (
        <Notice tone={m.approval_status === 'rejected' ? 'bad' : 'warn'}>
          {m.approval_status === 'pending' ? 'This machine is waiting for approval.' : `This machine was rejected${m.approval_remarks ? `: ${m.approval_remarks}` : '.'}`}
        </Notice>
      )}
      <DetailGroup title="Machine identity">
        <DetailRow label="Serial number">{m.serial_number}</DetailRow>
        <DetailRow label="Model">{m.model_name}</DetailRow>
        <DetailRow label="Classification">{m.machine_type}</DetailRow>
        <DetailRow label="Application">{m.application_type}</DetailRow>
        <DetailRow label="Status">{STATUS_LABELS[m.status || ''] || m.status}</DetailRow>
        <DetailRow label="Engine / chassis">{[m.engine_number, m.chassis_number].filter(Boolean).join(' / ')}</DetailRow>
        <DetailRow label="Year of manufacture">{m.year_of_manufacture}</DetailRow>
        <DetailRow label="Notes">{m.notes}</DetailRow>
      </DetailGroup>
      <DetailGroup title="Client & site">
        <DetailRow label="Client company">{m.client_company}</DetailRow>
        <DetailRow label="Contact">{[m.client_name, m.client_designation, m.client_phone, m.client_email].filter(Boolean).join(' · ')}</DetailRow>
        <DetailRow label="GST number">{m.client_gst}</DetailRow>
        <DetailRow label="Address">{m.client_address}</DetailRow>
        <DetailRow label="Site">{site}</DetailRow>
        <DetailRow label="Zone">{m.zone}</DetailRow>
        <DetailRow label="Operator">{[m.operator_name, m.operator_phone].filter(Boolean).join(' · ')}</DetailRow>
      </DetailGroup>
      {hasSpecs && (
        <DetailGroup title="Technical specs">
          <DetailRow label="Specifications">{m.specifications}</DetailRow>
          <DetailRow label="Installed options">{m.installed_options}</DetailRow>
          <DetailRow label="Software version">{m.software_version}</DetailRow>
          <DetailRow label="Technical notes">{m.tech_notes}</DetailRow>
        </DetailGroup>
      )}
      <DetailGroup title="Timeline & warranty" last>
        <DetailRow label="Customer PO">{m.po_number ? `${m.po_number}${m.po_date ? ` · ${formatDate(m.po_date)}` : ''}` : ''}</DetailRow>
        <DetailRow label="Dispatch date">{m.delivery_date ? formatDate(m.delivery_date) : ''}</DetailRow>
        <DetailRow label="Commissioning date">{m.commissioning_date ? formatDate(m.commissioning_date) : ''}</DetailRow>
        <DetailRow label="Handover date">{m.handover_date ? formatDate(m.handover_date) : ''}</DetailRow>
        <DetailRow label="Warranty">{m.warranty_start_date ? `${formatDate(m.warranty_start_date)} to ${m.warranty_end_date ? formatDate(m.warranty_end_date) : '—'}` : 'No warranty'}</DetailRow>
        <DetailRow label="Extended warranty">{m.extended_warranty ? `Until ${m.extended_warranty_end ? formatDate(m.extended_warranty_end) : '—'}` : ''}</DetailRow>
      </DetailGroup>
    </DetailCard>
  )
}
