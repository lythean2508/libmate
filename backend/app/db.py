"""Quản lý cơ sở dữ liệu SQLite, khởi tạo bảng, seed dữ liệu mẫu, tiện ích tiếng Việt/múi giờ và Sao lưu/Phục hồi (T04, T06, T11, T16, T17, T22, T42)."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import threading
import unicodedata
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Generator, Iterable
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = BACKEND_ROOT / "data" / "libmate.db"
DEFAULT_BACKUP_DIR = BACKEND_ROOT / "data" / "backups"
BOOKS_SEED_PATH = REPO_ROOT / "data" / "books_catalog_100.json"
COPIES_SEED_PATH = REPO_ROOT / "data" / "copies_seed.json"

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
MAX_ACTIVE_LOANS = int(os.environ.get("LIBMATE_BORROW_LIMIT", "3"))
DEFAULT_LOAN_DAYS = int(os.environ.get("LIBMATE_LOAN_DAYS", "14"))
MODEL_REVISION = os.environ.get("LIBMATE_AI_REVISION", "e5-small-local-v1")
DB_PATH = DEFAULT_DB_PATH

# Khóa luồng toàn cục phục vụ giao dịch nguyên tử chống tranh chấp bản sao cuối (TC11 / T17 / T18)
DB_LOCK = threading.RLock()
ISSUE_LOCK = DB_LOCK

_CURRENT_DB_PATH: Path | None = None


def get_db_path(custom_path: str | Path | None = None) -> Path:
    if custom_path is not None:
        return Path(custom_path)
    if _CURRENT_DB_PATH is not None:
        return _CURRENT_DB_PATH
    env_path = os.environ.get("LIBMATE_DB_PATH")
    if env_path:
        p = Path(env_path)
        return p if p.is_absolute() else (REPO_ROOT / p)
    return DEFAULT_DB_PATH


def set_db_path(custom_path: str | Path | None) -> Path:
    global _CURRENT_DB_PATH
    _CURRENT_DB_PATH = Path(custom_path) if custom_path is not None else None
    return get_db_path()


# ==================== TIỆN ÍCH CHUẨN HÓA TIẾNG VIỆT & THỜI GIAN MÚI GIỜ VN (TC05, TC16, T31) ====================


def strip_vietnamese_accents(text: str | None) -> str:
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFD", str(text))
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return stripped.replace("đ", "d").replace("Đ", "D")


def normalize_search_text(text: str | None) -> str:
    stripped = strip_vietnamese_accents(text).lower()
    cleaned = re.sub(r"[^a-z0-9\s]", " ", stripped)
    return re.sub(r"\s+", " ", cleaned).strip()


def count_words(text: str | None) -> int:
    if not text:
        return 0
    trimmed = str(text).strip()
    if not trimmed:
        return 0
    return len(re.split(r"\s+", trimmed))


def parse_iso_datetime(value: str | datetime | date | None) -> datetime:
    if value is None:
        return datetime.now(VN_TZ)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=VN_TZ)
        return value.astimezone(VN_TZ)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, 12, 0, 0, tzinfo=VN_TZ)

    raw = str(value).strip()
    if not raw:
        return datetime.now(VN_TZ)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        y, m, d = (int(x) for x in raw.split("-"))
        return datetime(y, m, d, 12, 0, 0, tzinfo=VN_TZ)
    if raw.endswith("Z") or raw.endswith("z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=VN_TZ)
    return dt.astimezone(VN_TZ)


def to_server_date_key(iso_or_date: str | datetime | date | None) -> str:
    """Chuyển mốc thời gian sang chuỗi YYYY-MM-DD theo múi giờ Asia/Ho_Chi_Minh (TC16)."""
    dt_vn = parse_iso_datetime(iso_or_date)
    return dt_vn.strftime("%Y-%m-%d")


def compute_days_remaining(due_at_iso: str | datetime | date, now: str | datetime | date | None = None) -> int:
    due_key = to_server_date_key(due_at_iso)
    now_key = to_server_date_key(now)
    due_date = date.fromisoformat(due_key)
    now_date = date.fromisoformat(now_key)
    return (due_date - now_date).days


def is_loan_overdue(
    due_at_iso: str | datetime | date,
    returned_at_iso: str | datetime | date | None = None,
    now: str | datetime | date | None = None,
) -> bool:
    """
    Kiểm tra phiếu mượn quá hạn theo ngày máy chủ Asia/Ho_Chi_Minh (TC16):
    - Đã trả (returned_at != None) -> False
    - Đúng ngày hạn trả (days_remaining == 0) -> False (chưa quá hạn)
    - Qua ngày hôm sau (days_remaining < 0) -> True (quá hạn)
    """
    if returned_at_iso is not None and str(returned_at_iso).strip() != "":
        return False
    return compute_days_remaining(due_at_iso, now) < 0


def add_days_iso(start_iso: str | datetime, days: int) -> str:
    dt = parse_iso_datetime(start_iso).astimezone(timezone.utc)
    target = dt + timedelta(days=days)
    return target.strftime("%Y-%m-%dT%H:%M:%SZ")


def format_date_vi(iso_str: str | datetime | None) -> str:
    if not iso_str:
        return "—"
    dt_vn = parse_iso_datetime(iso_str)
    return dt_vn.strftime("%d/%m/%Y")


def simple_content_hash(text: str) -> str:
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return f"fnv1a-{h:08x}"


def build_passage_text(book: dict[str, Any]) -> str:
    title = str(book.get("title", "") or "").strip()
    author = str(book.get("author", "") or "").strip()
    category = str(book.get("category", "") or "").strip()
    description = str(book.get("description", "") or "").strip()
    return f"passage: {title}. Chủ đề: {category}. Tác giả: {author}. Mô tả: {description}"


def compute_book_content_hash(book: dict[str, Any], model_revision: str = MODEL_REVISION) -> str:
    title = str(book.get("title", "") or "").strip()
    author = str(book.get("author", "") or "").strip()
    category = str(book.get("category", "") or "").strip()
    description = str(book.get("description", "") or "").strip()
    rev = str(model_revision or MODEL_REVISION).strip()
    raw = f"{title}|{author}|{category}|{description}|{rev}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


compute_content_hash = compute_book_content_hash


def build_csv_utf8_bom(rows: list[dict[str, Any]], columns: list[tuple[str, str]]) -> str:
    """Xuất CSV kèm UTF-8 BOM (\\ufeff) để hiển thị đúng tiếng Việt trên Excel (T31 / TC17)."""
    def escape_cell(val: Any) -> str:
        s = "" if val is None else str(val)
        if any(ch in s for ch in ('"', ",", "\n", "\r")):
            return '"' + s.replace('"', '""') + '"'
        return s

    header = ",".join(escape_cell(label) for _, label in columns)
    lines = [header]
    for row in rows:
        lines.append(",".join(escape_cell(row.get(key, "")) for key, _ in columns))
    return "\ufeff" + "\n".join(lines) + "\n"


def hash_password_pbkdf2(password: str, salt: str | None = None, iterations: int = 100_000) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${dk.hex()}"


def verify_password_pbkdf2(password: str, stored_hash: str) -> bool:
    if not stored_hash or not isinstance(stored_hash, str):
        return False
    if stored_hash.startswith("pbkdf2_sha256$"):
        parts = stored_hash.split("$")
        if len(parts) != 4:
            return False
        _, iter_str, salt, _ = parts
        try:
            iterations = int(iter_str)
        except ValueError:
            return False
        expected = hash_password_pbkdf2(password, salt=salt, iterations=iterations)
        return hmac.compare_digest(expected, stored_hash)
    if stored_hash.startswith("pbkdf2_mock$"):
        mock_expected = f"pbkdf2_mock${simple_content_hash(f'libmate-salt:{password}')}"
        return hmac.compare_digest(mock_expected, stored_hash)
    return False


# ==================== KẾT NỐI SQLITE & KHỞI TẠO LƯỢC ĐỒ (T06, T11) ====================


def get_connection(db_path: str | Path | None = None) -> sqlite3.Connection:
    """Tạo kết nối SQLite và luôn bật PRAGMA foreign_keys = ON trên mọi kết nối."""
    target_path = get_db_path(db_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target_path), timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 30000;")
    return conn


get_db_connection = get_connection
connect_db = get_connection


@contextmanager
def db_session(db_path: str | Path | None = None) -> Generator[sqlite3.Connection, None, None]:
    conn = get_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    reader_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('reader', 'librarian')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'locked')),
    grade_or_dept TEXT,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    category TEXT NOT NULL,
    shelf TEXT NOT NULL,
    description TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    missing_description INTEGER NOT NULL DEFAULT 0,
    metadata_source TEXT NOT NULL,
    license_verified INTEGER NOT NULL DEFAULT 1,
    visible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS copies (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    copy_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    status TEXT NOT NULL CHECK(status IN ('available', 'borrowed', 'maintenance')),
    condition_note TEXT DEFAULT 'Tốt'
);

CREATE TABLE IF NOT EXISTS borrow_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'fulfilled', 'rejected', 'cancelled')),
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    rejection_reason TEXT,
    handled_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    copy_id TEXT NOT NULL REFERENCES copies(id) ON DELETE RESTRICT,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    request_id TEXT REFERENCES borrow_requests(id),
    issued_by TEXT NOT NULL REFERENCES users(id),
    issued_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    returned_at TEXT,
    return_note TEXT
);

CREATE TABLE IF NOT EXISTS book_embeddings (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    model_revision TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ready', 'pending')),
    vector_json TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, book_id)
);

CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK(source_type IN ('semantic_search', 'similar_book')),
    context_key TEXT NOT NULL,
    useful INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    detail TEXT NOT NULL,
    timestamp TEXT NOT NULL
);
"""


