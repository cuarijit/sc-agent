from __future__ import annotations

import os
import sqlite3
import tempfile
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = BASE_DIR / "data" / "asc.db"
FALLBACK_DB_PATH = BASE_DIR / "data" / "asc.runtime.db"
TEMP_DB_PATH = Path(tempfile.gettempdir()) / "asc.runtime.db"


def _sqlite_url_from_path(path: Path) -> str:
    return f"sqlite:///{path.resolve().as_posix()}"


def _path_from_sqlite_url(url: str) -> Path | None:
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        return None
    raw = url[len(prefix) :]
    # Handle sqlite:////C:/... representation.
    if len(raw) >= 3 and raw[0] == "/" and raw[2] == ":":
        raw = raw[1:]
    if not raw:
        return None
    return Path(raw)


def _sqlite_file_writable(path: Path) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        # Reject corrupt/unhealthy DB files before selecting this path.
        cur.execute("PRAGMA quick_check")
        quick_check = cur.fetchone()
        if quick_check and str(quick_check[0]).lower() != "ok":
            conn.close()
            return False
        cur.execute("create table if not exists __db_write_probe(id integer)")
        conn.commit()
        cur.execute("drop table __db_write_probe")
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False


def _resolve_database_url() -> str:
    override_path = os.getenv("ASC_DATABASE_PATH")
    if override_path:
        path = Path(override_path).expanduser()
        if _sqlite_file_writable(path):
            return _sqlite_url_from_path(path)

    override = os.getenv("ASC_DATABASE_URL")
    if override:
        override_path = _path_from_sqlite_url(override)
        if override_path:
            if _sqlite_file_writable(override_path):
                return _sqlite_url_from_path(override_path)
        else:
            return override

    for candidate in (DEFAULT_DB_PATH, FALLBACK_DB_PATH, TEMP_DB_PATH):
        if _sqlite_file_writable(candidate):
            return _sqlite_url_from_path(candidate)

    return _sqlite_url_from_path(FALLBACK_DB_PATH)


DATABASE_URL = _resolve_database_url()
DATABASE_PATH = _path_from_sqlite_url(DATABASE_URL)

connect_args = {"check_same_thread": False, "timeout": 30} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)

# Enable WAL mode so concurrent readers don't block each other (the AuthMiddleware
# does a SELECT-only validate_session on every request — without WAL, SQLite
# serializes them and parallel page loads stall for many seconds).
if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy import event as _sa_event

    @_sa_event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, _conn_record):
        cur = dbapi_conn.cursor()
        try:
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.execute("PRAGMA temp_store=MEMORY")
        finally:
            cur.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def apply_additive_column_migrations() -> None:
    """Additive-only SQLite schema migrations.

    Adds nullable columns to existing tables when upgrading a DB created by
    an older version of the schema. New tables are created via
    Base.metadata.create_all — only pre-existing tables need column adds.
    """
    if not DATABASE_URL.startswith("sqlite"):
        return None
    path = _path_from_sqlite_url(DATABASE_URL)
    if path is None or not path.exists():
        return None

    additions: dict[str, list[tuple[str, str]]] = {
        "products": [
            ("shelf_life_days", "INTEGER"),
            ("cold_chain_flag", "INTEGER DEFAULT 0"),
            ("category_perishable", "INTEGER DEFAULT 0"),
        ],
    }

    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        for table, cols in additions.items():
            cur.execute(f"PRAGMA table_info({table})")
            existing = {row[1] for row in cur.fetchall()}
            if not existing:
                continue
            for col_name, col_ddl in cols:
                if col_name in existing:
                    continue
                cur.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_ddl}")
        conn.commit()
        conn.close()
    except Exception:
        return None
    return None
