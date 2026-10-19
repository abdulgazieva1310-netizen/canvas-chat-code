.DEFAULT_GOAL := help

UV ?= uv
HOST ?= 127.0.0.1
PORT ?= 8000

.PHONY: help install run test smoke

help:
	@echo "make install  Install backend dependencies with uv"
	@echo "make run      Run the backend with auto-reload (HOST=$(HOST) PORT=$(PORT))"
	@echo "make test     Run the backend tests"
	@echo "make smoke    Run isolated backend and frontend smoke tests"

install:
	cd backend && $(UV) sync --locked

run:
	cd backend && $(UV) run --locked uvicorn app.main:app --reload --host $(HOST) --port $(PORT)

test:
	cd backend && $(UV) run --locked pytest

smoke:
	cd backend && $(UV) run --locked pytest tests/test_smoke.py
	cd frontend && npm test -- src/test/smoke.test.tsx
