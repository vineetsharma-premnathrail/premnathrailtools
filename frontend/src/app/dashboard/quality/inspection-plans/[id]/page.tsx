'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { qualityApi } from '@/lib/api'
import { QualityChecklist, QualityInspectionPlan, QualityInspectionPlanStatus, QualityInspectionType, QualityStandard } from '@/types'
import { TEXT, GLASS, SHADOWS, GRADIENTS, BORDER, DANGER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { secondaryBtnStyle } from '@/components/shared/ui'
import QualityNav from '@/components/quality/QualityNav'
import ConfirmDialog from '@/components/erp/ConfirmDialog'
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

export default function QualityInspectionPlanDetailPage() {
  const { isAuthorized, isLoading } = useRequireApp('quality')
  const router = useRouter()
  const params = useParams()
  const planId = Number(params.id)

  const [plan, setPlan] = useState<QualityInspectionPlan | null>(null)
  const [checklists, setChecklists] = useState<QualityChecklist[]>([])
  const [standards, setStandards] = useState<QualityStandard[]>([])
  const [loading, setLoading] = useState(true)

  const [itemName, setItemName] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [inspectionType, setInspectionType] = useState<QualityInspectionType>('incoming')
  const [checklistId, setChecklistId] = useState('')
  const [standardId, setStandardId] = useState('')
  const [samplingPlan, setSamplingPlan] = useState('')
  const [status, setStatus] = useState<QualityInspectionPlanStatus>('active')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized || !planId) return
    ;(async () => {
      try {
        const [p, checklistList, standardList] = await Promise.all([
          qualityApi.getInspectionPlan(planId),
          qualityApi.listChecklists(),
          qualityApi.listStandards(),
        ])
        setPlan(p)
        setChecklists(Array.isArray(checklistList) ? checklistList : [])
        setStandards(Array.isArray(standardList) ? standardList : [])
        setItemName(p.item_name)
        setItemCode(p.item_code || '')
        setInspectionType(p.inspection_type)
        setChecklistId(p.checklist_id ? String(p.checklist_id) : '')
        setStandardId(p.standard_id ? String(p.standard_id) : '')
        setSamplingPlan(p.sampling_plan || '')
        setStatus(p.status)
      } catch (err: any) {
        setError(extractErrorMessages(err, 'Failed to load Inspection Plan.'))
      } finally {
        setLoading(false)
      }
    })()
  }, [isAuthorized, planId])

  if (isLoading || !isAuthorized) return null
  if (loading || !plan) return null

  const handleSave = async () => {
    setError('')
    if (!itemName.trim()) { setError('Item name is required.'); return }

    setSaving(true)
    try {
      const updated = await qualityApi.updateInspectionPlan(planId, {
        item_name: itemName.trim(),
        item_code: itemCode.trim() || undefined,
        inspection_type: inspectionType,
        checklist_id: checklistId ? Number(checklistId) : undefined,
        standard_id: standardId ? Number(standardId) : undefined,
        sampling_plan: samplingPlan.trim() || undefined,
        status,
      })
      setPlan(updated)
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to save Inspection Plan.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError('')
    setDeleting(true)
    try {
      await qualityApi.deleteInspectionPlan(planId)
      router.push('/dashboard/quality/inspection-plans')
    } catch (err: any) {
      setError(extractErrorMessages(err, 'Failed to delete Inspection Plan.'))
      setDeleting(false)
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <QualityNav />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
            Quality Module
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 20px' }}>{plan.plan_number}</h1>
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
          <textarea style={{ ...inputStyle, minHeight: 60 }} value={samplingPlan} onChange={(e) => setSamplingPlan(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={deleting}
          type="button"
          style={{ padding: '12px 22px', borderRadius: 12, border: `1px solid ${DANGER.border}`, background: DANGER.light, color: DANGER.text, fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
        >
          {deleting ? 'Deleting…' : 'Delete Plan'}
        </button>
        <button onClick={handleSave} disabled={saving} type="button" style={{ padding: '12px 26px', borderRadius: 12, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', background: GRADIENTS.primary, color: '#fff', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this Inspection Plan?"
        message={`This permanently deletes "${plan.plan_number}". This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
