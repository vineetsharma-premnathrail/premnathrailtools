'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { maintenanceApi } from '@/lib/api'
import { MaintenanceAssetOption } from '@/types'
import { TEXT, BORDER } from '@/lib/theme'
import SearchableSelect from '@/components/erp/SearchableSelect'
import { extractErrorMessages } from '@/lib/validation'

/** The lookup endpoint returns at most this many rows per call. */
const LOOKUP_CAP = 100

export function assetOptionLabel(a: MaintenanceAssetOption): string {
  return `${a.asset_code}${a.name ? ` — ${a.name}` : ''}${a.location_text ? ` (${a.location_text})` : ''}`
}

function mergeAssets(base: MaintenanceAssetOption[], extra: MaintenanceAssetOption[], prepend = false): MaintenanceAssetOption[] {
  const seen = new Set(base.map((a) => a.id))
  const fresh = extra.filter((a) => !seen.has(a.id))
  if (!fresh.length) return base
  return prepend ? [...fresh, ...base] : [...base, ...fresh]
}

/**
 * Asset picker for maintenance forms. The lookup endpoint caps at 100 rows,
 * so a plant with more machines needs a server-side search, and a preset asset
 * (QR scan, ?asset=, edit form) that isn't in the first 100 is fetched by id so
 * the selected machine's label is always visible.
 */
