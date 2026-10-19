"""Compare complete legacy records across migration and database reopening."""
from sqlalchemy import MetaData, inspect

from app.database import Base, database_engine
from app.migrate import upgrade_database

LEGACY_TABLES = ('users', 'tokens', 'interviews', 'answer_evaluations')


def snapshot(engine):
    metadata = MetaData()
    metadata.reflect(engine)
    with engine.connect() as connection:
        return {name: [dict(row) for row in connection.execute(metadata.tables[name].select()).mappings()]
                for name in LEGACY_TABLES}


def test_migration_adoption_preserves_every_saved_field(tmp_path):
    url = f'sqlite:///{tmp_path / "legacy.db"}'
    engine = database_engine(url)
    Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in LEGACY_TABLES])
    with engine.begin() as connection:
        connection.execute(Base.metadata.tables['users'].insert(), {
            'id': 'owner', 'email': 'owner@example.com', 'password_hash': 'salted-password-hash',
            'profile': {'name': 'Owner', 'targetRole': 'Python Developer', 'preferredLanguage': 'Kazakh'},
        })
        connection.execute(Base.metadata.tables['tokens'].insert(), {
            'digest': 'login-digest', 'user_id': 'owner', 'expires_at': 9876543210,
        })
        connection.execute(Base.metadata.tables['interviews'].insert(), {
            'id': 'session', 'owner_id': 'owner', 'started_at': 1000.5, 'status': 'incomplete',
            'version': 7, 'payload': {
                'setup': {'questionCount': 15, 'jobDescription': 'Build APIs'},
                'messages': [{'id': 'answer', 'from': 'you', 'text': 'def solve():\n    return 42\n'}],
                'answeredCount': 1,
            },
        })
        connection.execute(Base.metadata.tables['answer_evaluations'].insert(), {
            'answer_id': 'answer', 'interview_id': 'session', 'question_id': 'question',
            'result': {'accuracy': 8, 'stronger_answer': 'Explain the complexity.'},
        })
    before = snapshot(engine)
    upgrade_database(engine)
    upgrade_database(engine)
    assert snapshot(engine) == before
    assert 'alembic_version' in inspect(engine).get_table_names()
    engine.dispose()
    reopened = database_engine(url)
    upgrade_database(reopened)
    assert snapshot(reopened) == before
    reopened.dispose()
