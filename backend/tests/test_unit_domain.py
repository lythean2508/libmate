"""
Unit tests for LibMate backend domain logic (test_unit_domain.py):
- Password hashing & verification (PBKDF2-HMAC-SHA256) & public user sanitization (TC01)
- Vietnamese accent stripping & search text normalization (TC05)
- Asia/Ho_Chi_Minh due-date and overdue boundary calculation (TC16)
- E5 passage/query prefix formatting, content_hash SHA-256 & L2 vector normalization (T28, TC20)
- Verbatim metadata excerpt extraction (AI05, T26)
- XSS payload detection & input validation (TC27, T35)
- UTF-8 BOM CSV generation (TC17, T31)
"""

from __future__ import annotations

import math
from datetime import datetime

import pytest

from backend.app import ai_engine
from backend.app.auth import (
    XSSValidationError,
    contains_xss_payload,
    hash_password,
    sanitize_text_input,
    to_public_user,
    validate_no_xss,
    verify_password,
)
from backend.app.db import (
    MODEL_REVISION,
    add_days_iso,
    build_csv_utf8_bom,
    compute_book_content_hash,
    compute_days_remaining,
    count_words,
    format_date_vi,
    hash_password_pbkdf2,
    is_loan_overdue,
    normalize_search_text,
    strip_vietnamese_accents,
    to_server_date_key,
    verify_password_pbkdf2,
)


class TestPasswordHashingAndUserSecurity:
    """Kiểm thử băm mật khẩu PBKDF2-HMAC-SHA256 và ẩn password_hash (T10, TC01)."""

    def test_pbkdf2_hash_and_verify_roundtrip(self) -> None:
        raw_pw = "libmate123"
        hashed = hash_password(raw_pw)

        assert hashed.startswith("pbkdf2_sha256$")
        parts = hashed.split("$")
        assert len(parts) == 4
        assert int(parts[1]) >= 100_000
        assert raw_pw not in hashed

        assert verify_password(raw_pw, hashed) is True
        assert verify_password("sai_mat_khau", hashed) is False
        assert verify_password("", hashed) is False
        assert verify_password(raw_pw, "") is False
        assert verify_password(raw_pw, "invalid_hash_format") is False

    def test_pbkdf2_random_salts_produce_distinct_verifiable_hashes(self) -> None:
        h1 = hash_password_pbkdf2("reader123")
        h2 = hash_password_pbkdf2("reader123")
        assert h1 != h2
        assert verify_password_pbkdf2("reader123", h1) is True
        assert verify_password_pbkdf2("reader123", h2) is True

    def test_to_public_user_never_exposes_password_hash_tc01(self) -> None:
        db_user_row = {
            "id": "U-RDR-01",
            "reader_code": "HS10A1",
            "name": "Nguyễn Minh Anh",
            "role": "reader",
            "status": "active",
            "grade_or_dept": "Lớp 10A1",
            "password_hash": hash_password("reader123"),
        }
        public_user = to_public_user(db_user_row)
        assert "password_hash" not in public_user
        assert "password" not in public_user
        assert public_user["reader_code"] == "HS10A1"
        assert public_user["role"] == "reader"


class TestVietnameseNormalization:
    """Kiểm thử khử dấu tiếng Việt Unicode NFD + đ/Đ -> d/D (TC05)."""

    def test_strip_vietnamese_accents_handles_all_diacritics_and_d_stroke(self) -> None:
        assert strip_vietnamese_accents("Mắt Biếc") == "Mat Biec"
        assert strip_vietnamese_accents("Nguyễn Nhật Ánh") == "Nguyen Nhat Anh"
        assert strip_vietnamese_accents("Đất Rừng Phương Nam") == "Dat Rung Phuong Nam"
        assert strip_vietnamese_accents("đồng hồ Điện Biên Phủ") == "dong ho Dien Bien Phu"
        assert strip_vietnamese_accents("") == ""

    def test_normalize_search_text_lowercases_and_cleans_punctuation(self) -> None:
        assert normalize_search_text("  Mắt   Biếc! (Nguyễn Nhật Ánh) ") == "mat biec nguyen nhat anh"
        assert normalize_search_text("Tắt Đèn - Ngô Tất Tố") == "tat den ngo tat to"
        assert ai_engine.normalize_search_text("Dế Mèn Phiêu Lưu Ký") == "de men phieu luu ky"

    def test_count_words_accurately_counts_vietnamese_words(self) -> None:
        sample = "Câu chuyện tuổi học trò đầy hoài niệm về mối tình đơn phương trong trẻo."
        assert count_words(sample) == 15
        assert count_words("   ") == 0
        assert count_words(None) == 0


