// Central design tokens — the app-wide theme. Every shared style module
// (toolStyles.ts for R&D, components/crm/ui.tsx for CRM, dashboard shell,
// login page) imports from here so a palette/elevation change happens once
// instead of being repeated across 40+ files.
//
// Glassmorphism is ~30% color, ~70% rendering technique. Every glass surface
// should combine ALL of:
//   - backdrop-filter: blur(24px-40px)      -> GLASS.blur / GLASS.blurStrong
//   - low-opacity white background          -> GLASS.card / GLASS.surface
//   - a thin white border                   -> GLASS.border
//   - an inset top highlight (not just a background) -> GLASS.innerHighlight
//   - a soft, layered (not single-value) shadow       -> SHADOWS.glass()
//   - a large border-radius (20-28px)
//   - a colorful/gradient backdrop behind it to actually refract — a white
//     glass panel over a near-white page is invisible no matter how correct
//     the CSS is, so the page background must carry real color/contrast.

export const BRAND = {
  primary: '#FF7A45',
  primaryHover: '#FF6A2A',
  primaryActive: '#E85A1F',
  primarySoft: '#FFF2EB',
  primaryGlow: '#FFD8C7',
  primaryBorder: '#FFC3A8',
} as const

export const TEXT = {
  heading: '#0F172A',
  body: '#1E293B',
  secondary: '#334155',
  muted: '#64748B',
  white: '#FFFFFF',
} as const

export const BG = {
  bg1: '#EEF2FF',
  bg2: '#F8FAFC',
  bg3: '#FFF7F2',
  bg4: '#FFFFFF',
} as const

export const BORDER = {
  light: 'rgba(255,255,255,.20)',
  normal: 'rgba(255,255,255,.32)',
  strong: 'rgba(255,255,255,.45)',
} as const

export const SUCCESS = { primary: '#16A34A', hover: '#15803D', light: '#F0FDF4', border: '#BBF7D0', text: '#166534' } as const
export const DANGER = { primary: '#DC2626', hover: '#B91C1C', light: '#FEF2F2', border: '#FECACA', text: '#991B1B' } as const
export const WARNING = { primary: '#F59E0B', hover: '#D97706', light: '#FFFBEB', border: '#FDE68A', text: '#92400E' } as const
export const INFO = { primary: '#2563EB', hover: '#1D4ED8', light: '#EFF6FF', border: '#BFDBFE', text: '#1E40AF' } as const
export const PURPLE = { primary: '#7C3AED', hover: '#6D28D9', light: '#F5F3FF', border: '#DDD6FE', text: '#5B21B6' } as const

export const GLASS = {
  white: 'rgba(255,255,255,.08)',
  surface: 'rgba(255,255,255,.12)',
  card: 'rgba(255,255,255,.16)',
  strong: 'rgba(255,255,255,.22)',
  border: 'rgba(255,255,255,.24)',
  highlight: 'rgba(255,255,255,.45)',
  shadow: 'rgba(0,0,0,.18)',
  innerHighlight: 'inset 0 1px 0 rgba(255,255,255,.35)',
  blur: 'blur(28px)',
  blurStrong: 'blur(36px)',
  blurLight: 'blur(20px)',
} as const

export const SHADOWS = {
  sm: 'rgba(15,23,42,.10)',
  md: 'rgba(15,23,42,.18)',
  lg: 'rgba(15,23,42,.30)',
  glowOrange: 'rgba(255,122,69,.28)',
  /** A real glass shadow is layered: a tight contact shadow + a soft ambient
   * one + the inset top highlight — a single box-shadow value looks flat. */
  glass: (hover = false) =>
    [
      `0 ${hover ? 20 : 12}px ${hover ? 44 : 32}px rgba(15,23,42,${hover ? 0.22 : 0.16})`,
      `0 2px 6px rgba(15,23,42,.08)`,
      GLASS.innerHighlight,
    ].join(', '),
} as const

export const GRADIENTS = {
  primary: 'linear-gradient(135deg,#FF7A45,#FF6A2A)',
  page: `linear-gradient(160deg, ${BG.bg1} 0%, ${BG.bg3} 55%, ${BG.bg2} 100%)`,
} as const

// ---- Backward-compatible aliases -------------------------------------
// toolStyles.ts and components/crm/ui.tsx were written against an earlier
// token shape (COLORS/RADII/BORDERS flat maps). Rather than rewrite every
// call site, keep those names pointed at the current palette above so this
// file remains the single source of truth.
export const COLORS = {
  brand: BRAND.primary,
  brandDark: BRAND.primaryActive,
  brandLight: BRAND.primarySoft,
  brandGradient: GRADIENTS.primary,
  ink: TEXT.heading,
  slateDark: '#0f172a',
  slate: '#1e293b',
  textMuted: TEXT.secondary,
  textMuted2: TEXT.secondary,
  textFaint: TEXT.muted,
  textFaint2: TEXT.muted,
  surface: BG.bg4,
  surfaceWarm: BG.bg3,
  surfaceSubtle: BG.bg2,
  success: SUCCESS.primary,
  info: INFO.primary,
  danger: DANGER.primary,
  purple: PURPLE.primary,
  cyan: '#06b6d4',
  warning: WARNING.primary,
} as const

export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 18,
  '2xl': 20,
  '3xl': 22,
  '4xl': 26,
  pill: 9999,
} as const

export const BORDERS = {
  subtle: `1px solid ${GLASS.border}`,
  default: `1px solid ${GLASS.border}`,
  slate: `1px solid ${GLASS.border}`,
  danger: `1px solid ${DANGER.border}`,
  dangerStrong: `1px solid ${DANGER.border}`,
  brand: `1px solid ${BRAND.primaryBorder}`,
  purple: `1px solid ${PURPLE.border}`,
  success: `1px solid ${SUCCESS.border}`,
} as const
