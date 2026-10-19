from uuid import uuid4

from sqlalchemy.exc import IntegrityError

from fastapi import APIRouter, HTTPException, Request, Response

from ..auth import CurrentUser, DUMMY_HASH, establish_session, hasher, token_key
from ..models import LoginData, ProfileUpdate, RegisterData, User

router = APIRouter(prefix='/auth', tags=['auth'])


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
