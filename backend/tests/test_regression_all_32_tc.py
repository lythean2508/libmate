"""
Concurrency, Resilience, AI Evaluation & Full 32-TC Regression Suite (test_regression_all_32_tc.py):
- TC11 / T18: Two concurrent threads attempting to issue the last available copy of B006 (CP-B006-A)
  simultaneously -> exactly one succeeds (200) and one fails cleanly (409), leaving 1 active loan and 0 available copies.
- TC18 & TC19 / T34 / T47: Holdout split (10 queries from data/ai_eval_30_queries_vi.json) achieves Hit@5 >= 80%,
  and negative query Q30 (plus Q18, Q19, Q20) returns 0 results with below_threshold_message.
- TC20 & TC21 / T29 / T30: Updating a book's description invalidates/updates its embedding vector;
  issuing a copy immediately reflects updated available_copies in semantic search results.
- TC22, TC23, TC24 / T40: Offline local AI execution without network calls, automatic keyword fallback
  when AI errors, and warm-up p95 latency <= 3.0s across 20 queries on 100 books.
- TC28 & TC29 / T42: SQLite backup and restore preserves books, copies, users, and active loans;
  index rebuild after restart recovers ready state without losing transaction data.
- TC30, TC31, TC32: End-to-end UAT borrow-issue-return journey & full project deliverables verification.
"""

from __future__ import annotations

import csv
import json
import socket
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import ai_engine
from backend.app.db import REPO_ROOT, db_session, reset_db, set_db_path
from backend.app.main import app


@pytest.fixture()
def isolated_env(tmp_path: Path) -> Path:
    """Thiết lập file SQLite riêng biệt đã seed đầy đủ 100 đầu sách và 201 bản sao."""
    db_file = tmp_path / "test_libmate_regression.db"
    set_db_path(db_file)
    reset_db(db_file)
    ai_engine.set_simulate_offline_error(False)
    with db_session(db_file) as conn:
        ai_engine.sync_and_verify_embeddings(conn=conn, force_rebuild=False)
    yield db_file
    ai_engine.set_simulate_offline_error(False)
    set_db_path(None)


