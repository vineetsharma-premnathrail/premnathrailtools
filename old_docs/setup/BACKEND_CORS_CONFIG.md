# Backend CORS Configuration for Next.js Frontend

## What is CORS?

CORS (Cross-Origin Resource Sharing) allows browsers to make requests from one domain to another.

Without CORS config:
```
Frontend: http://localhost:3000
Backend: http://localhost:8000
❌ Browser blocks request (different origins)
```

With CORS config:
```
Backend explicitly allows requests from http://localhost:3000
✅ Browser allows request
```

---

## Backend Setup (FastAPI)

### **Install Package**

```bash
cd backend
pip install fastapi-cors
```

### **Add to app/main.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",      # Next.js development
        "http://localhost:5173",      # Vite alternative
        "http://127.0.0.1:3000",      # Localhost alias
    ],
    allow_credentials=True,            # Allow cookies/auth headers
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],              # Allow all headers
)

# Rest of your routes...
@app.get("/health")
async def health():
    return {"status": "ok"}
```

---

## Production CORS Configuration

### **Environment-Based**

```python
from app.core.config import settings

origins = []

if settings.environment == "development":
    origins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
    ]
else:
    origins = [
        "https://premnathrail-portal.vercel.app",  # Production domain
        "https://www.premnathrail-portal.com",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
```

---

## Testing CORS

### **From Browser Console**

```javascript
// This should work after CORS is configured
fetch('http://localhost:8000/health')
  .then(r => r.json())
  .then(console.log)
```

### **Common CORS Errors**

**Error:** 
```
Access to XMLHttpRequest at 'http://localhost:8000/api/v1/auth/me' 
from origin 'http://localhost:3000' has been blocked by CORS policy
```

**Fix:**
1. Check backend CORS configuration
2. Verify `allow_origins` includes frontend URL
3. Restart backend server
4. Hard refresh browser (Ctrl+Shift+R)

---

## Update Backend app/main.py

Add this near the top of your FastAPI app setup:

```python
# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Premnathrail Portal API",
    version="1.0.0",
)

# ============ CORS CONFIGURATION ============
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",      # Next.js dev
        "http://localhost:5173",      # Vite dev
        "http://127.0.0.1:3000",      # Localhost
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ HEALTH CHECK ============
@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": "2025-01-01T00:00:00Z"}

# ============ ROUTES ============
# Import and include your routes
from app.modules.main.routes.auth import router as auth_router
app.include_router(auth_router, prefix="/api/v1")
```

---

## Restart Backend

After making changes:

```bash
# Stop the server (Ctrl+C)

# Restart
cd backend
python -m uvicorn app.main:app --reload
```

You should see:
```
INFO:     Application startup complete
```

---

## Done!

Now frontend can communicate with backend. 🎉

Next: Create the Next.js frontend files.
