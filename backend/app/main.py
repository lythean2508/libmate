"""
Ứng dụng FastAPI chính của LibMate (Phạm Hiển):
- Cung cấp toàn bộ REST API khớp hợp đồng T02 & T04 với Frontend (Lý Thế An).
- Xử lý giao dịch nguyên tử có khóa luồng + BEGIN IMMEDIATE khi giao sách tại quầy (TC11, TC12, TC13).
- Chống trả lặp lần 2, hỗ trợ chuyển bản sao sang Bảo trì (TC14, TC15) và tính quá hạn theo Asia/Ho_Chi_Minh (TC16).
- Bảo mật phân quyền, cô lập dữ liệu cá nhân (/me/*), chống XSS (TC01..TC04, TC27).
- Báo cáo thống kê, xuất CSV UTF-8 BOM, sao lưu/phục hồi SQLite và đồng bộ chỉ mục AI Local (TC17..TC29).
"""

from __future__ import annotations

import secrets
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from . import ai_engine
from .auth import (
    XSSValidationError,
    authenticate_user,
    contains_xss_payload,
    extract_token_from_request,
    get_current_user,
    get_optional_user,
    hash_password,
    register_public_reader,
    require_librarian,
    revoke_session_token,
    sanitize_text_input,
    to_public_user,
    validate_no_xss,
    verify_password,
)
from .db import (
    DB_LOCK,
    DEFAULT_LOAN_DAYS,
    ISSUE_LOCK,
    MAX_ACTIVE_LOANS,
    MODEL_REVISION,
    VN_TZ,
    add_days_iso,
    backup_database,
    build_csv_utf8_bom,
    compute_book_content_hash,
    compute_days_remaining,
    count_words,
    db_session,
    enrich_book_row,
    enrich_books_bulk,
    format_date_vi,
    get_connection,
    get_db_path,
    init_db,
    is_loan_overdue,
    log_audit_entry,
    normalize_search_text,
    parse_iso_datetime,
    reset_db,
    restore_database,
    set_db_path,
    strip_vietnamese_accents,
    to_server_date_key,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with db_session() as conn:
        ai_engine.sync_and_verify_embeddings(conn=conn, force_rebuild=False)
    yield


app = FastAPI(
    title="LibMate Backend API",
    description="Ứng dụng Thư viện Trường học Tích hợp AI Local (FastAPI + SQLite + multilingual-e5-small)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== PYDANTIC SCHEMAS ====================


class LoginPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    reader_code: str | None = None
    username: str | None = None
    code: str | None = None
    password: str = ""


class RegisterPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    reader_code: str = ""
    name: str = ""
    password: str = ""
    grade_or_dept: str | None = "Học sinh"
    role: str | None = None


class BookCreatePayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str | None = None
    code: str | None = None
    title: str
    author: str
    category: str
    shelf: str
    description: str
    metadata_source: str | None = None
    visible: bool = True
    auto_reindex: bool = True
    autoReindex: bool | None = None


class BookUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    title: str | None = None
    author: str | None = None
    category: str | None = None
    shelf: str | None = None
    description: str | None = None
    metadata_source: str | None = None
    visible: bool | None = None
    auto_reindex: bool = True
    autoReindex: bool | None = None


class CopyCreatePayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    book_id: str | None = None
    bookId: str | None = None
    copy_code: str | None = None
    copyCode: str | None = None
    status: str = "available"
    condition_note: str | None = "Tốt"
    conditionNote: str | None = None


class CopyUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    status: str | None = None
    condition_note: str | None = None
    conditionNote: str | None = None


class BorrowRequestCreatePayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    book_id: str | None = None
    bookId: str | None = None


class BorrowRequestRejectPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    reason: str | None = None
    rejection_reason: str | None = None


class LoanIssuePayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    request_id: str | None = None
    requestId: str | None = None
    copy_id: str | None = None
    copyId: str | None = None
    copy_code: str | None = None
    user_id: str | None = None
    userId: str | None = None
    reader_code: str | None = None
    book_id: str | None = None
    issued_at: str | None = None
    now: str | None = None
    simulate_failure: bool = False
    simulateMidTransactionFailure: bool = False
    simulate_mid_transaction_failure: bool = False


class LoanReturnPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    mark_maintenance: bool = False
    markMaintenance: bool | None = None
    maintenance: bool | None = None
    condition_note: str | None = None
    conditionNote: str | None = None
    return_note: str | None = None
    now: str | None = None
    returned_at: str | None = None


class FeedbackPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    book_id: str | None = None
    bookId: str | None = None
    source_type: str | None = None
    sourceType: str | None = None
    context_key: str | None = None
    contextKey: str | None = None
    query: str | None = None
    useful: bool = True
    comment: str | None = None
    note: str | None = None


class BackupPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    backup_path: str | None = None
    path: str | None = None


class RestorePayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    backup_path: str | None = None
    path: str | None = None


class RebuildIndexPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    book_id: str | None = None
    force_rebuild: bool = True


# ==================== HELPERS ====================


def _ensure_initialized() -> None:
    db_file = get_db_path()
    if not db_file.exists():
        init_db(db_file)


def _to_loan_view(conn: sqlite3.Connection, loan_row: sqlite3.Row | dict[str, Any], now: str | datetime | None = None) -> dict[str, Any]:
    l = dict(loan_row)
    book = conn.execute("SELECT title, author FROM books WHERE id = ?", (l["book_id"],)).fetchone()
    copy = conn.execute("SELECT copy_code, status FROM copies WHERE id = ?", (l["copy_id"],)).fetchone()
    reader = conn.execute("SELECT name, reader_code FROM users WHERE id = ?", (l["user_id"],)).fetchone()

    overdue = is_loan_overdue(l["due_at"], l.get("returned_at"), now=now)
    days_rem = compute_days_remaining(l["due_at"], now=now)

    return {
        "id": l["id"],
        "user_id": l["user_id"],
        "copy_id": l["copy_id"],
        "book_id": l["book_id"],
        "request_id": l.get("request_id"),
        "issued_by": l["issued_by"],
        "issued_at": l["issued_at"],
        "due_at": l["due_at"],
        "returned_at": l.get("returned_at"),
        "return_note": l.get("return_note"),
        "book_title": book["title"] if book else l["book_id"],
        "book_author": book["author"] if book else "",
        "copy_code": copy["copy_code"] if copy else l["copy_id"],
        "copy_status": copy["status"] if copy else "available",
        "reader_name": reader["name"] if reader else l["user_id"],
        "reader_code": reader["reader_code"] if reader else "",
        "is_overdue": overdue,
        "days_remaining": days_rem,
    }


def _to_request_view(conn: sqlite3.Connection, req_row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    r = dict(req_row)
    book_row = conn.execute("SELECT * FROM books WHERE id = ?", (r["book_id"],)).fetchone()
    enriched = enrich_book_row(conn, book_row) if book_row else None
    reader = conn.execute("SELECT name, reader_code FROM users WHERE id = ?", (r["user_id"],)).fetchone()
    active_cnt = int(
        conn.execute(
            "SELECT COUNT(*) FROM loans WHERE user_id = ? AND returned_at IS NULL",
            (r["user_id"],),
        ).fetchone()[0]
    )

    return {
        "id": r["id"],
        "user_id": r["user_id"],
        "book_id": r["book_id"],
        "status": r["status"],
        "created_at": r["created_at"],
        "resolved_at": r.get("resolved_at"),
        "rejection_reason": r.get("rejection_reason"),
        "handled_by": r.get("handled_by"),
        "book_title": book_row["title"] if book_row else r["book_id"],
        "book_author": book_row["author"] if book_row else "",
        "book_shelf": book_row["shelf"] if book_row else "",
        "available_copies": enriched["available_copies"] if enriched else 0,
        "reader_name": reader["name"] if reader else r["user_id"],
        "reader_code": reader["reader_code"] if reader else "",
        "reader_active_loans": active_cnt,
    }


# ==================== HEALTH & ROOT ====================


@app.get("/health")
def health_check() -> dict[str, Any]:
    _ensure_initialized()
    return {
        "status": "ok",
        "db_path": str(get_db_path()),
        "ai": ai_engine.get_ai_status(),
    }


# ==================== 1. AUTH ENDPOINTS (TC01, TC02, TC03, TC04, T16, TC27) ====================


@app.post("/auth/login")
def api_login(payload: LoginPayload) -> dict[str, Any]:
    _ensure_initialized()
    code = payload.reader_code or payload.username or payload.code or ""
    with db_session() as conn:
        return authenticate_user(conn, code, payload.password)


@app.post("/auth/register", status_code=200)
def api_register(payload: RegisterPayload) -> dict[str, Any]:
    _ensure_initialized()
    with db_session() as conn:
        user = register_public_reader(
            conn=conn,
            reader_code=payload.reader_code,
            name=payload.name,
            password=payload.password,
            grade_or_dept=payload.grade_or_dept,
            requested_role=payload.role,
        )
    return {**user, "user": user}


@app.post("/auth/logout")
def api_logout(request: Request) -> dict[str, Any]:
    _ensure_initialized()
    token = extract_token_from_request(request)
    with db_session() as conn:
        revoked = revoke_session_token(conn, token)
    return {"status": "logged_out", "revoked": revoked}


@app.get("/auth/me")
def api_get_me(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {**current_user, "user": current_user}


# ==================== 2. BOOKS & CATALOG ENDPOINTS (TC05, TC06, TC08, TC20, TC27) ====================


@app.get("/books")
def api_list_books(
    request: Request,
    query: str | None = Query(default=None),
    q: str | None = Query(default=None),
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    only_available: bool = Query(default=False),
    onlyAvailable: bool | None = Query(default=None),
    include_hidden: bool = Query(default=False),
    includeHidden: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=200),
    pageSize: int | None = Query(default=None, ge=1, le=200),
) -> dict[str, Any]:
    _ensure_initialized()
    effective_query = query if query is not None else (q if q is not None else search)
    effective_only_avail = bool(onlyAvailable if onlyAvailable is not None else only_available)
    effective_page_size = int(pageSize if pageSize is not None else page_size)
    want_hidden = bool(includeHidden if includeHidden is not None else include_hidden)

    optional_user = get_optional_user(request)
    can_see_hidden = bool(optional_user and optional_user.get("role") == "librarian" and want_hidden)

    with db_session() as conn:
        rows = conn.execute("SELECT * FROM books ORDER BY id ASC").fetchall()
        enriched = enrich_books_bulk(conn, rows)

    if effective_query and effective_query.strip():
        pool = (
            [{**b, "visible": True} for b in enriched]
            if can_see_hidden
            else [b for b in enriched if b["visible"]]
        )
        matched = ai_engine.run_keyword_search(
            effective_query,
            books=pool,
            category=category,
            only_available=effective_only_avail,
        )
        matched_ids = {m["id"] for m in matched}
        by_id = {b["id"]: b for b in enriched}
        filtered = [by_id[m["id"]] for m in matched if m["id"] in matched_ids and (can_see_hidden or by_id[m["id"]]["visible"])]
    else:
        filtered = []
        for b in enriched:
            if not can_see_hidden and not b["visible"]:
                continue
            if category and category.upper() != "ALL" and b["category"] != category:
                continue
            if effective_only_avail and b["available_copies"] <= 0:
                continue
            filtered.append(b)

    total = len(filtered)
    total_pages = max((total + effective_page_size - 1) // effective_page_size, 1)
    safe_page = min(max(page, 1), total_pages)
    start = (safe_page - 1) * effective_page_size
    items = filtered[start : start + effective_page_size]

    return {
        "items": items,
        "books": items,
        "total": total,
        "page": safe_page,
        "page_size": effective_page_size,
        "pageSize": effective_page_size,
        "total_pages": total_pages,
        "totalPages": total_pages,
    }


@app.get("/books/{book_id}")
def api_get_book_detail(book_id: str, request: Request) -> dict[str, Any]:
    _ensure_initialized()
    optional_user = get_optional_user(request)
    is_librarian = bool(optional_user and optional_user.get("role") == "librarian")

    with db_session() as conn:
        row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy đầu sách này.")
        if not bool(row["visible"]) and not is_librarian:
            raise HTTPException(
                status_code=404,
                detail="Đầu sách này hiện đang tạm ẩn khỏi danh mục bạn đọc.",
            )

        enriched_book = enrich_book_row(conn, row)
        copy_rows = conn.execute(
            "SELECT * FROM copies WHERE book_id = ? ORDER BY copy_code ASC",
            (book_id,),
        ).fetchall()
        copies = [dict(c) for c in copy_rows]
        similar = ai_engine.get_similar_books(book_id, conn=conn, limit=4)

    return {
        **enriched_book,
        "book": enriched_book,
        "copies": copies,
        "similar": similar,
    }


@app.post("/books", status_code=201)
def api_create_book(
    payload: BookCreatePayload,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    title = validate_no_xss(payload.title, "title")
    author = validate_no_xss(payload.author, "author")
    category = validate_no_xss(payload.category, "category")
    shelf = validate_no_xss(payload.shelf, "shelf")
    description = validate_no_xss(payload.description, "description")
    metadata_source = validate_no_xss(
        payload.metadata_source or "Thủ thư biên tập nội bộ tại trường (metadata được phép sử dụng)",
        "metadata_source",
    )

    if not title or not author or not category or not shelf:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng nhập đầy đủ Tên sách, Tác giả, Chủ đề và Kệ sách.",
        )

    should_reindex = payload.autoReindex if payload.autoReindex is not None else payload.auto_reindex
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    wc = count_words(description)
    missing_desc = 1 if wc < 80 else 0

    with DB_LOCK, db_session() as conn:
        if payload.id:
            book_id = validate_no_xss(payload.id, "id")
            if conn.execute("SELECT 1 FROM books WHERE id = ?", (book_id,)).fetchone():
                raise HTTPException(status_code=409, detail=f"Mã đầu sách '{book_id}' đã tồn tại.")
        else:
            cnt = int(conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]) + 1
            book_id = f"B{cnt:03d}"
            while conn.execute("SELECT 1 FROM books WHERE id = ?", (book_id,)).fetchone():
                cnt += 1
                book_id = f"B{cnt:03d}"

        code = validate_no_xss(payload.code or f"LIB-{book_id}", "code")

        conn.execute(
            """
            INSERT INTO books (
                id, code, title, author, category, shelf, description,
                word_count, missing_description, metadata_source,
                license_verified, visible, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            """,
            (
                book_id,
                code,
                title,
                author,
                category,
                shelf,
                description,
                wc,
                missing_desc,
                metadata_source,
                1 if payload.visible else 0,
                now_iso,
                now_iso,
            ),
        )

        row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        c_hash = compute_book_content_hash(dict(row))
        conn.execute(
            """
            INSERT OR REPLACE INTO book_embeddings (book_id, content_hash, model_revision, status, vector_json, updated_at)
            VALUES (?, ?, ?, 'pending', NULL, ?)
            """,
            (book_id, c_hash, MODEL_REVISION, now_iso),
        )

        if should_reindex:
            ai_engine.index_book(dict(row), conn=conn, status="ready")
        else:
            ai_engine.mark_book_pending(book_id, conn=conn)

        log_audit_entry(
            conn=conn,
            actor_id=librarian["id"],
            actor_name=librarian["name"],
            action="CREATE_BOOK",
            entity_type="book",
            entity_id=book_id,
            detail=f'Thêm đầu sách mới "{title}"',
            timestamp=now_iso,
        )
        enriched = enrich_book_row(conn, row)

    return {**enriched, "book": enriched}


@app.patch("/books/{book_id}")
@app.put("/books/{book_id}")
def api_update_book(
    book_id: str,
    payload: BookUpdatePayload,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    should_reindex = payload.autoReindex if payload.autoReindex is not None else payload.auto_reindex

    with DB_LOCK, db_session() as conn:
        existing_row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        if not existing_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy đầu sách cần cập nhật.")
        existing = dict(existing_row)

        title = validate_no_xss(payload.title, "title") if payload.title is not None else existing["title"]
        author = validate_no_xss(payload.author, "author") if payload.author is not None else existing["author"]
        category = validate_no_xss(payload.category, "category") if payload.category is not None else existing["category"]
        shelf = validate_no_xss(payload.shelf, "shelf") if payload.shelf is not None else existing["shelf"]
        description = (
            validate_no_xss(payload.description, "description")
            if payload.description is not None
            else existing["description"]
        )
        metadata_source = (
            validate_no_xss(payload.metadata_source, "metadata_source")
            if payload.metadata_source is not None
            else existing["metadata_source"]
        )
        visible = payload.visible if payload.visible is not None else bool(existing["visible"])

        if not title or not author or not category or not shelf:
            raise HTTPException(
                status_code=400,
                detail="Tên sách, Tác giả, Chủ đề và Kệ sách không được để trống.",
            )

        content_changed = (
            title != existing["title"]
            or author != existing["author"]
            or category != existing["category"]
            or description != existing["description"]
        )

        wc = count_words(description)
        missing_desc = 1 if wc < 80 else 0

        conn.execute(
            """
            UPDATE books
            SET title = ?, author = ?, category = ?, shelf = ?, description = ?,
                word_count = ?, missing_description = ?, metadata_source = ?,
                visible = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                title,
                author,
                category,
                shelf,
                description,
                wc,
                missing_desc,
                metadata_source,
                1 if visible else 0,
                now_iso,
                book_id,
            ),
        )

        updated_row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        if content_changed:
            # Đánh dấu trạng thái 'pending' trước, sau đó tự động re-index vector mới (TC20)
            ai_engine.mark_book_pending(book_id, conn=conn)
            if should_reindex:
                ai_engine.index_book(dict(updated_row), conn=conn, status="ready")

        log_audit_entry(
            conn=conn,
            actor_id=librarian["id"],
            actor_name=librarian["name"],
            action="UPDATE_BOOK",
            entity_type="book",
            entity_id=book_id,
            detail=f'Cập nhật đầu sách "{title}" (visible={visible})',
            timestamp=now_iso,
        )
        enriched = enrich_book_row(conn, updated_row)

    return {**enriched, "book": enriched}


# ==================== 3. COPIES ENDPOINTS (TC07, TC03, TC27) ====================


@app.post("/copies", status_code=201)
def api_add_copy(
    payload: CopyCreatePayload,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    book_id = validate_no_xss(payload.book_id or payload.bookId or "", "book_id")
    raw_code = validate_no_xss(payload.copy_code or payload.copyCode or "", "copy_code")
    clean_code = raw_code.strip().upper()
    cond_note = validate_no_xss(
        payload.conditionNote if payload.conditionNote is not None else (payload.condition_note or "Tốt"),
        "condition_note",
    ) or "Tốt"

    if not clean_code:
        raise HTTPException(
            status_code=400,
            detail={"field": "copy_code", "message": "Trường lỗi [copy_code]: Mã bản sao không được để trống."},
        )

    status_val = "maintenance" if payload.status == "maintenance" else "available"

    with DB_LOCK, db_session() as conn:
        book_row = conn.execute("SELECT id, title FROM books WHERE id = ?", (book_id,)).fetchone()
        if not book_row:
            raise HTTPException(status_code=404, detail="Đầu sách không tồn tại.")

        dup = conn.execute(
            "SELECT id, copy_code FROM copies WHERE UPPER(copy_code) = UPPER(?)",
            (clean_code,),
        ).fetchone()
        if dup:
            raise HTTPException(
                status_code=409,
                detail=f'Trường lỗi [copy_code]: Mã bản sao "{clean_code}" đã tồn tại. Mỗi bản sao vật lý phải có mã duy nhất (TC07).',
            )

        copy_id = f"CP-{book_id}-{secrets.token_hex(3).upper()}"
        conn.execute(
            """
            INSERT INTO copies (id, book_id, copy_code, status, condition_note)
            VALUES (?, ?, ?, ?, ?)
            """,
            (copy_id, book_id, clean_code, status_val, cond_note),
        )
        log_audit_entry(
            conn=conn,
            actor_id=librarian["id"],
            actor_name=librarian["name"],
            action="ADD_COPY",
            entity_type="copy",
            entity_id=copy_id,
            detail=f'Thêm bản sao {clean_code} cho sách "{book_row["title"]}"',
        )
        created = dict(conn.execute("SELECT * FROM copies WHERE id = ?", (copy_id,)).fetchone())

    return {**created, "copy": created}


@app.patch("/copies/{copy_id}")
@app.put("/copies/{copy_id}")
def api_update_copy(
    copy_id: str,
    payload: CopyUpdatePayload,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    with DB_LOCK, db_session() as conn:
        copy_row = conn.execute("SELECT * FROM copies WHERE id = ?", (copy_id,)).fetchone()
        if not copy_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy bản sao.")
        if copy_row["status"] == "borrowed":
            raise HTTPException(
                status_code=409,
                detail="Bản sao đang được mượn — vui lòng thực hiện xác nhận trả sách tại Quầy trước khi đổi trạng thái.",
            )

        next_status = payload.status or copy_row["status"]
        if next_status not in ("available", "maintenance"):
            raise HTTPException(status_code=400, detail="Trạng thái bản sao chỉ nhận 'available' hoặc 'maintenance'.")

        raw_note = payload.conditionNote if payload.conditionNote is not None else payload.condition_note
        next_note = (
            validate_no_xss(raw_note, "condition_note")
            if raw_note is not None
            else copy_row["condition_note"]
        )

        conn.execute(
            "UPDATE copies SET status = ?, condition_note = ? WHERE id = ?",
            (next_status, next_note, copy_id),
        )
        log_audit_entry(
            conn=conn,
            actor_id=librarian["id"],
            actor_name=librarian["name"],
            action="UPDATE_COPY",
            entity_type="copy",
            entity_id=copy_id,
            detail=f"Đổi trạng thái {copy_row['copy_code']} -> {next_status}",
        )
        updated = dict(conn.execute("SELECT * FROM copies WHERE id = ?", (copy_id,)).fetchone())

    return {**updated, "copy": updated}


# ==================== 4. BORROW REQUESTS ENDPOINTS (TC09, TC10, TC04, T16) ====================


@app.post("/borrow-requests", status_code=201)
def api_create_borrow_request(
    payload: BorrowRequestCreatePayload,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_initialized()
    book_id = validate_no_xss(payload.book_id or payload.bookId or "", "book_id")
    if not book_id:
        raise HTTPException(status_code=400, detail="Thiếu mã đầu sách (book_id).")

    with DB_LOCK, db_session() as conn:
        user_row = conn.execute("SELECT * FROM users WHERE id = ?", (current_user["id"],)).fetchone()
        if not user_row or user_row["status"] == "locked":
            raise HTTPException(
                status_code=403,
                detail="Tài khoản đang bị khóa, không thể gửi yêu cầu mượn (T16).",
            )

        book_row = conn.execute("SELECT * FROM books WHERE id = ? AND visible = 1", (book_id,)).fetchone()
        if not book_row:
            raise HTTPException(status_code=404, detail="Đầu sách không khả dụng để đặt yêu cầu.")

        dup_pending = conn.execute(
            """
            SELECT id FROM borrow_requests
            WHERE user_id = ? AND book_id = ? AND status = 'pending'
            """,
            (current_user["id"], book_id),
        ).fetchone()
        if dup_pending:
            raise HTTPException(
                status_code=409,
                detail="Bạn đã có một yêu cầu đang chờ xử lý cho đầu sách này (TC09).",
            )

        active_loans = int(
            conn.execute(
                "SELECT COUNT(*) FROM loans WHERE user_id = ? AND returned_at IS NULL",
                (current_user["id"],),
            ).fetchone()[0]
        )
        if active_loans >= MAX_ACTIVE_LOANS:
            raise HTTPException(
                status_code=400,
                detail=f"Bạn đang mượn {active_loans}/{MAX_ACTIVE_LOANS} cuốn tối đa. Vui lòng trả sách trước khi mượn thêm.",
            )

        enriched = enrich_book_row(conn, book_row)
        if enriched["available_copies"] <= 0:
            raise HTTPException(
                status_code=400,
                detail="Hiện không còn bản sao sẵn có trên kệ cho đầu sách này.",
            )

        next_num = int(conn.execute("SELECT COUNT(*) FROM borrow_requests").fetchone()[0]) + 1
        req_id = f"REQ-{next_num:04d}"
        while conn.execute("SELECT 1 FROM borrow_requests WHERE id = ?", (req_id,)).fetchone():
            next_num += 1
            req_id = f"REQ-{next_num:04d}"

        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute(
            """
            INSERT INTO borrow_requests (id, user_id, book_id, status, created_at)
            VALUES (?, ?, ?, 'pending', ?)
            """,
            (req_id, current_user["id"], book_id, now_iso),
        )
        created_row = conn.execute("SELECT * FROM borrow_requests WHERE id = ?", (req_id,)).fetchone()
        req_view = _to_request_view(conn, created_row)

    return {**req_view, "request": req_view}


@app.post("/borrow-requests/{req_id}/cancel")
def api_cancel_borrow_request(
    req_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_initialized()
    with DB_LOCK, db_session() as conn:
        req_row = conn.execute("SELECT * FROM borrow_requests WHERE id = ?", (req_id,)).fetchone()
        if not req_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu mượn.")

        if req_row["user_id"] != current_user["id"]:
            raise HTTPException(
                status_code=403,
                detail="Bạn không có quyền hủy yêu cầu của người đọc khác (TC04).",
            )

        if req_row["status"] != "pending":
            raise HTTPException(
                status_code=400,
                detail="Chỉ được hủy yêu cầu đang ở trạng thái Đang chờ (pending). Yêu cầu đã giao không thể hủy tại đây (TC10).",
            )

        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute(
            "UPDATE borrow_requests SET status = 'cancelled', resolved_at = ? WHERE id = ?",
            (now_iso, req_id),
        )
        updated_row = conn.execute("SELECT * FROM borrow_requests WHERE id = ?", (req_id,)).fetchone()
        req_view = _to_request_view(conn, updated_row)

    return {**req_view, "request": req_view}


@app.post("/borrow-requests/{req_id}/reject")
def api_reject_borrow_request(
    req_id: str,
    payload: BorrowRequestRejectPayload,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    reason = validate_no_xss(payload.reason or payload.rejection_reason or "", "reason")
    if not reason:
        raise HTTPException(status_code=400, detail="Vui lòng nhập lý do từ chối yêu cầu.")

    with DB_LOCK, db_session() as conn:
        req_row = conn.execute("SELECT * FROM borrow_requests WHERE id = ?", (req_id,)).fetchone()
        if not req_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu mượn.")
        if req_row["status"] != "pending":
            raise HTTPException(status_code=400, detail="Chỉ có thể từ chối yêu cầu đang chờ xử lý.")

        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute(
            """
            UPDATE borrow_requests
            SET status = 'rejected', rejection_reason = ?, resolved_at = ?, handled_by = ?
            WHERE id = ?
            """,
            (reason, now_iso, librarian["id"], req_id),
        )
        log_audit_entry(
            conn=conn,
            actor_id=librarian["id"],
            actor_name=librarian["name"],
            action="REJECT_REQUEST",
            entity_type="request",
            entity_id=req_id,
            detail=f"Từ chối yêu cầu {req_id}: {reason}",
            timestamp=now_iso,
        )
        updated_row = conn.execute("SELECT * FROM borrow_requests WHERE id = ?", (req_id,)).fetchone()
        req_view = _to_request_view(conn, updated_row)

    return {**req_view, "request": req_view}


# ==================== 5. LOANS ISSUE & RETURN AT DESK (TC11, TC12, TC13, TC14, TC15, TC16) ====================


@app.post("/loans/issue")
def api_issue_loan(
    payload: LoanIssuePayload,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    """
    Giao sách tại quầy trong một giao dịch nguyên tử có khóa luồng + BEGIN IMMEDIATE (T17, TC11, TC12, TC13):
    - Kiểm tra lại copy.status == 'available' ngay thời điểm ghi (chống 2 luồng giao trùng bản cuối TC11 -> 409).
    - Kiểm tra lại số phiếu đang mượn < 3 ngay thời điểm giao (TC12).
    - Nếu lỗi giữa giao dịch (simulate_failure=True), rollback toàn bộ, không tạo phiếu mồ côi (TC13).
    """
    _ensure_initialized()
    req_id = payload.request_id or payload.requestId
    copy_ref = payload.copy_id or payload.copyId or payload.copy_code
    user_ref = payload.user_id or payload.userId or payload.reader_code
    simulate_fail = bool(
        payload.simulate_failure
        or payload.simulateMidTransactionFailure
        or payload.simulate_mid_transaction_failure
    )

    if not copy_ref:
        raise HTTPException(status_code=400, detail="Vui lòng chọn bản sao vật lý (copy_id) để giao sách.")

    with ISSUE_LOCK:
        conn = get_connection()
        try:
            conn.isolation_level = None  # Quản lý BEGIN IMMEDIATE thủ công
            conn.execute("BEGIN IMMEDIATE;")

            copy_row = conn.execute(
                "SELECT * FROM copies WHERE id = ? OR UPPER(copy_code) = UPPER(?)",
                (copy_ref, copy_ref),
            ).fetchone()
            if not copy_row:
                conn.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail="Không tìm thấy bản sao vật lý được chọn.")

            req_row = None
            if req_id:
                req_row = conn.execute(
                    "SELECT * FROM borrow_requests WHERE id = ?",
                    (req_id,),
                ).fetchone()
                if not req_row:
                    conn.execute("ROLLBACK;")
                    raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu mượn.")
                if req_row["status"] != "pending":
                    conn.execute("ROLLBACK;")
                    raise HTTPException(
                        status_code=409,
                        detail=f"Yêu cầu {req_id} không còn ở trạng thái chờ (hiện tại: {req_row['status']}).",
                    )
                target_user_id = req_row["user_id"]
                target_book_id = req_row["book_id"]
                if copy_row["book_id"] != target_book_id:
                    conn.execute("ROLLBACK;")
                    raise HTTPException(
                        status_code=400,
                        detail="Bản sao được chọn không thuộc đầu sách của yêu cầu này.",
                    )
            else:
                if not user_ref:
                    conn.execute("ROLLBACK;")
                    raise HTTPException(
                        status_code=400,
                        detail="Cần cung cấp request_id hoặc user_id/reader_code để giao sách.",
                    )
                u_lookup = conn.execute(
                    "SELECT id FROM users WHERE id = ? OR UPPER(reader_code) = UPPER(?)",
                    (user_ref, user_ref),
                ).fetchone()
                if not u_lookup:
                    conn.execute("ROLLBACK;")
                    raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản bạn đọc.")
                target_user_id = u_lookup["id"]
                target_book_id = copy_row["book_id"]
                req_row = conn.execute(
                    """
                    SELECT * FROM borrow_requests
                    WHERE user_id = ? AND book_id = ? AND status = 'pending'
                    ORDER BY created_at ASC LIMIT 1
                    """,
                    (target_user_id, target_book_id),
                ).fetchone()
                if req_row:
                    req_id = req_row["id"]

            reader_row = conn.execute(
                "SELECT * FROM users WHERE id = ?",
                (target_user_id,),
            ).fetchone()
            if not reader_row or reader_row["status"] == "locked":
                conn.execute("ROLLBACK;")
                raise HTTPException(
                    status_code=403,
                    detail="Tài khoản người đọc đang bị khóa, không thể giao sách (T16).",
                )

            # Kiểm tra bản sao sẵn có ngay trong transaction (TC11)
            if copy_row["status"] != "available":
                conn.execute("ROLLBACK;")
                raise HTTPException(
                    status_code=409,
                    detail=f"Bản sao {copy_row['copy_code']} hiện không sẵn có (trạng thái: {copy_row['status']}) — vừa được giao cho phiếu khác hoặc đang bảo trì (TC11).",
                )

            active_loan_on_copy = conn.execute(
                "SELECT id FROM loans WHERE copy_id = ? AND returned_at IS NULL",
                (copy_row["id"],),
            ).fetchone()
            if active_loan_on_copy:
                conn.execute("ROLLBACK;")
                raise HTTPException(
                    status_code=409,
                    detail=f"Bản sao {copy_row['copy_code']} đang gắn với phiếu mượn chưa trả {active_loan_on_copy['id']} (TC11).",
                )

            # Kiểm tra lại giới hạn 3 cuốn đang mượn ngay thời điểm giao (TC12)
            active_loans_count = int(
                conn.execute(
                    "SELECT COUNT(*) FROM loans WHERE user_id = ? AND returned_at IS NULL",
                    (reader_row["id"],),
                ).fetchone()[0]
            )
            if active_loans_count >= MAX_ACTIVE_LOANS:
                conn.execute("ROLLBACK;")
                raise HTTPException(
                    status_code=409,
                    detail=f"Người đọc đã đạt giới hạn mượn tối đa ({active_loans_count}/{MAX_ACTIVE_LOANS} cuốn đang mượn) tại thời điểm giao sách (TC12).",
                )

            raw_issued = payload.issued_at or payload.now
            issued_dt = parse_iso_datetime(raw_issued).astimezone(timezone.utc)
            issued_iso = issued_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            due_iso = add_days_iso(issued_iso, DEFAULT_LOAN_DAYS)

            next_num = int(conn.execute("SELECT COUNT(*) FROM loans").fetchone()[0]) + 1
            loan_id = f"LN-{next_num:04d}"
            while conn.execute("SELECT 1 FROM loans WHERE id = ?", (loan_id,)).fetchone():
                next_num += 1
                loan_id = f"LN-{next_num:04d}"

            conn.execute(
                "UPDATE copies SET status = 'borrowed' WHERE id = ?",
                (copy_row["id"],),
            )
            if req_id:
                conn.execute(
                    """
                    UPDATE borrow_requests
                    SET status = 'fulfilled', resolved_at = ?, handled_by = ?
                    WHERE id = ?
                    """,
                    (issued_iso, librarian["id"], req_id),
                )

            conn.execute(
                """
                INSERT INTO loans (id, user_id, copy_id, book_id, request_id, issued_by, issued_at, due_at, returned_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    loan_id,
                    reader_row["id"],
                    copy_row["id"],
                    target_book_id,
                    req_id,
                    librarian["id"],
                    issued_iso,
                    due_iso,
                ),
            )

            # Kiểm thử rollback khi lỗi xảy ra giữa giao dịch (TC13)
            if simulate_fail:
                conn.execute("ROLLBACK;")
                raise HTTPException(
                    status_code=500,
                    detail="Lỗi mô phỏng giữa giao dịch — thực hiện rollback toàn bộ, không sinh phiếu mồ côi (TC13).",
                )

            log_audit_entry(
                conn=conn,
                actor_id=librarian["id"],
                actor_name=librarian["name"],
                action="ISSUE_LOAN",
                entity_type="loan",
                entity_id=loan_id,
                detail=f"Giao bản sao {copy_row['copy_code']} cho {reader_row['reader_code']} (hạn trả {format_date_vi(due_iso)})",
                timestamp=issued_iso,
            )
            conn.execute("COMMIT;")

            created_loan = conn.execute("SELECT * FROM loans WHERE id = ?", (loan_id,)).fetchone()
            loan_view = _to_loan_view(conn, created_loan, now=issued_dt)
        except HTTPException:
            raise
        except Exception as exc:
            try:
                conn.execute("ROLLBACK;")
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=f"Giao dịch thất bại và đã được rollback: {exc}") from exc
        finally:
            conn.close()

    return {**loan_view, "loan": loan_view}


@app.post("/loans/{loan_id}/return")
def api_return_loan(
    loan_id: str,
    payload: LoanReturnPayload | None = None,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    """
    Xác nhận trả sách tại quầy (T22, TC14, TC15, TC16):
    - Chống trả lặp lần 2 trên cùng phiếu mượn -> 409 Conflict (TC14).
    - Hỗ trợ gắn cờ mark_maintenance=True + condition_note để chuyển bản sao sang 'maintenance' (TC15).
    """
    _ensure_initialized()
    body = payload or LoanReturnPayload()
    mark_maint = bool(
        body.markMaintenance
        if body.markMaintenance is not None
        else (body.maintenance if body.maintenance is not None else body.mark_maintenance)
    )
    raw_note = (
        body.conditionNote
        if body.conditionNote is not None
        else (body.condition_note if body.condition_note is not None else body.return_note)
    )
    clean_note = validate_no_xss(raw_note, "condition_note") if raw_note is not None else ""

    with ISSUE_LOCK:
        conn = get_connection()
        try:
            conn.isolation_level = None
            conn.execute("BEGIN IMMEDIATE;")

            loan_row = conn.execute("SELECT * FROM loans WHERE id = ?", (loan_id,)).fetchone()
            if not loan_row:
                conn.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail="Không tìm thấy phiếu mượn.")

            if loan_row["returned_at"] is not None:
                conn.execute("ROLLBACK;")
                raise HTTPException(
                    status_code=409,
                    detail=f"Phiếu mượn {loan_id} đã được ghi nhận trả trước đó — không thể trả lặp lần hai (TC14).",
                )

            copy_row = conn.execute("SELECT * FROM copies WHERE id = ?", (loan_row["copy_id"],)).fetchone()
            if not copy_row:
                conn.execute("ROLLBACK;")
                raise HTTPException(status_code=404, detail="Không tìm thấy bản sao liên kết với phiếu mượn.")

            now_dt = parse_iso_datetime(body.returned_at or body.now).astimezone(timezone.utc)
            returned_iso = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            return_note = clean_note or (
                "Chuyển sang bảo trì sau khi trả" if mark_maint else "Trả sách bình thường"
            )
            next_copy_status = "maintenance" if mark_maint else "available"
            next_copy_note = (
                clean_note
                if clean_note
                else (
                    "Cần kiểm tra / bảo trì trước khi đưa lại lên kệ"
                    if mark_maint
                    else copy_row["condition_note"]
                )
            )

            conn.execute(
                "UPDATE loans SET returned_at = ?, return_note = ? WHERE id = ?",
                (returned_iso, return_note, loan_id),
            )
            conn.execute(
                "UPDATE copies SET status = ?, condition_note = ? WHERE id = ?",
                (next_copy_status, next_copy_note, copy_row["id"]),
            )
            log_audit_entry(
                conn=conn,
                actor_id=librarian["id"],
                actor_name=librarian["name"],
                action="RETURN_LOAN",
                entity_type="loan",
                entity_id=loan_id,
                detail=f"Nhận trả bản sao {copy_row['copy_code']} -> trạng thái mới: {next_copy_status}",
                timestamp=returned_iso,
            )
            conn.execute("COMMIT;")

            updated_loan = conn.execute("SELECT * FROM loans WHERE id = ?", (loan_id,)).fetchone()
            loan_view = _to_loan_view(conn, updated_loan, now=now_dt)
        except HTTPException:
            raise
        except Exception as exc:
            try:
                conn.execute("ROLLBACK;")
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=f"Lỗi khi trả sách: {exc}") from exc
        finally:
            conn.close()

    return {**loan_view, "loan": loan_view}


# ==================== 6. PERSONAL (/me/*) ENDPOINTS (TC04, TC16, TC26) ====================


@app.get("/me/loans")
def api_get_my_loans(
    now: str | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Lấy danh sách phiếu mượn của chính người dùng đang đăng nhập (TC04 - khóa chặt theo token)."""
    _ensure_initialized()
    with db_session() as conn:
        rows = conn.execute(
            "SELECT * FROM loans WHERE user_id = ? ORDER BY issued_at DESC",
            (current_user["id"],),
        ).fetchall()
        loans = [_to_loan_view(conn, r, now=now) for r in rows]

    active = [l for l in loans if l["returned_at"] is None]
    history = [l for l in loans if l["returned_at"] is not None]
    return {
        "items": loans,
        "loans": loans,
        "active_loans": active,
        "activeLoans": active,
        "loan_history": history,
        "loanHistory": history,
    }


@app.get("/me/requests")
def api_get_my_requests(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Lấy danh sách yêu cầu mượn của chính người dùng đang đăng nhập (TC04)."""
    _ensure_initialized()
    with db_session() as conn:
        rows = conn.execute(
            "SELECT * FROM borrow_requests WHERE user_id = ? ORDER BY created_at DESC",
            (current_user["id"],),
        ).fetchall()
        reqs = [_to_request_view(conn, r) for r in rows]

    return {
        "items": reqs,
        "requests": reqs,
    }


@app.get("/me/favorites")
def api_get_my_favorites(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Lấy danh sách sách yêu thích riêng biệt của từng tài khoản (TC04, TC26)."""
    _ensure_initialized()
    with db_session() as conn:
        rows = conn.execute(
            """
            SELECT b.*
            FROM favorites f
            JOIN books b ON b.id = f.book_id
            WHERE f.user_id = ? AND b.visible = 1
            ORDER BY f.created_at DESC
            """,
            (current_user["id"],),
        ).fetchall()
        books = enrich_books_bulk(conn, rows)

    return {
        "items": books,
        "favorites": books,
        "book_ids": [b["id"] for b in books],
    }


@app.post("/me/favorites/{book_id}")
def api_add_favorite(
    book_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_initialized()
    with DB_LOCK, db_session() as conn:
        book_row = conn.execute("SELECT * FROM books WHERE id = ? AND visible = 1", (book_id,)).fetchone()
        if not book_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy sách để thêm vào yêu thích.")

        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute(
            "INSERT OR IGNORE INTO favorites (user_id, book_id, created_at) VALUES (?, ?, ?)",
            (current_user["id"], book_id, now_iso),
        )
        fav_rows = conn.execute(
            """
            SELECT b.* FROM favorites f JOIN books b ON b.id = f.book_id
            WHERE f.user_id = ? AND b.visible = 1 ORDER BY f.created_at DESC
            """,
            (current_user["id"],),
        ).fetchall()
        books = enrich_books_bulk(conn, fav_rows)

    return {
        "favorited": True,
        "book_id": book_id,
        "items": books,
        "favorites": books,
    }


@app.delete("/me/favorites/{book_id}")
def api_remove_favorite(
    book_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_initialized()
    with DB_LOCK, db_session() as conn:
        conn.execute(
            "DELETE FROM favorites WHERE user_id = ? AND book_id = ?",
            (current_user["id"], book_id),
        )
        fav_rows = conn.execute(
            """
            SELECT b.* FROM favorites f JOIN books b ON b.id = f.book_id
            WHERE f.user_id = ? AND b.visible = 1 ORDER BY f.created_at DESC
            """,
            (current_user["id"],),
        ).fetchall()
        books = enrich_books_bulk(conn, fav_rows)

    return {
        "favorited": False,
        "book_id": book_id,
        "items": books,
        "favorites": books,
    }


# ==================== 7. AI SEMANTIC SEARCH, SIMILAR BOOKS & FEEDBACK (TC18..TC25) ====================


@app.get("/search/semantic")
def api_search_semantic(
    q: str | None = Query(default=None),
    query: str | None = Query(default=None),
    only_available: bool = Query(default=False),
    onlyAvailable: bool | None = Query(default=None),
    category: str | None = Query(default=None),
    top_k: int = Query(default=5, ge=1, le=20),
    limit: int | None = Query(default=None, ge=1, le=20),
    simulate_offline_error: bool | None = Query(default=None),
    simulate_error: bool | None = Query(default=None),
    simulateAiFailure: bool | None = Query(default=None),
) -> dict[str, Any]:
    _ensure_initialized()
    raw_q = q if q is not None else (query or "")
    validate_no_xss(raw_q, "query")
    eff_only_avail = bool(onlyAvailable if onlyAvailable is not None else only_available)
    eff_limit = int(limit if limit is not None else top_k)

    with db_session() as conn:
        return ai_engine.search_semantic(
            query=raw_q,
            conn=conn,
            only_available=eff_only_avail,
            category=category,
            top_k=eff_limit,
            simulate_offline_error=simulate_offline_error,
            simulate_error=simulate_error,
            simulate_ai_failure=simulateAiFailure,
        )


@app.get("/books/{book_id}/similar")
def api_get_similar_books(
    book_id: str,
    limit: int = Query(default=4, ge=1, le=20),
) -> dict[str, Any]:
    _ensure_initialized()
    with db_session() as conn:
        row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy đầu sách.")
        similar = ai_engine.get_similar_books(book_id, conn=conn, limit=limit)

    return {
        "book_id": book_id,
        "items": similar,
        "results": similar,
        "similar": similar,
    }


@app.post("/feedback")
def api_submit_feedback(
    payload: FeedbackPayload,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_initialized()
    book_id = validate_no_xss(payload.book_id or payload.bookId or "", "book_id")
    if not book_id:
        raise HTTPException(status_code=400, detail="Thiếu mã sách (book_id).")

    raw_src = payload.source_type or payload.sourceType or "similar_book"
    source_type = "semantic_search" if raw_src == "semantic_search" else "similar_book"
    context_key = validate_no_xss(
        payload.context_key or payload.contextKey or payload.query or "default",
        "context_key",
    )
    if payload.comment:
        validate_no_xss(payload.comment, "comment")
    if payload.note:
        validate_no_xss(payload.note, "note")

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    useful_int = 1 if payload.useful else 0

    with DB_LOCK, db_session() as conn:
        book_row = conn.execute("SELECT id FROM books WHERE id = ?", (book_id,)).fetchone()
        if not book_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy đầu sách để gửi phản hồi.")

        existing = conn.execute(
            """
            SELECT id FROM feedback
            WHERE user_id = ? AND book_id = ? AND source_type = ? AND context_key = ?
            """,
            (current_user["id"], book_id, source_type, context_key),
        ).fetchone()

        if existing:
            fb_id = existing["id"]
            conn.execute(
                "UPDATE feedback SET useful = ?, created_at = ? WHERE id = ?",
                (useful_int, now_iso, fb_id),
            )
        else:
            fb_id = f"FB-{secrets.token_hex(4).upper()}"
            conn.execute(
                """
                INSERT INTO feedback (id, user_id, book_id, source_type, context_key, useful, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (fb_id, current_user["id"], book_id, source_type, context_key, useful_int, now_iso),
            )

    record = {
        "id": fb_id,
        "user_id": current_user["id"],
        "book_id": book_id,
        "source_type": source_type,
        "context_key": context_key,
        "useful": bool(payload.useful),
        "created_at": now_iso,
    }
    return {**record, "feedback": record}


@app.get("/feedback")
def api_get_my_feedback(
    source_type: str | None = Query(default=None),
    context_key: str | None = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ensure_initialized()
    with db_session() as conn:
        sql = "SELECT * FROM feedback WHERE user_id = ?"
        params: list[Any] = [current_user["id"]]
        if source_type:
            sql += " AND source_type = ?"
            params.append(source_type)
        if context_key:
            sql += " AND context_key = ?"
            params.append(context_key)
        rows = conn.execute(sql, tuple(params)).fetchall()

    items = [
        {
            "id": r["id"],
            "user_id": r["user_id"],
            "book_id": r["book_id"],
            "source_type": r["source_type"],
            "context_key": r["context_key"],
            "useful": bool(r["useful"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]
    feedback_map = {item["book_id"]: item["useful"] for item in items}
    return {"items": items, "feedback_map": feedback_map}


# ==================== 8. REPORTS & CSV EXPORTS (T31, TC03, TC17) ====================


def _build_report_data(
    conn: sqlite3.Connection,
    loan_status: str | None = None,
    category: str | None = None,
    now: str | datetime | None = None,
) -> dict[str, Any]:
    visible_books = int(conn.execute("SELECT COUNT(*) FROM books WHERE visible = 1").fetchone()[0])
    hidden_books = int(conn.execute("SELECT COUNT(*) FROM books WHERE visible = 0").fetchone()[0])
    total_copies = int(conn.execute("SELECT COUNT(*) FROM copies").fetchone()[0])
    available_copies = int(
        conn.execute("SELECT COUNT(*) FROM copies WHERE status = 'available'").fetchone()[0]
    )
    borrowed_copies = int(
        conn.execute("SELECT COUNT(*) FROM copies WHERE status = 'borrowed'").fetchone()[0]
    )
    maintenance_copies = int(
        conn.execute("SELECT COUNT(*) FROM copies WHERE status = 'maintenance'").fetchone()[0]
    )
    pending_requests = int(
        conn.execute("SELECT COUNT(*) FROM borrow_requests WHERE status = 'pending'").fetchone()[0]
    )

    loan_rows = conn.execute("SELECT * FROM loans ORDER BY issued_at DESC").fetchall()
    all_loan_views = [_to_loan_view(conn, r, now=now) for r in loan_rows]
    active_loans = [l for l in all_loan_views if l["returned_at"] is None]
    overdue_loans = [l for l in active_loans if l["is_overdue"]]

    book_cat_rows = conn.execute("SELECT id, category FROM books").fetchall()
    cat_by_book = {r["id"]: r["category"] for r in book_cat_rows}

    st_filter = (loan_status or "ALL").upper()
    filtered_loans: list[dict[str, Any]] = []
    for lv in all_loan_views:
        if category and category.upper() != "ALL":
            if cat_by_book.get(lv["book_id"]) != category:
                continue
        if st_filter == "ACTIVE" and lv["returned_at"] is not None:
            continue
        if st_filter == "OVERDUE" and not lv["is_overdue"]:
            continue
        if st_filter == "RETURNED" and lv["returned_at"] is None:
            continue
        filtered_loans.append(lv)

    audit_rows = conn.execute(
        "SELECT * FROM audit_logs ORDER BY timestamp DESC, id DESC LIMIT 25"
    ).fetchall()
    audit_logs = [dict(a) for a in audit_rows]

    summary = {
        "total_visible_books": visible_books,
        "total_hidden_books": hidden_books,
        "total_copies": total_copies,
        "available_copies": available_copies,
        "borrowed_copies": borrowed_copies,
        "maintenance_copies": maintenance_copies,
        "active_loans": len(active_loans),
        "overdue_loans": len(overdue_loans),
        "pending_requests": pending_requests,
    }
    return {
        **summary,
        "summary": summary,
        "loans": filtered_loans,
        "audit_logs": audit_logs,
        "auditLogs": audit_logs,
    }


@app.get("/reports/summary")
def api_get_report_summary(
    loan_status: str | None = Query(default=None),
    loanStatus: str | None = Query(default=None),
    category: str | None = Query(default=None),
    now: str | None = Query(default=None),
    _librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    eff_status = loanStatus if loanStatus is not None else loan_status
    with db_session() as conn:
        return _build_report_data(conn, loan_status=eff_status, category=category, now=now)


@app.get("/exports/loans.csv")
def api_export_loans_csv(
    loan_status: str | None = Query(default=None),
    loanStatus: str | None = Query(default=None),
    category: str | None = Query(default=None),
    now: str | None = Query(default=None),
    _librarian: dict[str, Any] = Depends(require_librarian),
) -> Response:
    _ensure_initialized()
    eff_status = loanStatus if loanStatus is not None else loan_status
    with db_session() as conn:
        report = _build_report_data(conn, loan_status=eff_status, category=category, now=now)

    rows = [
        {
            "loan_id": l["id"],
            "reader_code": l["reader_code"],
            "reader_name": l["reader_name"],
            "book_title": l["book_title"],
            "copy_code": l["copy_code"],
            "issued_at": format_date_vi(l["issued_at"]),
            "due_at": format_date_vi(l["due_at"]),
            "returned_at": format_date_vi(l["returned_at"]) if l["returned_at"] else "Chưa trả",
            "overdue_status": (
                "Quá hạn"
                if l["is_overdue"]
                else ("Đã hoàn tất" if l["returned_at"] else "Đúng hạn")
            ),
        }
        for l in report["loans"]
    ]

    csv_content = build_csv_utf8_bom(
        rows,
        [
            ("loan_id", "Mã phiếu"),
            ("reader_code", "Mã bạn đọc"),
            ("reader_name", "Họ tên bạn đọc"),
            ("book_title", "Tên đầu sách"),
            ("copy_code", "Mã bản sao"),
            ("issued_at", "Ngày mượn"),
            ("due_at", "Hạn trả"),
            ("returned_at", "Ngày trả thực tế"),
            ("overdue_status", "Tình trạng hạn"),
        ],
    )
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="libmate_loans.csv"'},
    )


@app.get("/exports/inventory.csv")
def api_export_inventory_csv(
    _librarian: dict[str, Any] = Depends(require_librarian),
) -> Response:
    _ensure_initialized()
    with db_session() as conn:
        book_rows = conn.execute("SELECT * FROM books ORDER BY id ASC").fetchall()
        enriched = enrich_books_bulk(conn, book_rows)

    rows = [
        {
            "id": b["id"],
            "title": b["title"],
            "author": b["author"],
            "category": b["category"],
            "shelf": b["shelf"],
            "visible": "Hiển thị" if b["visible"] else "Đang ẩn",
            "total_copies": b["total_copies"],
            "available_copies": b["available_copies"],
            "borrowed_copies": b["borrowed_copies"],
            "maintenance_copies": b["maintenance_copies"],
        }
        for b in enriched
    ]

    csv_content = build_csv_utf8_bom(
        rows,
        [
            ("id", "Mã đầu sách"),
            ("title", "Tên sách"),
            ("author", "Tác giả"),
            ("category", "Chủ đề"),
            ("shelf", "Kệ sách"),
            ("visible", "Hiển thị"),
            ("total_copies", "Tổng bản sao"),
            ("available_copies", "Sẵn có"),
            ("borrowed_copies", "Đang mượn"),
            ("maintenance_copies", "Bảo trì"),
        ],
    )
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="libmate_inventory.csv"'},
    )


# ==================== 9. ADMIN BACKUP, RESTORE, REBUILD INDEX & AUDIT LOGS (TC28, TC29) ====================


@app.post("/admin/backup")
def api_admin_backup(
    payload: BackupPayload | None = None,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    custom_target = (payload.backup_path or payload.path) if payload else None
    info = backup_database(backup_path=custom_target)
    with DB_LOCK, db_session() as conn:
        log_audit_entry(
            conn=conn,
            actor_id=librarian["id"],
            actor_name=librarian["name"],
            action="BACKUP_DB",
            entity_type="book",
            entity_id="SQLITE_BACKUP",
            detail=f"Sao lưu cơ sở dữ liệu tới {info['backup_path']}",
        )
    return {"status": "ok", **info}


@app.post("/admin/restore")
def api_admin_restore(
    payload: RestorePayload,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    target = payload.backup_path or payload.path
    if not target:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp đường dẫn tệp sao lưu (backup_path).")
    if not Path(target).exists():
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tệp sao lưu: {target}")

    info = restore_database(backup_path=target)
    with DB_LOCK, db_session() as conn:
        index_info = ai_engine.sync_and_verify_embeddings(conn=conn, force_rebuild=True)
        log_audit_entry(
            conn=conn,
            actor_id=librarian["id"],
            actor_name=librarian["name"],
            action="RESTORE_DB",
            entity_type="book",
            entity_id="SQLITE_RESTORE",
            detail=f"Phục hồi cơ sở dữ liệu từ {info['restored_from']}",
        )
    return {"status": "ok", **info, "index": index_info}


@app.post("/admin/rebuild-index")
def api_admin_rebuild_index(
    payload: RebuildIndexPayload | None = None,
    librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    body = payload or RebuildIndexPayload()
    with DB_LOCK, db_session() as conn:
        if body.book_id:
            rec = ai_engine.index_book(body.book_id, conn=conn, status="ready")
            log_audit_entry(
                conn=conn,
                actor_id=librarian["id"],
                actor_name=librarian["name"],
                action="REINDEX_BOOK",
                entity_type="book",
                entity_id=body.book_id,
                detail=f"Tái lập chỉ mục vector AI cho sách {body.book_id}",
            )
            return {"status": "ready", "book": rec}

        result = ai_engine.sync_and_verify_embeddings(conn=conn, force_rebuild=body.force_rebuild)
        log_audit_entry(
            conn=conn,
            actor_id=librarian["id"],
            actor_name=librarian["name"],
            action="REBUILD_INDEX",
            entity_type="book",
            entity_id="CATALOG-100",
            detail=f"Tái lập chỉ mục toàn bộ danh mục ({result['total_indexed']} sách)",
        )
    return result


@app.get("/admin/audit-logs")
def api_admin_audit_logs(
    limit: int = Query(default=50, ge=1, le=500),
    _librarian: dict[str, Any] = Depends(require_librarian),
) -> dict[str, Any]:
    _ensure_initialized()
    with db_session() as conn:
        rows = conn.execute(
            "SELECT * FROM audit_logs ORDER BY timestamp DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        logs = [dict(r) for r in rows]

    return {
        "items": logs,
        "audit_logs": logs,
        "auditLogs": logs,
        "total": len(logs),
    }