def _build_initial_users() -> list[dict[str, Any]]:
    lib_hash = hash_password_pbkdf2("libmate123", salt="libmate_seed_lib")
    rdr_hash = hash_password_pbkdf2("reader123", salt="libmate_seed_rdr")
    pilot_hash = hash_password_pbkdf2("pilot123", salt="libmate_seed_pilot")

    users: list[dict[str, Any]] = [
        {
            "id": "U-LIB-01",
            "reader_code": "LIB001",
            "name": "Lý Thế An (Thủ thư)",
            "role": "librarian",
            "status": "active",
            "grade_or_dept": "Phòng Thư viện",
            "password_hash": lib_hash,
        },
        {
            "id": "U-RDR-01",
            "reader_code": "HS10A1",
            "name": "Nguyễn Minh Anh",
            "role": "reader",
            "status": "active",
            "grade_or_dept": "Lớp 10A1",
            "password_hash": rdr_hash,
        },
        {
            "id": "U-RDR-02",
            "reader_code": "HS11B2",
            "name": "Trần Quốc Bảo",
            "role": "reader",
            "status": "active",
            "grade_or_dept": "Lớp 11B2",
            "password_hash": rdr_hash,
        },
        {
            "id": "U-RDR-03",
            "reader_code": "HS12C3",
            "name": "Lê Hoàng Nam",
            "role": "reader",
            "status": "active",
            "grade_or_dept": "Lớp 12C3",
            "password_hash": rdr_hash,
        },
        {
            "id": "U-LCK-01",
            "reader_code": "HSKHOA",
            "name": "Phạm Thảo Vy (Tài khoản khóa)",
            "role": "reader",
            "status": "locked",
            "grade_or_dept": "Lớp 10A2",
            "password_hash": rdr_hash,
        },
    ]

    for i in range(1, 11):
        code = f"PILOT{i:02d}"
        users.append(
            {
                "id": f"U-{code}",
                "reader_code": code,
                "name": f"Người dùng thử Pilot #{i:02d}",
                "role": "reader",
                "status": "active",
                "grade_or_dept": "Nhóm Pilot Tuần 7",
                "password_hash": pilot_hash,
            }
        )
    return users


