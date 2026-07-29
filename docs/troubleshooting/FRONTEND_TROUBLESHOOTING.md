# Frontend (Next.js) Troubleshooting Guide

## Common Issues & Solutions

### **Issue 1: Port 3000 already in use**

**Error:**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Fix:**

**Windows (PowerShell):**
```powershell
# Find process using port 3000
netstat -ano | findstr :3000

# Kill it (replace PID)
taskkill /PID <PID> /F

# Or use different port
npm run dev -- -p 3001
```

**Mac/Linux:**
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use different port
npm run dev -- -p 3001
```

---

### **Issue 2: Backend connection refused**

**Error:**
```
Error: connect ECONNREFUSED 127.0.0.1:8000
```

**Fix:**

1. Check backend is running:
```bash
# Terminal 1: Backend
cd backend
python -m uvicorn app.main:app --reload
```

2. Check API URL in `.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

3. Test connection from browser console:
```javascript
fetch('http://localhost:8000/health')
  .then(r => r.json())
  .then(console.log)
```

---

### **Issue 3: CORS error**

**Error:**
```
Access to XMLHttpRequest at 'http://localhost:8000/api/v1/auth/me' 
from origin 'http://localhost:3000' has been blocked by CORS policy
```

**Fix:**

1. Add CORS to backend (app/main.py):
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

2. Restart backend:
```bash
# Press Ctrl+C, then restart
python -m uvicorn app.main:app --reload
```

3. Hard refresh browser (Ctrl+Shift+R)

---

### **Issue 4: Token not saving to localStorage**

**Problem:** After login, token not in localStorage

**Debug:**
```javascript
// Open browser console (F12)
localStorage.getItem('auth-storage')

// Should show something like:
// {"state":{"user":{...},"token":"eyJ..."},"version":0}
```

**Fix:**

1. Check if localStorage is enabled:
   - DevTools → Application → Storage → Local Storage
   - Should list your domain

2. Check useAuthStore:
```typescript
// src/store/authStore.ts
// Make sure it has:
persist(
  (set, get) => ({...}),
  {
    name: 'auth-storage',  // Storage key
    partialize: (state) => ({
      user: state.user,
      token: state.token,
    }),
  }
)
```

3. Clear and retry:
```javascript
localStorage.clear()
location.reload()
```

---

### **Issue 5: "Unauthorized" after login**

**Error:**
```
401 Unauthorized
```

**Problem:** Token not being sent to backend

**Debug:**
```javascript
// In api.ts, check token is sent:
const token = localStorage.getItem('auth-storage')
console.log(token)  // Should have a JWT

// Check Authorization header:
fetch('http://localhost:8000/api/v1/auth/me', {
  headers: {
    'Authorization': `Bearer YOUR_TOKEN_HERE`
  }
})
```

**Fix:**

1. Verify token is in localStorage:
```javascript
const stored = JSON.parse(localStorage.getItem('auth-storage'))
console.log(stored.state.token)
```

2. Check interceptor in api.ts:
```typescript
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
```

3. Check token format (should be JWT):
```javascript
// Token should look like: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0...
const token = useAuthStore.getState().token
console.log(token.split('.').length)  // Should be 3 parts
```

---

### **Issue 6: Blank page after build**

**Error:** `npm run build` succeeds but page is blank

**Fix:**

1. Check build output:
```bash
npm run build
```
Should say: `✓ Compiled successfully`

2. Test locally:
```bash
npm run build
npm start
```
Then open http://localhost:3000

3. Check for errors in browser console:
   - Open DevTools (F12)
   - Look for red errors
   - Check Network tab for failed requests

---

### **Issue 7: "Next.js not found" error**

**Error:**
```
Error: Cannot find module 'next'
```

**Fix:**

1. Reinstall dependencies:
```bash
rm -rf node_modules package-lock.json
npm install
```

2. Check Node.js version:
```bash
node --version  # Should be 18+
npm --version   # Should be 9+
```

3. Update npm:
```bash
npm install -g npm@latest
```

---

### **Issue 8: TypeScript errors**

**Error:**
```
error TS2307: Cannot find module '@/types'
```

**Fix:**

1. Check `tsconfig.json` has path aliases:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

2. Check import paths match:
```typescript
// ✓ Correct
import { User } from '@/types'

// ✗ Wrong
import { User } from './types'
```

3. Restart TypeScript:
   - Close and reopen editor
   - `npm run build` should work

---

### **Issue 9: Login redirects but doesn't return**

**Problem:** Click login → Goes to Microsoft → Never comes back

**Fix:**

