# Frontend Quick Start (5 Steps)

## 🚀 Setup Everything in 5 Minutes

### **Step 1: Create Next.js Project (2 min)**

```bash
npx create-next-app@latest premnathrail-portal \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-git \
  --src-dir

cd premnathrail-portal
```

### **Step 2: Install Libraries (1 min)**

```bash
npm install axios zustand @tanstack/react-query js-cookie
```

### **Step 3: Create Files**

Copy all code from **FRONTEND_NEXTJS_SETUP.md** sections:

**Files to Create:**
1. `src/types/index.ts` — TypeScript types
2. `src/lib/api.ts` — API client  
3. `src/store/authStore.ts` — Auth state
4. `src/hooks/useAuth.ts` — Auth hook
5. `src/components/Navbar.tsx` — Top bar
6. `src/components/Sidebar.tsx` — Side menu
7. `src/components/ModuleCard.tsx` — Card component
8. `src/components/LoadingSpinner.tsx` — Loading
9. `src/app/layout.tsx` — Root layout
10. `src/app/login/page.tsx` — Login page
11. `src/app/dashboard/layout.tsx` — Dashboard layout
12. `src/app/dashboard/page.tsx` — Dashboard home
13. `.env.local` — Environment variables
14. `src/styles/globals.css` — Global styles

### **Step 4: Configure Backend CORS (1 min)**

Edit `backend/app/main.py`:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Restart backend:
```bash
python -m uvicorn app.main:app --reload
```

### **Step 5: Start Development (1 min)**

**Terminal 1 - Backend:**
```bash
cd backend
python -m uvicorn app.main:app --reload
```

**Terminal 2 - Frontend:**
```bash
cd premnathrail-portal
npm run dev
```

**Open:** http://localhost:3000

---

## ✅ Verify Everything Works

1. **Frontend loads?** ✓ http://localhost:3000 → Login page
2. **Can click login?** ✓ Redirects to Microsoft
3. **After login redirects back?** ✓ Shows dashboard
4. **Shows user name?** ✓ User data from backend
5. **Sign out works?** ✓ Goes back to login

---

## 📁 Final Folder Structure

```
premnathrail-portal/
├── src/
│   ├── app/
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── dashboard/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── Navbar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── ModuleCard.tsx
│   │   └── LoadingSpinner.tsx
│   ├── hooks/
│   │   └── useAuth.ts
│   ├── lib/
│   │   └── api.ts
│   ├── store/
│   │   └── authStore.ts
│   ├── styles/
│   │   └── globals.css
│   └── types/
│       └── index.ts
├── .env.local
├── next.config.js
├── tsconfig.json
├── package.json
└── README.md
```

---

## 🔗 Important Links

**Documentation:**
- Frontend Architecture: [docs/architecture/FRONTEND_ARCHITECTURE.md](../architecture/FRONTEND_ARCHITECTURE.md)
- Next.js Setup: [docs/setup/FRONTEND_NEXTJS_SETUP.md](./FRONTEND_NEXTJS_SETUP.md)
- CORS Config: [docs/setup/BACKEND_CORS_CONFIG.md](./BACKEND_CORS_CONFIG.md)
- Troubleshooting: [docs/troubleshooting/FRONTEND_TROUBLESHOOTING.md](../troubleshooting/FRONTEND_TROUBLESHOOTING.md)
- Deployment: [docs/deployment/FRONTEND_DEPLOYMENT.md](../deployment/FRONTEND_DEPLOYMENT.md)

**Useful Commands:**
```bash
npm run dev        # Development
npm run build      # Production build
npm start          # Run production build
npm run lint       # Check code quality
npm run type-check # TypeScript check
```

---

## 🎯 Next Steps After Login Works

### Phase 1: Core (Done after this)
- ✅ Login page
- ✅ Dashboard
- ✅ User profile
- ✅ Logout

### Phase 2: CRM Module
- Create `src/app/dashboard/crm/page.tsx`
- List notes from backend
- Add form to create notes
- Edit/delete notes

### Phase 3: ERP Module
- Create `src/app/dashboard/erp/page.tsx`
- List projects
- List service requests
- Forms for CRUD

### Phase 4: RnD Module
- Create `src/app/dashboard/rnd/page.tsx`
- Calculator forms
- Call backend APIs
- Display results

### Phase 5: Polish
- Add error handling
- Add loading states
- Add validation
- Add tests

---

## 💡 Tips

**IDE Setup:**
- Use VS Code
- Install "Tailwind CSS IntelliSense"
- Install "ESLint" extension
- Format on save: Set `editor.formatOnSave: true`

**Git Workflow:**
```bash
# Save progress
git add .
git commit -m "Frontend: Add auth and dashboard"
git push

# Others can clone and run:
# git clone <repo>
# cd premnathrail-portal
# npm install
# npm run dev
```

**Team Development:**
```bash
# Frontend team:
cd premnathrail-portal
npm run dev

# Backend team:
cd backend
python -m uvicorn app.main:app --reload

# Both run simultaneously!
```

---

## 🐛 Quick Troubleshooting

| Problem | Command |
|---------|---------|
| Port 3000 in use | `npm run dev -- -p 3001` |
| Backend not connecting | `curl http://localhost:8000/health` |
| CORS error | Check CORS in backend app/main.py |
| Token not saving | Check localStorage in DevTools |
| Build fails | `rm -rf node_modules && npm install` |

---

## ✨ You're Ready!

Everything is set up for production. Now:

1. **Create login** ✅
2. **Test with backend** → Run both servers
3. **Build modules** → Follow CRM/ERP/RnD pattern
4. **Deploy** → Use Vercel or Docker

**Next command:**
```bash
npm run dev
```

Have fun building! 🚀
