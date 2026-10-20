from uuid import uuid4
from datetime import datetime, timedelta, timezone
import logging
import secrets
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from fastapi import APIRouter, HTTPException, Request, Response

from ..auth import CurrentUser, DUMMY_HASH, establish_session, hasher, token_key
from ..models import LoginData, ProfileUpdate, RegisterData, ResetPassword, ResetRequest, User
from ..database import PasswordResetRecord, TokenRecord, UserRecord

router = APIRouter(prefix='/auth', tags=['auth'])


@router.post('/password-reset/request', status_code=202)
def request_reset(data: ResetRequest, request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    token = secrets.token_urlsafe(32)
    with request.app.state.store.transaction() as store:
        user = store.user_by_email(str(data.email).lower())
        if user is not None:
            reset = PasswordResetRecord(digest=token_key(token), user_id=user.id,
                expires_at=(datetime.now(timezone.utc) + timedelta(minutes=30)).timestamp())
            store.session.add(reset)
            parts = urlsplit(request.app.state.reset_url)
            query = [(key, value) for key, value in parse_qsl(parts.query) if key != 'token']
            link = urlunsplit(parts._replace(query=urlencode(query + [('token', token)])))
            try:
                request.app.state.mailer.send_reset(user.email, link)
            except Exception:
                # Do not expose account existence, provider errors, or reset credentials.
                store.session.expunge(reset)
                logging.getLogger(__name__).warning('Password recovery email delivery failed')
            else:
                store.session.execute(delete(PasswordResetRecord).where(
                    PasswordResetRecord.user_id == user.id,
                    PasswordResetRecord.digest != reset.digest))
    return {'message': 'If this account exists, a password reset link will be sent.'}


@router.post('/password-reset/confirm', status_code=204)
def confirm_reset(data: ResetPassword, request: Request):
    password_hash = hasher.hash(data.password)
    with request.app.state.store.transaction() as store:
        record = store.session.scalar(select(PasswordResetRecord).where(
            PasswordResetRecord.digest == token_key(data.token)))
        if record is None:
            raise HTTPException(400, 'Invalid or expired password reset link.')
        user_id = record.user_id
        # Conditional deletion is the single-use claim, including concurrent requests.
        claimed = store.session.execute(delete(PasswordResetRecord).where(
            PasswordResetRecord.digest == token_key(data.token),
            PasswordResetRecord.expires_at > datetime.now(timezone.utc).timestamp()))
        if claimed.rowcount != 1:
            raise HTTPException(400, 'Invalid or expired password reset link.')
        store.session.execute(update(UserRecord).where(UserRecord.id == user_id).values(password_hash=password_hash))
        store.session.execute(delete(TokenRecord).where(TokenRecord.user_id == user_id))
        store.session.execute(delete(PasswordResetRecord).where(PasswordResetRecord.user_id == user_id))
    response = Response(status_code=204, headers={'Cache-Control': 'no-store'})
    response.delete_cookie('session', path='/api', httponly=True,
                           secure=request.app.state.secure_cookies, samesite='lax')
    return response


@router.get('/me', response_model=User)
def me(user: CurrentUser, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return user


@router.patch('/me', response_model=User)
def update_me(data: ProfileUpdate, request: Request, response: Response, user: CurrentUser):
    response.headers['Cache-Control'] = 'no-store'
    with request.app.state.store.transaction() as store:
        return store.update_profile(user.id, data)


@router.post('/logout', status_code=204)
def logout(request: Request):
    # Idempotent even for expired sessions. Revoke both credentials if supplied,
    # because a browser can hold a bearer token and a different session cookie.
    tokens = [request.cookies.get('session')]
    authorization = request.headers.get('authorization', '').split()
    if len(authorization) == 2 and authorization[0].lower() == 'bearer':
        tokens.append(authorization[1])
    with request.app.state.store.transaction() as store:
        store.revoke_tokens([token_key(token) for token in tokens if token])
    response = Response(status_code=204, headers={'Cache-Control': 'no-store'})
    response.delete_cookie('session', path='/api', httponly=True,
                           secure=request.app.state.secure_cookies, samesite='lax')
    return response


@router.post('/register', response_model=User, status_code=201)
def register(data: RegisterData, request: Request, response: Response):
    store = request.app.state.store
    email = str(data.email).lower()
    password_hash = hasher.hash(data.password)
    with store.transaction() as store:
        if store.user_by_email(email) is not None:
            raise HTTPException(409, 'Email already registered.')
        user = User(id=str(uuid4()), name=data.name.strip(), email=email,
                    targetRole=data.targetRole, level=data.level)
        try:
            store.add_user(user, password_hash)
        except IntegrityError as exc:
            raise HTTPException(409, 'Email already registered.') from exc
        establish_session(request, response, user.id, store)
        return user


@router.post('/login', response_model=User)
def login(data: LoginData, request: Request, response: Response):
    store = request.app.state.store
    with store.transaction() as store:
        record = store.user_by_email(str(data.email).lower())
        valid = hasher.verify(data.password, record.password_hash if record else DUMMY_HASH)
        if not valid or record is None:
            raise HTTPException(401, 'Invalid email or password.', headers={'WWW-Authenticate': 'Bearer'})
        establish_session(request, response, record.id, store)
        return User.model_validate(record.profile)


@router.get('/me/export')
def export_account(request: Request, user: CurrentUser):
    from ..account_export import archive
    with request.app.state.store.transaction() as store:
        payload = archive(store, user)
    return Response(payload, media_type='application/json', headers={
        'Content-Disposition': 'attachment; filename="interview-mirror-account.json"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
