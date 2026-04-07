FROM node:22-alpine AS frontend-build

WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY --from=frontend-build /build/dist /app/frontend/dist

ENV ASC_DATABASE_PATH=/app/backend/data/asc.db
ENV ASC_SEED_DIR=/app/backend/data/seed
ENV ASC_STATIC_DIR=/app/frontend/dist

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
