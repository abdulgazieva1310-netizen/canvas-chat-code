from uuid import uuid4

from sqlalchemy.exc import IntegrityError

from fastapi import APIRouter, HTTPException, Request, Response

from ..auth import DUMMY_HASH, establish_session, hasher
from ..models import LoginData, RegisterData, User

router = APIRouter(prefix='/auth', tags=['auth'])


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
