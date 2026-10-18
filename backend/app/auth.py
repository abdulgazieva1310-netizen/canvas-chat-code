"""Argon2 password hashes and expiring opaque bearer/session tokens."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, Security
from fastapi.security import APIKeyCookie, HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

hasher = PasswordHash.recommended()
DUMMY_HASH = hasher.hash('not-a-real-password')
TOKEN_TTL = timedelta(hours=24)
bearer = HTTPBearer(auto_error=False)
cookie = APIKeyCookie(name='session', auto_error=False)


def token_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def establish_session(request: Request, response: Response, user_id: str, store):
    token = secrets.token_urlsafe(32)
    store.add_token(token_key(token), user_id, datetime.now(timezone.utc) + TOKEN_TTL)
    response.headers['Authorization'] = f'Bearer {token}'
    response.headers['Cache-Control'] = 'no-store'
    response.set_cookie('session', token, max_age=int(TOKEN_TTL.total_seconds()),
                        httponly=True, secure=request.app.state.secure_cookies,
                        samesite='lax', path='/api')


def current_user(request: Request,
                 credentials: Annotated[HTTPAuthorizationCredentials | None, Security(bearer)],
                 session: Annotated[str | None, Security(cookie)]):
    # An explicitly supplied invalid Authorization header must not fall back to a cookie.
    token = credentials.credentials if credentials else session
    if 'authorization' in request.headers and credentials is None:
        token = None
    with request.app.state.store.transaction() as store:
        user = store.token_user(token_key(token)) if token else None
    if user is None:
        raise HTTPException(401, 'Authentication required.', headers={'WWW-Authenticate': 'Bearer'})
    return user


CurrentUser = Annotated[object, Depends(current_user)]
