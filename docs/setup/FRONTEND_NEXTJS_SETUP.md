# Next.js Frontend Setup Guide

## Quick Start (Copy-Paste)

### **Step 1: Create Project**

```bash
# Create Next.js project with TypeScript + Tailwind
npx create-next-app@latest premnathrail-portal \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-git \
  --src-dir

cd premnathrail-portal
```

### **Step 2: Install Dependencies**

```bash
npm install axios zustand @tanstack/react-query js-cookie
npm install -D prettier prettier-plugin-tailwindcss
```

**Dependencies Explained:**
- `axios` — HTTP client (simpler than fetch)
- `zustand` — Lightweight state management
- `@tanstack/react-query` — Server state management & caching
- `js-cookie` — Cookie handling for tokens

### **Step 3: Start Development Server**

```bash
npm run dev
```

Opens at: **http://localhost:3000**

---

## Project Structure Setup

### **Create Folders**

```bash
mkdir -p src/lib
mkdir -p src/components
mkdir -p src/hooks
mkdir -p src/store
mkdir -p src/types
mkdir -p src/config
```

---

## Step-by-Step Files Creation

### **1. Environment Configuration (.env.local)**

Create `premnathrail-portal/.env.local`:

```env
# Backend API
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_AUTH_URL=http://localhost:8000

# Frontend
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000

# Features
NEXT_PUBLIC_ENABLE_CRM=true
NEXT_PUBLIC_ENABLE_ERP=true
NEXT_PUBLIC_ENABLE_RND=true
```

**Why NEXT_PUBLIC?** These variables are exposed to browser (safe for URLs, not secrets)

---

### **2. TypeScript Types (src/types/index.ts)**

```typescript
// User and Auth types
export interface User {
  id: number
  email: string
  name: string
  role: 'user' | 'admin' | 'super_admin'
  is_active: boolean
  azure_id?: string
  designation?: string
  department?: string
  phone?: string
  avatar_url?: string
  created_at: string
  updated_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  expires_in: number
}

export interface ApiResponse<T> {
  data: T
  status: 'success' | 'error'
  message?: string
}

export interface ApiError {
  detail: string
  status_code: number
}
```

---

### **3. API Client (src/lib/api.ts)**

```typescript
import axios, { AxiosInstance, AxiosError } from 'axios'
import { useAuthStore } from '@/store/authStore'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor: Add token to all requests
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor: Handle 401 errors
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// API Methods
export const authApi = {
  getMe: async () => {
    const { data } = await apiClient.get('/auth/me')
    return data
  },

  logout: async () => {
    try {
      await apiClient.post('/auth/logout')
    } catch (error) {
      console.error('Logout error:', error)
    }
  },
}

export const crmApi = {
  getNotes: async (limit = 100, offset = 0) => {
    const { data } = await apiClient.get('/crm/notes', {
      params: { limit, offset },
    })
    return data
  },

  getNote: async (id: number) => {
    const { data } = await apiClient.get(`/crm/notes/${id}`)
    return data
  },

  createNote: async (note: { title: string; description: string }) => {
    const { data } = await apiClient.post('/crm/notes', note)
    return data
  },

  updateNote: async (id: number, note: { title?: string; description?: string }) => {
    const { data } = await apiClient.put(`/crm/notes/${id}`, note)
    return data
  },

  deleteNote: async (id: number) => {
    await apiClient.delete(`/crm/notes/${id}`)
  },
}

export const erpApi = {
  getProjects: async (limit = 100, offset = 0) => {
    const { data } = await apiClient.get('/erp/projects', {
      params: { limit, offset },
    })
    return data
  },

  getServiceRequests: async (limit = 100, offset = 0) => {
    const { data } = await apiClient.get('/erp/service-requests', {
      params: { limit, offset },
    })
    return data
  },
}

export const rndApi = {
  calculateBraking: async (params: Record<string, number>) => {
    const { data } = await apiClient.post('/rnd/braking', params)
    return data
  },

  calculateHydraulic: async (params: Record<string, number>) => {
    const { data } = await apiClient.post('/rnd/hydraulic', params)
    return data
  },
}
```

---

### **4. Auth Store (src/store/authStore.ts)**

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User } from '@/types'
import { authApi } from '@/lib/api'

interface AuthStore {
  user: User | null
  token: string | null
  isLoading: boolean
  error: string | null

  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void

