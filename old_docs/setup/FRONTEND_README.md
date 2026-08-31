# Frontend Documentation Index

## 📚 Complete Frontend Documentation

### **Start Here** 🚀
1. **[FRONTEND_QUICKSTART.md](./FRONTEND_QUICKSTART.md)** — 5-minute setup
   - Create Next.js project
   - Install dependencies
   - Configure backend
   - Start development

### **Deep Dive** 📖
2. **[FRONTEND_ARCHITECTURE.md](../architecture/FRONTEND_ARCHITECTURE.md)** — System design
   - Frontend flow diagram
   - Authentication flow
   - API communication
   - Error handling
   - CORS & security
   - Development server options
   - Testing checklist

3. **[FRONTEND_NEXTJS_SETUP.md](./FRONTEND_NEXTJS_SETUP.md)** — Complete code guide
   - Environment configuration
   - TypeScript types (src/types/index.ts)
   - API client (src/lib/api.ts)
   - Auth store (src/store/authStore.ts)
   - Auth hook (src/hooks/useAuth.ts)
   - Root layout (src/app/layout.tsx)
   - Login page (src/app/login/page.tsx)
   - Dashboard layout (src/app/dashboard/layout.tsx)
   - Dashboard home (src/app/dashboard/page.tsx)
   - Navbar component (src/components/Navbar.tsx)
   - Sidebar component (src/components/Sidebar.tsx)
   - ModuleCard component (src/components/ModuleCard.tsx)
   - LoadingSpinner component (src/components/LoadingSpinner.tsx)
   - Global styles (src/styles/globals.css)
   - Next.js config

### **Configuration** ⚙️
4. **[BACKEND_CORS_CONFIG.md](./BACKEND_CORS_CONFIG.md)** — Enable backend communication
   - What is CORS
   - Backend CORS setup
   - Environment-based config
   - Testing CORS
   - Production CORS

### **Deployment** 🚀
5. **[FRONTEND_DEPLOYMENT.md](../deployment/FRONTEND_DEPLOYMENT.md)** — Production deployment
   - Vercel (recommended)
   - Docker container
   - AWS (S3 + CloudFront)
   - DigitalOcean App Platform
   - Environment variables
   - Production checklist
   - Monitoring & analytics
   - Cost estimation

### **Troubleshooting** 🔧
6. **[FRONTEND_TROUBLESHOOTING.md](../troubleshooting/FRONTEND_TROUBLESHOOTING.md)** — Problem solving
   - Port already in use
   - Backend connection refused
   - CORS errors
   - Token not saving
   - Unauthorized errors
   - Build failures
   - TypeScript errors
   - Login redirect issues
   - Performance issues
   - Debugging commands
   - Browser DevTools tips

---

## 📊 Tech Stack

```
Next.js 14          # React framework
├── React 18        # UI library
├── TypeScript      # Type safety
├── Tailwind CSS    # Styling
├── Zustand         # State management
├── TanStack Query  # Data fetching & caching
├── Axios           # HTTP client
└── js-cookie       # Cookie handling
```

---

## 🗂️ Project Structure

```
premnathrail-portal/
├── src/
│   ├── app/                    # Next.js app directory (routing)
│   │   ├── login/              # /login route
│   │   ├── dashboard/          # /dashboard route
│   │   │   ├── crm/            # /dashboard/crm (later)
│   │   │   ├── erp/            # /dashboard/erp (later)
│   │   │   ├── rnd/            # /dashboard/rnd (later)
│   │   │   ├── layout.tsx      # Dashboard layout wrapper
│   │   │   └── page.tsx        # Dashboard home
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # / (root page)
│   ├── components/             # Reusable React components
│   │   ├── Navbar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── ModuleCard.tsx
│   │   └── LoadingSpinner.tsx
│   ├── hooks/                  # Custom React hooks
│   │   └── useAuth.ts          # Authentication hook
│   ├── lib/                    # Utilities & helpers
│   │   └── api.ts              # Axios + API methods
│   ├── store/                  # State management (Zustand)
│   │   └── authStore.ts        # User + auth state
│   ├── types/                  # TypeScript types
│   │   └── index.ts            # All type definitions
│   └── styles/                 # Global styles
│       └── globals.css         # Tailwind + custom CSS
├── public/                     # Static files
├── .env.local                  # Local environment variables
├── .env.example                # Template for env vars
├── next.config.js              # Next.js configuration
├── tsconfig.json               # TypeScript configuration
├── tailwind.config.ts          # Tailwind CSS configuration
├── package.json                # Dependencies
└── README.md                   # Project readme
```

---

## 🚀 Quick Commands

### **Development**
```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Build for production
npm start            # Run production build
npm run lint         # Check code quality
npm run type-check   # TypeScript type checking
```

### **Project Setup**
```bash
npm install          # Install dependencies
npm install <pkg>    # Install new package
npm uninstall <pkg>  # Remove package
npm update           # Update all packages
```

### **Git Workflow**
```bash
git status           # Check changes
git add .            # Stage all changes
git commit -m "msg"  # Create commit
git push             # Push to GitHub
git pull             # Pull from GitHub
```

### **Debugging**
```bash
# Clear cache and reinstall
rm -rf node_modules .next package-lock.json
npm install
npm run dev

# Check environment variables
echo $NEXT_PUBLIC_API_URL

# Test backend connection
curl http://localhost:8000/health
```

---

## 📋 Checklist: What's Built

### **Phase 1: Core Auth (CURRENT)**
- [x] Login page with Microsoft SSO
- [x] Dashboard with user info
- [x] Navigation (sidebar + navbar)
- [x] Logout functionality
- [x] Token management (localStorage)
- [x] Protected routes
- [x] API client with auth headers
- [x] Error handling & 401 redirect
- [x] Loading states
- [x] TypeScript types
- [x] Responsive design (Tailwind)

