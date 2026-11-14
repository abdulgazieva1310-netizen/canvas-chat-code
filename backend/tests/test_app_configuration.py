from app.main import create_app


def test_demo_account_seed_can_be_disabled_by_environment(tmp_path, monkeypatch):
    monkeypatch.setenv('SEED_DEMO_ACCOUNT', 'false')
    app = create_app(database_url=f'sqlite:///{tmp_path / "no-demo.db"}')

    with app.state.store.transaction() as repository:
        assert repository.user_by_email('demo@example.com') is None

    app.state.store.engine.dispose()
