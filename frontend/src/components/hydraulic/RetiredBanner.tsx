'use client'

/**
 * Shown on the hidden Hydraulic Maintenance / Service Records / Spare Parts
 * pages (plan rule R5, phase HY-0). The routes stay readable as history;
 * every write is refused by the API with 410.
 */
export default function RetiredBanner({ what }: { what: string }) {
  return (
    <div
      data-tour="hyd-retired-banner"
      style={{
        padding: '12px 16px', marginBottom: 16, borderRadius: 12,
        background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e', fontSize: 13, lineHeight: 1.5,
      }}
    >
      <strong>{what} are retired (rule R5) — read-only history.</strong>{' '}
      Plant equipment maintenance now lives in the Maintenance module; customer RRV service is logged in Service &amp; Commissioning → Service Requests.
      Existing records stay readable here but can&apos;t be created, changed or deleted.
    </div>
  )
}