class TestHoChiMinhOverdueBoundaryTC16:
    """
    Kiểm thử ranh giới ngày đến hạn và quá hạn theo múi giờ máy chủ Asia/Ho_Chi_Minh (TC16):
    - Đúng ngày hạn trả (2026-12-15) -> CHƯA quá hạn (is_overdue = False, days_remaining = 0)
    - Sang ngày hôm sau (2026-12-16) -> QUÁ HẠN (is_overdue = True, days_remaining = -1)
    """

    def test_due_date_boundary_asia_ho_chi_minh_tc16(self) -> None:
        issued_at = "2026-12-01T10:00:00+07:00"
        due_at = add_days_iso(issued_at, 14)

        # Kiểm tra ngày hạn trả theo múi giờ Việt Nam là 2026-12-15
        assert to_server_date_key(due_at) == "2026-12-15"
        assert format_date_vi(due_at) == "15/12/2026"

        # 1. Trước ngày đến hạn (2026-12-14): còn 1 ngày, chưa quá hạn
        before_due = datetime.fromisoformat("2026-12-14T15:30:00+07:00")
        assert compute_days_remaining(due_at, now=before_due) == 1
        assert is_loan_overdue(due_at, returned_at_iso=None, now=before_due) is False

        # 2. Đúng ngày đến hạn (2026-12-15 lúc 22:00 tối và 23:59:59 tối giờ VN): CHƯA quá hạn (TC16)
        on_due_evening = datetime.fromisoformat("2026-12-15T22:00:00+07:00")
        on_due_late = datetime.fromisoformat("2026-12-15T23:59:59+07:00")
        assert compute_days_remaining(due_at, now=on_due_evening) == 0
        assert is_loan_overdue(due_at, returned_at_iso=None, now=on_due_evening) is False
        assert is_loan_overdue(due_at, returned_at_iso=None, now=on_due_late) is False

        # 3. Qua ngày hôm sau theo giờ VN (2026-12-16 lúc 00:05 sáng và 08:00 sáng): QUÁ HẠN (TC16)
        next_day_early = datetime.fromisoformat("2026-12-16T00:05:00+07:00")
        next_day_morning = datetime.fromisoformat("2026-12-16T08:00:00+07:00")
        assert compute_days_remaining(due_at, now=next_day_early) == -1
        assert is_loan_overdue(due_at, returned_at_iso=None, now=next_day_early) is True
        assert is_loan_overdue(due_at, returned_at_iso=None, now=next_day_morning) is True

        # 4. Nếu phiếu đã trả (returned_at != None) thì không còn gắn cờ đang quá hạn
        assert is_loan_overdue(
            due_at,
            returned_at_iso="2026-12-15T16:00:00+07:00",
            now=next_day_morning,
        ) is False

    def test_utc_timestamp_crossing_midnight_in_vietnam_timezone(self) -> None:
        # 2026-12-15T17:30:00Z tương đương 2026-12-16T00:30:00+07:00 tại Việt Nam
        due_at = "2026-12-15T03:00:00Z"  # 2026-12-15 10:00+07:00
        now_utc_after_vn_midnight = "2026-12-15T17:30:00Z"  # 2026-12-16 00:30+07:00
        assert to_server_date_key(now_utc_after_vn_midnight) == "2026-12-16"
        assert is_loan_overdue(due_at, returned_at_iso=None, now=now_utc_after_vn_midnight) is True


