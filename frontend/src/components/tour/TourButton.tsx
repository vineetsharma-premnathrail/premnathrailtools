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
