# Checklist Review Chéo & Quản lý Rủi ro của Lý Thế An

Tài liệu này phục vụ hai trách nhiệm trực tiếp gắn với tên **Lý Thế An** trong bảng kế hoạch Excel:
1. **Vai trò `Người review = Lý Thế An`** đối với 24 công việc Backend / Database / AI của Phạm Hiển.
2. **Vai trò `Phụ trách = Lý Thế An`** đối với 6 mã rủi ro dự án (`R01, R05, R07, R10, R11, R12`).

---

## 1. Bảng theo dõi và xử lý 6 Rủi ro do Lý Thế An phụ trách

| Mã | Rủi ro | Mốc rà soát | Biện pháp đã triển khai trong Repo | Trạng thái kiểm soát |
| :--- | :--- | :--- | :--- | :--- |
| `R01` | Chưa có thư viện cho pilot | Tuần 1 | Đã xây dựng danh mục 100 đầu sách trường học có nguồn metadata rõ ràng (`data/books_catalog_100.json`) và phiếu xác nhận quy tắc với thủ thư trong [`docs/01-khao-sat-nguoi-dung-T01.md`](01-khao-sat-nguoi-dung-T01.md). | Đã có phương án chủ động; chờ xác nhận thực địa 01 thủ thư. |
| `R05` | Thiếu thời gian hai thành viên | Hằng tuần | Tách rõ kiến trúc độc lập qua `apiClient`/`libraryStore`; ưu tiên hoàn tất sớm luồng cốt lõi (Đăng nhập, Danh mục, Mượn-Trả, Tìm AI); nếu trễ tiến độ tích hợp có thể giảm Yêu thích/CSV trước theo quy tắc Excel. | Đang kiểm soát tốt. |
| `R07` | Mô tả sách thiếu hoặc không có quyền dùng | Tuần 3 | Toàn bộ 100 đầu sách đã được biên soạn mới tóm tắt ngắn `93–127 từ` (`80–200 từ` theo `AI01`), không sao chép toàn văn sách có bản quyền; form thủ thư tự động gắn cờ `missing_description` nếu mô tả `< 80 từ`. | Đã giải quyết trên bộ dữ liệu 100 sách. |
| `R10` | Nhầm phí AI với tổng chi phí | Trước mở rộng | Ghi chú rõ trên kiến trúc, README và hướng dẫn: AI chạy local `0 VND` phí API, nhưng nếu đưa lên Internet ngoài mạng LAN phải bật dự trù Hosting (`CP05`) & Tên miền (`CP06`) và kiểm tra báo giá thực. | Đã minh bạch hóa trong tài liệu. |
| `R11` | Đổi lịch vì học/thi/Tết | Khi chốt lịch | Giữ cấu trúc tham số ngày bắt đầu (`B7`) và tuần công việc linh hoạt trong file theo dõi kế hoạch để dễ dịch chuyển khi chốt lịch thi học kỳ / nghỉ Tết. | Sẵn sàng cập nhật theo lịch thực tế. |
| `R12` | Đánh giá AI không khách quan | Tuần 6 / Tuần 8 | Bộ 30 câu tiếng Việt (`data/ai_eval_30_queries_vi.json`) đã gán nhãn trước và khóa cứng tập `holdout` 10 câu tách biệt hoàn toàn với 20 câu `calibration`, bao gồm cả câu phủ định không có sách phù hợp. | Đã khóa bộ câu hỏi chuẩn. |

---

## 2. Checklist Review Pull Request khi Phạm Hiển gửi code Backend/AI (`Người review: Lý Thế An`)

Khi review các nhánh `task/T04` → `task/T48` của Phạm Hiển trên GitHub (`lythean2508/libmate`), kiểm tra lần lượt:

- [ ] **Nhóm Thiết kế & Tài khoản (`T04, T06, T10, T35`):**
  - API `/auth/login` không bao giờ trả trường `password_hash` trong JSON.
  - Endpoint đăng ký công khai chặn hoặc bỏ qua mọi tham số `role="librarian"` (`TC02`).
  - Endpoint `/me/loans`, `/me/favorites` lấy `user_id` từ phiên xác thực, không nhận `user_id` tùy ý từ query/body (`TC04`).
- [ ] **Nhóm Danh mục, Kho sách & Giao dịch Mượn – Trả (`T11, T12, T16, T17, T18, T22`):**
  - Bật `PRAGMA foreign_keys = ON` trên mọi kết nối SQLite.
  - `POST /loans/issue` chạy trong một transaction: kiểm tra lại `copy.status == 'available'` và số phiếu đang mượn `< 3` ngay thời điểm ghi (`TC11`, `TC12`, `TC13`).
  - `POST /loans/{id}/return` chống trả lặp lần 2 (`TC14`) và hỗ trợ chuyển bản sao sang `maintenance` (`TC15`).
  - Quá hạn tính theo ngày máy chủ (`Asia/Ho_Chi_Minh`), đúng ngày hạn trả chưa bị gắn quá hạn (`TC16`).
- [ ] **Nhóm AI Local & Vận hành (`T05, T23, T24, T28, T29, T30, T34, T36, T40, T42, T46, T47, T48`):**
  - Dùng đúng tiền tố `query:` và `passage:` của `intfloat/multilingual-e5-small` và chuẩn hóa L2 vector (`T28`).
  - Khi sửa mô tả sách hoặc ẩn sách (`visible=false`), không trả về kết quả từ vector cũ âm thầm (`TC08`, `TC20`) và luôn ghép `available_copies` mới nhất từ SQLite (`TC21`).
  - Tắt Internet sau lần tải model đầu tiên vẫn tìm kiếm AI bình thường; nếu thiếu model tự trả cờ `fallback_used = true` để Frontend hiển thị cảnh báo rõ (`TC22`, `TC23`).
  - Tập 10 câu `holdout` trong `data/ai_eval_30_queries_vi.json` chỉ dùng để đo kiểm cuối (`T34`, `T47`), không dùng để tinh chỉnh ngưỡng/từ điển (`R12`).
