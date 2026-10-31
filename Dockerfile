FROM node:22-slim AS frontend-build

WORKDIR /src/frontend
ENV VITE_API_BASE_URL=/api
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS backend

COPY --from=frontend-build /usr/local/bin/node /usr/local/bin/node
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    FRONTEND_SERVER_ENTRY=/app/frontend/server/index.mjs \
    FRONTEND_SERVER_HOST=127.0.0.1 \
    FRONTEND_SERVER_PORT=3000 \
    NITRO_HOST=127.0.0.1 \
    NITRO_PORT=3000

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev
COPY --from=frontend-build /src/frontend/.output/ /app/frontend/

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
