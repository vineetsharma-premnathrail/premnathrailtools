'use client'

// R&D head only: who else may see this requirement and what they may do.
// Rights are separate on purpose — View alone lets someone read the
// requirement; Download opens the TOR / client documents; Upload adds R&D
// documents; Respond sends the formal R&D answer back to CRM.

import { useEffect, useState } from 'react'
import { rndApi } from '@/lib/api'
import { RndPerson, RndRequirementAccessRow } from '@/types'
import { TEXT, BORDER, SHADOWS, GLASS } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import Checkbox from '@/components/Checkbox'
import { dangerBtnStyle, primaryBtnStyle, RowCount } from '@/components/shared/ui'
import { extractErrorMessages } from '@/lib/validation'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

type Row = Omit<RndRequirementAccessRow, 'granted_by'>
const RIGHTS = [
  { key: 'can_view', label: 'View', hint: 'Open the requirement and its discussion' },
  { key: 'can_download', label: 'Download', hint: 'Open/download the TOR and documents' },
  { key: 'can_upload', label: 'Upload', hint: 'Add R&D documents' },
  { key: 'can_respond', label: 'Respond', hint: 'Send the R&D response to CRM' },
] as const

const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 16,
}
const primaryBtn: React.CSSProperties = { ...primaryBtnStyle, boxShadow: `0 6px 16px ${SHADOWS.glowOrange}` }

