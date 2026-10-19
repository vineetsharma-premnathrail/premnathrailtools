'use client'

import { Question } from '@phosphor-icons/react'

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
        <Question size={16} className="w-4 h-4" />
        <span className="absolute opacity-0 group-hover:opacity-100 group-hover:-translate-y-7 duration-700 text-sm whitespace-nowrap bg-gray-800 text-white px-2 py-1 rounded pointer-events-none">
          {text}
        </span>
      </div>
    </section>
  )
}
