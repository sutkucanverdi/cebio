import sys
from pathlib import Path
from typing import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# backend/ dizinini sys.path'e ekle (hem kök dizinden hem backend dizininden pytest çalıştırılabilsin)
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import settings  # noqa: E402
from app.core.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402  (app.main zaten app.models'i dolaylı olarak yükler)

# Testler gerçek veritabanına migration uygulamasın.
settings.AUTO_MIGRATE = False
# Şifre hash'leme testlerde hızlı olsun (production varsayılanı 12)
settings.BCRYPT_ROUNDS = 4

# Bellek içi (in-memory) izole SQLite test veritabanı
TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(
    bind=TEST_ENGINE,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


@pytest.fixture(autouse=True)
def setup_test_db() -> Generator[None, None, None]:
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    Base.metadata.drop_all(bind=TEST_ENGINE)


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def anon_client(db_session: Session) -> Generator[TestClient, None, None]:
    """Giriş yapmamış istemci."""

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def register(anon_client: TestClient) -> Callable[..., str]:
    """Yeni kullanıcı kaydeder ve access token döner."""

    def _register(email: str = "utku@example.com", password: str = "gizli-sifre-123") -> str:
        res = anon_client.post("/api/v1/auth/register", json={"email": email, "password": password, "accept_terms": True})
        assert res.status_code == 201, res.text
        return res.json()["access_token"]

    return _register


@pytest.fixture
def client(anon_client: TestClient, register: Callable[..., str]) -> TestClient:
    """Varsayılan kullanıcıyla giriş yapmış istemci."""
    token = register()
    anon_client.headers.update({"Authorization": f"Bearer {token}"})
    return anon_client
