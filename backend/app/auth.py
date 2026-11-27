"""Xác thực tài khoản, băm mật khẩu PBKDF2-HMAC-SHA256, phân quyền vai trò và kiểm soát chống XSS (T10, T16, T35, TC01..TC04, TC27)."""

from __future__ import annotations

import re
import secrets
import sqlite3
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, HTTPException, Request

from .db import (
    add_days_iso,
    db_session,
    hash_password_pbkdf2,
    parse_iso_datetime,
    verify_password_pbkdf2,
)

XSS_PATTERNS = [
    re.compile(r"<\s*script\b", re.IGNORECASE),
    re.compile(r"<\s*/\s*script\s*>", re.IGNORECASE),
    re.compile(r"javascript\s*:", re.IGNORECASE),
    re.compile(r"\bon(?:error|load|click|mouseover|focus|blur|submit|change|input|keydown|keyup)\s*=", re.IGNORECASE),
    re.compile(r"<\s*(?:iframe|object|embed|applet|meta|link|style)\b", re.IGNORECASE),
    re.compile(r"<\s*svg\b[^>]*\bon\w+\s*=", re.IGNORECASE),
    re.compile(r"<\s*img\b[^>]*\bon\w+\s*=", re.IGNORECASE),
]


class XSSValidationError(HTTPException, ValueError):
    """Lỗi phát hiện mã độc XSS: tương thích cả pytest.raises(ValueError) lẫn FastAPI HTTPException (422)."""

    def __init__(self, detail: str = "Dữ liệu đầu vào chứa mã kịch bản không hợp lệ (chặn XSS - TC27).", status_code: int = 422):
        HTTPException.__init__(self, status_code=status_code, detail=detail)
        ValueError.__init__(self, detail)


def hash_password(password: str, salt: str | None = None) -> str:
    return hash_password_pbkdf2(password, salt=salt)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return verify_password_pbkdf2(plain_password, password_hash)


def contains_xss_payload(text: str | None) -> bool:
    if not text:
        return False
    raw = str(text)
    return any(pattern.search(raw) for pattern in XSS_PATTERNS)


def validate_no_xss(text: str | None, field_name: str = "input") -> str:
    """Kiểm tra chuỗi đầu vào và chặn ngay nếu chứa payload XSS (<script>, javascript:, onerror=...) (TC27)."""
    if text is None:
        return ""
    s = str(text).strip()
    if contains_xss_payload(s):
        raise XSSValidationError(
            detail=f"Trường '{field_name}' chứa thẻ hoặc kịch bản không hợp lệ (chặn XSS - TC27).",
            status_code=422,
        )
    return s


def sanitize_text_input(text: str | None, field_name: str = "input") -> str:
    return validate_no_xss(text, field_name=field_name)


def to_public_user(user_row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    """Chuyển đổi bản ghi người dùng sang đối tượng công khai, TUYỆT ĐỐI KHÔNG bao gồm password_hash (TC01)."""
    u = dict(user_row)
    return {
        "id": u["id"],
        "reader_code": u["reader_code"],
        "name": u["name"],
        "role": u["role"],
        "status": u["status"],
        "grade_or_dept": u.get("grade_or_dept") or "Học sinh",
    }


def authenticate_user(conn: sqlite3.Connection, reader_code: str, password: str) -> dict[str, Any]:
    clean_code = validate_no_xss(reader_code, "reader_code").upper()
    if not clean_code or not password:
        raise HTTPException(status_code=401, detail="Mã người đọc hoặc mật khẩu không đúng.")

    row = conn.execute(
        "SELECT * FROM users WHERE UPPER(reader_code) = ?",
        (clean_code,),
    ).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Mã người đọc hoặc mật khẩu không đúng.")

    if row["status"] == "locked":
        raise HTTPException(
            status_code=403,
            detail="Tài khoản này đang bị tạm khóa. Vui lòng liên hệ thủ thư tại quầy.",
        )

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    expires_at = add_days_iso(now_iso, 1)
    token = f"tok_{secrets.token_urlsafe(24)}"

    conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token, row["id"], expires_at, now_iso),
    )

    return {
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "user": to_public_user(row),
        "expires_at": expires_at,
    }


def register_public_reader(
    conn: sqlite3.Connection,
    reader_code: str,
    name: str,
    password: str,
    grade_or_dept: str | None = None,
    requested_role: str | None = None,
) -> dict[str, Any]:
    """
    Đăng ký tài khoản công khai (T10 / TC02):
    Dù payload cố tình gửi role='librarian', luôn khóa cứng role='reader'.
    """
    _ = requested_role  # Cố tình bỏ qua mọi yêu cầu nâng quyền (TC02)
    clean_code = validate_no_xss(reader_code, "reader_code").upper()
    clean_name = validate_no_xss(name, "name")
    clean_dept = validate_no_xss(grade_or_dept or "Học sinh", "grade_or_dept") or "Học sinh"

    if len(clean_code) < 4:
        raise HTTPException(status_code=400, detail="Mã người đọc phải có ít nhất 4 ký tự.")
    if not clean_name:
        raise HTTPException(status_code=400, detail="Họ và tên không được để trống.")
    if not password or len(password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có ít nhất 6 ký tự.")

    existing = conn.execute(
        "SELECT id FROM users WHERE UPPER(reader_code) = ?",
        (clean_code,),
    ).fetchone()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f'Mã người đọc "{clean_code}" đã tồn tại trong hệ thống.',
        )

    user_id = f"U-{clean_code}-{secrets.token_hex(3).upper()}"
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pw_hash = hash_password(password)

    conn.execute(
        """
        INSERT INTO users (id, reader_code, name, role, status, grade_or_dept, password_hash, created_at)
        VALUES (?, ?, ?, 'reader', 'active', ?, ?, ?)
        """,
        (user_id, clean_code, clean_name, clean_dept, pw_hash, now_iso),
    )

    created = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return to_public_user(created)


def extract_token_from_request(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    if auth_header:
        parts = auth_header.strip().split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip()
        return auth_header.strip()

    x_token = request.headers.get("X-Auth-Token") or request.headers.get("x-auth-token")
    if x_token:
        return x_token.strip()

    q_token = request.query_params.get("token")
    if q_token:
        return q_token.strip()

    return None


def verify_session_token(conn: sqlite3.Connection, token: str | None) -> dict[str, Any]:
    if not token:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ hoặc thiếu token xác thực.")

    row = conn.execute(
        """
        SELECT s.token, s.expires_at, u.*
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ?
        """,
        (token,),
    ).fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ hoặc đã đăng xuất.")

    exp_dt = parse_iso_datetime(row["expires_at"])
    now_dt = datetime.now(timezone.utc)
    if exp_dt <= now_dt:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn.")

    if row["status"] == "locked":
        raise HTTPException(status_code=403, detail="Tài khoản đang bị khóa.")

    return to_public_user(row)


def revoke_session_token(conn: sqlite3.Connection, token: str | None) -> bool:
    if not token:
        return False
    cur = conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return cur.rowcount > 0


def get_optional_user(request: Request) -> dict[str, Any] | None:
    token = extract_token_from_request(request)
    if not token:
        return None
    with db_session() as conn:
        try:
            return verify_session_token(conn, token)
        except HTTPException:
            return None


def get_current_user(request: Request) -> dict[str, Any]:
    token = extract_token_from_request(request)
    with db_session() as conn:
        return verify_session_token(conn, token)


def require_librarian(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if user.get("role") != "librarian":
        raise HTTPException(
            status_code=403,
            detail="Từ chối truy cập: Thao tác này chỉ dành cho Thủ thư (TC03).",
        )
    return user
