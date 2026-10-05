'use client'

import { useEffect, useState } from 'react'
import { useRequireApp } from '@/hooks/useAuth'
import { storeApi } from '@/lib/api'
import { StoreIssueRules, StoreDocType, StoreLocation } from '@/types'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'
import { primaryBtnStyle, secondaryBtnStyle } from '@/components/shared/ui'
import StoreNav from '@/components/store/StoreNav'
import StoreSettingsNav from '@/components/store/StoreSettingsNav'
import MessageDialog from '@/components/erp/MessageDialog'
import { extractErrorMessages } from '@/lib/validation'

const cardStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, flex: '1 1 280px',
}
const checkRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', fontSize: 13.5, color: TEXT.body, cursor: 'pointer' }
const headingStyle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 4px' }
const hintStyle: React.CSSProperties = { fontSize: 12, color: TEXT.muted, margin: '0 0 8px' }

type ListKey = keyof StoreIssueRules
const EMPTY: StoreIssueRules = { challan_issue_types: [], challan_location_ids: [], vendor_issue_types: [], return_date_issue_types: [] }
const key = (r: StoreIssueRules) => (Object.keys(EMPTY) as ListKey[]).map((k) => [...r[k]].map(String).sort().join(',')).join('|')

/** Store → Settings → Issue Rules: which extra fields a Material Issue must
 *  carry. Challan No. — when the issue type OR store is ticked. Vendor —
 *  when the issue type is ticked (material going out for job work / rework).
 *  Date — when the issue type is ticked (material that comes back). */
export default function StoreIssueRulesPage() {
  const { isAuthorized, isLoading } = useRequireApp('store')
  const [issueTypes, setIssueTypes] = useState<StoreDocType[]>([])
  const [locations, setLocations] = useState<StoreLocation[]>([])
  const [saved, setSaved] = useState<StoreIssueRules>(EMPTY)
  const [rules, setRules] = useState<StoreIssueRules>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([storeApi.listDocTypes('issue'), storeApi.listLocations(), storeApi.getIssueRules()])
      .then(([t, l, r]) => { setIssueTypes(t); setLocations(l); setSaved(r); setRules(r) })
      .catch((err) => setErrors(extractErrorMessages(err, 'Failed to load issue rules.')))
      .finally(() => setLoading(false))
  }, [isAuthorized])

  const toggle = (k: ListKey, v: string | number) =>
    setRules((r) => {
      const list = r[k] as (string | number)[]
      return { ...r, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] }
    })

  const save = async () => {
    setSaving(true)
    setErrors([])
    try {
      const res = await storeApi.setIssueRules(rules)
      setSaved(res)
      setRules(res)
      setNotice('Saved — new Material Issues now ask for Challan No. / Vendor / Date where these rules match.')
    } catch (err) {
      setErrors(extractErrorMessages(err, 'Could not save the issue rules.'))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !isAuthorized) return null

  const dirty = key(rules) !== key(saved)
  const checklist = (k: ListKey, options: { value: string | number; label: string }[], empty: string) => (
    <>
      {options.length === 0 && <p style={{ fontSize: 13, color: TEXT.muted }}>{empty}</p>}
      {options.map((o) => (
        <label key={o.value} style={checkRowStyle}>
          <input type="checkbox" checked={(rules[k] as (string | number)[]).includes(o.value)} onChange={() => toggle(k, o.value)} />
          {o.label}
        </label>
      ))}
    </>
  )
  const typeOptions = issueTypes.map((t) => ({ value: t.value, label: t.label }))
  const noTypes = 'No issue types — add them under Issue Types first.'

  return (
    <div>
      <StoreNav />

      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.muted, margin: '0 0 4px' }}>
          Store &amp; Inventory · Settings
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: TEXT.heading, margin: '0 0 4px' }}>Issue Rules</h1>
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 8px', maxWidth: 760 }}>
          Extra fields a Material Issue must carry. A <b>delivery challan</b> travels with goods leaving the premises without a sales invoice (job work, site, another unit). A <b>vendor</b> is needed when the material goes to an outside party — e.g. Rework or Machining done by a job worker — so you can track what is lying with whom. A <b>date</b> is needed when the material has to come back (machining, rework) — so overdue material can be chased.
        </p>
      </div>

      <StoreSettingsNav />

      <MessageDialog open={errors.length > 0} variant="error" title="Cannot Save Issue Rules" message={errors} onClose={() => setErrors([])} />
      <MessageDialog open={!!notice} variant="success" title="Issue Rules Saved" message={notice} onClose={() => setNotice('')} />

      {loading ? (
        <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20, maxWidth: 1100 }}>
            <div data-tour="challan-issue-types" style={cardStyle}>
              <h3 style={headingStyle}>Challan No. — by Issue Type</h3>
              <p style={hintStyle}>Mandatory when the issue uses a ticked type…</p>
              {checklist('challan_issue_types', typeOptions, noTypes)}
            </div>
            <div data-tour="challan-warehouses" style={cardStyle}>
              <h3 style={headingStyle}>Challan No. — by Store</h3>
              <p style={hintStyle}>…or is issued from a ticked store.</p>
              {checklist('challan_location_ids', locations.map((l) => ({ value: l.id, label: l.name })), 'No stores — add them under Stores first.')}
            </div>
            <div data-tour="vendor-issue-types" style={cardStyle}>
              <h3 style={headingStyle}>Vendor — by Issue Type</h3>
              <p style={hintStyle}>Mandatory when the issue uses a ticked type.</p>
              {checklist('vendor_issue_types', typeOptions, noTypes)}
            </div>
            <div data-tour="return-date-issue-types" style={cardStyle}>
              <h3 style={headingStyle}>Date — by Issue Type</h3>
              <p style={hintStyle}>Mandatory when the issue uses a ticked type.</p>
              {checklist('return_date_issue_types', typeOptions, noTypes)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button data-tour="issue-rules-save" disabled={saving || !dirty} onClick={save} style={{ ...primaryBtnStyle, opacity: saving || !dirty ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
            {dirty && <button disabled={saving} onClick={() => setRules(saved)} style={secondaryBtnStyle}>Discard changes</button>}
          </div>
        </>
      )}
    </div>
  )
}
