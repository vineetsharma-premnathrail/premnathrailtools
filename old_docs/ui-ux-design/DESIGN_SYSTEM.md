# Design System

Single source of truth for tokens: `frontend/src/lib/theme.ts`. Every value below is copied verbatim from that file plus real usage observed across page files. Cross-reference: [../product/PRODUCT.md](../product/PRODUCT.md).

## Color tokens

### Brand
```ts
BRAND.primary       = '#FF7A45'
BRAND.primaryHover  = '#FF6A2A'
BRAND.primaryActive = '#E85A1F'
BRAND.primarySoft   = '#FFF2EB'
BRAND.primaryGlow   = '#FFD8C7'
BRAND.primaryBorder = '#FFC3A8'
```

### Text
```ts
TEXT.heading   = '#0F172A'
TEXT.body      = '#1E293B'
TEXT.secondary = '#475569'
TEXT.muted     = '#94A3B8'
TEXT.white     = '#FFFFFF'
```

### Page backgrounds
```ts
BG.bg1 = '#EEF2FF'  // cool indigo tint
BG.bg2 = '#F8FAFC'  // near-white
BG.bg3 = '#FFF7F2'  // warm peach tint
BG.bg4 = '#FFFFFF'
```

### Borders (semi-transparent white, for glass edges)
```ts
BORDER.light  = 'rgba(255,255,255,.20)'
BORDER.normal = 'rgba(255,255,255,.32)'
BORDER.strong = 'rgba(255,255,255,.45)'
```

### Semantic color groups
Each group has the same 5-key shape: `primary / hover / light / border / text`.
```ts
SUCCESS = { primary:'#16A34A', hover:'#15803D', light:'#F0FDF4', border:'#BBF7D0', text:'#166534' }
DANGER  = { primary:'#DC2626', hover:'#B91C1C', light:'#FEF2F2', border:'#FECACA', text:'#991B1B' }
WARNING = { primary:'#F59E0B', hover:'#D97706', light:'#FFFBEB', border:'#FDE68A', text:'#92400E' }
INFO    = { primary:'#2563EB', hover:'#1D4ED8', light:'#EFF6FF', border:'#BFDBFE', text:'#1E40AF' }
PURPLE  = { primary:'#7C3AED', hover:'#6D28D9', light:'#F5F3FF', border:'#DDD6FE', text:'#5B21B6' }
```

### Backward-compat aliases (`COLORS`)
`theme.ts` also exports a flat `COLORS` map pointing at the tokens above, kept only so two older files (`toolStyles.ts` for R&D, `components/crm/ui.tsx`) don't need rewriting. New code should use `BRAND`/`TEXT`/`BG`/etc. directly, not `COLORS`.

**Observed inconsistency:** several page files (e.g. `frontend/src/app/dashboard/erp/projects/[id]/page.tsx`, `frontend/src/components/erp/ProjectForm.tsx`, `frontend/src/app/dashboard/purchase/page.tsx`) hardcode literal hex/rgba values inline (`#fa9b9b`, `#1f1108`, `#78716c`, `#a8a29e`, `rgba(0,0,0,0.1)`, etc.) instead of importing from `theme.ts`. These are a de facto secondary, undocumented palette used heavily in ERP/Purchase pages — `#fa9b9b` in particular is used as an accent/link color in many ERP screens even though it does not appear anywhere in `theme.ts`. Treat `theme.ts` as the intended system; these inline values are technical debt, not an alternate approved palette.

## Glassmorphism recipe

Documented directly in `theme.ts`'s header comment — glassmorphism is "~30% color, ~70% rendering technique." Every glass surface should combine **all** of:

1. `backdrop-filter: blur(24px–40px)` — via `GLASS.blur` (28px), `GLASS.blurStrong` (36px), `GLASS.blurLight` (20px). Always paired with `WebkitBackdropFilter` for Safari.
2. Low-opacity white background — via `GLASS.card` (`rgba(255,255,255,.16)`) as the default panel fill, `GLASS.surface` (.12) for lighter chrome, `GLASS.strong` (.22) for hover/emphasis states, `GLASS.white` (.08) for the most subtle layer.
3. A thin white border — `GLASS.border` = `rgba(255,255,255,.24)`.
4. An inset top highlight (not just background) — `GLASS.innerHighlight` = `inset 0 1px 0 rgba(255,255,255,.35)`. Always appended as the last item in the shadow list, never applied alone.
5. A soft, **layered** (not single-value) shadow — `SHADOWS.glass(hover?)` composes three layers: a tight contact shadow, a soft ambient shadow, and the inset highlight:
   ```ts
   SHADOWS.glass(hover=false) =
     `0 ${hover?20:12}px ${hover?44:32}px rgba(15,23,42,${hover?0.22:0.16})`,
     `0 2px 6px rgba(15,23,42,.08)`,
     GLASS.innerHighlight
   ```
6. A large border-radius (20–28px) — see Radii scale below.
7. A colorful/gradient backdrop behind the glass panel — `GRADIENTS.page` = `linear-gradient(160deg, #EEF2FF 0%, #FFF7F2 55%, #F8FAFC 100%)`. The comment is explicit that a white glass panel over a near-white page is invisible regardless of correct CSS — the page background must carry real color.

`GLASS.shadow` = `rgba(0,0,0,.18)` is available as a raw shadow-color token outside the composed `SHADOWS.glass()` helper.

