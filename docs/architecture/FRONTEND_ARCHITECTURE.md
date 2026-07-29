# Frontend Architecture

## Overview

Premnathrail Portal Frontend is a **plain HTML/CSS/JavaScript** application (no framework) that connects to the FastAPI backend via REST APIs.

**Design Philosophy:**
- Vanilla HTML/CSS/JS (no React/Vue) — अपनी पूरी control
- Modular structure — Pages + Components
- API client layer — Centralized backend communication
- Progressive enhancement — Works without JavaScript भी

---

## Project Structure

```
frontend/
├── public/
│   ├── index.html          # Entry point
│   └── favicon.ico
├── src/
│   ├── pages/
│   │   ├── login/
│   │   │   ├── login.html      # Login page
│   │   │   ├── login.css       # Login styles
│   │   │   └── login.js        # Login logic
│   │   └── dashboard/
│   │       ├── dashboard.html  # Dashboard page
│   │       ├── dashboard.css   # Dashboard styles
│   │       └── dashboard.js    # Dashboard logic
│   ├── components/
│   │   ├── navbar.html         # Navigation bar (reusable)
│   │   ├── sidebar.html        # Sidebar (reusable)
│   │   └── card.html           # Card component (reusable)
│   ├── services/
│   │   ├── api.js              # API client (centralized)
│   │   └── auth.js             # Auth helpers
│   └── styles/
│       ├── variables.css       # Color, spacing, typography
│       ├── base.css            # Global styles
│       └── responsive.css      # Mobile styles
├── .env.example                # Environment template
├── package.json                # Dependencies (if using npm)
└── server.py                   # Simple Python server for local dev
```

---

## Frontend Flow

### **1. Initial Load**

```
User opens http://localhost:3000
         ↓
Check: localStorage.getItem('session_token')?
         ↓
    ├─ Token exists → GET /api/v1/auth/me
    │                     ↓
    │              Valid? → Show Dashboard
    │              Invalid? → Clear token, Show Login
    │
    └─ No token → Show Login Page
```

### **2. Login Flow**

```
User clicks "Login with Microsoft"
         ↓
Open: http://localhost:8000/auth/microsoft-login
         ↓
Microsoft login (external)
         ↓
Redirect to: http://localhost:8000/auth/callback?code=XXX&state=YYY
         ↓
Backend exchanges code for token
         ↓
Redirect to: http://localhost:3000/dashboard?token=JWT_TOKEN
         ↓
Frontend stores token in localStorage
         ↓
Show Dashboard with user info
```

### **3. API Communication**

```
Frontend                          Backend
   │                                │
   ├─ GET /api/v1/auth/me ──────────→
   │  (with Authorization header)   │
   │                                │ Verify JWT
   │                                │ Return user data
   │← {id, email, name, role} ──────┤
   │                                │
   └─ All requests include token    │
      Authorization: Bearer <token> │
```

---

## Key Files Explained

### **api.js — API Client**

```javascript
// BASE_URL = http://localhost:8000/api/v1

// 1. Helper: Add token to all requests
function getAuthHeaders() {
  const token = localStorage.getItem('session_token');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

// 2. Helper: Check if response is 401 (unauthorized)
async function handleAuthError(response) {
  if (response.status === 401) {
    localStorage.removeItem('session_token');
    window.location.href = '/login.html';
  }
}

// 3. GET current user
async function getCurrentUser() {
  const response = await fetch(`${BASE_URL}/auth/me`, {
    headers: getAuthHeaders()
  });
  
  if (!response.ok) {
    handleAuthError(response);
    return null;
  }
  
  return await response.json();
}

// 4. Logout
async function logout() {
  await fetch(`${BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: getAuthHeaders()
  });
  
  localStorage.removeItem('session_token');
  window.location.href = '/login.html';
}
```

### **login.js — Login Logic**

```javascript
// 1. On page load
document.addEventListener('DOMContentLoaded', () => {
  // Check if user already logged in
  const token = new URLSearchParams(window.location.search).get('token');
  
  if (token) {
    // Redirect से आया है token
    localStorage.setItem('session_token', token);
    window.location.href = '/dashboard.html';
  }
  
  // Button को attach करो
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
});

// 2. Login handler
function handleLogin() {
  // Backend के login URL पर redirect करो
  window.location.href = 'http://localhost:8000/auth/microsoft-login';
}
```

### **dashboard.js — Dashboard Logic**

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Check token exists
  const token = localStorage.getItem('session_token');
  if (!token) {
    window.location.href = '/login.html';
    return;
  }
  
  // 2. Fetch user data
  const user = await getCurrentUser();
  if (!user) return;  // getCurrentUser handles 401
  
  // 3. Display user info
  document.getElementById('userName').textContent = user.name;
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('userRole').textContent = user.role;
  
  // 4. Logout button
  document.getElementById('logoutBtn').addEventListener('click', logout);
  
  // 5. Module cards (disabled for now)
  document.querySelectorAll('.module-card').forEach(card => {
    card.style.opacity = '0.5';
    card.style.cursor = 'not-allowed';
  });
});
```

