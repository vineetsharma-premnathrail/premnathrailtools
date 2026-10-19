'use client'

import { useCallback, useRef, useState } from 'react'
import { FormSheet, SheetSection, SheetIcon, Optional, Req, SHEET, sheetBtn, sheetInput, sheetLabel, sheetHint } from '@/components/shared/FormSheet'
import { grcApi, SodConflict } from '@/lib/basisApi'

const RISK_HEX: Record<string, string> = { high: '#DC2626', medium: '#F59E0B' }

/**
 * Segregation of Duties guard for role / extra-grant saves (backend
 * core/sod_rules.py). `guard` previews the change; when it adds a conflict
 * the user sees what clashes and why — a HIGH risk conflict needs a
 * mitigation reason (who checks this person's work) before it saves, a
 * medium one only a confirmation. Render `dialog` once in the page.
 */
export function useSodGuard() {
  const [conflicts, setConflicts] = useState<SodConflict[] | null>(null)
  const [reason, setReason] = useState('')
  const pending = useRef<{ resolve: (reason: string | undefined) => void; reject: (e: unknown) => void } | null>(null)

  const guard = useCallback(async <T,>(
    userId: number,
    planned: { role_ids?: number[]; granular_permissions?: string[] },
    save: (reason?: string) => Promise<T>,
  ): Promise<T> => {
    const preview = await grcApi.sodPreview({ user_id: userId, ...planned })
    if (!preview.new_conflicts.length) return save()
    const reason = await new Promise<string | undefined>((resolve, reject) => {
      pending.current = { resolve, reject }
      setReason('')
      setConflicts(preview.new_conflicts)
    })
    return save(reason)
  }, [])

  const high = (conflicts || []).some((c) => c.risk === 'high')
  const blocked = high && !reason.trim()
  const confirm = () => {
    if (blocked) return
    setConflicts(null)
    pending.current?.resolve(reason.trim() || undefined)
    pending.current = null
  }
  const cancel = () => {
    setConflicts(null)
    // Shaped like an API error so the page's extractErrorMessages shows the text.
    pending.current?.reject({ response: { data: { detail: 'Not saved — the Segregation of Duties conflict was not accepted. Remove the conflicting role or give a mitigation reason.' } } })
    pending.current = null
  }

  const dialog = conflicts ? (
    <FormSheet width={580} icon="shield" iconColor={high ? '#DC2626' : '#F59E0B'}
      title={high ? 'Segregation of Duties conflict — mitigation needed' : 'Segregation of Duties warning'}
      subtitle={high ? 'Enter the mitigating control (who reviews their work, until when) to assign it anyway.' : 'You can save anyway; a reason is recorded if you give one.'}
      onClose={cancel} busy={false}
      footer={<>
        <button type="button" onClick={cancel} style={sheetBtn('secondary', SHEET.INK)}>Cancel</button>
        <button type="button" onClick={confirm} disabled={blocked} style={sheetBtn('primary', '#DC2626', blocked)}>
          <SheetIcon name="shield" size={16} />Assign anyway
        </button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetSection icon="alert" title="What clashes" color={high ? '#DC2626' : '#F59E0B'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {conflicts.map((c) => (
              <div key={c.rule_id} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${SHEET.LINE}`, background: SHEET.SOFT }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 13, color: SHEET.INK }}>{c.rule_id} {c.title}</b>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: `${RISK_HEX[c.risk] || '#78716c'}1a`, color: RISK_HEX[c.risk] || '#78716c' }}>{c.risk} risk</span>
                </div>
                <p style={{ fontSize: 12.5, color: SHEET.BODY, margin: '4px 0 0' }}>{c.why}</p>
              </div>
            ))}
          </div>
        </SheetSection>
        <SheetSection icon="chat" title={high ? 'Mitigating control' : 'Reason'}>
          <label style={sheetLabel}>{high ? 'Who checks this person’s work, and until when?' : 'Why is this needed?'} {high ? <Req /> : <Optional />}</label>
          <textarea style={{ ...sheetInput, minHeight: 80 }} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
            placeholder={high ? 'e.g. Finance manager reviews every JV this user posts, until 31-03-2027' : 'Optional reason…'} />
          <p style={sheetHint}>{high ? 'Recorded as the mitigation for this conflict (Organization › Access Risk › Mitigations).' : 'Recorded with the assignment.'}</p>
        </SheetSection>
      </div>
    </FormSheet>
  ) : null
  return { guard, dialog }
}