def get_auth_headers(client: TestClient, reader_code: str, password: str) -> dict[str, str]:
    res = client.post("/auth/login", json={"reader_code": reader_code, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


class TestConcurrencyLastCopyTC11:
    """
    TC11 / T18: Hai yêu cầu giao sách đồng thời trên bản sao cuối cùng của B006 (CP-B006-A).
    Đúng 1 luồng thành công (200) và 1 luồng bị từ chối sạch (409), tồn kho còn 0 bản sẵn có và chỉ có 1 phiếu active.
    """

    def test_tc11_concurrent_threads_issuing_last_available_copy_b006(self, isolated_env: Path) -> None:
        with TestClient(app) as setup_client:
            lib_headers = get_auth_headers(setup_client, "LIB001", "libmate123")
            rdr1_headers = get_auth_headers(setup_client, "HS11B2", "reader123")
            rdr2_headers = get_auth_headers(setup_client, "HS12C3", "reader123")

            # Xác nhận B006 (Tắt Đèn) chỉ có duy nhất 1 bản sao sẵn có là CP-B006-A
            b006_before = setup_client.get("/books/B006").json()
            assert b006_before["total_copies"] == 1
            assert b006_before["available_copies"] == 1
            assert b006_before["copies"][0]["id"] == "CP-B006-A"

            req1 = setup_client.post("/borrow-requests", headers=rdr1_headers, json={"book_id": "B006"})
            req2 = setup_client.post("/borrow-requests", headers=rdr2_headers, json={"book_id": "B006"})
            assert req1.status_code == 201 and req2.status_code == 201
            req1_id = req1.json()["id"]
            req2_id = req2.json()["id"]

        barrier = threading.Barrier(2)

        def worker_issue(req_id: str) -> tuple[int, dict]:
            with TestClient(app) as worker_client:
                barrier.wait(timeout=5.0)
                resp = worker_client.post(
                    "/loans/issue",
                    headers=lib_headers,
                    json={"request_id": req_id, "copy_id": "CP-B006-A"},
                )
                return resp.status_code, resp.json()

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(worker_issue, req1_id)
            f2 = pool.submit(worker_issue, req2_id)
            res1 = f1.result(timeout=10.0)
            res2 = f2.result(timeout=10.0)

        statuses = sorted([res1[0], res2[0]])
        assert statuses == [200, 409], f"Expected one 200 and one 409, got: {res1}, {res2}"

        with TestClient(app) as verify_client:
            b006_after = verify_client.get("/books/B006").json()
            assert b006_after["available_copies"] == 0
            assert b006_after["borrowed_copies"] == 1

            report = verify_client.get("/reports/summary", headers=lib_headers).json()
            active_b006_loans = [
                l for l in report["loans"] if l["book_id"] == "B006" and l["returned_at"] is None
            ]
            assert len(active_b006_loans) == 1
            assert active_b006_loans[0]["copy_id"] == "CP-B006-A"


class TestAISemanticEvaluationConsistencyAndFallbackTC18ToTC24:
    """Kiểm thử đánh giá AI 30 câu tiếng Việt, đồng bộ chỉ mục, tồn kho sống, chạy offline, fallback & độ trễ p95 (TC18..TC24)."""

    def test_tc18_and_tc19_holdout_hit_at_5_and_negative_query_rejection(self, isolated_env: Path) -> None:
        queries_path = REPO_ROOT / "data" / "ai_eval_30_queries_vi.json"
        queries = json.loads(queries_path.read_text(encoding="utf-8"))
        assert len(queries) == 30

        calibration = [q for q in queries if q["split"] == "calibration"]
        holdout = [q for q in queries if q["split"] == "holdout"]
        assert len(calibration) == 20
        assert len(holdout) == 10

        pos_holdout = [q for q in holdout if len(q["expected_book_ids"]) > 0]
        neg_queries = [q for q in queries if len(q["expected_book_ids"]) == 0]
        assert len(pos_holdout) == 9
        assert len(neg_queries) == 4

        with TestClient(app) as client:
            # TC18: Tập Holdout độc lập đạt Hit@5 >= 80%
            holdout_hits = 0
            for q in pos_holdout:
                resp = client.get("/search/semantic", params={"q": q["query"]})
                assert resp.status_code == 200
                data = resp.json()
                assert data["fallback_used"] is False
                top5_ids = [r["book_id"] for r in data["results"][:5]]
                if any(exp_id in top5_ids for exp_id in q["expected_book_ids"]):
                    holdout_hits += 1
                # Mọi kết quả đều trích xuất nguyên văn câu mô tả từ description gốc (AI05)
                for item in data["results"]:
                    assert item["reason"]["excerpt"] in item["description"]

            hit_rate = holdout_hits / len(pos_holdout)
            assert hit_rate >= 0.80, f"Holdout Hit@5 = {hit_rate:.2%} (< 80% target)"

            # TC19: Câu hỏi ngoài phạm vi thư viện (đặc biệt Q30 trong holdout) trả rỗng kèm below_threshold_message
            q30 = next(q for q in holdout if q["id"] == "Q30")
            r30 = client.get("/search/semantic", params={"q": q30["query"]})
            assert r30.status_code == 200
            d30 = r30.json()
            assert d30["results"] == []
            assert d30["below_threshold_message"] is not None
            assert "ngưỡng" in d30["below_threshold_message"].lower()

            for nq in neg_queries:
                rn = client.get("/search/semantic", params={"q": nq["query"]}).json()
                assert rn["results"] == [], f"Negative query {nq['id']} should return empty results"
                assert rn["below_threshold_message"]

    def test_tc20_updating_book_description_invalidates_and_updates_embedding(self, isolated_env: Path) -> None:
        with TestClient(app) as client:
            lib_headers = get_auth_headers(client, "LIB001", "libmate123")

            with db_session() as conn:
                old_hash = conn.execute(
                    "SELECT content_hash FROM book_embeddings WHERE book_id = 'B006'"
                ).fetchone()["content_hash"]

            new_desc = (
                "Chuyên khảo đặc biệt hướng dẫn kỹ thuật lắp mạch điện tử Arduino cảm biến tưới cây tự động "
                "và chế tạo robot dò đường thông minh trong phòng thí nghiệm STEM của trường trung học phổ thông."
            )
            upd = client.patch(
                "/books/B006",
                headers=lib_headers,
                json={"description": new_desc, "auto_reindex": False},
            )
            assert upd.status_code == 200
            assert upd.json()["index_status"] == "pending"

            # Khi người dùng tìm kiếm ngữ nghĩa, ai_engine tự động phát hiện trạng thái pending/hash mới và re-encode ngay
            sem = client.get(
                "/search/semantic",
                params={"q": "lắp mạch điện tử Arduino cảm biến tưới cây tự động và làm robot dò đường"},
            )
            assert sem.status_code == 200
            results = sem.json()["results"]
            b006_match = next((r for r in results if r["book_id"] == "B006"), None)
            assert b006_match is not None
            assert b006_match["reason"]["excerpt"] in new_desc

            with db_session() as conn:
                row = conn.execute(
                    "SELECT content_hash, status FROM book_embeddings WHERE book_id = 'B006'"
                ).fetchone()
                assert row["status"] == "ready"
                assert row["content_hash"] != old_hash

    def test_tc21_issuing_copy_immediately_updates_available_copies_in_semantic_search(self, isolated_env: Path) -> None:
        with TestClient(app) as client:
            lib_headers = get_auth_headers(client, "LIB001", "libmate123")
            q_tat_den = "Tiểu thuyết cảm động về người nông dân nghèo phải bán con bán chó giữa mùa sưu thuế"

            before = client.get("/search/semantic", params={"q": q_tat_den}).json()
            b006_before = next(r for r in before["results"] if r["book_id"] == "B006")
            assert b006_before["available_copies"] == 1

            # Thủ thư giao bản sao duy nhất CP-B006-A cho HS12C3
            issue = client.post(
                "/loans/issue",
                headers=lib_headers,
                json={"reader_code": "HS12C3", "copy_id": "CP-B006-A"},
            )
            assert issue.status_code == 200

            # Tìm kiếm AI phản ánh ngay lập tức available_copies == 0
            after = client.get("/search/semantic", params={"q": q_tat_den}).json()
            b006_after = next(r for r in after["results"] if r["book_id"] == "B006")
            assert b006_after["available_copies"] == 0

            # Nếu bật bộ lọc only_available=True thì B006 không còn nằm trong kết quả
            only_avail = client.get(
                "/search/semantic",
                params={"q": q_tat_den, "only_available": True},
            ).json()
            assert all(r["book_id"] != "B006" for r in only_avail["results"])

    def test_tc22_tc23_tc24_offline_execution_keyword_fallback_and_p95_latency(
        self, isolated_env: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # TC22: Chặn mọi kết nối socket mạng ra ngoài -> AI vẫn chạy 100% cục bộ trên CPU
        def block_network(*_args, **_kwargs):
            raise RuntimeError("Network call prohibited in TC22 offline local AI mode!")

        monkeypatch.setattr(urllib.request, "urlopen", block_network)
        monkeypatch.setattr(socket, "create_connection", block_network)

        offline_res = ai_engine.search_semantic(
            "Em hay bị căng thẳng lo lắng trước kỳ thi học kỳ, có sách tâm lý nào giúp giảm áp lực không?"
        )
        assert offline_res["fallback_used"] is False
        assert any(r["book_id"] == "B074" for r in offline_res["results"])

        # TC23: Khi mô hình gặp lỗi -> tự động fallback về tìm kiếm từ khóa không dấu kèm cờ fallback_used=True
        with TestClient(app) as client:
            fb_resp = client.get(
                "/search/semantic",
                params={"q": "mat biec nguyen nhat anh", "simulate_offline_error": True},
            )
            assert fb_resp.status_code == 200
            fb_data = fb_resp.json()
            assert fb_data["fallback_used"] is True
            assert fb_data["fallback_reason"]
            assert any(r["book_id"] == "B001" for r in fb_data["results"])

            # TC24: Độ trễ p95 sau warm-up trên 20 câu truy vấn với danh mục 100 sách <= 3.0 giây
            queries = json.loads((REPO_ROOT / "data" / "ai_eval_30_queries_vi.json").read_text(encoding="utf-8"))
            sample_20 = [q["query"] for q in queries[:20]]

            # Warm-up 1 lượt
            client.get("/search/semantic", params={"q": sample_20[0]})

            latencies_sec: list[float] = []
            for q_text in sample_20:
                t0 = time.perf_counter()
                r = client.get("/search/semantic", params={"q": q_text})
                elapsed = time.perf_counter() - t0
                assert r.status_code == 200
                latencies_sec.append(elapsed)

            latencies_sec.sort()
            p95_idx = min(int(len(latencies_sec) * 0.95), len(latencies_sec) - 1)
            p95_sec = latencies_sec[p95_idx]
            assert p95_sec <= 3.0, f"p95 latency {p95_sec:.4f}s exceeded 3.0s limit (TC24)"


class TestBackupRestoreRebuildIndexAndFullRegressionTC28ToTC32:
    """Kiểm thử sao lưu & phục hồi SQLite (TC28), tái lập chỉ mục AI (TC29), UAT xuyên suốt (TC31) và toàn vẹn dự án (TC32)."""

    def test_tc28_and_tc29_sqlite_backup_restore_and_index_rebuild(
        self, isolated_env: Path, tmp_path: Path
    ) -> None:
        backup_file = tmp_path / "snapshot_tc28.db"

        with TestClient(app) as client:
            lib_headers = get_auth_headers(client, "LIB001", "libmate123")

            # 1. Tạo bản sao lưu nhất quán khi đang có 100 sách, 201 bản sao, 15 người dùng, 3 phiếu đang mượn
            bck = client.post(
                "/admin/backup",
                headers=lib_headers,
                json={"backup_path": str(backup_file)},
            )
            assert bck.status_code == 200
            bck_data = bck.json()
            assert Path(bck_data["backup_path"]).exists()
            assert bck_data["counts"] == {
                "books": 100,
                "copies": 201,
                "users": 15,
                "loans": 4,
                "active_loans": 3,
            }

            # 2. Thay đổi dữ liệu sau thời điểm backup (giao thêm sách, ẩn sách, thêm bản sao)
            client.patch("/books/B001", headers=lib_headers, json={"visible": False})
            client.post("/loans/issue", headers=lib_headers, json={"request_id": "REQ-0004", "copy_id": "CP-B071-A"})
            mutated_summary = client.get("/reports/summary", headers=lib_headers).json()["summary"]
            assert mutated_summary["total_visible_books"] == 99
            assert mutated_summary["active_loans"] == 4

            # 3. Phục hồi từ bản sao lưu (TC28) -> mọi sách, bản sao, người dùng và phiếu đang mượn trở về nguyên trạng
            rest = client.post(
                "/admin/restore",
                headers=lib_headers,
                json={"backup_path": str(backup_file)},
            )
            assert rest.status_code == 200
            rest_summary = client.get("/reports/summary", headers=lib_headers).json()["summary"]
            assert rest_summary["total_visible_books"] == 100
            assert rest_summary["total_copies"] == 201
            assert rest_summary["active_loans"] == 3
            assert rest_summary["available_copies"] == 196

            # 4. TC29: Giả lập mất/hỏng bảng chỉ mục vector sau khởi động lại -> gọi /admin/rebuild-index
            with db_session() as conn:
                conn.execute("DELETE FROM book_embeddings;")

            rebuild = client.post(
                "/admin/rebuild-index",
                headers=lib_headers,
                json={"force_rebuild": True},
            )
            assert rebuild.status_code == 200
            rb_data = rebuild.json()
            assert rb_data["status"] == "ready"
            assert rb_data["total_indexed"] == 100

            # Tất cả sách đều có index_status='ready' và dữ liệu giao dịch mượn-trả không bị ảnh hưởng
            books_after_rb = client.get("/books", params={"page_size": 100}).json()["items"]
            assert len(books_after_rb) == 100
            assert all(b["index_status"] == "ready" for b in books_after_rb)
            assert client.get("/reports/summary", headers=lib_headers).json()["summary"]["active_loans"] == 3

    def test_tc31_end_to_end_uat_borrow_issue_and_return_flow(self, isolated_env: Path) -> None:
        with TestClient(app) as client:
            # 1. PILOT01 đăng nhập và tìm sách bằng AI
            pilot_headers = get_auth_headers(client, "PILOT01", "pilot123")
            lib_headers = get_auth_headers(client, "LIB001", "libmate123")

            sem = client.get(
                "/search/semantic",
                params={"q": "căng thẳng lo lắng trước kỳ thi học kỳ, sách tâm lý giảm áp lực"},
            ).json()
            target_book_id = sem["results"][0]["book_id"]

            detail_before = client.get(f"/books/{target_book_id}").json()
            avail_before = detail_before["available_copies"]
            avail_copy_id = next(c["id"] for c in detail_before["copies"] if c["status"] == "available")

            # 2. PILOT01 gửi yêu cầu mượn
            req_resp = client.post(
                "/borrow-requests",
                headers=pilot_headers,
                json={"book_id": target_book_id},
            )
            assert req_resp.status_code == 201
            req_id = req_resp.json()["id"]

            # 3. Thủ thư LIB001 giao bản sao tại quầy
            issue_resp = client.post(
                "/loans/issue",
                headers=lib_headers,
                json={"request_id": req_id, "copy_id": avail_copy_id},
            )
            assert issue_resp.status_code == 200
            loan_id = issue_resp.json()["id"]
            assert client.get(f"/books/{target_book_id}").json()["available_copies"] == avail_before - 1

            # 4. PILOT01 kiểm tra danh sách đang mượn của mình
            my_loans = client.get("/me/loans", headers=pilot_headers).json()
            assert any(l["id"] == loan_id for l in my_loans["active_loans"])

            # 5. Thủ thư LIB001 xác nhận trả sách tại quầy
            ret_resp = client.post(f"/loans/{loan_id}/return", headers=lib_headers, json={})
            assert ret_resp.status_code == 200
            assert ret_resp.json()["returned_at"] is not None
            assert client.get(f"/books/{target_book_id}").json()["available_copies"] == avail_before

    def test_tc30_and_tc32_project_datasets_and_32_tc_tracking_completeness(self) -> None:
        books = json.loads((REPO_ROOT / "data" / "books_catalog_100.json").read_text(encoding="utf-8"))
        copies = json.loads((REPO_ROOT / "data" / "copies_seed.json").read_text(encoding="utf-8"))
        queries = json.loads((REPO_ROOT / "data" / "ai_eval_30_queries_vi.json").read_text(encoding="utf-8"))

        assert len(books) == 100
        assert all(80 <= int(b["word_count"]) <= 200 for b in books)
        assert len(copies) == 201
        assert len({c["copy_code"].upper() for c in copies}) == 201
        assert len(queries) == 30

        tc_csv_path = REPO_ROOT / "data" / "ket_qua_kiem_thu_toan_du_an_32_tc.csv"
        assert tc_csv_path.exists()
        with tc_csv_path.open(encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        tc_codes = {r["Mã ca"] for r in rows}
        expected_codes = {f"TC{i:02d}" for i in range(1, 33)}
        assert tc_codes == expected_codes