class TestEmbeddingsContentHashAndL2Normalization:
    """Kiểm thử tiền tố E5, mã băm content_hash SHA-256 và chuẩn hóa vector L2 (T28, TC20)."""

    def test_e5_passage_and_query_prefix_formatting(self) -> None:
        book = {
            "title": "Mắt Biếc",
            "category": "Văn học Việt Nam",
            "author": "Nguyễn Nhật Ánh",
            "description": "Câu chuyện tuổi học trò tại làng Đo Đo.",
        }
        passage = ai_engine.format_passage(book)
        assert passage.startswith("passage: ")
        assert "Mắt Biếc" in passage
        assert "Chủ đề: Văn học Việt Nam" in passage
        assert "Tác giả: Nguyễn Nhật Ánh" in passage
        assert "Mô tả: Câu chuyện tuổi học trò tại làng Đo Đo." in passage

        q1 = ai_engine.format_query("sách tâm lý giảm căng thẳng mùa thi")
        q2 = ai_engine.format_query("query: sách tâm lý giảm căng thẳng mùa thi")
        assert q1 == "query: sách tâm lý giảm căng thẳng mùa thi"
        assert q2 == q1

    def test_content_hash_determinism_and_change_sensitivity_tc20(self) -> None:
        base_book = {
            "title": "Tắt Đèn",
            "author": "Ngô Tất Tố",
            "category": "Văn học Việt Nam",
            "description": "Bức tranh hiện thực về chị Dậu giữa mùa sưu thuế.",
        }
        h1 = ai_engine.compute_content_hash(base_book)
        h2 = compute_book_content_hash(base_book)
        assert len(h1) == 64
        assert h1 == h2

        # Khi sửa mô tả, tiêu đề, tác giả, chủ đề hoặc model_revision -> content_hash phải đổi ngay
        edited_desc = {**base_book, "description": "Mô tả mới đã được thủ thư cập nhật."}
        edited_title = {**base_book, "title": "Tắt Đèn (Bản Mới)"}
        assert ai_engine.compute_content_hash(edited_desc) != h1
        assert ai_engine.compute_content_hash(edited_title) != h1
        assert ai_engine.compute_content_hash(base_book, model_revision="e5-small-local-v2") != h1

    def test_l2_normalization_for_dense_and_sparse_vectors(self) -> None:
        raw_dense = [3.0, 4.0, 0.0, -12.0]
        norm_dense = ai_engine.l2_normalize(raw_dense)
        assert isinstance(norm_dense, list)
        l2_len = math.sqrt(sum(x * x for x in norm_dense))
        assert math.isclose(l2_len, 1.0, rel_tol=1e-6)
        assert math.isclose(ai_engine.cosine_similarity(norm_dense, norm_dense), 1.0, rel_tol=1e-6)

        raw_sparse = {"lo_den": 3.0, "vu_tru": 4.0}
        norm_sparse = ai_engine.l2_normalize(raw_sparse)
        assert isinstance(norm_sparse, dict)
        sparse_len = math.sqrt(sum(v * v for v in norm_sparse.values()))
        assert math.isclose(sparse_len, 1.0, rel_tol=1e-6)
        assert math.isclose(norm_sparse["lo_den"], 0.6, rel_tol=1e-6)
        assert math.isclose(norm_sparse["vu_tru"], 0.8, rel_tol=1e-6)

        # Zero vector không gây lỗi chia cho 0
        zero_dense = ai_engine.l2_normalize([0.0, 0.0, 0.0])
        assert zero_dense == [0.0, 0.0, 0.0]

    def test_encode_passage_and_query_produce_384d_unit_l2_vectors(self) -> None:
        book = {
            "title": "Lược Sử Thời Gian",
            "author": "Stephen Hawking",
            "category": "Khoa học tự nhiên",
            "description": "Giải thích dễ hiểu về lỗ đen vũ trụ, vụ nổ Big Bang và bản chất thời gian.",
        }
        p_vec = ai_engine.encode_passage(book)
        q_vec = ai_engine.encode_query("Sách giải thích về lỗ đen vũ trụ và Big Bang")

        assert len(p_vec) == ai_engine.EMBEDDING_DIM == 384
        assert len(q_vec) == ai_engine.EMBEDDING_DIM == 384
        assert math.isclose(sum(x * x for x in p_vec), 1.0, rel_tol=1e-5)
        assert math.isclose(sum(x * x for x in q_vec), 1.0, rel_tol=1e-5)
        assert ai_engine.cosine_similarity(p_vec, q_vec) > 0.25


