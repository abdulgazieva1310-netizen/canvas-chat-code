Backend (Python / FastAPI), use uv for dependency management. a few useful commands:
cd backend - navigate to backend directory
uv sync  - install dependencies
uv add <PACKAGE-NAME>
uv run python <PYTHON-FILE>
uv run uvicorn app.main:app --reload --port 8000 - start the backend server
uv run pytest - run the whole backend test suite
uv run pytest tests/test_api.py - run one specific test file

Frontend (React / Vite)
cd frontend - navigate to frontend directory
npm install - install dependencies
npm run dev - start the frontend server (port 8080)

Rules
Backend dependencies are added in `backend/pyproject.toml`.
Frontend dependencies are added in `frontend/package.json`.
Regularly commit code to git after every meaningful change.
Read `docs/process.md` before starting any task to understand the PM, Engineer, and QA workflow.