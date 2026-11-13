'use client'

// Share a document with colleagues inside the portal: each one gets a bell notification that opens it.

import { useEffect, useState } from 'react'
import { FormSheet, SheetError, SheetField, SheetIcon, Optional, sheetBtn, sheetInput, SHEET } from '@/components/shared/FormSheet'
import { extractErrorMessages } from '@/lib/validation'
import { useAuthStore } from '@/store/authStore'
import { salesLibraryApi, type LibDocument } from '@/lib/salesLibraryApi'
import { MultiPicker, errorText } from '@/components/crm/library/libraryUi'

export default function ShareSheet({ doc, onClose, onShared }: { doc: LibDocument; onClose: () => void; /** `skipped` = who was not notified and why (empty when everyone was). */
  onShared: (sent: number, skipped: string) => void }) {
  const me = useAuthStore((s) => s.user?.id)
  const [users, setUsers] = useState<{ value: string; label: string }[]>([])
  const [loadError, setLoadError] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | string[]>('')

  useEffect(() => {
    let live = true
    salesLibraryApi.listUsers()
      .then((rows) => { if (live) setUsers(rows.filter((u) => u.id !== me).sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ value: String(u.id), label: u.department ? `${u.name} — ${u.department}` : u.name }))) })
      .catch(async (err) => { if (live) setLoadError(await errorText(err, 'The list of colleagues could not be loaded. Reload the page and try again.')) })
    return () => { live = false }
  }, [me])

  const submit = async () => {
    setError('')
    if (!picked.length) { setError('Pick at least one colleague to share with.'); return }
    setBusy(true)
    try {
      const res = await salesLibraryApi.share(doc.id, { user_ids: picked.map(Number), message: message.trim() || undefined })
      const skipped = res.skipped?.length ?? 0
      onShared(res.sent, skipped
        ? `${skipped} ${skipped === 1 ? 'person' : 'people'} can't receive this file — they need CRM › Sales Library access (and Confidential folders for a confidential file). Ask an admin to grant it.`
        : '')
    } catch (err) {
      setError(extractErrorMessages(err, 'The document could not be shared. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet width={560} icon="send" busy={busy} onClose={onClose} onSubmit={submit} title="Share document"
      subtitle={`${doc.title} — colleagues get a notification that opens it in the Sales Library.`}
      footer={<>
        <button type="button" onClick={onClose} disabled={busy} style={sheetBtn('secondary', SHEET.INK, busy)}>Cancel</button>
        <button type="submit" disabled={busy || !!loadError} style={sheetBtn('primary', SHEET.BLUE, busy || !!loadError)}><SheetIcon name="send" size={16} />{busy ? 'Sharing…' : 'Share'}</button>
      </>}>
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SheetError error={error || loadError} />
        <SheetField label="Share with" required hint="Only people who can open the Sales Library (and this folder, if it is confidential) will be able to open it.">
          <div><MultiPicker options={users} selected={picked} onChange={setPicked} placeholder="Add a colleague…" hex="#2563eb" disabled={busy} /></div>
        </SheetField>
        <SheetField label={<>Message <Optional /></>}>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500} placeholder="e.g. Use this brochure for the Northern Railway tender" style={{ ...sheetInput, resize: 'vertical' }} />
        </SheetField>
      </div>
    </FormSheet>
  )
}
