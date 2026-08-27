'use client'

import Link from 'next/link'
import { ReactNode, useState } from 'react'
import { TEXT, GLASS, SHADOWS } from '@/lib/theme'

interface ModuleCardProps {
  title: string
  description: string
  icon: ReactNode
  href: string
  features: string[]
  barColor: string
  iconBg: string
  iconColor: string
  tagBg: string
  tagColor: string
}

export default function ModuleCard({ title, description, icon, href, features, barColor, iconBg, iconColor, tagBg, tagColor }: ModuleCardProps) {
  const [hover, setHover] = useState(false)
  // Uiverse-style press feedback (https://uiverse.io, by SteveBloX): a
  // slight overshoot scale + rotate on click, distinct from the plain
  // hover-lift below — gives the card a tactile "picked up" feel.
  const [pressed, setPressed] = useState(false)

  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => { setHover(false); setPressed(false) }}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        style={{
          position: 'relative',
          borderRadius: 22,
          overflow: 'hidden',
          background: hover ? GLASS.strong : GLASS.card,
          backdropFilter: hover ? GLASS.blurStrong : GLASS.blur,
          WebkitBackdropFilter: hover ? GLASS.blurStrong : GLASS.blur,
          border: hover ? '1px solid rgba(15,23,42,0.28)' : `1px solid ${GLASS.border}`,
          boxShadow: SHADOWS.glass(hover),
          transform: pressed
            ? 'scale(0.96) rotateZ(1.2deg)'
            : hover
              ? 'translateY(-3px) scale(1.02)'
              : 'translateY(0) scale(1)',
          transition: 'all .2s ease-out',
        }}
      >
        <div style={{ height: 4, background: barColor }} />
        <div style={{ padding: '24px 24px 22px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: iconBg, color: iconColor, marginBottom: 18 }}>
            {icon}
          </div>

          <h3 style={{ fontSize: 17, fontWeight: 700, color: TEXT.heading, margin: '0 0 8px' }}>{title}</h3>
          <p style={{ fontSize: 13, color: TEXT.muted, margin: '0 0 18px', lineHeight: 1.5, minHeight: 40 }}>{description}</p>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {features.map((feature) => (
              <span
                key={feature}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: tagColor,
                  background: tagBg,
                  padding: '5px 11px',
                  borderRadius: 9999,
                }}
              >
                {feature}
              </span>
            ))}
            <span
              style={{
                marginLeft: 'auto',
                width: 30,
                height: 30,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#fff',
                boxShadow: `0 2px 8px ${SHADOWS.sm}`,
                color: TEXT.secondary,
                flex: 'none',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
