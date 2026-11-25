# T37 & T38 — Hướng dẫn Nhóm 10 Người dùng thử (Pilot) và Biểu mẫu Quan sát (`F01`)

- **Mã công việc:** `T37` (Hướng dẫn nhóm người dùng thử) & `T38` (Quan sát và tổng hợp phản hồi)
- **Phụ trách:** Lý Thế An (`lythean2508`)
- **Người review:** Phạm Hiển
- **Tuần kế hoạch:** Tuần 7 (`2027-01-11` → `2027-01-17`)
- **Mục tiêu nghiệm thu:** Tối thiểu **10 người thử** dùng tài khoản thử nghiệm riêng, thực hiện tác vụ tìm sách + gửi yêu cầu mượn, ghi nhận thời gian hoàn thành, khó khăn và mức hữu ích để chốt danh sách sửa lỗi `T39` / `T41`.

> [!IMPORTANT]
> Tuân thủ nguyên tắc trung thực dữ liệu (`F14`: *"Kết quả thực tế nhập sau, không giả định đã đạt"*): Hệ thống đã tạo sẵn **10 tài khoản thử (`PILOT01` → `PILOT10`, mật khẩu `pilot123`)** và biểu mẫu chuẩn dưới đây để ghi nhận số liệu thực tế khi tổ chức buổi chạy thử trực tiếp trên mạng LAN/máy thử.

---

## 1. Danh sách 10 Tài khoản Pilot đã cấu hình sẵn trong ứng dụng

| STT | Mã đăng nhập | Mật khẩu | Vai trò | Đối tượng phân bổ đề xuất |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `PILOT01` | `pilot123` | `reader` | Học sinh khối 10 (ít dùng thư viện) |
| 2 | `PILOT02` | `pilot123` | `reader` | Học sinh khối 10 (hay đọc văn học) |
| 3 | `PILOT03` | `pilot123` | `reader` | Học sinh khối 10 (dùng trên điện thoại) |
| 4 | `PILOT04` | `pilot123` | `reader` | Học sinh khối 11 (nhu cầu STEM / Lý - Hóa) |
| 5 | `PILOT05` | `pilot123` | `reader` | Học sinh khối 11 (dùng trên điện thoại) |
| 6 | `PILOT06` | `pilot123` | `reader` | Học sinh khối 11 (nhu cầu kỹ năng / tâm lý) |
| 7 | `PILOT07` | `pilot123` | `reader` | Học sinh khối 12 (ôn thi Toán / Tiếng Anh) |
| 8 | `PILOT08` | `pilot123` | `reader` | Học sinh khối 12 (nhu cầu hướng nghiệp) |
| 9 | `PILOT09` | `pilot123` | `reader` | Cộng tác viên thư viện học sinh |
| 10 | `PILOT10` | `pilot123` | `reader` | Giáo viên / Thủ thư thử đóng vai người đọc |

*(Ngoài ra thủ thư thử nghiệm dùng tài khoản `LIB001` / `libmate123` để xử lý giao và trả sách tại quầy).*

---

## 2. Kịch bản 4 Tác vụ chuẩn giao cho mỗi người thử (Thời lượng 10–12 phút/người)

1. **Tác vụ P1 — Tìm sách theo từ khóa và lọc còn sẵn (`F04`):**
   - Đăng nhập bằng mã `PILOTxx`.
   - Tìm một cuốn sách của tác giả *Nguyễn Nhật Ánh* (có thể gõ không dấu `nguyen nhat anh`) và bật lọc *"Chỉ hiện sách còn bản sẵn có trên kệ"*.
2. **Tác vụ P2 — Tìm sách theo nhu cầu tự nhiên bằng AI Local (`F10`):**
   - Chuyển sang tab **Tìm theo nhu cầu bằng AI Local**.
   - Tự nhập 1 câu mô tả vấn đề học tập/kỹ năng bạn đang quan tâm, xem Top 5 gợi ý, đọc đoạn trích metadata gốc và bấm đánh giá **Hữu ích** hoặc **Chưa phù hợp**.
3. **Tác vụ P3 — Gửi yêu cầu mượn & Kiểm tra trạng thái (`F06`):**
   - Mở trang chi tiết cuốn sách ưng ý nhất, kiểm tra vị trí kệ và bấm **Gửi yêu cầu mượn**.
   - Vào mục **Mượn & Lịch sử** kiểm tra yêu cầu đang ở trạng thái `Đang chờ tại quầy`.
4. **Tác vụ P4 — Lưu sách yêu thích trên điện thoại/máy tính (`F12`, `TC30`):**
   - Lưu 2 cuốn sách vào **Yêu thích** và mở lại trang Yêu thích kiểm tra.

---

## 3. Tiêu chí phân loại mức độ ưu tiên lỗi sau Pilot (Đầu vào cho T39 & T41)

- **Mức P0 (Chặn luồng chính — Bắt buộc sửa ngay trong `T39`/`T41`):** Không đăng nhập được, sai tồn kho bản sao, giao trùng bản cuối, lộ lịch sử tài khoản khác, vỡ nút bấm trên màn hình điện thoại 360px.
- **Mức P1 (Ảnh hưởng trải nghiệm rõ rệt — Sửa trước UAT `T43`):** Thông báo lỗi khó hiểu, bộ lọc bị mất khi chuyển trang, kết quả AI thiếu nhãn fallback khi mô hình chưa sẵn sàng.
- **Mức P2 (Cải tiến nhỏ — Đưa vào Backlog sau MVP `T48`):** Đổi màu sắc phụ, bổ sung quét mã QR (`F15`), gửi email tự động.

---

## 4. Tệp ghi nhận số liệu thực tế
Điền kết quả đo thời gian hoàn thành (giây), thiết bị (`Desktop` / `Mobile`), điểm hữu ích (`1–5`) và vướng mắc thực tế vào tệp [`data/pilot_observation_template.csv`](../data/pilot_observation_template.csv).
