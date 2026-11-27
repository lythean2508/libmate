# Báo cáo Kỹ thuật Backend, AI Ngữ nghĩa Tiếng Việt Local & Tổng hợp Kiểm thử Toàn Dự án (`T04`–`T48`, `AI01`–`AI10`, `TC01`–`TC32`)

- **Phụ trách Backend, Cơ sở dữ liệu, AI Local & Kiểm thử hệ thống:** Phạm Hiển
- **Phối hợp Thiết kế Giao diện, Dữ liệu 100 sách, Bộ 30 câu hỏi AI & Review chéo:** Lý Thế An (`@lythean2508`)
- **Phạm vi báo cáo:** Tổng hợp toàn bộ thiết kế, cài đặt và bằng chứng kiểm thử cho 24 công việc của Phạm Hiển (`T04, T05, T06, T10, T11, T12, T16, T17, T18, T22, T23, T24, T28, T29, T30, T34, T35, T36, T40, T41, T42, T46, T47, T48`), 10 tiêu chí kỹ thuật AI (`AI01`–`AI10`) và toàn bộ 32 ca kiểm thử nghiệm thu dự án (`TC01`–`TC32`).

---

## 1. Kiến trúc Backend, SQLite & Giao dịch Nguyên tử Mượn – Trả (`T04, T06, T10–T12, T16–T18, T22–T24`)

### 1.1. Lược đồ Cơ sở dữ liệu & Ràng buộc Toàn vẹn (`backend/app/db.py`)
- Mọi kết nối SQLite đều bật cứng `PRAGMA foreign_keys = ON` và `PRAGMA busy_timeout = 30000`.
- Tách biệt rõ 4 thực thể cốt lõi theo đúng đặc tả `F02`/`T04`:
  1. **`books` (Đầu sách):** Lưu thông tin tác phẩm chung, số từ mô tả (`word_count`), cờ cảnh báo thiếu mô tả (`missing_description` khi `< 80 từ` theo `AI01`), nguồn metadata hợp lệ (`metadata_source`) và cờ ẩn mềm (`visible = 1/0` thay vì xóa cứng — `TC08`).
  2. **`copies` (Bản sao vật lý):** Gắn khóa ngoại `book_id`, mã định danh vật lý duy nhất toàn hệ thống `copy_code` (`UNIQUE COLLATE NOCASE` — `TC07`) và trạng thái `available | borrowed | maintenance`.
  3. **`borrow_requests` (Yêu cầu mượn theo đầu sách):** Người đọc đặt yêu cầu ở trạng thái `pending` mà không khóa cứng bản sao; hệ thống chặn trùng `pending` trên cùng `(user_id, book_id)` (`TC09`) và chỉ cho phép hủy khi còn `pending` (`TC10`).
  4. **`loans` (Phiếu mượn gắn với bản sao cụ thể):** Ghi nhận tại quầy thủ thư kèm hạn trả tiêu chuẩn `+14 ngày`, ngày trả thực tế `returned_at` và ghi chú tình trạng sách.

### 1.2. Giao dịch Nguyên tử & Chống Tranh chấp Đồng thời (`TC11, TC12, TC13, TC14, TC15, TC16`)
- **Giao sách tại quầy (`POST /loans/issue`):** Thực thi bên trong khóa luồng `DB_LOCK` kết hợp giao dịch `BEGIN IMMEDIATE` của SQLite:
  - Kiểm tra lại `copy.status == 'available'` ngay thời điểm ghi để chống 2 thủ thư/luồng giao trùng bản sao cuối cùng (`TC11` / `T18`).
  - Kiểm tra lại số phiếu đang mượn (`returned_at IS NULL`) của người đọc `< 3` ngay tại thời điểm giao (`TC12`).
  - Cập nhật đồng bộ 4 bảng (`loans`, `copies`, `borrow_requests`, `audit_logs`); nếu xảy ra bất kỳ lỗi nào giữa giao dịch (`simulate_failure=True`), toàn bộ thay đổi được `ROLLBACK` sạch sẽ, không sinh phiếu mượn mồ côi (`TC13`).
