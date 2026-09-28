'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityChecklist, QualityInspectionPlanStatus, QualityInspectionType, QualityStandard } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import { extractErrorMessages } from '@/lib/validation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}

export default function NewQualityInspectionPlanPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()

  const [checklists, setChecklists] = useState<QualityChecklist[]>([])
  const [standards, setStandards] = useState<QualityStandard[]>([])

  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [inspectionType, setInspectionType] = useState<QualityInspectionType>('incoming')
  const [checklistId, setChecklistId] = useState('')
  const [standardId, setStandardId] = useState('')
  const [samplingPlan, setSamplingPlan] = useState('')
  const [status, setStatus] = useState<QualityInspectionPlanStatus>('active')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    ;(async () => {
      try {
        const [checklistList, standardList] = await Promise.all([qualityApi.listChecklists(), qualityApi.listStandards()])
        setChecklists(Array.isArray(checklistList) ? checklistList : [])
        setStandards(Array.isArray(standardList) ? standardList : [])
      } catch (err: any) {
        setError(extractErrorMessages(err, 'Failed to load form options.'))
      }
    })()
  }, [isAuthorized])

  const handleSubmit = async () => {
    setError('')
    if (!itemName.trim()) { setError('Item name is required.'); return }

    setSubmitting(true)
    try {
      const plan = await qualityApi.createInspectionPlan({
        item_name: itemName.trim(),
        item_code: itemCode.trim() || undefined,
        inspection_type: inspectionType,
        checklist_id: checklistId ? Number(checklistId) : undefined,
        standard_id: standardId ? Number(standardId) : undefined,
        sampling_plan: samplingPlan.trim() || undefined,
        status,
      })
      router.push(`/dashboard/quality/inspection-plans/${plan.id}`)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to create Inspection Plan.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  return (
    <div style={{ width: '100%' }}>
      <QualityNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Quality Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>New Inspection Plan</h1>
        </div>
        <button onClick={() => router.push('/dashboard/quality/inspection-plans')} type="button" style={secondaryBtnStyle}>← Back</button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      <div style={sectionStyle}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT.heading, margin: '0 0 14px' }}>Plan Details</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <label style={labelStyle}>Item Name *</label>
            <input style={inputStyle} value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Item Code</label>
            <input style={inputStyle} value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 180px', minWidth: 160 }}>
            <label style={labelStyle}>Inspection Type *</label>
            <select style={inputStyle} value={inspectionType} onChange={(e) => setInspectionType(e.target.value as QualityInspectionType)}>
              <option value="incoming">Incoming</option>
              <option value="in_process">In-Process</option>
              <option value="final">Final</option>
            </select>
          </div>
          <div style={{ flex: '0 1 160px', minWidth: 140 }}>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as QualityInspectionPlanStatus)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={labelStyle}>Checklist</label>
            <SearchableSelect
              value={checklistId}
              onChange={setChecklistId}
              options={checklists.map((c) => ({ value: String(c.id), label: c.name }))}
              placeholder="Search checklist…"
            />
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 220 }}>
            <label style={labelStyle}>Standard</label>
            <SearchableSelect
              value={standardId}
              onChange={setStandardId}
              options={standards.map((s) => ({ value: String(s.id), label: `${s.standard_code} — ${s.title}` }))}
              placeholder="Search standard…"
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Sampling Plan</label>
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={samplingPlan} onChange={(e) => setSamplingPlan(e.target.value)} placeholder="e.g. AQL 1.0, Level II" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={() => router.push('/dashboard/quality/inspection-plans')} type="button" style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${BORDER.normal}`, background: 'transparent', color: TEXT.secondary, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={submitting} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Saving…' : 'Save Inspection Plan'}
        </button>
      </div>
    </div>
  )
}