Verified real usage matching this recipe: `Sidebar.tsx` (`GLASS.card` + `GLASS.blur` + `SHADOWS.glass()` + `border: 1px solid GLASS.border`, `borderRadius: 26`), `ModuleCard.tsx` (same pattern, `borderRadius: 22`, swaps to `GLASS.strong`/`GLASS.blurStrong` on hover), and repeated inline (non-token) copies of the exact same rgba/blur/shadow values in ERP page files (e.g. the `Card` component and glass table wrappers in `projects/[id]/page.tsx`) — confirming the recipe is applied consistently even where the literal token isn't imported.

## Gradients
```ts
GRADIENTS.primary = 'linear-gradient(135deg,#FF7A45,#FF6A2A)'
GRADIENTS.page     = 'linear-gradient(160deg, #EEF2FF 0%, #FFF7F2 55%, #F8FAFC 100%)'
```
`GRADIENTS.primary` is used for the active sidebar-link background, primary buttons, and avatar-initial badges (`Sidebar.tsx`). Module cards each get their own per-module gradient bar (`barColor`) defined ad hoc in `dashboard/page.tsx` (e.g. Service Module `linear-gradient(90deg,#FF7A45,#FF6A2A)`, R&D `linear-gradient(90deg,#3b82f6,#60a5fa)`, CRM `linear-gradient(90deg,#10b981,#34d399)`, Purchase `linear-gradient(90deg,#a855f7,#c084fc)`, Purchase Requisition `linear-gradient(90deg,#0ea5e9,#38bdf8)`) — these module accent colors are not part of `theme.ts` and exist only in that one file.

## Radii scale
```ts
RADII.sm   = 8
RADII.md   = 12
RADII.lg   = 16
RADII.xl   = 18
RADII['2xl'] = 20
RADII['3xl'] = 22
RADII['4xl'] = 26
RADII.pill = 9999
```
Observed real usage: sidebar panel `26` (`4xl`), module card `22` (`3xl`), glass content panels/tables/cards `16–18` (`lg`/`xl`), buttons/inputs/dropdowns `8–12` (`sm`/`md`), status pills and avatar circles `9999` (`pill`).

## Border presets (`BORDERS`)
```ts
BORDERS.subtle/default/slate = `1px solid ${GLASS.border}`
BORDERS.danger/dangerStrong  = `1px solid ${DANGER.border}`
BORDERS.brand                = `1px solid ${BRAND.primaryBorder}`
BORDERS.purple               = `1px solid ${PURPLE.border}`
BORDERS.success              = `1px solid ${SUCCESS.border}`
```

## Typography scale (observed, not invented)

No single exported type scale exists in `theme.ts` — font sizes are set inline per element, but the same values recur consistently enough across every reviewed page to describe a de facto scale:

| Role | Size (px) | Weight | Example source |
|---|---|---|---|
| Page title (`h1`) | 24–30 | 800 | Dashboard greeting `30/800`; Project detail `h1` `24/800` |
| Section/eyebrow label | 10–11.5 | 700 | "YOUR APPLICATIONS" `11/700`, letter-spacing `.08em`; "Purchase Module" eyebrow `11.5/700` |
| Card title | 16–17 | 800 | `ModuleCard` title `17/800`; `ConfirmDialog` title `16/800` |
| Body/label text | 13–13.5 | 400–600 | Form field labels `12.5/600`; table cell text `13/400` |
| Small/meta text | 11–12.5 | 500–700 | Status pills `11/700`; timestamps `11–12.5/400` |
| Muted/caption | 10–10.5 | 700 | `InfoRow` uppercase labels `10.5/700` |

Font family: `Inter, system-ui, sans-serif` (set explicitly on the login shell in `login/page.tsx`; other pages inherit from a global layout not reviewed here).

## Spacing conventions (observed)

- Card/panel internal padding: `16–24px` (`Card` in project detail = 16; `ModuleCard` = `24px 24px 22px`; form `Section` = 18).
- Gaps between grid items / stacked fields: `8–20px`, most commonly `10–14px` for compact rows (form fields, table cells) and `20px` for major layout blocks (dashboard card grid, tab-content grids).
- Component-internal small gaps (icon-to-label, pill padding): `4–10px`.
- Sidebar padding: `28px 20px` (`Sidebar.tsx`).
- Table cell padding: `10px 14px` to `12px 16px` depending on density.
- Status/tag pills: `padding: 4px 10px` to `5px 11px`, `borderRadius: 9999`.

## Interaction states (observed)

- Hover on `ModuleCard`: background steps up one glass tier (`GLASS.card → GLASS.strong`), blur steps up (`blur → blurStrong`), `transform: translateY(-3px)`, shadow intensifies via `SHADOWS.glass(true)`. Transition: `all .2s ease-out`.
- Active sidebar link: solid `GRADIENTS.primary` background, white text, colored glow shadow (`0 8px 20px rgba(255,122,69,.28)` via `SHADOWS.glowOrange`).
- Disabled/busy buttons: opacity drop to `0.7–0.75`, cursor `default`/`wait`, label swaps to a "-ing…" verb (`"Saving…"`, `"Uploading…"`, `"Redirecting to Microsoft…"`).
- Drag-and-drop zones: border/background swap on `dragOver` (dashed border color and background tint change, e.g. to `#fa9b9b` / `rgba(244,113,59,0.05)`), consistently reused across the Documents tab and the ProjectForm Documents tab.
