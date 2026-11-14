import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from om.books.store import BookStore  # noqa: E402
from om.db import Database  # noqa: E402
from om.engines.manager import APPRENTICE_PATH, EngineManager  # noqa: E402
from om.events import EventBus  # noqa: E402
from om.jobs import JobManager  # noqa: E402

FAST = {"min_time": 0.0, "max_time": 0.3, "min_depth": 1, "max_depth": 2}
GAME = {"min_time": 0.0, "max_time": 0.1, "min_depth": 1, "max_depth": 1}


@pytest.fixture
def db(tmp_path):
    d = Database(tmp_path / "test.sqlite3")
    yield d
    d.close()


@pytest.fixture
def bus():
    return EventBus()


@pytest.fixture
async def engines(db):
    em = EngineManager(db)
    row = await em.ensure_bundled()
    em.bundled_id = row["id"]
    yield em
    await em.shutdown()


@pytest.fixture
async def jobs(db, bus):
    jm = JobManager(db, bus, 2)
    jm.start()
    yield jm
    await jm.shutdown()


@pytest.fixture
def books(db):
    return BookStore(db)


async def fixture_engine(em: EngineManager, *flags: str, name: str = "fixture"):
    """Register the bundled engine as a *native* executable with test switches."""
    return await em.register(sys.executable, name=name, args=["-u", APPRENTICE_PATH, *flags])