def seed_database(conn: sqlite3.Connection, now: datetime | str | None = None) -> None:
    """Nạp dữ liệu mẫu 100 đầu sách, 201 bản sao, 15 tài khoản, 4 phiếu mượn, 5 yêu cầu mượn."""
    now_dt = parse_iso_datetime(now).astimezone(timezone.utc)
    now_iso = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    twenty_days_ago = add_days_iso(now_iso, -20)
    six_days_ago = add_days_iso(now_iso, -6)
    twelve_days_ago = add_days_iso(now_iso, -12)

    books_data = json.loads(BOOKS_SEED_PATH.read_text(encoding="utf-8"))
    copies_data = json.loads(COPIES_SEED_PATH.read_text(encoding="utf-8"))
    users_data = _build_initial_users()

    for u in users_data:
        conn.execute(
            """
            INSERT INTO users (id, reader_code, name, role, status, grade_or_dept, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                u["id"],
                u["reader_code"],
                u["name"],
                u["role"],
                u["status"],
                u["grade_or_dept"],
                u["password_hash"],
                now_iso,
            ),
        )

    for b in books_data:
        wc = b.get("word_count") or count_words(b.get("description", ""))
        missing_desc = 1 if (b.get("missing_description") or wc < 80) else 0
        visible = 1 if b.get("visible", True) else 0
        license_verified = 1 if b.get("license_verified", True) else 0
        created_at = b.get("created_at") or now_iso
        updated_at = b.get("updated_at") or now_iso

        conn.execute(
            """
            INSERT INTO books (
                id, code, title, author, category, shelf, description,
                word_count, missing_description, metadata_source,
                license_verified, visible, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                b["id"],
                b["code"],
                b["title"],
                b["author"],
                b["category"],
                b["shelf"],
                b["description"],
                wc,
                missing_desc,
                b.get("metadata_source", "Biên soạn nội bộ thư viện trường học"),
                license_verified,
                visible,
                created_at,
                updated_at,
            ),
        )

        content_hash = compute_book_content_hash(b)
        conn.execute(
            """
            INSERT INTO book_embeddings (book_id, content_hash, model_revision, status, vector_json, updated_at)
            VALUES (?, ?, ?, 'ready', NULL, ?)
            """,
            (b["id"], content_hash, MODEL_REVISION, now_iso),
        )

    for c in copies_data:
        conn.execute(
            """
            INSERT INTO copies (id, book_id, copy_code, status, condition_note)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                c["id"],
                c["book_id"],
                c["copy_code"],
                c["status"],
                c.get("condition_note") or "Tốt",
            ),
        )

    requests_seed = [
        {
            "id": "REQ-0001",
            "user_id": "U-RDR-01",
            "book_id": "B001",
            "status": "fulfilled",
            "created_at": twenty_days_ago,
            "resolved_at": twenty_days_ago,
            "rejection_reason": None,
            "handled_by": "U-LIB-01",
        },
        {
            "id": "REQ-0002",
            "user_id": "U-RDR-01",
            "book_id": "B002",
            "status": "fulfilled",
            "created_at": six_days_ago,
            "resolved_at": six_days_ago,
            "rejection_reason": None,
            "handled_by": "U-LIB-01",
        },
        {
            "id": "REQ-0003",
            "user_id": "U-RDR-02",
            "book_id": "B061",
            "status": "fulfilled",
            "created_at": twelve_days_ago,
            "resolved_at": twelve_days_ago,
            "rejection_reason": None,
            "handled_by": "U-LIB-01",
        },
        {
            "id": "REQ-0004",
            "user_id": "U-RDR-01",
            "book_id": "B071",
            "status": "pending",
            "created_at": add_days_iso(now_iso, -1),
            "resolved_at": None,
            "rejection_reason": None,
            "handled_by": None,
        },
        {
            "id": "REQ-0005",
            "user_id": "U-RDR-02",
            "book_id": "B031",
            "status": "pending",
            "created_at": now_iso,
            "resolved_at": None,
            "rejection_reason": None,
            "handled_by": None,
        },
    ]

    for r in requests_seed:
        conn.execute(
            """
            INSERT INTO borrow_requests (id, user_id, book_id, status, created_at, resolved_at, rejection_reason, handled_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                r["id"],
                r["user_id"],
                r["book_id"],
                r["status"],
                r["created_at"],
                r["resolved_at"],
                r["rejection_reason"],
                r["handled_by"],
            ),
        )

    loans_seed = [
        {
            "id": "LN-0001",
            "user_id": "U-RDR-01",
            "copy_id": "CP-B001-A",
            "book_id": "B001",
            "request_id": "REQ-0001",
            "issued_by": "U-LIB-01",
            "issued_at": twenty_days_ago,
            "due_at": add_days_iso(twenty_days_ago, DEFAULT_LOAN_DAYS),
            "returned_at": None,
            "return_note": None,
        },
        {
            "id": "LN-0002",
            "user_id": "U-RDR-01",
            "copy_id": "CP-B002-A",
            "book_id": "B002",
            "request_id": "REQ-0002",
            "issued_by": "U-LIB-01",
            "issued_at": six_days_ago,
            "due_at": add_days_iso(six_days_ago, DEFAULT_LOAN_DAYS),
            "returned_at": None,
            "return_note": None,
        },
        {
            "id": "LN-0003",
            "user_id": "U-RDR-02",
            "copy_id": "CP-B061-A",
            "book_id": "B061",
            "request_id": "REQ-0003",
            "issued_by": "U-LIB-01",
            "issued_at": twelve_days_ago,
            "due_at": add_days_iso(twelve_days_ago, DEFAULT_LOAN_DAYS),
            "returned_at": None,
            "return_note": None,
        },
        {
            "id": "LN-0004",
            "user_id": "U-RDR-01",
            "copy_id": "CP-B021-A",
            "book_id": "B021",
            "request_id": None,
            "issued_by": "U-LIB-01",
            "issued_at": add_days_iso(now_iso, -30),
            "due_at": add_days_iso(now_iso, -16),
            "returned_at": add_days_iso(now_iso, -18),
            "return_note": "Trả đúng hạn, sách nguyên vẹn",
        },
    ]

    for l in loans_seed:
        conn.execute(
            """
            INSERT INTO loans (id, user_id, copy_id, book_id, request_id, issued_by, issued_at, due_at, returned_at, return_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                l["id"],
                l["user_id"],
                l["copy_id"],
                l["book_id"],
                l["request_id"],
                l["issued_by"],
                l["issued_at"],
                l["due_at"],
                l["returned_at"],
                l["return_note"],
            ),
        )

    favorites_seed = [
        ("U-RDR-01", "B071", now_iso),
        ("U-RDR-01", "B031", now_iso),
    ]
    for uid, bid, cat in favorites_seed:
        conn.execute(
            "INSERT INTO favorites (user_id, book_id, created_at) VALUES (?, ?, ?)",
            (uid, bid, cat),
        )

    conn.execute(
        """
        INSERT INTO audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, detail, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "AUD-0001",
            "U-LIB-01",
            "Lý Thế An (Thủ thư)",
            "INIT_SEED",
            "book",
            "CATALOG-100",
            "Khởi tạo danh mục 100 đầu sách và 201 bản sao thử nghiệm",
            now_iso,
        ),
    )


