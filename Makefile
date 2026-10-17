.DEFAULT_GOAL := help

UV ?= uv
HOST ?= 127.0.0.1
PORT ?= 8000

.PHONY: help install run test

help:
	@echo "make install  Install backend dependencies with uv"
	@echo "make run      Run the backend with auto-reload (HOST=$(HOST) PORT=$(PORT))"
	@echo "make test     Run the backend tests"

install:
	cd backend && $(UV) sync --locked

run:
	cd backend && $(UV) run --locked uvicorn app.main:app --reload --host $(HOST) --port $(PORT)

test:
	cd backend && $(UV) run --locked pytest