### **Phase 2: CRM Module (NEXT)**
- [ ] Create `src/app/dashboard/crm/page.tsx`
- [ ] API: List notes (GET /api/v1/crm/notes)
- [ ] API: Get note (GET /api/v1/crm/notes/{id})
- [ ] API: Create note (POST /api/v1/crm/notes)
- [ ] API: Update note (PUT /api/v1/crm/notes/{id})
- [ ] API: Delete note (DELETE /api/v1/crm/notes/{id})
- [ ] Form: Create note
- [ ] Form: Edit note
- [ ] List: Display notes
- [ ] Actions: Delete note

### **Phase 3: ERP Module**
- [ ] Create `src/app/dashboard/erp/page.tsx`
- [ ] List projects
- [ ] List service requests
- [ ] CRUD operations

### **Phase 4: RnD Module**
- [ ] Create `src/app/dashboard/rnd/page.tsx`
- [ ] Calculator forms
- [ ] API integration
- [ ] Results display

### **Phase 5: Polish**
- [ ] Error boundaries
- [ ] Loading skeletons
- [ ] Form validation
- [ ] Toast notifications
- [ ] Unit tests
- [ ] E2E tests

---

## 🔐 Environment Variables

### **Development (.env.local)**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_AUTH_URL=http://localhost:8000
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_ENABLE_CRM=true
NEXT_PUBLIC_ENABLE_ERP=true
NEXT_PUBLIC_ENABLE_RND=true
```

### **Production (Vercel)**
```env
NEXT_PUBLIC_API_URL=https://api.premnathrail.com/api/v1
NEXT_PUBLIC_AUTH_URL=https://api.premnathrail.com
NEXT_PUBLIC_FRONTEND_URL=https://premnathrail-portal.vercel.app
```

---

## 🔗 Backend Integration

### **Required Backend Routes**

```
GET /health                        # Health check
GET /auth/microsoft-login          # Start OAuth flow
GET /auth/callback                 # OAuth callback (auto-handled)
GET /api/v1/auth/me               # Get current user (protected)
POST /api/v1/auth/logout          # Logout (protected)

GET /api/v1/crm/notes             # List notes (protected)
GET /api/v1/crm/notes/{id}        # Get note (protected)
POST /api/v1/crm/notes            # Create note (protected)
PUT /api/v1/crm/notes/{id}        # Update note (protected)
DELETE /api/v1/crm/notes/{id}     # Delete note (protected)

(ERP and RnD routes similarly)
```

### **CORS Configuration Required**

Backend must allow frontend origin:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

See: [BACKEND_CORS_CONFIG.md](./BACKEND_CORS_CONFIG.md)

---

## 📖 How to Read This Documentation

**If you want to:**

| Goal | Document | Time |
|------|----------|------|
| **Get started quickly** | [FRONTEND_QUICKSTART.md](./FRONTEND_QUICKSTART.md) | 5 min |
| **Understand architecture** | [FRONTEND_ARCHITECTURE.md](../architecture/FRONTEND_ARCHITECTURE.md) | 15 min |
| **Copy all code** | [FRONTEND_NEXTJS_SETUP.md](./FRONTEND_NEXTJS_SETUP.md) | 30 min |
| **Configure backend** | [BACKEND_CORS_CONFIG.md](./BACKEND_CORS_CONFIG.md) | 5 min |
| **Deploy to production** | [FRONTEND_DEPLOYMENT.md](../deployment/FRONTEND_DEPLOYMENT.md) | 30 min |
| **Fix a problem** | [FRONTEND_TROUBLESHOOTING.md](../troubleshooting/FRONTEND_TROUBLESHOOTING.md) | 10 min |

---

## 🎯 Development Workflow

```
1. Read FRONTEND_QUICKSTART.md
2. Create Next.js project
3. Copy files from FRONTEND_NEXTJS_SETUP.md
4. Configure CORS (BACKEND_CORS_CONFIG.md)
5. Run: npm run dev (Terminal 1)
6. Run: python -m uvicorn app.main:app --reload (Terminal 2)
7. Test: http://localhost:3000
8. Build modules (CRM, ERP, RnD)
9. Deploy (FRONTEND_DEPLOYMENT.md)
```

---

## 🤝 Contributing

**Making changes to frontend?**

```bash
# Create feature branch
git checkout -b feature/add-crm-list

# Make changes
# ...

# Commit
git commit -m "feat: Add CRM list page"

# Push
git push origin feature/add-crm-list

# Create Pull Request on GitHub
```

**Style guide:**
- Use TypeScript for type safety
- Use Tailwind for styling
- One component per file
- Custom hooks in src/hooks
- Utilities in src/lib
- API calls in src/lib/api.ts

---

## 📞 Need Help?

1. **Check [FRONTEND_TROUBLESHOOTING.md](../troubleshooting/FRONTEND_TROUBLESHOOTING.md)**
2. **Search error in browser console (F12)**
3. **Check backend logs:** `python -m uvicorn ... --log-level debug`
4. **Test API manually:** `curl http://localhost:8000/health`
5. **Check environment variables:** `.env.local`

---

## ✨ Summary

**You now have:**
- ✅ Production-grade Next.js setup
- ✅ TypeScript for type safety
- ✅ Complete authentication flow
- ✅ Dashboard with navigation
- ✅ API client with error handling
- ✅ State management (Zustand)
- ✅ Responsive design (Tailwind)
- ✅ Comprehensive documentation
- ✅ Deployment guides
- ✅ Troubleshooting help

**Next:** Run `npm run dev` and test login! 🚀