def init_db(db_path: str | Path | None = None, reset: bool = False, now: datetime | str | None = None) -> Path:
    """Khởi tạo bảng và tự động seed nếu DB trống hoặc khi reset=True."""
    target = get_db_path(db_path)
    with DB_LOCK:
        conn = get_connection(target)
        try:
            if reset:
                conn.executescript(
                    """
                    PRAGMA foreign_keys = OFF;
                    DROP TABLE IF EXISTS audit_logs;
                    DROP TABLE IF EXISTS feedback;
                    DROP TABLE IF EXISTS favorites;
                    DROP TABLE IF EXISTS book_embeddings;
                    DROP TABLE IF EXISTS loans;
                    DROP TABLE IF EXISTS borrow_requests;
                    DROP TABLE IF EXISTS copies;
                    DROP TABLE IF EXISTS books;
                    DROP TABLE IF EXISTS sessions;
                    DROP TABLE IF EXISTS users;
                    PRAGMA foreign_keys = ON;
                    """
                )
            conn.executescript(SCHEMA_SQL)
            conn.execute("PRAGMA foreign_keys = ON;")
            cur = conn.execute("SELECT COUNT(*) AS cnt FROM books")
            count = int(cur.fetchone()["cnt"])
            if count == 0:
                seed_database(conn, now=now)
            conn.commit()
        finally:
            conn.close()
    return target


