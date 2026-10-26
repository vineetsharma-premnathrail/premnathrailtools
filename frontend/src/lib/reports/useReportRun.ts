'use client'

// One report call per state change; a newer call always wins over an older one still in flight.
import { useEffect, useRef, useState } from 'react'
import { reportsApi } from '@/lib/api'
import { extractErrorMessages } from '@/lib/validation'
import { toQuery, type ReportState } from './params'
import type { RunResult } from './types'

export function useReportRun(module: string, report: string | null, state: ReportState | null, enabled = true) {
  const [data, setData] = useState<RunResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const [nonce, setNonce] = useState(0)
  const sig = report && state ? JSON.stringify([report, toQuery(state)]) : ''

  useEffect(() => {
    if (!enabled || !report || !state) return
    const my = ++seq.current
    setLoading(true)
    setError('')
    // q is debounced by the caller's input, so every change here is a real request.
    reportsApi.run(module, report, toQuery(state))
      .then((r) => { if (my === seq.current) setData(r as unknown as RunResult) })
      .catch((err) => {
        if (my !== seq.current) return
        setData(null)
        setError(extractErrorMessages(err, 'The report could not be loaded - check your connection and press Reload.').join(' '))
      })
      .finally(() => { if (my === seq.current) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, sig, enabled, nonce])

  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}