class TestVerbatimExcerptAndCsvAndXssSanitizer:
    """Kiểm thử trích xuất nguyên văn câu mô tả (AI05), xuất CSV UTF-8 BOM (TC17) và chặn XSS (TC27)."""

    def test_extract_verbatim_excerpt_never_fabricates_outside_description_ai05(self) -> None:
        description = (
            "Cẩm nang tâm lý gần gũi giúp học sinh trung học nhận diện dấu hiệu căng thẳng lo âu mùa thi. "
            "Sách hướng dẫn các bài tập hít thở sâu, lập kế hoạch ôn tập vừa sức và giữ giấc ngủ điều độ. "
            "Phù hợp cho học sinh lớp 9 đến lớp 12 đọc tham khảo trước kỳ thi học kỳ."
        )
        book = {
            "id": "B074",
            "title": "Vượt Qua Áp Lực Thi Cử",
            "author": "Nhiều tác giả",
            "category": "Kỹ năng sống & Tâm lý",
            "description": description,
        }
        query = "Em hay bị căng thẳng lo âu mùa thi và muốn học bài tập hít thở sâu"

        excerpt1 = ai_engine.extract_verbatim_excerpt(query, book)
        excerpt2 = ai_engine.extract_verbatim_excerpt(book, query)
        excerpt3 = ai_engine.extract_verbatim_excerpt(query, description)
        reason = ai_engine.build_metadata_reason(query, book)

        assert excerpt1 in description
        assert excerpt2 == excerpt1
        assert excerpt3 in description
        assert reason["excerpt"] in description
        assert "description" in reason["matched_fields"]

    def test_xss_sanitizer_blocks_malicious_payloads_tc27(self) -> None:
        # Văn bản tiếng Việt hợp lệ đi qua bình thường
        clean = validate_no_xss("Sách Toán Hình học & Giải tích lớp 12 (Tập 1)", "title")
        assert clean == "Sách Toán Hình học & Giải tích lớp 12 (Tập 1)"
        assert sanitize_text_input("  Nguyễn Nhật Ánh  ", "author") == "Nguyễn Nhật Ánh"
        assert contains_xss_payload("Sách lịch sử Việt Nam") is False

        malicious_payloads = [
            "<script>alert('xss')</script>",
            "<SCRIPT SRC=http://evil.local/xss.js></SCRIPT>",
            "javascript:alert(document.cookie)",
            "<img src=x onerror=alert(1)>",
            "<svg onload=fetch('http://evil.local')>",
            "<iframe src='https://evil.local'></iframe>",
            "Bình luận <a href='javascript:void(0)' onclick='steal()'>click</a>",
        ]
        for payload in malicious_payloads:
            assert contains_xss_payload(payload) is True
            with pytest.raises(XSSValidationError) as exc_info:
                validate_no_xss(payload, field_name="description")
            assert exc_info.value.status_code == 422

    def test_build_csv_utf8_bom_tc17(self) -> None:
        rows = [
            {
                "loan_id": "LN-0001",
                "book_title": 'Mắt Biếc, "Bản Đặc Biệt"',
                "status": "Quá hạn",
            }
        ]
        csv_text = build_csv_utf8_bom(
            rows,
            [
                ("loan_id", "Mã phiếu"),
                ("book_title", "Tên đầu sách"),
                ("status", "Tình trạng"),
            ],
        )
        assert csv_text.startswith("\ufeff")
        assert "Mã phiếu,Tên đầu sách,Tình trạng" in csv_text
        assert 'LN-0001,"Mắt Biếc, ""Bản Đặc Biệt""",Quá hạn' in csv_text
