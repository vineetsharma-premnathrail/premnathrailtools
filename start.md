Terminal 1 — Backend (FastAPI)
cd D:\Desktop\PremnathrailPortal-Ideal\backend
.\venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
Terminal 2 — Frontend (Next.js)
cd D:\Desktop\PremnathrailPortal-Ideal\frontend
npm run dev
