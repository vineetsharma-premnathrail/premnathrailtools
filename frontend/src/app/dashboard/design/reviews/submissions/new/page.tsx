'use client'

import AnchoredDropdown from '@/components/design/AnchoredDropdown'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRequireApp } from '@/hooks/useAuth'
import { designApi } from '@/lib/api'
import { DesignLookupOption } from '@/types'
import DesignNav from '@/components/design/DesignNav'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { FormPage, SheetColumns, SheetSection, SheetIcon, SHEET, Req, Optional, sheetBtn, sheetInput, sheetLabel, sheetHint, SheetError } from '@/components/shared/FormSheet'
import { useDesignMe } from '@/components/design/useDesignMe'
import { toOptions } from '@/components/design/designMeta'
import { extractErrorMessages } from '@/lib/validation'
import { recordPath } from '@/lib/recordRef'
import { chipBtnStyle, pillStyle } from '@/components/shared/ui'

export default function NewCustomerSubmissionPage() {
  const { isAuthorized, isLoading } = useRequireApp('design')
  const router = useRouter()
  // Preparing a customer submission is Design-team only (backend require_team).
  const me = useDesignMe(isAuthorized)
  const canSave = !!me?.is_team

  const [customers, setCustomers] = useState<DesignLookupOption[]>([])
  const [projects, setProjects] = useState<DesignLookupOption[]>([])
  const [machines, setMachines] = useState<DesignLookupOption[]>([])
  const [awaiting, setAwaiting] = useState<DesignLookupOption[]>([])
  const [awaitingFor, setAwaitingFor] = useState<string | null>(null)

  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [pmProjectId, setPmProjectId] = useState('')
  const [erpProjectId, setErpProjectId] = useState('')
  const [coverNote, setCoverNote] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [search, setSearch] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    if (!isAuthorized) return
    Promise.all([designApi.lookupCustomers(), designApi.lookupProjects(), designApi.lookupMachines()])
      .then(([c, p, m]) => { setCustomers(c); setProjects(p); setMachines(m) })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the form options — refresh the page to try again.')))
  }, [isAuthorized])

  // Drawings approved internally and waiting on this customer (or on any
  // customer while none is picked).
  useEffect(() => {
    if (!isAuthorized) return
    designApi.lookupAwaitingCustomer(customerId ? Number(customerId) : null)
      .then((rows) => {
        setAwaiting(rows)
        setSelectedIds((prev) => prev.filter((id) => rows.some((r) => r.id === id)))
      })
      .catch((err) => setError(extractErrorMessages(err, 'Failed to load the drawings waiting on the customer.')))
      .finally(() => setAwaitingFor(customerId))
  }, [isAuthorized, customerId])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return awaiting.filter((a) => !selectedIds.includes(a.id) && a.label.toLowerCase().includes(q)).slice(0, 8)
  }, [search, awaiting, selectedIds])
  const awaitingLoading = awaitingFor !== customerId
  const unpicked = awaiting.filter((a) => !selectedIds.includes(a.id))

  if (isLoading || !isAuthorized) return null

  const submit = async () => {
    if (!customerId && customerName.trim().length < 2) { setError('Pick the customer, or type the customer name if they are not in the customer list.'); return }
    if (selectedIds.length === 0) { setError('Add at least one drawing to send — only drawings approved internally and marked "customer approval required" can be submitted.'); return }
    setSaving(true)
    setError('')
    try {
      const sub = await designApi.createSubmission({
        customer_id: customerId ? Number(customerId) : null,
        customer_name: customerId ? null : customerName.trim(),
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        pm_project_id: pmProjectId ? Number(pmProjectId) : null,
        erp_project_id: erpProjectId ? Number(erpProjectId) : null,
        cover_note: coverNote.trim() || null,
        lines: selectedIds.map((id) => ({ revision_id: id })),
      })
      router.push(recordPath('/dashboard/design/reviews/submissions', sub))
    } catch (err) {
      setError(extractErrorMessages(err, 'Failed to create the submission.'))
      setSaving(false)
    }
  }

  const label = (id: number) => {
    const a = awaiting.find((x) => x.id === id)
    return a ? a.code || a.label : `Revision #${id}`
  }

  return (
    <FormPage
      nav={<DesignNav />}
      tour="design-subnew-form" backTour="design-subnew-back-btn"
      icon="send"
      title="New Customer Submission"
      subtitle="Saved as a draft transmittal — send it from its page once the drawing list is final."
      onBack={() => router.push('/dashboard/design/reviews')}
      footer={<>
        <button type="button" data-tour="design-subnew-cancel-btn" onClick={() => router.push('/dashboard/design/reviews')} style={sheetBtn('secondary', SHEET.INK, saving)} disabled={saving}>Cancel</button>
        {canSave && (
          <button type="button" data-tour="design-subnew-save-btn" onClick={submit} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
            <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Save Draft'}
          </button>
        )}
      </>}
    >
      <SheetColumns
        left={<>
          <SheetError error={error} />
          {me && !me.is_team && (
            <SheetError error="Only members of the Design team can prepare customer submissions. Ask the Design head to add you to the team in Design › Settings if you need to." />
          )}
          <SheetSection icon="building" title="Customer">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div data-tour="design-subnew-customer" style={{ flex: '1 1 240px', maxWidth: 380 }}>
                <label style={sheetLabel}>Customer <Req /></label>
                <SearchableSelect value={customerId} onChange={setCustomerId} options={toOptions(customers, 'Not in the customer list')} placeholder="Select customer…" />
              </div>
              {!customerId && (
                <div data-tour="design-subnew-customer-name" style={{ flex: '1 1 220px', maxWidth: 340 }}>
                  <label style={sheetLabel}>Customer name <Req /></label>
                  <input style={sheetInput} value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={255} placeholder="e.g. RDSO, Lucknow" />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
              <div data-tour="design-subnew-contact" style={{ flex: '1 1 200px', maxWidth: 300 }}>
                <label style={sheetLabel}>Contact name <Optional /></label>
                <input style={sheetInput} value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={255} />
              </div>
              <div data-tour="design-subnew-email" style={{ flex: '1 1 220px', maxWidth: 320 }}>
                <label style={sheetLabel}>Contact email <Optional /></label>
                <input type="email" style={sheetInput} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={255} />
              </div>
            </div>
          </SheetSection>

          <div data-tour="design-subnew-drawings">
            <SheetSection icon="doc" title="Drawings to send" extra={<Req />}>
              <p style={{ ...sheetHint, margin: '0 0 10px' }}>
                Only revisions approved internally and waiting on {customerId ? 'this customer' : 'a customer'} are listed{awaitingLoading ? ' (loading…)' : ` — ${awaiting.length} available`}.
              </p>
              {selectedIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {selectedIds.map((id) => (
                    <span key={id} style={{ ...pillStyle(SHEET.BLUE), gap: 6, padding: '4px 10px', fontSize: 12 }}>
                      {label(id)}
                      <span onClick={() => setSelectedIds((prev) => prev.filter((x) => x !== id))} style={{ cursor: 'pointer', fontSize: 14, lineHeight: 1 }} aria-label="Remove drawing">×</span>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ position: 'relative', maxWidth: 520 }}>
                <input data-tour="design-subnew-search" style={sheetInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by drawing number or title to add…" />
                {matches.length > 0 && (
                  <AnchoredDropdown style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                    {matches.map((a) => (
                      <div key={a.id} onClick={() => { setSelectedIds((prev) => [...prev, a.id]); setSearch('') }}
                        style={{ padding: '8px 12px', fontSize: 13, cursor: 'pointer', borderTop: `1px solid ${SHEET.LINE}` }}>
                        {a.label}
                      </div>
                    ))}
                  </AnchoredDropdown>
                )}
              </div>
              {unpicked.length > 0 && unpicked.length <= 12 && !search.trim() && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {unpicked.map((a) => (
                    <button key={a.id} type="button" onClick={() => setSelectedIds((prev) => [...prev, a.id])} title={a.label} style={{ ...chipBtnStyle(false), border: '1px dashed #cbd5e1' }}>
                      + {a.code || a.label}
                    </button>
                  ))}
                </div>
              )}
              {!awaitingLoading && awaiting.length === 0 && (
                <p style={{ fontSize: 13, color: SHEET.MUTED, margin: '10px 0 0' }}>
                  No drawings are waiting on {customerId ? 'this customer' : 'a customer'}. A drawing appears here once its revision is approved internally and the drawing is marked &quot;customer approval required&quot;.
                </p>
              )}
            </SheetSection>
          </div>
        </>}
        right={<>
          <SheetSection icon="link" title="Links" extra={<Optional />}>
            <div data-tour="design-subnew-project" style={{ marginBottom: 12 }}>
              <label style={sheetLabel}>Project</label>
              <SearchableSelect value={pmProjectId} onChange={setPmProjectId} options={toOptions(projects, 'None')} placeholder="Select project…" />
            </div>
            <div data-tour="design-subnew-machine">
              <label style={sheetLabel}>Machine</label>
              <SearchableSelect value={erpProjectId} onChange={setErpProjectId} options={toOptions(machines, 'None')} placeholder="Select machine…" />
            </div>
          </SheetSection>
          <SheetSection icon="chat" title="Cover note" extra={<Optional />}>
            <div data-tour="design-subnew-cover">
              <textarea style={{ ...sheetInput, minHeight: 110, resize: 'vertical' }} value={coverNote} onChange={(e) => setCoverNote(e.target.value)} maxLength={8000}
                placeholder="e.g. Please review and return with your approval / comments within 15 days." />
              <p style={sheetHint}>Printed on the transmittal.</p>
            </div>
          </SheetSection>
        </>}
      />
    </FormPage>
  )
}
