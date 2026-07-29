import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '@/styles/globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Premnathrail Portal',
  description: 'CRM, ERP, and R&D tools for railway engineering',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning>
        {children}
        <script dangerouslySetInnerHTML={{__html: `
          // Remove Next.js dev UI
          const removeNextDevUI = () => {
            const logo = document.getElementById('next-logo');
            if (logo) logo.remove();
            const ui = document.querySelector('[data-testid="next-dev-ui"]');
            if (ui) ui.remove();
          };
          removeNextDevUI();
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', removeNextDevUI);
          }
        `}} />
      </body>
    </html>
  )
}
