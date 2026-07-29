# syntax=docker/dockerfile:1
#
# Single-container build: FastAPI backend + Next.js frontend in one image.
# The frontend is the only exposed process (port 3000); it proxies /api/*
# to the backend, which binds to 127.0.0.1:8000 only (internal, not exposed).

# ---- backend deps: install Python dependencies into an isolated prefix ----
FROM python:3.12-slim AS backend-deps
WORKDIR /backend
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- frontend deps: install node_modules ----
FROM node:22-alpine AS frontend-deps
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# ---- frontend builder: build the standalone Next.js output ----
FROM node:22-alpine AS frontend-builder
WORKDIR /frontend
COPY --from=frontend-deps /frontend/node_modules ./node_modules
COPY frontend/ .

# NEXT_PUBLIC_* vars are baked into the client bundle at build time.
# Defaulting NEXT_PUBLIC_API_URL to a same-origin relative path means no
# build args are required at all — the /api/* rewrite above handles routing
# to the co-located backend.
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- production: single runtime image with both Python and Node ----
FROM python:3.12-slim AS production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg libpq5 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser

# backend
COPY --from=backend-deps /install /usr/local
COPY backend/alembic.ini ./backend/alembic.ini
COPY backend/alembic ./backend/alembic
COPY backend/app ./backend/app

# frontend (standalone output)
COPY --from=frontend-builder /frontend/public ./frontend/public
COPY --from=frontend-builder /frontend/.next/standalone ./frontend
COPY --from=frontend-builder /frontend/.next/static ./frontend/.next/static

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R appuser:appuser /app

USER appuser
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "node /app/frontend/server.js"]
