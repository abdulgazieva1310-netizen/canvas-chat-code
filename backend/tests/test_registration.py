from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import hasher
from app.database import UserRecord
from app.main import create_app


def test_concurrent_normalized_duplicates_and_salted_hashes(tmp_path, caplog):
    app = create_app(database_url=f'sqlite:///{tmp_path / "registration.db"}')
    password = 'private-registration-password'
    def register(email):
        with TestClient(app) as client:
            return client.post('/api/auth/register', json={'name': 'New user', 'email': email, 'password': password})
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(register, ['NEW@example.com', 'new@example.com']))
    assert sorted(r.status_code for r in responses) == [201, 409]
    with TestClient(app) as client:
        other = client.post('/api/auth/register', json={'name': 'Other', 'email': 'other@example.com', 'password': password})
        assert other.status_code == 201
        assert client.get('/api/auth/me').json() == other.json()
    with app.state.store.sessions() as session:
        records = session.scalars(select(UserRecord).where(UserRecord.email.in_(['new@example.com', 'other@example.com']))).all()
        assert len(records) == 2
        assert records[0].password_hash != records[1].password_hash
        for record in records:
            assert hasher.verify(password, record.password_hash)
            assert all(record.password_hash not in response.text for response in [*responses, other])
    assert password not in caplog.text
    assert all(password not in response.text and 'password' not in response.json() for response in [*responses, other])
