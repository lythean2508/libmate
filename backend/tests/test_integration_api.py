"""
Integration tests for LibMate FastAPI REST endpoints (test_integration_api.py):
- Auth & Role Security (TC01, TC02, TC03, TC04, T16)
- Catalog Search & Pagination (TC05, TC06)
- Librarian Book & Copy Management (TC07 duplicate copy_code -> 409, TC08 soft-hide book with loan history)
- Borrow Requests (TC09 duplicate pending blocked, TC10 cancel pending vs fulfilled)
- Issue & Return Desk (TC12 borrow limit 3 at issue time, TC13 mid-transaction failure rollback,
  TC14 double return blocked, TC15 return to maintenance, TC16 Asia/Ho_Chi_Minh due-date boundary via API)
- Reports & UTF-8 BOM CSV exports (TC17)
- Similar Books, Recommendation Feedback & Favorites isolation per user (TC25, TC26)
- API-level XSS payload rejection (TC27)
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import ai_engine
from backend.app.db import reset_db, set_db_path
from backend.app.main import app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """Khởi tạo cơ sở dữ liệu SQLite độc lập cho mỗi test case với đầy đủ dữ liệu seed chuẩn."""
    test_db = tmp_path / "test_libmate_integration.db"
    set_db_path(test_db)
    reset_db(test_db)
    ai_engine.set_simulate_offline_error(False)
    with TestClient(app) as c:
        yield c
    set_db_path(None)


def login_headers(client: TestClient, reader_code: str, password: str) -> dict[str, str]:
    resp = client.post("/auth/login", json={"reader_code": reader_code, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["token"]
    return {"Authorization": f"Bearer {token}"}


class TestAuthAndSecurityTC01ToTC04:
    """Kiểm thử xác thực, phân quyền và cô lập dữ liệu tài khoản (TC01, TC02, TC03, TC04, T16)."""

    def test_tc01_login_wrong_password_logout_and_no_password_hash(self, client: TestClient) -> None:
        # 1. Đăng nhập sai mật khẩu trả 401
        bad = client.post("/auth/login", json={"reader_code": "HS10A1", "password": "wrong_password"})
        assert bad.status_code == 401
        assert "không đúng" in bad.json()["detail"].lower()

        # 2. Đăng nhập đúng trả token & user tuyệt đối không chứa password_hash
        ok = client.post("/auth/login", json={"reader_code": "HS10A1", "password": "reader123"})
        assert ok.status_code == 200
        body = ok.json()
        assert "token" in body
        assert "password_hash" not in body
        assert "password_hash" not in body["user"]
        assert body["user"]["reader_code"] == "HS10A1"
        assert body["user"]["role"] == "reader"

        headers = {"Authorization": f"Bearer {body['token']}"}
        me = client.get("/auth/me", headers=headers)
        assert me.status_code == 200
        assert "password_hash" not in me.json()

        # 3. Đăng xuất hủy hiệu lực token ngay lập tức
        out = client.post("/auth/logout", headers=headers)
        assert out.status_code == 200
        assert out.json()["revoked"] is True

        after_logout = client.get("/auth/me", headers=headers)
        assert after_logout.status_code == 401
        loans_after_logout = client.get("/me/loans", headers=headers)
        assert loans_after_logout.status_code == 401

    def test_t16_locked_account_hskhoa_rejected_on_login(self, client: TestClient) -> None:
        locked = client.post("/auth/login", json={"reader_code": "HSKHOA", "password": "reader123"})
        assert locked.status_code == 403
        assert "khóa" in locked.json()["detail"].lower()

    def test_tc02_public_register_forces_reader_role(self, client: TestClient) -> None:
        reg = client.post(
            "/auth/register",
            json={
                "reader_code": "HS99Z9",
                "name": "Học Sinh Thử Leo Thang Quyền",
                "password": "password123",
                "grade_or_dept": "Lớp 12A1",
                "role": "librarian",  # Cố tình truyền librarian
            },
        )
        assert reg.status_code == 200
        data = reg.json()
        assert data["role"] == "reader"
        assert data["user"]["role"] == "reader"
        assert "password_hash" not in data

        # Tài khoản vừa đăng ký không thể gọi API thủ thư
        headers = login_headers(client, "HS99Z9", "password123")
        forbidden = client.get("/reports/summary", headers=headers)
        assert forbidden.status_code == 403

    def test_tc03_reader_blocked_from_all_librarian_endpoints(self, client: TestClient) -> None:
        rdr_headers = login_headers(client, "HS10A1", "reader123")

        assert client.post(
            "/books",
            headers=rdr_headers,
            json={
                "title": "Sách Trái Phép",
                "author": "Tác giả",
                "category": "Văn học Việt Nam",
                "shelf": "A1-99",
                "description": "Mô tả",
            },
        ).status_code == 403

        assert client.patch("/books/B001", headers=rdr_headers, json={"visible": False}).status_code == 403
        assert client.post("/copies", headers=rdr_headers, json={"book_id": "B001", "copy_code": "NEW-01"}).status_code == 403
        assert client.post("/loans/issue", headers=rdr_headers, json={"request_id": "REQ-0004", "copy_id": "CP-B071-A"}).status_code == 403
        assert client.post("/loans/LN-0001/return", headers=rdr_headers, json={}).status_code == 403
        assert client.get("/reports/summary", headers=rdr_headers).status_code == 403
        assert client.get("/exports/loans.csv", headers=rdr_headers).status_code == 403
        assert client.get("/exports/inventory.csv", headers=rdr_headers).status_code == 403
        assert client.post("/admin/backup", headers=rdr_headers).status_code == 403
        assert client.get("/admin/audit-logs", headers=rdr_headers).status_code == 403

    def test_tc04_me_endpoints_strictly_isolated_by_session_token(self, client: TestClient) -> None:
        h_hs10 = login_headers(client, "HS10A1", "reader123")
        h_hs11 = login_headers(client, "HS11B2", "reader123")

        # Dù truyền query param user_id của người khác, /me/loans chỉ trả về phiếu của chủ token
        loans_hs11 = client.get("/me/loans?user_id=U-RDR-01", headers=h_hs11)
        assert loans_hs11.status_code == 200
        items_11 = loans_hs11.json()["items"]
        assert len(items_11) == 1
        assert all(l["user_id"] == "U-RDR-02" for l in items_11)

        # HS11B2 không được phép hủy yêu cầu REQ-0004 của HS10A1
        cancel_other = client.post("/borrow-requests/REQ-0004/cancel", headers=h_hs11)
        assert cancel_other.status_code == 403

        # HS10A1 xem đúng yêu cầu của mình
        reqs_hs10 = client.get("/me/requests", headers=h_hs10).json()["items"]
        assert all(r["user_id"] == "U-RDR-01" for r in reqs_hs10)


class TestCatalogAndLibrarianInventoryTC05ToTC08:
    """Kiểm thử tìm kiếm danh mục có dấu/không dấu, phân trang và quản lý kho sách/bản sao (TC05..TC08)."""

    def test_tc05_search_books_accented_and_unaccented_vietnamese(self, client: TestClient) -> None:
        r_accented = client.get("/books", params={"query": "Mắt Biếc"})
        r_unaccented = client.get("/books", params={"query": "mat biec"})
        r_author = client.get("/books", params={"query": "nguyen nhat anh"})

        assert r_accented.status_code == 200
        assert r_unaccented.status_code == 200
        assert r_author.status_code == 200

        ids_accented = [b["id"] for b in r_accented.json()["items"]]
        ids_unaccented = [b["id"] for b in r_unaccented.json()["items"]]
        ids_author = [b["id"] for b in r_author.json()["items"]]

        assert "B001" in ids_accented
        assert "B001" in ids_unaccented
        assert "B001" in ids_author and "B002" in ids_author

    def test_tc06_empty_catalog_and_pagination_preserving_category_filter(self, client: TestClient) -> None:
        empty = client.get("/books", params={"query": "chuoi_khong_ton_tai_xyz_999"})
        assert empty.status_code == 200
        assert empty.json()["total"] == 0
        assert empty.json()["items"] == []

        p1 = client.get("/books", params={"category": "Văn học Việt Nam", "page": 1, "page_size": 5})
        p2 = client.get("/books", params={"category": "Văn học Việt Nam", "page": 2, "page_size": 5})
        assert p1.status_code == 200 and p2.status_code == 200

        d1, d2 = p1.json(), p2.json()
        assert d1["total"] == 12
        assert len(d1["items"]) == 5
        assert len(d2["items"]) == 5
        assert all(b["category"] == "Văn học Việt Nam" for b in d2["items"])
        assert {b["id"] for b in d1["items"]}.isdisjoint({b["id"] for b in d2["items"]})

    def test_tc07_duplicate_copy_code_returns_409_with_field_indication(self, client: TestClient) -> None:
        lib_headers = login_headers(client, "LIB001", "libmate123")

        # VHVN-001-A đã tồn tại trong seed -> gửi chữ thường 'vhvn-001-a' vẫn phải chặn 409
        dup = client.post(
            "/copies",
            headers=lib_headers,
            json={"book_id": "B001", "copy_code": "vhvn-001-a"},
        )
        assert dup.status_code == 409
        assert "copy_code" in str(dup.json()["detail"])

        # Mã bản sao mới duy nhất tạo thành công
        ok = client.post(
            "/copies",
            headers=lib_headers,
            json={"book_id": "B001", "copy_code": "VHVN-001-Z"},
        )
        assert ok.status_code == 201
        assert ok.json()["copy_code"] == "VHVN-001-Z"

    def test_tc08_hide_book_with_loan_history_preserves_loans_and_hides_from_search(self, client: TestClient) -> None:
        lib_headers = login_headers(client, "LIB001", "libmate123")

        # Ẩn B001 (Mắt Biếc - đang có phiếu mượn LN-0001)
        patch_resp = client.patch("/books/B001", headers=lib_headers, json={"visible": False})
        assert patch_resp.status_code == 200
        assert patch_resp.json()["visible"] is False

        # Không còn xuất hiện ở danh mục công khai, chi tiết công khai, tìm kiếm AI và sách tương tự
        cat = client.get("/books", params={"query": "Mắt Biếc"}).json()
        assert all(b["id"] != "B001" for b in cat["items"])

        assert client.get("/books/B001").status_code == 404

        sem = client.get("/search/semantic", params={"q": "tình cảm học trò đơn phương làng Đo Đo"}).json()
        assert all(r["book_id"] != "B001" for r in sem["results"])

        sim = client.get("/books/B002/similar").json()
        assert all(b["id"] != "B001" for b in sim["items"])

        # Nhưng lịch sử phiếu mượn LN-0001 vẫn còn nguyên vẹn trong báo cáo thủ thư
        rep = client.get("/reports/summary", headers=lib_headers).json()
        assert any(l["id"] == "LN-0001" and l["book_id"] == "B001" for l in rep["loans"])


class TestBorrowRequestsAndDeskTransactionsTC09ToTC16:
    """Kiểm thử đặt mượn, hủy yêu cầu, giới hạn 3 cuốn, rollback lỗi, trả sách & bảo trì (TC09..TC16)."""

    def test_tc09_and_tc10_duplicate_pending_blocked_and_cancel_rules(self, client: TestClient) -> None:
        rdr_headers = login_headers(client, "HS10A1", "reader123")

        # TC09: HS10A1 đã có REQ-0004 đang pending cho B071 -> gửi trùng bị chặn 409
        dup_req = client.post("/borrow-requests", headers=rdr_headers, json={"book_id": "B071"})
        assert dup_req.status_code == 409

        # TC10: Không thể hủy yêu cầu đã giao (REQ-0001 có status='fulfilled') -> 400
        cancel_fulfilled = client.post("/borrow-requests/REQ-0001/cancel", headers=rdr_headers)
        assert cancel_fulfilled.status_code == 400

        # TC10: Hủy yêu cầu đang chờ (REQ-0004 có status='pending') -> thành công
        cancel_pending = client.post("/borrow-requests/REQ-0004/cancel", headers=rdr_headers)
        assert cancel_pending.status_code == 200
        assert cancel_pending.json()["status"] == "cancelled"

    def test_tc12_borrow_limit_3_enforced_at_issue_time(self, client: TestClient) -> None:
        lib_headers = login_headers(client, "LIB001", "libmate123")
        rdr_headers = login_headers(client, "HS10A1", "reader123")

        # HS10A1 hiện có 2 phiếu đang mượn (LN-0001, LN-0002) và 1 yêu cầu pending REQ-0004 (B071).
        # Trước khi nhận B071, HS10A1 gửi thêm 1 yêu cầu pending cho B003 (khi vẫn mới chỉ có 2 phiếu active).
        req_4th = client.post("/borrow-requests", headers=rdr_headers, json={"book_id": "B003"})
        assert req_4th.status_code == 201
        req_4th_id = req_4th.json()["id"]

        # Thủ thư giao cuốn thứ 3 (REQ-0004 -> CP-B071-A): thành công (đạt 3/3 cuốn)
        issue_3rd = client.post(
            "/loans/issue",
            headers=lib_headers,
            json={"request_id": "REQ-0004", "copy_id": "CP-B071-A"},
        )
        assert issue_3rd.status_code == 200

        # Thủ thư cố giao cuốn thứ 4 (req_4th_id -> CP-B003-A): bị chặn ngay tại thời điểm giao (TC12 -> 409)
        issue_4th = client.post(
            "/loans/issue",
            headers=lib_headers,
            json={"request_id": req_4th_id, "copy_id": "CP-B003-A"},
        )
        assert issue_4th.status_code == 409
        assert "3/3" in issue_4th.json()["detail"] or "giới hạn" in issue_4th.json()["detail"].lower()

        # Bản sao CP-B003-A vẫn giữ nguyên trạng thái available
        b003 = client.get("/books/B003").json()
        assert b003["available_copies"] == 2

    def test_tc13_mid_transaction_failure_rolls_back_atomically(self, client: TestClient) -> None:
        lib_headers = login_headers(client, "LIB001", "libmate123")

        before_b071 = client.get("/books/B071").json()
        before_avail = before_b071["available_copies"]
        before_loans_cnt = len(client.get("/reports/summary", headers=lib_headers).json()["loans"])

        fail_resp = client.post(
            "/loans/issue",
            headers=lib_headers,
            json={
                "request_id": "REQ-0004",
                "copy_id": "CP-B071-A",
                "simulate_failure": True,
            },
        )
        assert fail_resp.status_code == 500
        assert "rollback" in fail_resp.json()["detail"].lower()

        # Kiểm tra không có phiếu mượn mồ côi, bản sao vẫn available, yêu cầu vẫn pending
        after_b071 = client.get("/books/B071").json()
        assert after_b071["available_copies"] == before_avail
        copy_a = next(c for c in after_b071["copies"] if c["id"] == "CP-B071-A")
        assert copy_a["status"] == "available"

        after_loans_cnt = len(client.get("/reports/summary", headers=lib_headers).json()["loans"])
        assert after_loans_cnt == before_loans_cnt

    def test_tc14_tc15_and_tc16_return_maintenance_double_return_and_overdue_api(self, client: TestClient) -> None:
        lib_headers = login_headers(client, "LIB001", "libmate123")
        rdr2_headers = login_headers(client, "HS11B2", "reader123")

        # Giao sách REQ-0005 (B031, CP-B031-A) cho HS11B2 vào ngày 2026-12-01T10:00:00+07:00 (hạn trả 2026-12-15)
        issue_resp = client.post(
            "/loans/issue",
            headers=lib_headers,
            json={
                "request_id": "REQ-0005",
                "copy_id": "CP-B031-A",
                "issued_at": "2026-12-01T10:00:00+07:00",
            },
        )
        assert issue_resp.status_code == 200
        loan_id = issue_resp.json()["id"]

        # TC16 qua API: đúng ngày hạn trả 2026-12-15 chưa quá hạn; sang ngày 2026-12-16 quá hạn
        on_due = client.get(
            "/me/loans",
            headers=rdr2_headers,
            params={"now": "2026-12-15T22:00:00+07:00"},
        ).json()["active_loans"]
        target_on_due = next(l for l in on_due if l["id"] == loan_id)
        assert target_on_due["is_overdue"] is False

        after_due = client.get(
            "/me/loans",
            headers=rdr2_headers,
            params={"now": "2026-12-16T08:00:00+07:00"},
        ).json()["active_loans"]
        target_after_due = next(l for l in after_due if l["id"] == loan_id)
        assert target_after_due["is_overdue"] is True

        # TC15: Trả sách kèm đánh dấu bảo trì (mark_maintenance=True)
        b031_while_borrowed = client.get("/books/B031").json()
        avail_while_borrowed = b031_while_borrowed["available_copies"]
        maint_while_borrowed = b031_while_borrowed["maintenance_copies"]

        ret1 = client.post(
            f"/loans/{loan_id}/return",
            headers=lib_headers,
            json={
                "mark_maintenance": True,
                "condition_note": "Bung gáy cần dán keo bảo trì",
            },
        )
        assert ret1.status_code == 200
        assert ret1.json()["copy_status"] == "maintenance"

        b031_after_return = client.get("/books/B031").json()
        assert b031_after_return["available_copies"] == avail_while_borrowed
        assert b031_after_return["maintenance_copies"] == maint_while_borrowed + 1

        # Bản sao đang maintenance không thể đem giao cho người khác
        issue_maint = client.post(
            "/loans/issue",
            headers=lib_headers,
            json={"reader_code": "HS12C3", "copy_id": "CP-B031-A"},
        )
        assert issue_maint.status_code == 409

        # TC14: Trả lặp lần 2 trên cùng phiếu mượn bị chặn với 409 Conflict
        ret2 = client.post(f"/loans/{loan_id}/return", headers=lib_headers, json={})
        assert ret2.status_code == 409


class TestReportsCsvFavoritesFeedbackAndXssTC17TC25TC26TC27:
    """Kiểm thử báo cáo thống kê, xuất CSV UTF-8 BOM, sách tương tự, feedback, yêu thích và chặn XSS (TC17, TC25, TC26, TC27)."""

    def test_tc17_reports_summary_and_utf8_bom_csv_exports(self, client: TestClient) -> None:
        lib_headers = login_headers(client, "LIB001", "libmate123")

        rep = client.get("/reports/summary", headers=lib_headers)
        assert rep.status_code == 200
        summary = rep.json()["summary"]

        assert summary["total_visible_books"] == 100
        assert summary["total_copies"] == 201
        assert summary["borrowed_copies"] == 3
        assert summary["maintenance_copies"] == 2
        assert summary["available_copies"] == 196
        assert summary["active_loans"] == 3
        assert summary["overdue_loans"] == 1
        assert summary["pending_requests"] == 2

        loans_csv = client.get("/exports/loans.csv", headers=lib_headers, params={"loan_status": "OVERDUE"})
        assert loans_csv.status_code == 200
        assert loans_csv.text.startswith("\ufeff")
        assert "Mắt Biếc" in loans_csv.text
        assert "Quá hạn" in loans_csv.text

        inv_csv = client.get("/exports/inventory.csv", headers=lib_headers)
        assert inv_csv.status_code == 200
        assert inv_csv.text.startswith("\ufeff")
        assert "Mã đầu sách,Tên sách,Tác giả" in inv_csv.text

    def test_tc25_similar_books_and_per_user_feedback_isolation(self, client: TestClient) -> None:
        h_hs10 = login_headers(client, "HS10A1", "reader123")
        h_hs11 = login_headers(client, "HS11B2", "reader123")

        sim_resp = client.get("/books/B001/similar")
        assert sim_resp.status_code == 200
        similar_items = sim_resp.json()["items"]
        assert len(similar_items) > 0
        assert all(b["id"] != "B001" and b["visible"] is True for b in similar_items)

        target_sim_id = similar_items[0]["id"]
        fb_post = client.post(
            "/feedback",
            headers=h_hs10,
            json={
                "book_id": target_sim_id,
                "source_type": "similar_book",
                "context_key": "B001",
                "useful": True,
            },
        )
        assert fb_post.status_code == 200
        assert fb_post.json()["useful"] is True

        fb_hs10 = client.get(
            "/feedback",
            headers=h_hs10,
            params={"source_type": "similar_book", "context_key": "B001"},
        ).json()
        fb_hs11 = client.get(
            "/feedback",
            headers=h_hs11,
            params={"source_type": "similar_book", "context_key": "B001"},
        ).json()

        assert fb_hs10["feedback_map"].get(target_sim_id) is True
        assert target_sim_id not in fb_hs11["feedback_map"]

    def test_tc26_favorites_deduplicated_and_isolated_between_users(self, client: TestClient) -> None:
        h_hs10 = login_headers(client, "HS10A1", "reader123")
        h_hs11 = login_headers(client, "HS11B2", "reader123")

        hs10_before = client.get("/me/favorites", headers=h_hs10).json()["book_ids"]
        assert set(hs10_before) == {"B071", "B031"}

        # HS11B2 thêm B051 hai lần liên tiếp -> không bị trùng lặp
        add1 = client.post("/me/favorites/B051", headers=h_hs11)
        add2 = client.post("/me/favorites/B051", headers=h_hs11)
        assert add1.status_code == 200 and add2.status_code == 200

        hs11_favs = client.get("/me/favorites", headers=h_hs11).json()["book_ids"]
        assert hs11_favs.count("B051") == 1

        # Danh sách của HS10A1 hoàn toàn không bị ảnh hưởng
        hs10_after_add = client.get("/me/favorites", headers=h_hs10).json()["book_ids"]
        assert hs10_after_add == hs10_before

        # HS11B2 xóa B051
        rem = client.delete("/me/favorites/B051", headers=h_hs11)
        assert rem.status_code == 200
        assert "B051" not in client.get("/me/favorites", headers=h_hs11).json()["book_ids"]

    def test_tc27_api_endpoints_reject_xss_payloads(self, client: TestClient) -> None:
        lib_headers = login_headers(client, "LIB001", "libmate123")
        rdr_headers = login_headers(client, "HS10A1", "reader123")

        r_book = client.post(
            "/books",
            headers=lib_headers,
            json={
                "title": "Sách <script>alert(1)</script>",
                "author": "Tác giả",
                "category": "Khoa học",
                "shelf": "A1-01",
                "description": "Mô tả hợp lệ",
            },
        )
        assert r_book.status_code == 422

        r_copy = client.post(
            "/copies",
            headers=lib_headers,
            json={
                "book_id": "B001",
                "copy_code": "VHVN-001-XSS",
                "condition_note": "<img src=x onerror=alert(1)>",
            },
        )
        assert r_copy.status_code == 422

        r_fb = client.post(
            "/feedback",
            headers=rdr_headers,
            json={
                "book_id": "B002",
                "source_type": "similar_book",
                "context_key": "<script>evil()</script>",
                "useful": True,
            },
        )
        assert r_fb.status_code == 422