- **Nhận trả sách & Bảo trì (`POST /loans/{loan_id}/return`):**
  - Kiểm tra `returned_at IS NULL`, trả lỗi `409 Conflict` nếu cố tình xác nhận trả lần thứ hai (`TC14`).
  - Nếu thủ thư đánh dấu `mark_maintenance=True`, bản sao tự động chuyển sang trạng thái `maintenance`, giảm `available_copies` và không thể bị chọn giao cho mượn (`TC15`).
  - Tính trạng thái quá hạn (`is_overdue`) theo múi giờ máy chủ Việt Nam `Asia/Ho_Chi_Minh`: đúng ngày hạn trả vẫn là hợp lệ (`is_overdue = False`), chỉ khi bước sang ngày kế tiếp mới gắn cờ quá hạn (`TC16`).

---

## 2. Bộ máy AI Ngữ nghĩa Tiếng Việt Cục bộ & Quản lý Chỉ mục Vector (`T05, T28–T30, AI01–AI10`)

### 2.1. Đặc tả Mô hình, Tiền tố `query:`/`passage:` và Chuẩn hóa L2 (`AI02, AI03, T28`)
Tệp [`backend/app/ai_engine.py`](../backend/app/ai_engine.py) cài đặt bộ máy tìm kiếm ngữ nghĩa tiếng Việt chạy hoàn toàn cục bộ trên CPU (`0 VND` phí API, không gọi mạng ngoài — `TC22`):
- **Định danh mô hình:** `intfloat/multilingual-e5-small` (phiên bản chỉ mục `e5-small-local-v1`, số chiều `384`).
- **Định dạng tiền tố bắt buộc (`AI03`):**
  - Đầu sách: `"passage: {title}. Chủ đề: {category}. Tác giả: {author}. Mô tả: {description}"`
  - Truy vấn: `"query: {query}"`
- **Chuẩn hóa L2 & Độ tương đồng Cosine:** Toàn bộ vector đầu sách và truy vấn đều được chuẩn hóa về độ dài đơn vị $\|\mathbf{v}\|_2 = 1.0$, kết hợp mở rộng 24 cụm khái niệm đồng nghĩa học đường tiếng Việt (tâm lý mùa thi, trì hoãn, mất tập trung, sơ đồ tư duy, thiên văn, STEM tái chế, lập trình Python, đạo đức AI, an toàn mạng, v.v.) và trọng số TF-IDF song ngữ có dấu/không dấu.

### 2.2. Tính Nhất quán Chỉ mục (`content_hash`), Tồn kho Sống & Bằng chứng Nguyên văn (`AI05, TC08, TC20, TC21, TC23`)
- **Theo dõi thay đổi qua `content_hash` (`TC20`):** Mỗi bản ghi trong bảng `book_embeddings` lưu mã băm SHA-256 của `(title, author, category, description, model_revision)` cùng trạng thái `status = 'ready' | 'pending'`. Khi thủ thư cập nhật mô tả hoặc nhan đề sách, `content_hash` thay đổi và `ai_engine` tự động mã hóa lại vector mới trước khi phục vụ tìm kiếm, đảm bảo không bao giờ dùng âm thầm vector cũ.
- **Lọc sách ẩn & ghép tồn kho thời gian thực (`TC08, TC21`):** Mọi kết quả tìm kiếm AI và gợi ý sách tương tự đều lọc cứng `visible == True` và truy vấn trực tiếp số bản sao `available_copies` mới nhất từ bảng `copies`.
- **Trích xuất bằng chứng khớp nguyên văn từ Metadata (`AI05`):** Hàm `build_metadata_reason` chỉ trích xuất câu nguyên văn có độ khớp từ khóa cao nhất trực tiếp từ trường `book.description` gốc, tuyệt đối không tự sáng tác lời giải thích ngoài dữ liệu và không hiển thị điểm cosine như xác suất phần trăm.
- **Dự phòng từ khóa tự động (`TC23`):** Khi mô hình AI gặp lỗi hoặc bật cờ `simulate_offline_error=True`, hệ thống tự động chuyển sang tìm kiếm từ khóa không dấu và trả về `fallback_used = True` kèm `fallback_reason` để giao diện hiển thị thông báo minh bạch.

---

## 3. Kết quả Đánh giá Thực nghiệm Bộ 30 Câu hỏi Tiếng Việt & Độ trễ (`T34, T40, T47, TC18, TC19, TC24`)

Chạy trực tiếp kịch bản kiểm định [`backend/scripts/eval_ai_30.py`](../backend/scripts/eval_ai_30.py) trên danh mục `100` đầu sách (`data/books_catalog_100.json`) và `30` câu truy vấn tiếng Việt (`data/ai_eval_30_queries_vi.json`):

