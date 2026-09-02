'use client'

import Link from 'next/link'
import { CSSProperties, ReactNode } from 'react'
import { TEXT } from '@/lib/theme'

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
  index?: number
}

// Uiverse-style gooey reveal card (https://uiverse.io) adapted from a
// numbered-tab carousel into a single-state hover card: on hover, colored
// blobs merge behind the icon/title (via the shared #module-card-goo SVG
// filter in dashboard/page.tsx) while the description clip-path–reveals in
// white text. Each card uses its own module accent color instead of the
// original's fixed palette.
//
// Blob geometry (size/corner/position) is picked per-card from VARIANTS via
// a hash of the title — deterministic across renders, but different from
// card to card, echoing how the original design gave each numbered tab
// (1/2/3) its own distinct blob shape.
const VARIANTS = [
  { globW: 65, globH: 85, globTop: -30, globRight: -25 },
  { globW: 55, globH: 65, globTop: 55, globRight: -20 },
  { globW: 70, globH: 55, globTop: -20, globRight: -30 },
  { globW: 50, globH: 90, globTop: 10, globRight: -15 },
  { globW: 60, globH: 60, globTop: 20, globRight: -35 },
  { globW: 45, globH: 75, globTop: -15, globRight: -10 },
  { globW: 75, globH: 45, globTop: 40, globRight: -25 },
  { globW: 55, globH: 100, globTop: -5, globRight: -30 },
  { globW: 68, globH: 68, globTop: -35, globRight: -15 },
  { globW: 48, globH: 58, globTop: 65, globRight: -30 },
] as const

export default function ModuleCard({ title, description, icon, href, iconBg, iconColor, index = 0 }: ModuleCardProps) {
  const v = VARIANTS[index % VARIANTS.length]
  return (
    <Link href={href} className="module-card-link" style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
      <div
        className="module-card"
        style={{
          '--accent': iconColor,
          '--accent-bg': iconBg,
          '--glob-w': `${v.globW}%`,
          '--glob-h': `${v.globH}%`,
          '--glob-top': `${v.globTop}%`,
          '--glob-right': `${v.globRight}%`,
        } as CSSProperties}
      >
        <div className="module-card-blob">
          <div className="module-card-glob" />
        </div>

        <div className="module-card-body">
          <div className="module-card-icon">{icon}</div>
          <h3 className="module-card-title">{title}</h3>
          <p className="module-card-desc">{description}</p>

          <span className="module-card-arrow">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </div>
      </div>

      <style jsx>{`
        .module-card {
          position: relative;
          isolation: isolate;
          height: 100%;
          min-height: 122px;
          border-radius: 15px;
          overflow: hidden;
          background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 10%, #fff) 0%, #fff 45%);
          border: 1px solid rgba(15, 23, 42, 0.08);
          box-shadow: -1px 1px 0px rgba(15, 23, 42, 0.14), -4px 5px 3px rgba(15, 23, 42, 0.1), -20px 26px 22px -6px rgba(15, 23, 42, 0.25);
          transition: transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.25s ease-out, background 0.25s ease-out;
        }
        .module-card:hover {
          background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 18%, #fff) 0%, #fff 55%);
        }
        .module-card:hover {
          transform: translateY(-3px);
          box-shadow: -1px 1px 0px rgba(15, 23, 42, 0.18), -5px 6px 4px rgba(15, 23, 42, 0.14), -26px 34px 28px -6px rgba(15, 23, 42, 0.32);
        }
        .module-card:active {
          transform: translateY(-1px) scale(0.97);
        }

        .module-card-blob {
          position: absolute;
          inset: 0;
          filter: url(#module-card-goo) blur(8px);
          pointer-events: none;
          /* Chromium bug: a filtered child can paint outside its ancestor's
             overflow:hidden clip once that ancestor gets promoted to its own
             compositing layer (e.g. by the hover transform) — an explicit
             clip-path forces the clip to actually apply. */
          clip-path: inset(0 round 15px);
        }
        .module-card-glob,
        .module-card-blob::before,
        .module-card-blob::after {
          content: '';
          position: absolute;
          border-radius: 100%;
          background: color-mix(in srgb, var(--accent) 30%, #fff);
          transform: scale(0);
          transition: transform 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .module-card-glob {
          width: var(--glob-w);
          height: var(--glob-h);
          top: var(--glob-top);
          right: var(--glob-right);
        }
        .module-card-blob::before {
          width: 50%;
          height: 60%;
          right: 0;
          top: 20px;
          transition-delay: 0.05s;
        }
        .module-card-blob::after {
          width: 40%;
          height: 60%;
          right: -15%;
          top: 20%;
          transition-delay: 0.1s;
        }
        .module-card:hover .module-card-glob,
        .module-card:hover .module-card-blob::before,
        .module-card:hover .module-card-blob::after {
          transform: scale(1);
        }

        .module-card-body {
          position: relative;
          z-index: 3;
          height: 100%;
          display: flex;
          flex-direction: column;
          padding: 12px;
        }

        .module-card-icon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent-bg);
          color: var(--accent);
          margin-bottom: 8px;
          box-shadow: -1px 1px 0px color-mix(in srgb, var(--accent) 35%, transparent),
            -3px 4px 3px color-mix(in srgb, var(--accent) 30%, transparent),
            -8px 11px 10px -3px color-mix(in srgb, var(--accent) 50%, transparent);
          transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .module-card:hover .module-card-icon {
          transform: scale(1.08) translateY(-2px);
        }

        .module-card-title {
          position: relative;
          font-size: 13.5px;
          font-weight: 700;
          color: #000;
          margin: 0 0 3px;
        }

        .module-card-desc {
          position: relative;
          font-size: 11px;
          color: ${TEXT.muted};
          margin: 0 0 6px;
          line-height: 1.4;
        }

        .module-card-arrow {
          margin-top: auto;
          align-self: flex-end;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fff;
          color: ${TEXT.secondary};
          box-shadow: -1px 1px 0px rgba(15, 23, 42, 0.14), -3px 4px 3px rgba(15, 23, 42, 0.1), -8px 11px 10px -3px rgba(15, 23, 42, 0.2);
          transition: transform 0.2s ease-out, background 0.25s, color 0.25s, box-shadow 0.25s;
        }
        .module-card:hover .module-card-arrow {
          transform: translateX(3px);
          background: rgba(255, 255, 255, 0.9);
          color: var(--accent);
          box-shadow: -1px 1px 0px color-mix(in srgb, var(--accent) 40%, transparent),
            -4px 5px 4px color-mix(in srgb, var(--accent) 35%, transparent),
            -12px 16px 14px -3px color-mix(in srgb, var(--accent) 55%, transparent);
        }

        @media (prefers-reduced-motion: reduce) {
          .module-card,
          .module-card-glob,
          .module-card-blob::before,
          .module-card-blob::after,
          .module-card-icon,
          .module-card-title,
          .module-card-desc,
          .module-card-arrow {
            transition: none !important;
          }
        }
      `}</style>
    </Link>
  )
}
