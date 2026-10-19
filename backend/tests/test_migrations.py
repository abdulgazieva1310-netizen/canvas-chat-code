from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from app.database import Base, database_engine
from app.migrate import upgrade_database


def test_empty_database_migrates_and_matches_models(tmp_path):
    engine = database_engine(f'sqlite:///{tmp_path / "fresh.db"}')
    upgrade_database(engine)
    with engine.connect() as connection:
        assert connection.scalar(text('select version_num from alembic_version')) == '0002'
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    upgrade_database(engine)
    engine.dispose()


def test_existing_records_survive_adoption_and_reopening(tmp_path):
    url = f'sqlite:///{tmp_path / "existing.db"}'
    engine = database_engine(url)
    Base.metadata.create_all(engine, tables=[table for table in Base.metadata.sorted_tables
                                             if table.name != 'password_resets'])
    with engine.begin() as connection:
        connection.execute(Base.metadata.tables['users'].insert(), {
            'id': 'owner', 'email': 'owner@example.com', 'password_hash': 'stored-hash',
            'profile': {'name': 'Owner'},
        })
        connection.execute(Base.metadata.tables['tokens'].insert(), {
            'digest': 'digest', 'user_id': 'owner', 'expires_at': 12345,
        })
        connection.execute(Base.metadata.tables['interviews'].insert(), {
            'id': 'interview', 'owner_id': 'owner', 'started_at': 123,
            'status': 'incomplete', 'version': 1,
            'payload': {'messages': [{'text': 'Saved answer'}]},
        })
        connection.execute(Base.metadata.tables['answer_evaluations'].insert(), {
            'answer_id': 'answer', 'interview_id': 'interview',
            'question_id': 'question', 'result': {'accuracy': 8},
        })
    upgrade_database(engine)
    engine.dispose()
    reopened = database_engine(url)
    upgrade_database(reopened)
    with reopened.connect() as connection:
        for table in Base.metadata.sorted_tables:
            assert len(connection.execute(table.select()).all()) == (0 if table.name == 'password_resets' else 1)
        assert connection.execute(Base.metadata.tables['interviews'].select()).one().payload == {
            'messages': [{'text': 'Saved answer'}]}
    reopened.dispose()


def test_adopts_database_before_evaluations_existed(tmp_path):
    engine = database_engine(f'sqlite:///{tmp_path / "older.db"}')
    Base.metadata.create_all(engine, tables=[Base.metadata.tables[name]
                                           for name in ('users', 'tokens', 'interviews')])
    upgrade_database(engine)
    assert 'answer_evaluations' in inspect(engine).get_table_names()
    engine.dispose()