  fetchUser: () => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,

      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),

      fetchUser: async () => {
        set({ isLoading: true, error: null })
        try {
          const user = await authApi.getMe()
          set({ user, isLoading: false })
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to fetch user',
            isLoading: false,
            user: null,
            token: null,
          })
        }
      },

      logout: async () => {
        set({ isLoading: true })
        try {
          await authApi.logout()
        } catch (error) {
          console.error('Logout failed:', error)
        } finally {
          set({ user: null, token: null, isLoading: false })
          // Clear all storage
          localStorage.removeItem('auth-storage')
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
      }),
    }
  )
)
```

---

### **5. Custom Hook (src/hooks/useAuth.ts)**

```typescript
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'

export function useAuth() {
  const router = useRouter()
  const { user, token, isLoading, fetchUser, logout } = useAuthStore()

  // Check auth on mount
  useEffect(() => {
    if (token && !user) {
      fetchUser()
    }
  }, [token, user, fetchUser])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!token && !isLoading) {
      router.push('/login')
    }
  }, [token, isLoading, router])

  return { user, token, isLoading, logout, fetchUser }
}

// Hook for protected pages
export function useProtectedPage() {
  const { user, token, isLoading } = useAuth()

  if (!token) {
    return { isAuthorized: false, isLoading: true, user: null }
  }

  if (isLoading) {
    return { isAuthorized: false, isLoading: true, user }
  }

  return { isAuthorized: true, isLoading: false, user }
}
```

---

### **6. Root Layout (src/app/layout.tsx)**

```typescript
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
      <body className={inter.className}>{children}</body>
    </html>
  )
}
```

---

### **7. Login Page (src/app/login/page.tsx)**

```typescript
'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setToken, fetchUser } = useAuthStore()

  // Check if token in URL (from OAuth callback)
  useEffect(() => {
    const token = searchParams.get('token')
    if (token) {
      setToken(token)
      fetchUser()
      router.push('/dashboard')
    }
  }, [searchParams, setToken, fetchUser, router])

  const handleLogin = () => {
    // Redirect to backend login
    window.location.href = `${process.env.NEXT_PUBLIC_AUTH_URL}/auth/microsoft-login`
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">
              Premnathrail
              <span className="text-orange-600"> Portal</span>
            </h1>
            <p className="text-gray-600 mt-2">Enterprise Tools</p>
          </div>

          {/* Login Button */}
          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition duration-200 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 0C4.477 0 0 4.477 0 10c0 5.523 4.477 10 10 10s10-4.477 10-10c0-5.523-4.477-10-10-10z" />
            </svg>
            Sign in with Microsoft
          </button>

          {/* Footer */}
          <p className="text-center text-gray-600 text-sm mt-6">
            Enterprise sign-in only
          </p>
        </div>
      </div>
    </div>
  )
}
```

---

### **8. Dashboard Layout (src/app/dashboard/layout.tsx)**

```typescript
'use client'