def reset_db(db_path: str | Path | None = None, now: datetime | str | None = None) -> Path:
    """Reset toàn bộ dữ liệu về trạng thái seed chuẩn ban đầu (dùng cho test & khôi phục mẫu)."""
    return init_db(db_path=db_path, reset=True, now=now)


def log_audit_entry(
    conn: sqlite3.Connection,
    actor_id: str,
    actor_name: str,
    action: str,
    entity_type: str,
    entity_id: str,
    detail: str,
    timestamp: str | None = None,
) -> dict[str, Any]:
    ts = timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cur = conn.execute("SELECT COUNT(*) AS cnt FROM audit_logs")
    next_num = int(cur.fetchone()["cnt"]) + 1
    audit_id = f"AUD-{next_num:04d}"
    while conn.execute("SELECT 1 FROM audit_logs WHERE id = ?", (audit_id,)).fetchone():
        next_num += 1
        audit_id = f"AUD-{next_num:04d}"
    conn.execute(
        """
        INSERT INTO audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, detail, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (audit_id, actor_id, actor_name, action, entity_type, entity_id, detail, ts),
    )
    return {
        "id": audit_id,
        "actor_id": actor_id,
        "actor_name": actor_name,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "detail": detail,
        "timestamp": ts,
    }


def enrich_book_row(conn: sqlite3.Connection, book_row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    b = dict(book_row)
    book_id = b["id"]
    copy_rows = conn.execute(
        "SELECT status, COUNT(*) AS cnt FROM copies WHERE book_id = ? GROUP BY status",
        (book_id,),
    ).fetchall()
    counts = {"available": 0, "borrowed": 0, "maintenance": 0}
    for cr in copy_rows:
        st = cr["status"]
        if st in counts:
            counts[st] = int(cr["cnt"])
    total_copies = sum(counts.values())

    emb_row = conn.execute(
        "SELECT content_hash, model_revision, status FROM book_embeddings WHERE book_id = ?",
        (book_id,),
    ).fetchone()
    current_hash = compute_book_content_hash(b)
    index_ready = bool(
        emb_row and emb_row["status"] == "ready" and emb_row["content_hash"] == current_hash
    )

    return {
        "id": b["id"],
        "code": b["code"],
        "title": b["title"],
        "author": b["author"],
        "category": b["category"],
        "shelf": b["shelf"],
        "description": b["description"],
        "word_count": int(b.get("word_count") or count_words(b.get("description", ""))),
        "missing_description": bool(b.get("missing_description", False)),
        "metadata_source": b.get("metadata_source", ""),
        "license_verified": bool(b.get("license_verified", True)),
        "visible": bool(b.get("visible", True)),
        "created_at": b["created_at"],
        "updated_at": b["updated_at"],
        "total_copies": total_copies,
        "available_copies": counts["available"],
        "borrowed_copies": counts["borrowed"],
        "maintenance_copies": counts["maintenance"],
        "index_status": "ready" if index_ready else "pending",
    }


def enrich_books_bulk(conn: sqlite3.Connection, book_rows: Iterable[sqlite3.Row | dict[str, Any]]) -> list[dict[str, Any]]:
    books = [dict(r) for r in book_rows]
    if not books:
        return []
    copy_agg = conn.execute(
        "SELECT book_id, status, COUNT(*) AS cnt FROM copies GROUP BY book_id, status"
    ).fetchall()
    counts_by_book: dict[str, dict[str, int]] = {}
    for row in copy_agg:
        bid = row["book_id"]
        if bid not in counts_by_book:
            counts_by_book[bid] = {"available": 0, "borrowed": 0, "maintenance": 0}
        st = row["status"]
        if st in counts_by_book[bid]:
            counts_by_book[bid][st] = int(row["cnt"])

    emb_rows = conn.execute(
        "SELECT book_id, content_hash, model_revision, status FROM book_embeddings"
    ).fetchall()
    emb_by_book = {r["book_id"]: dict(r) for r in emb_rows}

    result: list[dict[str, Any]] = []
    for b in books:
        bid = b["id"]
        c = counts_by_book.get(bid, {"available": 0, "borrowed": 0, "maintenance": 0})
        emb = emb_by_book.get(bid)
        current_hash = compute_book_content_hash(b)
        index_ready = bool(emb and emb["status"] == "ready" and emb["content_hash"] == current_hash)
        result.append(
            {
                "id": b["id"],
                "code": b["code"],
                "title": b["title"],
                "author": b["author"],
                "category": b["category"],
                "shelf": b["shelf"],
                "description": b["description"],
                "word_count": int(b.get("word_count") or count_words(b.get("description", ""))),
                "missing_description": bool(b.get("missing_description", False)),
                "metadata_source": b.get("metadata_source", ""),
                "license_verified": bool(b.get("license_verified", True)),
                "visible": bool(b.get("visible", True)),
                "created_at": b["created_at"],
                "updated_at": b["updated_at"],
                "total_copies": c["available"] + c["borrowed"] + c["maintenance"],
                "available_copies": c["available"],
                "borrowed_copies": c["borrowed"],
                "maintenance_copies": c["maintenance"],
                "index_status": "ready" if index_ready else "pending",
            }
        )
    return result


# ==================== SAO LƯU & PHỤC HỒI NHẤT QUÁN SQLITE (T36, T42, TC28, TC29) ====================


def backup_database(
    backup_path: str | Path | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Sao lưu nhất quán SQLite bằng Online Backup API (TC28)."""
    src_path = get_db_path(db_path)
    if not src_path.exists():
        init_db(src_path)

    if backup_path is None:
        DEFAULT_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        dst_path = DEFAULT_BACKUP_DIR / f"libmate_backup_{stamp}.db"
    else:
        dst_path = Path(backup_path)
        dst_path.parent.mkdir(parents=True, exist_ok=True)

    with DB_LOCK:
        src_conn = get_connection(src_path)
        dst_conn = sqlite3.connect(str(dst_path))
        try:
            src_conn.backup(dst_conn)
            dst_conn.commit()
            books_cnt = int(src_conn.execute("SELECT COUNT(*) FROM books").fetchone()[0])
            copies_cnt = int(src_conn.execute("SELECT COUNT(*) FROM copies").fetchone()[0])
            users_cnt = int(src_conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])
            loans_cnt = int(src_conn.execute("SELECT COUNT(*) FROM loans").fetchone()[0])
            active_loans_cnt = int(
                src_conn.execute("SELECT COUNT(*) FROM loans WHERE returned_at IS NULL").fetchone()[0]
            )
        finally:
            dst_conn.close()
            src_conn.close()

    return {
        "backup_path": str(dst_path),
        "source_db_path": str(src_path),
        "size_bytes": dst_path.stat().st_size,
        "counts": {
            "books": books_cnt,
            "copies": copies_cnt,
            "users": users_cnt,
            "loans": loans_cnt,
            "active_loans": active_loans_cnt,
        },
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def restore_database(
    backup_path: str | Path,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Phục hồi cơ sở dữ liệu từ file backup và kiểm tra tính toàn vẹn khóa ngoại (TC28, TC29)."""
    src_backup = Path(backup_path)
    if not src_backup.exists():
        raise FileNotFoundError(f"Không tìm thấy tệp sao lưu: {src_backup}")

    dst_path = get_db_path(db_path)
    dst_path.parent.mkdir(parents=True, exist_ok=True)

    with DB_LOCK:
        bck_conn = sqlite3.connect(str(src_backup))
        dst_conn = sqlite3.connect(str(dst_path))
        try:
            bck_conn.backup(dst_conn)
            dst_conn.commit()
        finally:
            dst_conn.close()
            bck_conn.close()

        verify_conn = get_connection(dst_path)
        try:
            fk_issues = verify_conn.execute("PRAGMA foreign_key_check;").fetchall()
            if fk_issues:
                raise RuntimeError("Dữ liệu phục hồi không hợp lệ: vi phạm toàn vẹn khóa ngoại.")
            books_cnt = int(verify_conn.execute("SELECT COUNT(*) FROM books").fetchone()[0])
            copies_cnt = int(verify_conn.execute("SELECT COUNT(*) FROM copies").fetchone()[0])
            users_cnt = int(verify_conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])
            loans_cnt = int(verify_conn.execute("SELECT COUNT(*) FROM loans").fetchone()[0])
            active_loans_cnt = int(
                verify_conn.execute("SELECT COUNT(*) FROM loans WHERE returned_at IS NULL").fetchone()[0]
            )
        finally:
            verify_conn.close()

    return {
        "restored_from": str(src_backup),
        "db_path": str(dst_path),
        "counts": {
            "books": books_cnt,
            "copies": copies_cnt,
            "users": users_cnt,
            "loans": loans_cnt,
            "active_loans": active_loans_cnt,
        },
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