1. Check redirect URI in backend `.env`:
```env
AZURE_REDIRECT_URI=http://localhost:8000/auth/callback
```

2. Check this matches Azure Portal:
   - Azure AD → App registrations → Your app
   - Authentication → Redirect URIs
   - Should list: `http://localhost:8000/auth/callback`

3. Check backend callback route:
```python
# app/modules/main/routes/auth.py
@router.get("/callback")
async def oauth_callback(code: str, state: str):
    # Should return redirect with token
    return RedirectResponse(
        url=f"http://localhost:3000/login?token={token}"
    )
```

4. Check token is in redirect:
   - After login, URL should be: 
   - `http://localhost:3000/login?token=eyJ...`

---

### **Issue 10: Module not found errors**

**Error:**
```
ModuleNotFoundError: No module named 'app'
```

**This is BACKEND error, not frontend!**

**Fix:** (in backend)
```bash
cd backend
python -m uvicorn app.main:app --reload
```

---

## Performance Issues

### **Slow page load**

**Check:**
1. Network tab in DevTools
2. Is API call slow?
3. Is build size large?

```bash
# Check bundle size
npm run build

# Analyze:
npm install -D @next/bundle-analyzer
# Add to next.config.js:
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})
module.exports = withBundleAnalyzer({...})

# Run analysis:
ANALYZE=true npm run build
```

### **High memory usage**

```bash
# Check build memory:
node --max-old-space-size=4096 node_modules/.bin/next build
```

---

## Debugging Commands

### **Check environment variables**

```bash
# Show all env vars:
npm start

# Or in code:
console.log(process.env.NEXT_PUBLIC_API_URL)
```

### **Run with debug logging**

```bash
# Enable debug mode:
DEBUG=* npm run dev
```

### **Clear Next.js cache**

```bash
rm -rf .next
npm run dev
```

### **Rebuild everything**

```bash
rm -rf node_modules .next
npm install
npm run dev
```

---

## Testing Locally

### **Test login flow manually**

```javascript
// Open browser console (F12) and run:

// 1. Check API is accessible
fetch('http://localhost:8000/health')
  .then(r => r.json())
  .then(console.log)

// 2. Test login URL
fetch('http://localhost:8000/auth/microsoft-login')
  .then(r => console.log(r.url))

// 3. Check localStorage
console.log(localStorage.getItem('auth-storage'))

// 4. Call protected endpoint
fetch('http://localhost:8000/api/v1/auth/me', {
  headers: {
    'Authorization': `Bearer YOUR_TOKEN_HERE`
  }
})
  .then(r => r.json())
  .then(console.log)
```

---

## Browser DevTools Tips

### **Network Tab**

1. Open DevTools (F12)
2. Click "Network" tab
3. Click login button
4. Watch requests:
   - Should redirect to `auth/microsoft-login`
   - Then redirect to Microsoft
   - Then redirect back with token

### **Application Tab**

1. Open DevTools (F12)
2. Click "Application" tab
3. Check:
   - **Cookies** — `session_token` present?
   - **Local Storage** — `auth-storage` present?
   - **Indexed DB** — Any data stored?

### **Console Tab**

1. Open DevTools (F12)
2. Click "Console" tab
3. Look for errors (red text)
4. Run debugging commands above

---

## Logs & Debugging

### **Frontend Logs**

```typescript
// In src/lib/api.ts add logging:
apiClient.interceptors.request.use((config) => {
  console.log('Request:', config.method, config.url)
  return config
})

apiClient.interceptors.response.use(
  (response) => {
    console.log('Response:', response.status, response.data)
    return response
  },
  (error) => {
    console.error('Error:', error.response?.status, error.message)
    return Promise.reject(error)
  }
)
```

### **Backend Logs**

```bash
# Verbose logging:
python -m uvicorn app.main:app --reload --log-level debug
```

---

## Can't Find Your Issue?

**Checklist before asking for help:**

1. ✅ Backend running? (`http://localhost:8000/health`)
2. ✅ Frontend running? (`http://localhost:3000`)
3. ✅ `.env.local` configured?
4. ✅ Dependencies installed? (`npm install`)
5. ✅ No TypeScript errors? (`npm run build`)
6. ✅ CORS configured on backend?
7. ✅ Browser cache cleared? (Ctrl+Shift+R)
8. ✅ Checked browser console? (F12)

---

**Still stuck?** Check logs:
```bash
# Frontend
npm run dev

# Backend  
python -m uvicorn app.main:app --reload --log-level debug

# Then run action that fails and share the error!
```

Good luck! 🚀