/** canEdit: the role's R&D › Requirements › Access 'edit' (default true) — without it the list is read-only. */
export default function RequirementAccessTab({ source, recordId, canEdit = true }: { source: 'inquiry' | 'tender'; recordId: number; canEdit?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [people, setPeople] = useState<RndPerson[]>([])
  const [adding, setAdding] = useState('')
  const [error, setError] = useState<string | string[]>('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // "Give access" popup: the person and their rights, saved straight away.
  const [grantOpen, setGrantOpen] = useState(false)
  const [grant, setGrant] = useState<Omit<Row, 'user_id' | 'name'>>({ can_view: true, can_download: true, can_upload: false, can_respond: false })
  const [grantError, setGrantError] = useState<string | string[]>('')
  useEscapeKey(grantOpen && !saving, () => setGrantOpen(false))

  useEffect(() => {
    rndApi.getAccess(source, recordId)
      .then((r) => setRows(r))
      .catch((err) => { setRows([]); setError(extractErrorMessages(err, 'Could not load who has access.')) })
    rndApi.people().then(setPeople).catch(() => setPeople([]))
  }, [source, recordId])

  if (rows === null) return <p style={{ fontSize: 13, color: TEXT.muted }}>Loading…</p>

  // Heads already have every right — no point listing them.
  const options = people
    .filter((p) => p.team_role !== 'head' && !rows.some((r) => r.user_id === p.id))
    .map((p) => ({ value: String(p.id), label: p.designation ? `${p.name} — ${p.designation}` : p.name }))

  const setRight = (uid: number, key: typeof RIGHTS[number]['key'], value: boolean) => {
    setSaved(false)
    setRows(rows.map((r) => {
      if (r.user_id !== uid) return r
      const next = { ...r, [key]: value }
      // Every other right needs View; un-ticking View clears them.
      if (key === 'can_view' && !value) return { ...next, can_download: false, can_upload: false, can_respond: false }
      if (key !== 'can_view' && value) return { ...next, can_view: true }
      return next
    }))
  }

  const save = async (list: Row[] = rows, fromPopup = false) => {
    setSaving(true)
    setError('')
    setGrantError('')
    try {
      const out = await rndApi.saveAccess(source, recordId, list.map(({ user_id, can_view, can_download, can_upload, can_respond }) => ({ user_id, can_view, can_download, can_upload, can_respond })))
      setRows(out)
      setSaved(true)
      if (fromPopup) setGrantOpen(false)
    } catch (err) {
      ;(fromPopup ? setGrantError : setError)(extractErrorMessages(err, 'Could not save access.'))
    } finally {
      setSaving(false)
    }
  }

  const openGrant = () => {
    setAdding('')
    setGrant({ can_view: true, can_download: true, can_upload: false, can_respond: false })
    setGrantError('')
    setGrantOpen(true)
  }
  const setGrantRight = (key: typeof RIGHTS[number]['key'], value: boolean) => {
    const next = { ...grant, [key]: value }
    // Same rule as the table: every other right needs View.
    if (key === 'can_view' && !value) setGrant({ ...next, can_download: false, can_upload: false, can_respond: false })
    else if (key !== 'can_view' && value) setGrant({ ...next, can_view: true })
    else setGrant(next)
  }
  const submitGrant = () => {
    if (!adding) { setGrantError('Pick the R&D person to give access to.'); return }
    if (!grant.can_view) { setGrantError('Tick at least View — without it the person can’t open the requirement.'); return }
    const p = people.find((x) => x.id === Number(adding))
    save([...rows, { user_id: Number(adding), name: p?.name || '', ...grant }], true)
  }

  return (
    <div data-tour="rnd-req-access" style={sectionStyle}>
      <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.secondary, margin: '0 0 6px' }}>Who can work on this requirement</p>
      <p style={{ fontSize: 12.5, color: TEXT.muted, margin: '0 0 14px', lineHeight: 1.55 }}>
        R&amp;D heads and admins always have every right. Anyone else sees this requirement only if listed here. Giving someone a task adds View + Download for them automatically.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 14px' }}>Only the R&amp;D head(s) can see this requirement.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.05em', padding: '6px 8px' }}>Person <RowCount count={rows.length} /></th>
                {RIGHTS.map((r) => (
                  <th key={r.key} title={r.hint} style={{ fontSize: 11, fontWeight: 700, color: TEXT.muted, textTransform: 'uppercase', letterSpacing: '.05em', padding: '6px 8px', width: 90 }}>{r.label}</th>
                ))}
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id} style={{ borderTop: `1px solid ${BORDER.light}` }}>
                  <td style={{ padding: '8px', fontSize: 13, color: TEXT.heading, fontWeight: 600 }}>{row.name || people.find((p) => p.id === row.user_id)?.name || `User #${row.user_id}`}</td>
                  {RIGHTS.map((r) => (
                    <td key={r.key} style={{ padding: '8px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex' }}><Checkbox checked={row[r.key]} onChange={() => { if (canEdit) setRight(row.user_id, r.key, !row[r.key]) }} /></span>
                    </td>
                  ))}
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    {canEdit && <button type="button" onClick={() => { setSaved(false); setRows(rows.filter((x) => x.user_id !== row.user_id)) }} style={{ ...dangerBtnStyle, padding: '5px 10px', fontSize: 11.5 }}>Remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button data-tour="rnd-req-access-add" type="button" onClick={openGrant} disabled={saving || options.length === 0}
          title={options.length ? undefined : 'Everyone in R&D is already listed'}
          style={{ ...sheetBtn('secondary', SHEET.INK, saving || options.length === 0) }}>
          <SheetIcon name="plus" size={15} color={SHEET.BLUE} />Give someone access
        </button>
        {rows.length > 0 && (
          <button type="button" onClick={() => save()} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving && !grantOpen ? 'Saving…' : 'Save access'}</button>
        )}
        {saved && <span style={{ fontSize: 12.5, color: '#16A34A', fontWeight: 600 }}>Saved.</span>}
      </div>}

      {grantOpen && (
        <FormSheet tour="rnd-req-access-form" width={580} icon="shield" title="Give Access" subtitle="Who else may work on this requirement, and what they may do." onClose={() => setGrantOpen(false)} busy={saving}
          footer={<>
            <button type="button" onClick={() => setGrantOpen(false)} disabled={saving} style={sheetBtn('secondary', SHEET.INK, saving)}>Cancel</button>
            <button type="button" onClick={submitGrant} disabled={saving} style={sheetBtn('primary', SHEET.BLUE, saving)}>
              <SheetIcon name="check" size={16} />{saving ? 'Saving…' : 'Give access'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {grantError && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {Array.isArray(grantError) ? grantError.join(' ') : grantError}
              </div>
            )}
            <SheetSection icon="user" title="Person">
              <label style={sheetLabel}>R&amp;D person <Req /></label>
              <SearchableSelect value={adding} onChange={(v) => { setAdding(v); setGrantError('') }} placeholder="Select R&D person…" options={options} />
              <p style={sheetHint}>R&amp;D heads already have every right, so they aren&apos;t listed.</p>
            </SheetSection>
            <SheetSection icon="shield" title="Rights">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {RIGHTS.map((r) => (
                  <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ display: 'inline-flex' }}><Checkbox checked={grant[r.key]} onChange={() => setGrantRight(r.key, !grant[r.key])} /></span>
                    <span style={{ fontSize: 13, color: SHEET.INK, fontWeight: 600 }}>{r.label}</span>
                    <span style={{ fontSize: 12, color: SHEET.MUTED }}>{r.hint}</span>
                  </div>
                ))}
              </div>
              <p style={sheetHint}>Saved straight away{rows.length > 0 ? ' — any unsaved ticks in the table are saved with it' : ''}.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}
    </div>
  )
}
