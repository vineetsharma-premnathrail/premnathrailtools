# Setup Instructions

## Prerequisites

- **Python 3.14+** — [Download](https://www.python.org/downloads/)
- **PostgreSQL 18+** — [Download](https://www.postgresql.org/download/)
- **Node.js 24+** (for frontend) — [Download](https://nodejs.org/)
- **Git** — [Download](https://git-scm.com/)
- **Microsoft Azure Account** — for OAuth credentials

---

## Step 1: Database Setup

### Option A: Use existing PostgreSQL

1. **Open PostgreSQL:**
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres
   ```

2. **Create database:**
   ```sql
   CREATE DATABASE premnathrail_ideal;
   \q
   ```

### Option B: Docker (recommended for development)

```bash
docker run --name postgres-premnathrail -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=premnathrail_ideal -p 5432:5432 -d postgres:18
```

---

## Step 2: Microsoft Azure OAuth Setup

### Register Application in Azure AD

1. Go to: [Azure Portal](https://portal.azure.com)
2. Navigate to: **Azure Active Directory → App registrations → New registration**
3. Enter:
   - **Name:** `Premnathrail Portal Dev`
   - **Supported account types:** `Accounts in this organizational directory only`
4. Click **Register**

### Get Credentials

1. Copy **Application (client) ID** → `AZURE_CLIENT_ID`
2. Copy **Directory (tenant) ID** → `AZURE_TENANT_ID`
3. Go to **Certificates & secrets → New client secret**
   - Copy the secret value → `AZURE_CLIENT_SECRET`

### Configure Redirect URI

1. Go to **Authentication → Platform configurations → Web**
2. Add **Redirect URI:** `http://localhost:8000/api/v1/auth/callback`

---

## Step 3: Backend Setup

### 1. Clone/Open project

```powershell
cd D:\Desktop\PremnathrailPortal-Ideal
```

### 2. Create virtual environment

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure `.env` file

Create `backend/.env`:

```env
# Database
DATABASE_URL=postgresql+psycopg://postgres:password@localhost:5432/premnathrail_ideal

# Microsoft Azure OAuth
AZURE_CLIENT_ID=your-client-id-from-azure
AZURE_CLIENT_SECRET=your-client-secret-from-azure
AZURE_TENANT_ID=your-tenant-id-from-azure
AZURE_REDIRECT_URI=http://localhost:8000/auth/callback

# Domain restriction (optional)
DOMAIN_EMAIL=@premnathrail.com

# JWT
SECRET_KEY=change-this-to-a-random-string-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

### 5. Run server

```bash
uvicorn app.main:app --reload
```

**Server runs at:** `http://localhost:8000`

**API docs:** `http://localhost:8000/docs`

---

## Step 4: Test Backend

### Health check
```bash
curl http://localhost:8000/health
```

Should return:
```json
{"status": "ok", "app": "Premnathrail Portal"}
```

### Test via Swagger UI
1. Open: `http://localhost:8000/docs`
2. Click on `/health`
3. Click "Try it out"
4. Click "Execute"
5. Should see 200 response

---

## Step 5: Run Tests

```bash
pytest app/tests -v
```

Should see:
```
test_create_and_verify_token PASSED
test_verify_valid_token PASSED
test_verify_invalid_token PASSED
test_health_endpoint PASSED

====== 4 passed in 0.05s ======
```

---

## Step 6: Frontend Setup (Optional)

### 1. Create basic HTML test page

Create `frontend/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Premnathrail Portal</title>
</head>
<body>
  <h1>Premnathrail Portal</h1>
  
  <button onclick="login()">Login with Microsoft</button>
  <div id="user-info" style="display:none;">
    <p>Welcome, <span id="username"></span>!</p>
    <button onclick="logout()">Logout</button>
  </div>

  <script>
    const API_URL = 'http://localhost:8000';
    
    function login() {
      window.location.href = `${API_URL}/auth/microsoft-login`;
    }
    
    async function getMe() {
      const token = localStorage.getItem('token');
      if (!token) return null;
      
      const response = await fetch(`${API_URL}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) return response.json();
      return null;
    }
    
    async function logout() {
      localStorage.removeItem('token');
      location.reload();
    }
    
    // Check if logged in
    (async () => {
      const user = await getMe();
      if (user) {
        document.getElementById('user-info').style.display = 'block';
        document.getElementById('username').textContent = user.name;
      }
    })();
  </script>
</body>
</html>
```

### 2. Serve frontend

```bash
# Using Python
python -m http.server 3000

# Or use npm http-server
npm install -g http-server
http-server
```

Open: `http://localhost:3000/frontend/index.html`

---

## Common Issues

### PostgreSQL Connection Error

**Error:** `could not connect to server`

**Fix:**
- Make sure PostgreSQL is running
- Check DATABASE_URL in `.env`
- Verify username/password

### Azure OAuth Error

**Error:** `OAuth not configured`

**Fix:**
- Set AZURE_CLIENT_ID in `.env`
- Set AZURE_CLIENT_SECRET in `.env`
- Set AZURE_TENANT_ID in `.env`

### Port 8000 Already In Use

**Error:** `Address already in use`

**Fix:**
```bash
# Use different port
uvicorn app.main:app --port 8001 --reload
```

### Import Error

**Error:** `ModuleNotFoundError: No module named 'app'`

**Fix:**
```bash
# Make sure you're in backend directory
cd backend
python -m uvicorn app.main:app --reload
```

---

## Next Steps

1. ✅ Backend running
2. ✅ Tests passing
3. ⏭️ Create CRM module (Stage 7)
4. ⏭️ Build frontend (Stage 8)
5. ⏭️ Add more modules (Stage 10)

---

## Useful Commands

```bash
# Run server
uvicorn app.main:app --reload

# Run tests
pytest app/tests -v

# Run specific test
pytest app/tests/test_auth.py::test_health_endpoint -v

# Create new migration (when adding models)
alembic revision --autogenerate -m "Add users table"

# Apply migrations
alembic upgrade head

# Reset database (development only!)
python -c "from app.db.base import Base; from app.db.session import engine; Base.metadata.drop_all(bind=engine); Base.metadata.create_all(bind=engine)"
```

---

## Architecture at a Glance

```
Browser
  ↓
  ↓ HTTP/REST
  ↓
FastAPI (localhost:8000)
  ├─ Authentication (Microsoft SSO)
  ├─ Routes (HTTP endpoints)
  ├─ Services (Business logic)
  └─ Repositories (Database queries)
  ↓
PostgreSQL (localhost:5432)
```

---

## Need Help?

- Check logs in terminal where uvicorn is running
- Check `docs/architecture/ARCHITECTURE.md` for design
- Check `docs/api/API.md` for endpoints
- Check test files for examples
