'use client'

// Info-icon tooltip (Uiverse.io pattern). Drop in anywhere a field/label needs
// a hover hint: <Tooltip text="..." />

interface TooltipProps {
  text: string
  className?: string
}

export default function Tooltip({ text, className = '' }: TooltipProps) {
  return (
    <section className={`relative inline-flex justify-center items-center ${className}`}>
      <div className="group flex justify-center transition-all rounded-full bg-gray-200 p-1">
        <svg viewBox="0 0 320 512" className="w-4 h-4">
          <path d="M80 160c0-35.3 28.7-64 64-64h32c35.3 0 64 28.7 64 64v3.6c0 21.8-11.1 42.1-29.4 53.8l-42.2 27.1c-25.2 16.2-40.4 44.1-40.4 74V320c0 17.7 14.3 32 32 32s32-14.3 32-32v-1.4c0-8.2 4.2-15.8 11-20.2l42.2-27.1c36.6-23.6 58.8-64.1 58.8-107.7V160c0-70.7-57.3-128-128-128H144C73.3 32 16 89.3 16 160c0 17.7 14.3 32 32 32s32-14.3 32-32zm80 320a40 40 0 1 0 0-80 40 40 0 1 0 0 80z" />
        </svg>
        <span className="absolute opacity-0 group-hover:opacity-100 group-hover:-translate-y-7 duration-700 text-sm whitespace-nowrap bg-gray-800 text-white px-2 py-1 rounded pointer-events-none">
          {text}
        </span>
      </div>
    </section>
  )
}
