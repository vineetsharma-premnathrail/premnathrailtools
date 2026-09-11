'use client'

import { useTour } from './TourContext'

export default function TourButton({ variant = 'icon' }: { variant?: 'icon' | 'row' }) {
  const { start, hasContent } = useTour()

  const icon = (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 2-3 4" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )

  if (variant === 'row') {
    return (
      <button
        onClick={start}
        className={`sidebar-flat-btn${hasContent ? ' tour-glow' : ''}`}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '10px 14px',
          marginBottom: 6,
          borderRadius: 12,
          border: hasContent ? '1px solid rgba(255,122,69,0.5)' : 'none',
          background: hasContent ? 'rgba(255,122,69,0.06)' : 'transparent',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: hasContent ? 700 : 500,
          color: hasContent ? '#FF7A45' : '#57534e',
          fontFamily: 'inherit',
        }}
      >
        {icon}
        Take a Tour
      </button>
    )
  }

  return (
    <button
      onClick={start}
      className={`tour-icon-btn${hasContent ? ' tour-glow' : ''}`}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: hasContent ? '1px solid rgba(255,122,69,0.5)' : '1px solid rgba(0,0,0,0.1)',
        background: hasContent ? 'rgba(255,122,69,0.08)' : '#fff',
        boxShadow: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: hasContent ? '#FF7A45' : '#57534e',
        ['--tour-icon-color' as string]: hasContent ? '#FF7A45' : '#57534e',
      } as React.CSSProperties}
      aria-label="Take a Tour"
      title="Take a Tour"
    >
      {icon}
    </button>
  )
}
