# Next.js Frontend Deployment Guide

## Quick Deployment Options

| Platform | Difficulty | Cost | Setup Time |
|----------|-----------|------|-----------|
| **Vercel** ⭐ | Easy | Free tier | 2 min |
| Docker | Medium | Flexible | 10 min |
| AWS S3 + CloudFront | Medium | ~$10/mo | 20 min |
| DigitalOcean | Medium | $6+/mo | 15 min |
| GitHub Pages | Easy | Free | 5 min |

---

## Option 1: Vercel (RECOMMENDED)

### **Step 1: Push to GitHub**

```bash
# Initialize git in Next.js project
cd premnathrail-portal
git init
git add .
git commit -m "Initial Next.js setup"

# Create GitHub repo at github.com/new
# Then push:
git remote add origin https://github.com/username/premnathrail-portal.git
git branch -M main
git push -u origin main
```

### **Step 2: Deploy on Vercel**

1. Go to **https://vercel.com**
2. Click "New Project"
3. Select "Import Git Repository"
4. Select your `premnathrail-portal` repo
5. Vercel auto-detects Next.js
6. Set Environment Variables:
   ```
   NEXT_PUBLIC_API_URL=https://your-backend.com/api/v1
   NEXT_PUBLIC_AUTH_URL=https://your-backend.com
   NEXT_PUBLIC_FRONTEND_URL=https://your-app.vercel.app
   ```
7. Click "Deploy"

**Done!** Your app is live at `https://your-app.vercel.app`

### **Auto-Deploy**

Every push to GitHub automatically deploys:
```bash
git push origin main  # Vercel auto-deploys
```

---

## Option 2: Docker Container

### **Create Dockerfile**

Create `premnathrail-portal/Dockerfile`:

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build Next.js app
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built app from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Expose port
EXPOSE 3000

# Start app
CMD ["npm", "start"]
```

### **Create .dockerignore**

```
node_modules
.next
.git
.gitignore
README.md
.env
.env.local
.vercel
```

### **Build & Run Locally**

```bash
# Build image
docker build -t premnathrail-frontend .

# Run container
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1 \
  premnathrail-frontend

# Opens at http://localhost:3000
```

### **Deploy to Docker Hub**

```bash
# Login to Docker Hub
docker login

# Tag image
docker tag premnathrail-frontend username/premnathrail-frontend:latest

# Push
docker push username/premnathrail-frontend:latest
```

Then on your server:
```bash
docker pull username/premnathrail-frontend:latest
docker run -d -p 80:3000 username/premnathrail-frontend:latest
```

---

## Option 3: AWS (EC2 + S3 + CloudFront)

### **Step 1: Build Static Export**

```bash
# Modify next.config.js
cat > next.config.js << 'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',  # Static export
  images: {
    unoptimized: true,
  },
}
module.exports = nextConfig
EOF

# Build
npm run build
```

### **Step 2: Upload to S3**

```bash
# Create S3 bucket
aws s3 mb s3://premnathrail-portal

# Upload build files
aws s3 sync out/ s3://premnathrail-portal/

# Make public (for CloudFront)
aws s3api put-bucket-policy --bucket premnathrail-portal \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::premnathrail-portal/*"
    }]
  }'
```

### **Step 3: CloudFront Distribution**

1. Go to CloudFront console
2. Create distribution
3. Origin: S3 bucket
4. Enable HTTPS
5. Wait 15 min for deployment

---

## Option 4: DigitalOcean App Platform

### **Step 1: Create app.yaml**

```yaml
name: premnathrail-portal
services:
- name: web
  github:
    repo: username/premnathrail-portal
    branch: main
  build_command: npm run build
  run_command: npm start
  http_port: 3000
  envs:
  - key: NEXT_PUBLIC_API_URL
    scope: RUN_AND_BUILD_TIME
    value: https://api.premnathrail.com/api/v1
```

### **Step 2: Deploy**

1. Go to **https://cloud.digitalocean.com**
2. Apps → Create App
3. Connect GitHub repo
4. Select `app.yaml`
5. Click "Deploy"

---

## Environment Variables for Production

### **Vercel**

Settings → Environment Variables:

```
NEXT_PUBLIC_API_URL=https://api.premnathrail.com/api/v1
NEXT_PUBLIC_AUTH_URL=https://api.premnathrail.com
NEXT_PUBLIC_FRONTEND_URL=https://premnathrail-portal.vercel.app
NEXT_PUBLIC_ENABLE_CRM=true
NEXT_PUBLIC_ENABLE_ERP=true
NEXT_PUBLIC_ENABLE_RND=true
```

### **Docker**

```bash
docker run -d \
  -e NEXT_PUBLIC_API_URL=https://api.premnathrail.com/api/v1 \
  -e NEXT_PUBLIC_AUTH_URL=https://api.premnathrail.com \
  -p 80:3000 \
  premnathrail-frontend
```

### **.env.production**

```env
NEXT_PUBLIC_API_URL=https://api.premnathrail.com/api/v1
NEXT_PUBLIC_AUTH_URL=https://api.premnathrail.com
NEXT_PUBLIC_FRONTEND_URL=https://premnathrail-portal.vercel.app
```

---

## Production Checklist

- [ ] TypeScript builds successfully: `npm run build`
- [ ] No console errors: `npm run lint`
- [ ] Environment variables set correctly
- [ ] Backend API URL is HTTPS
- [ ] CORS configured on backend
- [ ] Auth tokens work in production
- [ ] Images optimized
- [ ] Error boundaries in place
- [ ] Analytics configured
- [ ] Security headers set

---

## Backend API for Production

Your backend API should be:

1. **Secure**: HTTPS only
2. **CORS configured**: Allow production frontend URL
3. **Rate limited**: Prevent abuse
4. **Monitored**: Logs and errors tracked
5. **Scalable**: Can handle traffic

Example backend production config:

```python
# app/main.py
from app.core.config import settings

origins = [
    "https://premnathrail-portal.vercel.app",
    "https://www.premnathrail.com",
]

if settings.environment == "development":
    origins.extend([
        "http://localhost:3000",
        "http://localhost:5173",
    ])

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```

---

## Monitor Production

### **Vercel Analytics**

Built-in (free):
- Page load time
- Core Web Vitals
- Deployment history

### **Error Tracking**

Add Sentry:

```bash
npm install @sentry/nextjs
```

In `app/layout.tsx`:
```typescript
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
})
```

---

## Cost Estimation

| Platform | Cost | Notes |
|----------|------|-------|
| Vercel | Free - $50/mo | Best for most projects |
| DigitalOcean | $6 - $20/mo | Simple VPS |
| AWS | $10 - $50+/mo | Pay per usage |
| Docker (self-hosted) | $5 - $20/mo | Full control |

---

## Done! 🚀

Choose one:
1. **Vercel** (easiest, recommended)
2. **Docker** (most control)
3. **AWS** (enterprise)
4. **DigitalOcean** (balance)

Deploy now!
