# Interview Mirror

Interview preparation with a FastAPI backend and React frontend. Product scope
is in [docs/plan.md](docs/plan.md); the API contract is [openapi.yaml](openapi.yaml).

## Local setup

Prerequisites: Python 3.11+, uv, Node.js 22+, npm, and Make. From a clean checkout,
install the exact locked dependencies (installation needs registry access):

```sh
make install
cd frontend
npm ci
```

Start the backend from the repository root:

```sh
make run
```

Start the frontend in a second terminal:

```sh
cd frontend
npm run dev
```

The backend listens on port 8000; the frontend listens on port 8080. Backend
dependencies are managed by uv in `backend/pyproject.toml` and `backend/uv.lock`.
Frontend dependencies use `frontend/package.json` and `frontend/package-lock.json`.

## Tests

After installing dependencies, run the isolated baseline smoke tests from the root:

```sh
make smoke
```

These tests exercise a standalone ASGI application and React rendering, with no
application database, AI key, email adapter, or network request. The backend smoke
uses in-process ASGI transport; the frontend smoke renders only a local component.

Run the complete existing suites separately:

```sh
make test
cd frontend
npm test
```

Production frontend build: `cd frontend && npm run build`. See
[backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md)
for application configuration.