export default function MaintenanceAssetPicker({
  value,
  onChange,
  placeholder = 'Search by code, name or location…',
  includeIds,
  excludeIds,
  disabled = false,
  onSelectedOption,
  branchId,
  clearLabel,
  fallbackOption,
  rejectDecommissioned = false,
}: {
  value: number | null
  onChange: (id: number | null, option?: MaintenanceAssetOption) => void
  placeholder?: string
  /** Asset ids that must be present in the list even if outside the first 100. */
  includeIds?: number[]
  /** Asset ids to hide (e.g. the asset itself when picking its parent). */
  excludeIds?: number[]
  disabled?: boolean
  /** Fires with the full option once the selected asset is known (incl. a preset fetched by id). */
  onSelectedOption?: (option: MaintenanceAssetOption | null) => void
  /** Limit the list (and search) to one plant. */
  branchId?: number | null
  /** Adds a first "clear" row (e.g. "All assets") that sets the value to null. */
  clearLabel?: string
  /** Label to keep showing for an already-saved value the lookup no longer returns (e.g. editing a record whose asset was later decommissioned). */
  fallbackOption?: Pick<MaintenanceAssetOption, 'id' | 'asset_code' | 'name'> | null
  /** New requests / work orders: a preset asset that turns out to be decommissioned is cleared with a warning (the backend would reject it). */
  rejectDecommissioned?: boolean
}) {
  const [assets, setAssets] = useState<MaintenanceAssetOption[]>([])
  // Which plant filter the current list was loaded for ('' = all); the list is "loaded" once it matches.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const branchKey = branchId ? String(branchId) : ''
  const loaded = loadedFor === branchKey
  const [capped, setCapped] = useState(false)
  const [search, setSearch] = useState('')
  const [searchedTerm, setSearchedTerm] = useState('')
  const [loadError, setLoadError] = useState<string>('')
  // Warning shown after a preset asset was cleared (not found / decommissioned).
  const [missingNote, setMissingNote] = useState<string>('')
  const checkedIds = useRef<Set<number>>(new Set())
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])

  // Initial list (reloaded when the plant filter changes).
  useEffect(() => {
    let ignore = false
    checkedIds.current = new Set()
    setLoadError('')
    maintenanceApi.lookupAssets(branchId ? { branch_id: branchId } : {})
      .then((data) => {
        if (ignore) return
        const list = Array.isArray(data) ? data : []
        setLoadError('')
        setAssets(list)
        setCapped(list.length >= LOOKUP_CAP)
      })
      .catch((err) => {
        if (!ignore) setLoadError(flatten(extractErrorMessages(err, "Couldn't load the asset list — check your connection and reload the page.")))
      })
      .finally(() => { if (!ignore) setLoadedFor(branchKey) })
    return () => { ignore = true }
  }, [branchId, branchKey])

  // Debounced server-side search — results are merged so the current pick stays visible.
  useEffect(() => {
    const term = search.trim()
    if (!term) return
    let ignore = false
    const t = setTimeout(() => {
      maintenanceApi.lookupAssets(branchId ? { search: term, branch_id: branchId } : { search: term })
        .then((data) => {
          if (ignore) return
          setLoadError('')
          setAssets((prev) => mergeAssets(prev, Array.isArray(data) ? data : []))
        })
        .catch((err) => { if (!ignore) setLoadError(flatten(extractErrorMessages(err, `Search for "${term}" failed — try again.`))) })
        .finally(() => { if (!ignore) setSearchedTerm(term) })
    }, 250)
    return () => { ignore = true; clearTimeout(t) }
  }, [search, branchId])

  // Make sure the selected value (and any includeIds) is in the list, fetching by id if needed.
  const includeKey = (includeIds || []).join(',')
  useEffect(() => {
    if (!loaded) return
    const wanted = [...(value != null ? [value] : []), ...(includeKey ? includeKey.split(',').map(Number) : [])]
      .filter((id) => Number.isFinite(id) && id > 0)
    const missing = wanted.filter((id) => !assets.some((a) => a.id === id) && !checkedIds.current.has(id))
    if (!missing.length) return
    missing.forEach((id) => checkedIds.current.add(id))
    // Not cancelled on dep changes (the list itself is a dep) — only dropped after unmount,
    // otherwise an id marked as checked would never get its label.
    maintenanceApi.lookupAssets({ ids: missing.join(',') })
      .then((data) => {
        if (!mountedRef.current) return
        // The endpoint returns its normal first-100 list plus every requested id (decommissioned
        // included; deleted never) — so a requested id absent from the reply does not exist.
        const rows = Array.isArray(data) ? data : []
        const found = rows.filter((a) => missing.includes(a.id))
        // Only act on the pick if it is still the current value (the user may have changed it meanwhile).
        if (value == null || !missing.includes(value) || valueRef.current !== value) {
          setAssets((prev) => mergeAssets(prev, found, true))
          return
        }
        const picked = found.find((a) => a.id === value)
        if (picked && rejectDecommissioned && picked.status === 'decommissioned') {
          setAssets((prev) => mergeAssets(prev, found.filter((a) => a.id !== value), true))
          setMissingNote(`Asset ${picked.asset_code} is decommissioned — pick another machine (or reactivate it in Assets first).`)
          onChangeRef.current(null)
          return
        }
        setAssets((prev) => mergeAssets(prev, found, true))
        if (picked) return
        if (fallbackOption && fallbackOption.id === value) {
          setAssets((prev) => mergeAssets(prev, [{ criticality: '', status: '', branch_id: 0, location_text: null, ...fallbackOption }], true))
          return
        }
        setMissingNote(`Asset #${value} was not found (it may have been deleted, or the link / QR label is out of date) — pick the machine from the list.`)
        onChangeRef.current(null)
      })
      .catch((err) => {
        if (!mountedRef.current) return
        missing.forEach((id) => checkedIds.current.delete(id))
        setLoadError(flatten(extractErrorMessages(err, "Couldn't load the selected asset — reload the page to try again.")))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fallbackOption / rejectDecommissioned are only read when a lookup returns
  }, [loaded, value, includeKey, assets])

  const selectedOption = useMemo(() => (value != null ? assets.find((a) => a.id === value) || null : null), [assets, value])
  const onSelectedRef = useRef(onSelectedOption)
  useEffect(() => { onSelectedRef.current = onSelectedOption }, [onSelectedOption])
  useEffect(() => { onSelectedRef.current?.(selectedOption) }, [selectedOption])

  const options = useMemo(() => {
    const hide = new Set(excludeIds || [])
    const list = assets.filter((a) => !hide.has(a.id)).map((a) => ({ value: String(a.id), label: assetOptionLabel(a) }))
    return clearLabel ? [{ value: '', label: clearLabel }, ...list] : list
  }, [assets, excludeIds, clearLabel])

  const handleChange = (v: string) => {
    setMissingNote('')
    setLoadError('')
    if (!v) { onChange(null); return }
    const id = Number(v)
    onChange(id, assets.find((a) => a.id === id))
  }

  return (
    <div>
      <SearchableSelect value={value != null ? String(value) : ''} onChange={handleChange} options={options}
        placeholder={!loaded ? 'Loading assets…' : placeholder} disabled={disabled} />
      {capped && !disabled && (
        <div style={{ marginTop: 6 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Not in the list? Search all assets by code, name or location…"
            className="mt-asset-search"
            style={{
              width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px dashed ${BORDER.normal}`,
              background: 'rgba(255,255,255,.55)', fontSize: 12.5, outline: 'none', color: TEXT.body,
            }}
          />
          <p style={{ fontSize: 11.5, color: TEXT.muted, margin: '4px 0 0' }}>
            {search.trim() && searchedTerm !== search.trim() ? 'Searching…' : search.trim() ? 'Matches are added to the list above — open it to pick one.' : `Only the first ${LOOKUP_CAP} assets are listed.`}
          </p>
        </div>
      )}
      {missingNote && (
        <p style={{ fontSize: 12, color: '#b45309', margin: '6px 0 0' }}>{missingNote}</p>
      )}
      {loadError && (
        <p style={{ fontSize: 12, color: '#b91c1c', margin: '6px 0 0' }}>{loadError}</p>
      )}
    </div>
  )
}

function flatten(msg: string | string[]): string {
  return Array.isArray(msg) ? msg.join(' ') : msg
}
