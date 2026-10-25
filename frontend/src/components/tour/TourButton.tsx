'use client'

import { useTour } from './TourContext'
import { Question } from '@phosphor-icons/react'

export default function TourButton({ variant = 'icon' }: { variant?: 'icon' | 'row' }) {
  const { start, hasContent } = useTour()

  const icon = (
    <Question size={17} />
  )

  if (variant === 'row') {
    return (
      // ui-audit-ignore-next-line custom-button — sidebar navigation row ("Take a Tour" launcher), not an action pill
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
      className="tour-icon-btn nav-help-btn"
      data-has-tour={hasContent ? 'true' : undefined}
      style={{
        width: 34,
        height: 34,
        flex: 'none',
        borderRadius: '50%',
        border: '1px solid rgba(0,0,0,0.1)',
        background: 'rgba(255,255,255,.7)',
        boxShadow: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#78716c',
        ['--tour-icon-color' as string]: '#78716c',
      } as React.CSSProperties}
      aria-label="Take a Tour"
      title="Take a Tour"
    >
      {icon}
    </button>
  )
}