| Tập đánh giá | Nhóm câu truy vấn | Kết quả AI Local (`Hit@5`) | Baseline Từ khóa (`Hit@5`) | Đánh giá theo tiêu chuẩn nghiệm thu (`AI08`, `TC18`, `TC19`) |
| :--- | :--- | :--- | :--- | :--- |
| **Calibration (20 câu)** | Câu có sách phù hợp (`17` câu) | **17/17 (100.0%)** | 16/17 (94.12%) | Đạt tuyệt đối và vượt Baseline từ khóa |
| **Calibration (20 câu)** | Câu ngoài danh mục (`3` câu: `Q18, Q19, Q20`) | **3/3 từ chối đúng (100%)** | 1/3 từ chối đúng | Đạt `TC19` (trả `results=[]` + `below_threshold_message`) |
| **Holdout độc lập (10 câu)** | Câu có sách phù hợp (`9` câu: `Q21`–`Q29`) | **9/9 (100.0%)** | 9/9 (100.0%) | **Đạt vượt mục tiêu `Hit@5 >= 80%`** (`TC18`, `R12`) |
| **Holdout độc lập (10 câu)** | Câu ngoài danh mục (`1` câu: `Q30`) | **1/1 từ chối đúng (100%)** | 0/1 từ chối đúng | **Đạt `TC19`** (từ chối chính xác câu luật thuế đa quốc gia) |

### Chỉ số Hiệu năng & Tài nguyên (`T40`, `AI09`, `TC22`, `TC24`)
- **Thời gian khởi tạo & lập chỉ mục lần đầu (Cold-start 100 sách):** `~699.6 ms` (`< 1.0 giây`).
- **Độ trễ tìm kiếm sau warm-up (20 lượt truy vấn liên tiếp trên 100 đầu sách):**
  - Độ trễ trung bình (`avg`): **`10.15 ms`**
  - Độ trễ phân vị 95 (`p95`): **`14.41 ms`** (đạt vượt mức yêu cầu `< 50 ms` và mục tiêu `AI09 <= 3000 ms`).
- **Chi phí API ngoại vi:** **`0 VND`** (chạy 100% offline trên CPU máy chủ nội bộ).

---

## 4. Kiểm thử Bảo mật, Sao lưu & Phục hồi Dữ liệu (`T35, T36, T42, TC01–TC04, TC27–TC29`)

1. **Bảo mật xác thực & phân quyền (`TC01, TC02, TC03, TC04`):**
   - Mật khẩu lưu dưới dạng `pbkdf2_sha256$100000$<salt>$<hash>`, được kiểm tra bằng `hmac.compare_digest` chống tấn công thời gian.
   - Đăng ký công khai (`POST /auth/register`) luôn gán cứng `role = 'reader'` bất kể payload gửi lên.
   - Các endpoint `/me/*` chỉ truy xuất dữ liệu theo `user_id` của phiên token hợp lệ.
2. **Chống mã độc XSS & Kiểm tra đầu vào (`TC27`):**
   - Tầng xác thực dữ liệu chặn mọi chuỗi chứa `<script`, `javascript:`, `onerror=`, `onload=` trên tất cả các trường văn bản với mã lỗi `400/422`.
3. **Sao lưu, Phục hồi & Tái tạo chỉ mục (`TC28, TC29`):**
   - `POST /admin/backup` và `POST /admin/restore` sử dụng SQLite Online Backup API (`conn.backup()`) bên trong `DB_LOCK`, kèm kiểm tra toàn vẹn khóa ngoại `PRAGMA foreign_key_check`.
   - `POST /admin/rebuild-index` tái lập chỉ mục vector cho toàn bộ 100 đầu sách về trạng thái `ready` mà không làm suy suyển bất kỳ bản ghi người dùng hay phiếu mượn nào.

---

## 5. Tài liệu & Bảng dữ liệu Nghiệm thu Đính kèm

- Bảng tiến độ 24 công việc của Phạm Hiển (hoàn thành 100%): [`data/tien_do_cong_viec_pham_hien.csv`](../data/tien_do_cong_viec_pham_hien.csv)
- Bảng tổng hợp kết quả 32 ca kiểm thử toàn dự án (`TC01`–`TC32` đạt 100%): [`data/ket_qua_kiem_thu_toan_du_an_32_tc.csv`](../data/ket_qua_kiem_thu_toan_du_an_32_tc.csv)
- Kịch bản đánh giá tự động 30 câu hỏi tiếng Việt: [`backend/scripts/eval_ai_30.py`](../backend/scripts/eval_ai_30.py)
