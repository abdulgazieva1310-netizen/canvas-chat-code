from pathlib import Path

from dotenv import load_dotenv

# Resolve from this file so startup also works from the repository root.
# Existing process environment variables take precedence over .env values.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import os
from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException
import httpx

from .routers import auth, dashboard, evaluation_feedback, interviews, job_targets, languages, setup_presets, study, study_plans
from .store import Store
from .services.email_service import email_delivery, password_reset_url


def create_app(*, seed=True, secure_cookies=None, database_url=None, mailer=None):
    store = Store(seed=seed, database_url=database_url)
    frontend_server_entry = os.getenv('FRONTEND_SERVER_ENTRY')
    frontend_server_host = os.getenv('FRONTEND_SERVER_HOST', '127.0.0.1')
    frontend_server_port = int(os.getenv('FRONTEND_SERVER_PORT', '3000'))
    frontend_server_base_url = f'http://{frontend_server_host}:{frontend_server_port}'
    frontend_process = None
    frontend_client = None

    async def media_reaper():
        while True:
            await asyncio.sleep(60)
            try:
                with store.transaction() as repository:
                    interviews.purge_expired_media(repository)
                from .account_deletion import retry_media_cleanup
                retry_media_cleanup(store)
            except Exception:
                logging.getLogger(__name__).warning('Media cleanup deferred; will retry')


    @asynccontextmanager
    async def lifespan(app):
        nonlocal frontend_process, frontend_client
        reaper = asyncio.create_task(media_reaper())
        try:
            if frontend_server_entry:
                entry = Path(frontend_server_entry).resolve()
                if not entry.is_file():
                    raise RuntimeError(f'TanStack server entry not found: {entry}')

                frontend_env = os.environ.copy()
                frontend_env['NITRO_HOST'] = frontend_server_host
                frontend_env['NITRO_PORT'] = str(frontend_server_port)
                frontend_process = await asyncio.create_subprocess_exec(
                    'node', str(entry), cwd=str(entry.parent.parent), env=frontend_env,
                )
                for _ in range(100):
                    if frontend_process.returncode is not None:
                        raise RuntimeError(
                            f'TanStack server exited during startup with code '
                            f'{frontend_process.returncode}'
                        )
                    try:
                        _reader, writer = await asyncio.wait_for(
                            asyncio.open_connection(frontend_server_host, frontend_server_port),
                            timeout=0.25,
                        )
                        writer.close()
                        await writer.wait_closed()
                        break
                    except (OSError, asyncio.TimeoutError):
                        await asyncio.sleep(0.1)
                else:
                    raise RuntimeError('TanStack server did not start listening in time')
                frontend_client = httpx.AsyncClient(timeout=60.0)

            yield
        finally:
            reaper.cancel()
            try:
                await reaper
            except asyncio.CancelledError:
                pass
            if frontend_client is not None:
                await frontend_client.aclose()
            if frontend_process is not None and frontend_process.returncode is None:
                frontend_process.terminate()
                try:
                    await asyncio.wait_for(frontend_process.wait(), timeout=5)
                except asyncio.TimeoutError:
                    frontend_process.kill()
                    await frontend_process.wait()
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
        allow_origins=os.getenv('CORS_ORIGINS', 'http://localhost:8080,http://127.0.0.1:8080,http://localhost:8100,http://localhost:3000,http://localhost:5173,http://13.61.182.94').split(','),
        allow_credentials=True, allow_methods=['*'],
        allow_headers=['*'], expose_headers=['Authorization'])

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return JSONResponse({'message': str(exc.detail)}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Do not echo input values (which may contain passwords).
        return JSONResponse({'message': 'Missing or invalid input.'}, status_code=400)

    app.include_router(languages.router, prefix='/api')
    app.include_router(auth.router, prefix='/api')
    app.include_router(interviews.router, prefix='/api')
    app.include_router(dashboard.router, prefix='/api')
    app.include_router(study.router, prefix='/api')
    app.include_router(study_plans.router, prefix='/api')
    app.include_router(evaluation_feedback.router, prefix='/api')
    app.include_router(job_targets.router, prefix='/api')
    app.include_router(setup_presets.router, prefix='/api')

    if frontend_server_entry:
        @app.api_route(
            '/{frontend_path:path}',
            methods=['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            include_in_schema=False,
        )
        async def frontend(frontend_path: str, request: Request):
            upstream_url = f'{frontend_server_base_url}/{frontend_path}'
            if request.url.query:
                upstream_url = f'{upstream_url}?{request.url.query}'
            headers = dict(request.headers)
            headers.pop('host', None)
            headers.pop('content-length', None)
            headers.pop('connection', None)
            headers.pop('accept-encoding', None)
            try:
                upstream = await frontend_client.request(
                    request.method,
                    upstream_url,
                    headers=headers,
                    content=await request.body(),
                )
            except httpx.HTTPError:
                return Response('Frontend server unavailable', status_code=502)

            response = Response(upstream.content, status_code=upstream.status_code)
            hop_by_hop_headers = {
                b'connection', b'content-encoding', b'content-length',
                b'keep-alive', b'proxy-authenticate', b'proxy-authorization',
                b'te', b'trailers', b'transfer-encoding', b'upgrade',
            }
            for name, value in upstream.headers.raw:
                if name.lower() not in hop_by_hop_headers:
                    response.headers.append(name.decode('latin-1'), value.decode('latin-1'))
            return response

    return app


app = create_app()
