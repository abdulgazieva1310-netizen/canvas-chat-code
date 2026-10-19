"""Apply the versioned schema using the application's database configuration."""
from pathlib import Path

from alembic import command
from alembic.config import Config
from dotenv import load_dotenv

from .database import database_engine


def upgrade_database(engine):
    config = Config()
    config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'migrations'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    engine = database_engine()
    try:
        upgrade_database(engine)
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
