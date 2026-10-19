from pathlib import Path

from dotenv import load_dotenv

# Resolve from this file so startup also works from the repository root.
# Existing process environment variables take precedence over .env values.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import os
from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .routers import auth, dashboard, interviews
from .store import Store
from .services.email_service import email_delivery, password_reset_url


def create_app(*, seed=True, secure_cookies=None, database_url=None, mailer=None):
    store = Store(seed=seed, database_url=database_url)

    async def media_reaper():
        while True:
            await asyncio.sleep(3600)
            with store.transaction() as repository:
                interviews.purge_expired_media(repository)

    @asynccontextmanager
    async def lifespan(app):
        reaper = asyncio.create_task(media_reaper())
        try:
            yield
        finally:
            reaper.cancel()
            try:
                await reaper
            except asyncio.CancelledError:
                pass
            store.engine.dispose()

    app = FastAPI(lifespan=lifespan, title='Interview Mirror API', version='1.0.0')
    @app.get('/api/health', tags=['health'])
    def health():
        return JSONResponse({'status': 'ok'}, headers={'Cache-Control': 'no-store'})

    app.state.store = store
    app.state.mailer = mailer if mailer is not None else email_delivery()
    app.state.reset_url = password_reset_url()
    app.state.secure_cookies = (os.getenv('SECURE_COOKIES', 'false').lower() == 'true'
                                if secure_cookies is None else secure_cookies)
    app.add_middleware(CORSMiddleware,
        allow_origins=os.getenv('CORS_ORIGINS', 'http://localhost:8080,http://127.0.0.1:8080,http://localhost:3000,http://localhost:5173').split(','),
        allow_credentials=True, allow_methods=['*'],
        allow_headers=['*'], expose_headers=['Authorization'])

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return JSONResponse({'message': str(exc.detail)}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Do not echo input values (which may contain passwords).
        return JSONResponse({'message': 'Missing or invalid input.'}, status_code=400)

    app.include_router(auth.router, prefix='/api')
    app.include_router(interviews.router, prefix='/api')
    app.include_router(dashboard.router, prefix='/api')
    return app


app = create_app()
