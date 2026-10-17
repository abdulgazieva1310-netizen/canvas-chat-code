from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response

from ..auth import DUMMY_HASH, establish_session, hasher
from ..models import LoginData, RegisterData, User

router = APIRouter(prefix='/auth', tags=['auth'])


@router.post('/register', response_model=User, status_code=201)
def register(data: RegisterData, request: Request, response: Response):
    store = request.app.state.store
    email = str(data.email).lower()
    password_hash = hasher.hash(data.password)
    with store.lock:
        if email in store.emails:
            raise HTTPException(409, 'Email already registered.')
        user = User(id=str(uuid4()), name=data.name.strip(), email=email,
                    targetRole=data.targetRole, level=data.level)
        store.users[user.id] = user
        store.emails[email] = user.id
        store.passwords[user.id] = password_hash
        establish_session(request, response, user.id)
        return user


@router.post('/login', response_model=User)
def login(data: LoginData, request: Request, response: Response):
    store = request.app.state.store
    with store.lock:
        user_id = store.emails.get(str(data.email).lower())
        valid = hasher.verify(data.password, store.passwords.get(user_id, DUMMY_HASH))
        if not valid or user_id is None:
            raise HTTPException(401, 'Invalid email or password.', headers={'WWW-Authenticate': 'Bearer'})
        establish_session(request, response, user_id)
        return store.users[user_id]
