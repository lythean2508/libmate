# T45 — Kịch bản Demo 5 Phút, Tổng hợp Vai trò & Backlog sau MVP (`F14`)

- **Mã công việc:** `T45` (Nhóm Bàn giao — `F14`)
- **Phụ trách:** Lý Thế An (`lythean2508`)
- **Phối hợp nghiệm thu cuối (`T46`–`T48`):** Phạm Hiển

---

## 1. Kịch bản Demo Trực tiếp 5 Phút (Dùng để quay Video ngắn & Bảo vệ dự án)

### Chuẩn bị trước khi bấm máy quay (30 giây)
- Mở sẵn trình duyệt ở địa chỉ local `http://localhost:5173` (hoặc IP LAN máy thử).
- Mở song song 2 cửa sổ (hoặc chuyển nhanh bằng nút chọn tài khoản mẫu trên trang `/login`):
  - **Người đọc:** `HS11B2` (mật khẩu `reader123`) hoặc `PILOT01` (`pilot123`).
  - **Thủ thư:** `LIB001` (mật khẩu `libmate123`).

### Phân cảnh chi tiết từng phút (0:00 → 5:00)

| Thời lượng | Người trình bày | Thao tác trực tiếp trên màn hình | Điểm nhấn nghiệm thu cần nêu rõ |
| :--- | :--- | :--- | :--- |
| **0:00 – 0:45** | Lý Thế An | Giới thiệu bài toán thư viện trường học; tìm nhanh không dấu `nguyen nhat anh` và lọc *Chỉ hiện sách còn sẵn có* trên danh mục 100 đầu sách. | Phân biệt rõ **Đầu sách** và **Số bản sao sẵn có** thực tế trên kệ (`F04`, `TC05`). |
| **0:45 – 2:00** | Lý Thế An | Chuyển sang tab **Tìm theo nhu cầu AI Local**, nhập câu: *"Em hay bị căng thẳng lo lắng trước kỳ thi, có sách nào giúp giảm áp lực không?"*; tiếp theo thử 1 câu ngoài phạm vi (sửa chữa động cơ tàu thủy). | AI chạy local miễn phí, dẫn nguyên văn mô tả gốc (`AI05`), không bịa lý do; câu ngoài danh mục từ chối trung thực (`TC19`). |
| **2:00 – 3:15** | Lý Thế An & Phạm Hiển | Bạn đọc `PILOT01` bấm **Gửi yêu cầu mượn** cuốn sách vừa tìm được. Chuyển sang tài khoản Thủ thư `LIB001` mở **Quầy Giao/Trả**, chọn mã bản sao vật lý `copy_code` và bấm **Xác nhận giao**. | Yêu cầu chờ chưa giữ cứng sách; giao sách kiểm tra đồng thời & giới hạn `<= 3` cuốn trong 1 giao dịch (`F06`, `F07`, `TC11`). |
| **3:15 – 4:15** | Phạm Hiển & Lý Thế An | Tại Quầy Thủ thư, chuyển sang tab **Nhận trả sách**, tìm phiếu vừa giao, tích chọn **Cần bảo trì** và xác nhận trả. Mở trang **Báo cáo & CSV**, đối chiếu số liệu và bấm **Xuất CSV**. | Bản sao bảo trì tự khóa cho mượn (`TC15`); trả lặp bị chặn (`TC14`); báo cáo khớp dữ liệu thực và phân quyền chặt (`TC17`). |
| **4:15 – 5:00** | Cả hai | Tóm tắt kết quả đánh giá bộ 30 câu tiếng Việt (20 hiệu chỉnh / 10 giữ lại độc lập), khả năng fallback từ khóa khi tắt AI/offline và hướng phát triển sau MVP. | Đạt mục tiêu `Hit@5 >= 80%` trên tập giữ lại (`TC18`) và sẵn sàng bàn giao môi trường sạch. |

---

## 2. Tổng hợp Đóng góp theo Vai trò hai thành viên

| Thành viên | Vai trò chính theo kế hoạch | Các hạng mục phụ trách (24 tasks / người) |
| :--- | :--- | :--- |
| **Lý Thế An (`lythean2508`)** | Giao diện, luồng người dùng, dữ liệu sách, đánh giá câu hỏi AI, tài liệu & pilot | `T01, T02, T03` (Khảo sát, thiết kế UI, dựng React/TS) • `T07, T08, T09` (UI Auth, Danh mục, Kho sách/Bản sao) • `T13, T14, T15` (UI Yêu cầu, Quầy giao, Danh mục 100 đầu sách 80–200 từ) • `T19, T20, T21` (UI Lịch sử, Trả/Bảo trì, Responsive Mobile) • `T25, T26, T27` (UI Tìm AI, Bằng chứng metadata, Sách tương tự & Feedback) • `T31, T32, T33` (UI Báo cáo CSV, Yêu thích & Nhắc hạn, Bộ 30 câu đánh giá AI) • `T37, T38, T39` (Tài liệu Pilot 10 người & Sửa lỗi UI) • `T43, T44, T45` (UAT 11 ca kiểm thử, Hướng dẫn sử dụng & Kịch bản Demo). |
| **Phạm Hiển** | Backend, database, AI local, kiểm thử nghiệp vụ, vận hành & phát hành | `T04, T05, T06` (Mô hình dữ liệu, thử embedding E5, dựng FastAPI/SQLite) • `T10, T11, T12` (API Auth, Danh mục, Kho sách) • `T16, T17, T18` (API Yêu cầu, Transaction giao sách & Test đồng thời bản cuối) • `T22, T23, T24` (API Trả sách, Báo cáo CSV, Backup/Audit log) • `T28, T29, T30` (Chỉ mục vector, API tìm ngữ nghĩa & Fallback) • `T34, T35, T36` (Đo baseline AI, Kiểm thử bảo mật/XSS, Đóng gói LAN offline) • `T40, T41, T42` (Đo tốc độ/RAM, Sửa lỗi nghiệp vụ, Diễn tập khôi phục) • `T46, T47, T48` (Tag bản phát hành, Hồi quy tập giữ lại & Bàn giao cuối). |

---

## 3. Backlog Giai đoạn Sau MVP (Đồng bộ F15, F16, F17)

1. **`F15` — Quét mã vạch / QR bản sao tại quầy (Phụ trách dự kiến: Lý Thế An):** Dùng camera điện thoại/máy quét USB đọc nhanh `copy_code` khi giao và trả sách thay vì chọn/nhập tay, triển khai sau khi luồng mượn – trả vận hành ổn định.
2. **`F16` — Hỏi đáp nội dung sách có bản quyền mở (Phạm Hiển):** Chỉ mở rộng khi có nguồn toàn văn hợp pháp và phần cứng đáp ứng mô hình tạo sinh.
3. **`F17` — Triển khai Internet công khai, HTTPS & SSO trường học (Phạm Hiển & Lý Thế An):** Thẩm định chi phí hosting/tên miền (`CP05`, `CP06`) và bảo mật dữ liệu học sinh trước khi mở ra ngoài mạng LAN.
