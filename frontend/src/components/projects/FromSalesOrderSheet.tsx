'use client'

// All Projects › From Sales Order: the Project Manager creates the PEW project of a
// confirmed New Project sales order (owner, 2026-10-28 — the order never creates it
// itself). Picks the order and the project manager; the units (vehicles / lots)
// come from the order's delivery rows.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { projectsApi, usersApi } from '@/lib/api'
import { DirectoryUser } from '@/types'
import { FormSheet, SheetError, SheetField, SheetSection, Optional, sheetBtn, sheetInput } from '@/components/shared/FormSheet'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { recordPath } from '@/lib/recordRef'
import { extractErrorMessages } from '@/lib/validation'

export type AwaitingSalesOrder = Awaited<ReturnType<typeof projectsApi.salesOrdersAwaitingProject>>[number]

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export function awaitingLabel(o: AwaitingSalesOrder): string {
  return [o.so_number, o.customer_name || 'Customer', `PO ${o.customer_po_number || '—'}`, `${o.vehicles} vehicle${o.vehicles === 1 ? '' : 's'}`].join(' — ')
}

export default function FromSalesOrderSheet({ orders, onClose }: { orders: AwaitingSalesOrder[]; onClose: () => void }) {
  const router = useRouter()
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [soId, setSoId] = useState(orders.length === 1 ? String(orders[0].id) : '')
  const [pmId, setPmId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string[] | null>(null)

  useEffect(() => { usersApi.directory().then(setUsers).catch(() => setUsers([])) }, [])

  const so = orders.find((o) => String(o.id) === soId)
  const defaultName = so ? `${so.customer_name || 'Customer'} — ${so.customer_po_number || so.so_number}` : 'Customer — PO number'

  const submit = async () => {
    const problems: string[] = []
    if (!soId) problems.push('Pick the sales order the project is for.')
    if (!pmId) problems.push('Pick the project manager who will run this project.')
    if (problems.length) { setError(problems); return }
    setBusy(true)
    setError(null)
    try {
      const created = await projectsApi.createFromSalesOrder({
        sales_order_id: Number(soId), project_manager_id: Number(pmId), ...(name.trim() ? { name: name.trim() } : {}),
      })
      router.push(recordPath('/dashboard/projects', created))
    } catch (e) {
      setError(extractErrorMessages(e, 'The project could not be created — check your connection and try again; if it keeps failing, refresh the page.'))
      setBusy(false)
    }
  }

  return (
    <FormSheet icon="building" title="Project from sales order" width={620} busy={busy} onClose={onClose} onSubmit={submit}
      subtitle="Creates the PEW project of a confirmed sales order; its vehicles / lots become the project's units."
      footer={<>
        <button type="button" style={sheetBtn('secondary')} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" style={sheetBtn('primary', undefined, busy || !orders.length)} disabled={busy || !orders.length}>{busy ? 'Creating…' : 'Create project'}</button>
      </>}>
      <div style={{ padding: '20px 24px' }}>
        <SheetError error={error} />
        {orders.length === 0 ? (
          <p style={{ fontSize: 13.5, color: '#64748b', margin: 0 }}>No confirmed sales order is waiting for a project.</p>
        ) : (
          <SheetSection icon="doc" title="Order & owner">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SheetField label="Sales order" required
                hint={so ? `Confirmed ${fmt(so.confirmed_at)}${so.sales_owner_name ? ` · sales owner ${so.sales_owner_name}` : ''} · delivery ${fmt(so.first_delivery_date)} to ${fmt(so.last_delivery_date)}` : undefined}>
                <SearchableSelect value={soId} onChange={setSoId} placeholder="Pick a confirmed sales order"
                  options={orders.map((o) => ({ value: String(o.id), label: awaitingLabel(o) }))} />
              </SheetField>
              <SheetField label="Project manager" required>
                <SearchableSelect value={pmId} onChange={setPmId} placeholder="Pick the project manager"
                  options={users.map((u) => ({ value: String(u.id), label: `${u.name}${u.designation ? ` — ${u.designation}` : ''}` }))} />
              </SheetField>
              <SheetField label={<>Project name <Optional /></>} hint="Leave blank to use the customer and PO number. The project number is the next PEW number.">
                <input style={sheetInput} value={name} maxLength={400} onChange={(e) => setName(e.target.value)} placeholder={defaultName} />
              </SheetField>
            </div>
          </SheetSection>
        )}
      </div>
    </FormSheet>
  )
}
