# ---- stage 1: build the React SPA ----
FROM node:22-slim AS fe
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- stage 2: FastAPI serves API + SPA from one Cloud Run container ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=fe /fe/dist ./static
RUN useradd -m albedo && chown -R albedo /app
USER albedo
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
