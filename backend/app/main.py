import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .routers import auth, interviews
from .store import Store


def create_app(*, seed=True, secure_cookies=None):
    app = FastAPI(title='Interview Mirror API', version='1.0.0')
    app.state.store = Store(seed=seed)
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
    return app


app = create_app()