import { useAuth } from '@/hooks/useAuth'
import Navbar from '@/components/Navbar'
import Sidebar from '@/components/Sidebar'
import LoadingSpinner from '@/components/LoadingSpinner'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return <LoadingSpinner />
  }

  if (!user) {
    return null
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar user={user} />
      <div className="flex-1 flex flex-col">
        <Navbar user={user} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
```

---

### **9. Dashboard Home (src/app/dashboard/page.tsx)**

```typescript
'use client'

import { useAuth } from '@/hooks/useAuth'
import ModuleCard from '@/components/ModuleCard'

const modules = [
  {
    title: 'CRM',
    description: 'Customer relationship management',
    icon: '👥',
    color: 'bg-green-50',
    borderColor: 'border-green-200',
    href: '/dashboard/crm',
    features: ['Contacts', 'Leads', 'Deals', 'Organizations'],
  },
  {
    title: 'Service Module',
    description: 'Project and service management',
    icon: '⚙️',
    color: 'bg-orange-50',
    borderColor: 'border-orange-200',
    href: '/dashboard/erp',
    features: ['Projects', 'Service Requests', 'Warranty Tracking'],
  },
  {
    title: 'R&D Tools',
    description: 'Railway engineering calculators',
    icon: '🔬',
    color: 'bg-blue-50',
    borderColor: 'border-blue-200',
    href: '/dashboard/rnd',
    features: ['Braking', 'Hydraulic', 'Load Distribution', '+5 more'],
  },
]

export default function DashboardPage() {
  const { user } = useAuth()

  return (
    <div>
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          Welcome back, {user?.name.split(' ')[0]}! 👋
        </h1>
        <p className="text-gray-600 mt-2">
          {new Date().toLocaleDateString('en-IN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Modules Grid */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Your Applications
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module) => (
            <ModuleCard key={module.title} {...module} />
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active Projects" value="12" />
        <StatCard label="Open Requests" value="8" />
        <StatCard label="Contacts" value="156" />
        <StatCard label="Last Updated" value="Just now" />
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg p-4 border border-gray-200">
      <p className="text-gray-600 text-sm">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
}
```

---

### **10. Navbar Component (src/components/Navbar.tsx)**

```typescript
'use client'

import { User } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { useRouter } from 'next/navigation'

export default function Navbar({ user }: { user: User | null }) {
  const router = useRouter()
  const logout = useAuthStore((state) => state.logout)

  const handleLogout = async () => {
    await logout()
    router.push('/login')
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Dashboard</h2>
      </div>

      <div className="flex items-center gap-4">
        {user && (
          <>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold">
                {user.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {user.name}
                </p>
                <p className="text-xs text-gray-600 capitalize">{user.role}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="text-gray-600 hover:text-gray-900 text-sm font-medium"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </nav>
  )
}
```

---

### **11. Sidebar Component (src/components/Sidebar.tsx)**

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User } from '@/types'

export default function Sidebar({ user }: { user: User | null }) {
  const pathname = usePathname()

  const links = [
    { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
    { href: '/dashboard/crm', label: 'CRM', icon: '👥' },
    { href: '/dashboard/erp', label: 'Service Module', icon: '⚙️' },
    { href: '/dashboard/rnd', label: 'R&D Tools', icon: '🔬' },
  ]

  return (
    <aside className="w-64 bg-white border-r border-gray-200 p-6">
      {/* Logo */}
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">
          Premnathrail
          <span className="text-orange-600"> Portal</span>
        </h1>
      </div>

      {/* Navigation */}
      <nav className="space-y-2">
        {links.map((link) => {
          const isActive = pathname === link.href
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-4 py-2 rounded-lg transition ${
                isActive
                  ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="text-xl">{link.icon}</span>
              <span className="font-medium">{link.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
```

---

### **12. ModuleCard Component (src/components/ModuleCard.tsx)**

```typescript
'use client'

import Link from 'next/link'

interface ModuleCardProps {
  title: string
  description: string
  icon: string
  color: string
  borderColor: string
  href: string
  features: string[]
}

export default function ModuleCard({
  title,
  description,
  icon,
  color,
  borderColor,
  href,
  features,
}: ModuleCardProps) {
  return (
    <Link href={href}>
      <div
        className={`${color} border-2 ${borderColor} rounded-lg p-6 cursor-pointer hover:shadow-lg transition`}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-4xl mb-3">{icon}</div>
            <h3 className="text-xl font-bold text-gray-900">{title}</h3>
            <p className="text-gray-600 text-sm mt-1">{description}</p>
          </div>
        </div>

        {/* Features */}
        <div className="mt-4 flex flex-wrap gap-2">
          {features.map((feature) => (
            <span
              key={feature}
              className="text-xs bg-white bg-opacity-70 text-gray-700 px-2 py-1 rounded"
            >
              {feature}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}
```

---

### **13. LoadingSpinner Component (src/components/LoadingSpinner.tsx)**

```typescript
export default function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-gray-300 border-t-orange-600 rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>
  )
}
```

---

### **14. Global Styles (src/styles/globals.css)**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  background-color: #f9fafb;
  color: #111827;
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: #f1f5f9;
}

::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}
```

---

### **15. Next.js Config (next.config.js)**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost'],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
}

module.exports = nextConfig
```

---

## Verification Checklist

After creating all files, run:

```bash
npm run dev
```

Then check:

- [ ] **http://localhost:3000** → Should redirect to /login
- [ ] **http://localhost:3000/login** → Shows login button
- [ ] **"Sign in with Microsoft"** → Redirects to http://localhost:8000/auth/microsoft-login
- [ ] **After login** → Redirected back to /dashboard
- [ ] **Dashboard** → Shows user name, email, role
- [ ] **Module cards** → CRM, Service Module, R&D visible
- [ ] **Sign out** → Clears token, redirects to /login
- [ ] **Refresh page** → Still logged in (token persisted)

---

## Development Workflow

```bash
# Development
npm run dev

# Build for production
npm run build

# Run production build locally
npm start

# Format code
npm run format

# Type check
npm run type-check

# Lint
npm run lint
```

---

## Next Steps

Once login + dashboard works:

1. **Create CRM page** (src/app/dashboard/crm/page.tsx)
   - List notes
   - Create note form
   - Edit/delete

2. **Create ERP page** (src/app/dashboard/erp/page.tsx)
   - Projects list
   - Service requests

3. **Create RnD page** (src/app/dashboard/rnd/page.tsx)
   - Calculator forms

4. **Add tests** (Jest + React Testing Library)

5. **Deploy** (Vercel, Docker, AWS)

---

Done! Ready to build? 🚀