---

## Authentication Flow Details

### **Token Storage**

```javascript
// After login successful redirect
const token = new URLSearchParams(window.location.search).get('token');
localStorage.setItem('session_token', token);

// In all API calls
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};

// On logout
localStorage.removeItem('session_token');
```

### **JWT Token Format**

```
Header.Payload.Signature

Example:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c

Decoded Payload:
{
  "sub": "1",           # User ID
  "role": "admin",      # User role
  "iat": 1234567890,    # Issued at
  "exp": 1234571490     # Expires at
}
```

---

## Error Handling

### **Common Scenarios**

| Scenario | HTTP Status | Frontend Action |
|----------|-------------|-----------------|
| Token invalid | 401 | Clear token, redirect to login |
| Token expired | 401 | Clear token, redirect to login |
| User inactive | 401 | Show message: "Account disabled" |
| Server error | 500 | Show: "Server error, please retry" |
| Network error | — | Show: "No internet connection" |

### **Implementation**

```javascript
async function apiFetch(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: getAuthHeaders()
    });
    
    if (response.status === 401) {
      localStorage.removeItem('session_token');
      window.location.href = '/login.html';
      return null;
    }
    
    if (response.status === 500) {
      alert('Server error. Please try again.');
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Network error:', error);
    alert('Network error. Check your connection.');
    return null;
  }
}
```

---

## CORS & Security

### **Backend CORS Configuration**

Backend को allow करना होगा requests से `http://localhost:3000`:

```python
# app/main.py
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### **Credentials in Cookies**

```javascript
// Include cookies in requests
fetch(url, {
  credentials: 'include'  // Send cookies with request
})
```

---

## Environment Variables

### **.env File**

```env
# Backend API
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_AUTH_REDIRECT_URI=http://localhost:3000/dashboard.html

# Features
VITE_ENABLE_CRM=false
VITE_ENABLE_ERP=false
VITE_ENABLE_RND=false
```

### **Usage in JavaScript**

```javascript
const API_BASE = process.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
```

---

## Development Server

### **Option 1: Python Simple Server**

```bash
cd frontend
python -m http.server 3000
```

Then open: `http://localhost:3000/src/pages/login/login.html`

### **Option 2: Live Server (VS Code Extension)**

- Install "Live Server" extension
- Right-click any HTML file → "Open with Live Server"
- Automatically opens at `http://localhost:5500`

### **Option 3: Node.js HTTP Server**

```bash
npm install -g http-server
http-server frontend -p 3000
```

---

## Testing Frontend

### **Manual Testing Checklist**

- [ ] Login page loads
- [ ] "Login with Microsoft" button redirects correctly
- [ ] Callback returns token
- [ ] Token stored in localStorage
- [ ] Dashboard loads user info
- [ ] Logout clears token and redirects to login
- [ ] Refresh page → Still logged in (token persists)
- [ ] Invalid token → Redirects to login

### **Browser Console Testing**

```javascript
// Check token
localStorage.getItem('session_token')

// Check backend connection
fetch('http://localhost:8000/health')
  .then(r => r.json())
  .then(d => console.log(d))

// Call API manually
fetch('http://localhost:8000/api/v1/auth/me', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('session_token')}`
  }
})
  .then(r => r.json())
  .then(d => console.log(d))
```

---

## Next Steps (After Base Works)

1. **CRM Module Page** — `/dashboard/crm.html`
   - List notes
   - Create note form
   - Edit/delete notes

2. **ERP Module Page** — `/dashboard/service.html`
   - Projects list
   - Service requests form

3. **RnD Module Page** — `/dashboard/rnd.html`
   - Calculator tools
   - PDF export

4. **State Management** — If needed
   - Currently: localStorage for token only
   - Could add: IndexedDB for caching

---

## Troubleshooting

### **Login redirects but doesn't return**

- Check: AZURE_REDIRECT_URI in backend .env
- Should be: `http://localhost:8000/auth/callback`
- Frontend redirect URI should match backend config

### **Token not stored**

- Check: localStorage enabled in browser
- Open DevTools → Application → LocalStorage
- Look for `session_token` key

### **401 Errors on API calls**

- Token expired? Check `exp` claim in token
- Token format wrong? Should be `Bearer <token>`
- Backend restarted? Restart required

### **CORS errors**

- "Access to fetch blocked by CORS"
- Fix: Add frontend URL to backend CORS config
- Restart backend after change

---

## Security Checklist

✅ **Do:**
- Store token in localStorage (OK for this app)
- Always send Authorization header
- Clear token on 401
- Validate on every page load

❌ **Don't:**
- Store sensitive data in localStorage (only token OK)
- Log tokens to console
- Send token in URL
- Cache sensitive responses

---

## Files to Create

Next sections will show exact code for:
1. `login.html` + `login.js`
2. `dashboard.html` + `dashboard.js`
3. `services/api.js`
4. `styles/variables.css` + `base.css`

Ready? 🚀
