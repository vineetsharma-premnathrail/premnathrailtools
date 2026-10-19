'use client'

// Prototype / Research projects this requirement is being worked on in.
// The R&D head links an existing project (and can unlink it); everyone who
// can see the requirement sees the links and can jump to the project.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { rndApi } from '@/lib/api'
import { recordPath } from '@/lib/recordRef'
import { RndLinkedProject } from '@/types'
import { TEXT, BORDER, GLASS, SHADOWS, GRADIENTS } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'
import { useEscapeKey } from '@/hooks/useEscapeKey'
import { FormSheet, SheetSection, SheetIcon, Req, SHEET, sheetBtn, sheetLabel, sheetHint } from '@/components/shared/FormSheet'

const STATUS_HEX: Record<string, string> = { active: '#16A34A', on_hold: '#D97706', cancelled: '#78716c' }
const STATUS_LABELS: Record<string, string> = { active: 'Active', on_hold: 'On hold', cancelled: 'Cancelled' }

export default function RequirementProjectsCard({ source, recordId, isHead }: { source: 'inquiry' | 'tender'; recordId: number; isHead: boolean }) {
  const router = useRouter()
  const [linked, setLinked] = useState<RndLinkedProject[] | null>(null)
  const [options, setOptions] = useState<RndLinkedProject[]>([])
  const [picking, setPicking] = useState(false)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')
  useEscapeKey(picking && !busy, () => setPicking(false))

  useEffect(() => {
    rndApi.linkedProjects(source, recordId)
      .then(setLinked)
      .catch((err) => { setLinked([]); setError(extractErrorMessages(err, 'Could not load the linked projects.')) })
  }, [source, recordId])

  const openPicker = () => {
    setPicking(true)
    setPick('')
    setError('')
    rndApi.linkableProjects(source, recordId).then(setOptions).catch((err) => setError(extractErrorMessages(err, 'Could not load R&D projects.')))
  }

  const act = async (fn: () => Promise<RndLinkedProject[]>, fallback: string) => {
    setBusy(true)
    setError('')
    try {
      setLinked(await fn())
      setPicking(false)
      setPick('')
    } catch (err) {
      setError(extractErrorMessages(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  if (linked === null) return null
  if (!isHead && linked.length === 0) return null

  return (
    <div data-tour="rnd-req-projects" style={{ borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur, border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: TEXT.heading, margin: 0 }}>Prototype / Research</p>
        {isHead && !picking && (
          <button type="button" onClick={openPicker} style={{ padding: '7px 14px', borderRadius: 10, border: 'none', background: GRADIENTS.primary, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Link project
          </button>
        )}
      </div>

      {error && !picking && (
        <div style={{ padding: '8px 12px', marginTop: 10, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 12.5 }}>
          {Array.isArray(error) ? error.join(' ') : error}
        </div>
      )}

      {picking && isHead && (
        <FormSheet tour="rnd-req-projects-link" width={580} icon="link" title="Link Project" subtitle="Work on this requirement in an existing prototype / research project."
          onClose={() => setPicking(false)} busy={busy}
          footer={<>
            <button type="button" onClick={() => setPicking(false)} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
            <button type="button" disabled={!pick || busy} onClick={() => act(() => rndApi.linkProject(source, recordId, Number(pick)), 'Could not link the project.')}
              style={sheetBtn('primary', SHEET.BLUE, !pick || busy)}>
              <SheetIcon name="link" size={16} />{busy ? 'Linking…' : 'Link'}
            </button>
          </>}>
          <div style={{ padding: '20px 24px' }}>
            {error && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
                {Array.isArray(error) ? error.join(' ') : error}
              </div>
            )}
            <SheetSection icon="flag" title="Project">
              <label style={sheetLabel}>R&amp;D project <Req /></label>
              <SearchableSelect value={pick} onChange={setPick}
                placeholder={options.length ? 'Select an existing R&D project…' : 'No other active project to link'}
                options={options.map((p) => ({ value: String(p.id), label: `${p.project_number} — ${p.title}` }))} />
              <p style={sheetHint}>Everyone who can see the requirement sees the link and can open the project. Unlinking later doesn&apos;t change the project.</p>
            </SheetSection>
          </div>
        </FormSheet>
      )}

      {linked.length === 0 ? (
        !picking && <p style={{ fontSize: 13, color: TEXT.muted, margin: '8px 0 0' }}>Not linked to any prototype / research project yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {linked.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, border: `1px solid ${BORDER.light}`, background: 'rgba(255,255,255,0.6)' }}>
              <div onClick={() => router.push(recordPath('/dashboard/rnd/projects', p))} style={{ flex: '1 1 260px', minWidth: 0, cursor: 'pointer' }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#FF6A2A', margin: 0 }}>{p.project_number} <span style={{ color: TEXT.heading }}>· {p.title}</span></p>
                <p style={{ fontSize: 12, color: TEXT.muted, margin: '2px 0 0' }}>
                  {p.stage_label}{p.lead_name ? ` · Lead: ${p.lead_name}` : ''}{p.linked_by ? ` · linked by ${p.linked_by}` : ''}
                </p>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[p.status] || '#78716c'}1a`, color: STATUS_HEX[p.status] || '#78716c' }}>{STATUS_LABELS[p.status] || p.status}</span>
              {isHead && (
                <button type="button" disabled={busy} onClick={() => act(() => rndApi.unlinkProject(source, recordId, p.id), 'Could not unlink the project.')}
                  title="Unlink — the project itself is not changed"
                  style={{ background: 'none', border: 'none', fontSize: 12, fontWeight: 600, color: '#DC2626', cursor: 'pointer' }}>Unlink</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
