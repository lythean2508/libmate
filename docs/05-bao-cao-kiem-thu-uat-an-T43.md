# T43 — Báo cáo Kiểm thử UAT và Bằng chứng Thực thi của Lý Thế An (`F14`)

- **Mã công việc:** `T43` (Nhóm Nghiệm thu — `F14`)
- **Phụ trách:** Lý Thế An (`lythean2508`)
- **Người review:** Phạm Hiển
- **Bộ kiểm thử tự động đối ứng:** [`frontend/src/test/an_uat.test.tsx`](../frontend/src/test/an_uat.test.tsx) (chạy bằng lệnh `npm test` trong `frontend/`)

> [!IMPORTANT]
> Tuân thủ quy tắc nghiệm thu của kế hoạch (`T43`: *"Chạy bộ kiểm thử, cập nhật kết quả. Ca quan trọng thất bại phải còn hiển thị cần xử lý"*; `F14`: *"Kết quả thực tế nhập sau, không giả định đã đạt"*):
> - Báo cáo này tách bạch rõ **Kết quả kiểm thử tự động trên tầng Frontend & Local Service (`Đạt 11/11 ca`)** và **Trạng thái chờ kiểm thử tích hợp lại trên API FastAPI + SQLite thật của Phạm Hiển ở Tuần 8**.

---

## 1. Kết quả thực thi 11 Ca Kiểm thử do Lý Thế An phụ trách chính

| Mã ca | Chức năng | Mức độ | Tình huống kiểm thử | Kết quả trên Frontend | Bằng chứng xác minh & Ghi chú tích hợp Backend |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `TC01` | `F03` | **Quan trọng** | Đăng nhập sai / đăng xuất | **Đạt** | Sai mật khẩu báo lỗi rõ, không tạo phiên; sau `logout()` token bị xóa hiệu lực ngay; vai trò `reader` không thấy các mục menu Thủ thư. *(Cần chạy lại khi nối `POST /auth/login` FastAPI).* |
| `TC05` | `F04` | Thường | Tìm tên sách và tác giả | **Đạt** | Chuẩn hóa Unicode NFD + `đ -> d` tìm chính xác cả `"Mắt Biếc"` lẫn `"mat biec"`, `"nguyen nhat anh"` trong bộ 100 đầu sách. |
| `TC06` | `F04` | Thường | Danh mục rỗng và phân trang | **Đạt** | Truy vấn không khớp hiển thị `EmptyState` an toàn (không văng lỗi); khi lọc `"Văn học Việt Nam"` và chuyển sang trang 2 vẫn giữ nguyên bộ lọc chủ đề. |
| `TC10` | `F06` | Thường | Hủy `pending` và hủy đã giao | **Đạt** | Yêu cầu `pending` hủy thành công (`status -> cancelled`); yêu cầu đã giao (`fulfilled`) không hiện nút hủy và tầng nghiệp vụ từ chối nếu cố gọi hủy. |
| `TC17` | `F09` | **Quan trọng** | Đối chiếu báo cáo với dữ liệu | **Đạt** | Khớp chính xác 100 đầu sách, 201 bản sao (`196` sẵn có, `3` đang mượn, `2` bảo trì, `1` phiếu quá hạn); tệp xuất CSV có BOM UTF-8 mở đúng tiếng Việt trong Excel. |
| `TC18` | `F10` | Thường | Tìm ngữ nghĩa tiếng Việt | **Đạt** | Chạy `npm run eval:ai` đạt `Hit@5 = 9/9 (100%)` trên tập giữ lại độc lập (`>= 80%` mục tiêu `AI08`); xem chi tiết tại [`docs/03-bao-cao-danh-gia-ai-T33.md`](03-bao-cao-danh-gia-ai-T33.md). *(Đo lại với `multilingual-e5-small` ở `T47`).* |
| `TC19` | `F10` | Thường | Câu hỏi không có sách phù hợp | **Đạt** | Cả 4 câu ngoài danh mục (`Q18, Q19, Q20, Q30`) đều bị chặn dưới ngưỡng gợi ý, trả danh sách rỗng kèm thông báo rõ ràng và nút chuyển sang tìm từ khóa. |
| `TC25` | `F11` | Thường | Sách tương tự và phản hồi | **Đạt** | Khối Sách tương tự loại bỏ chính đầu sách đang xem và mọi đầu sách `visible = false`; đánh giá `Hữu ích` / `Chưa phù hợp` lưu đúng theo từng sách và tài khoản. |
| `TC26` | `F12` | Thường | Yêu thích theo tài khoản | **Đạt** | Lưu / bỏ lưu không tạo bản ghi trùng; thao tác trên tài khoản `HS11B2` hoàn toàn không làm thay đổi danh sách yêu thích của `HS10A1`. |
| `TC30` | `F14` | Thường | Desktop và điện thoại | **Đạt** | Dưới `720px` lưới sách tự chuyển về 1 cột, menu thu gọn thành nút `☰ Menu` và bảng dữ liệu bọc `.table-wrap` cuộn ngang mượt trên màn hình nhỏ. |
| `TC31` | `F14` | **Quan trọng** | UAT mượn-trả xuyên suốt | **Đạt (UI/Mock)** | Kiểm thử tự động mô phỏng trọn luồng: `PILOT01` đặt yêu cầu mượn → `LIB001` chọn bản sao giao tại quầy → `LIB001` xác nhận trả sách thành công, tồn kho cập nhật tức thì. |

---

## 2. Các ca kiểm thử phối hợp thêm đã được bảo vệ ngay tại tầng Frontend Service

Ngoài 11 ca đứng tên chính, bộ test `an_uat.test.tsx` cũng xác minh sẵn các ràng buộc nghiệp vụ quan trọng để đồng bộ với Phạm Hiển:
- `TC02`, `TC03`, `TC04`: Tự đăng ký ép cứng vai trò `reader`; chặn `reader` truy cập màn/hàm Thủ thư hoặc hủy yêu cầu của người khác.
- `TC07`, `TC08`: Kiểm tra trùng `copy_code` báo rõ tên trường lỗi; ẩn sách có lịch sử mượn giữ nguyên phiếu cũ nhưng lọc sạch khỏi danh mục và AI.
- `TC09`, `TC11`, `TC12`, `TC13`, `TC14`, `TC15`, `TC16`: Chặn trùng `pending`, chống giao bản cuối cho 2 người, kiểm tra lại trần `3 cuốn` lúc giao, rollback toàn bộ nếu lỗi giữa chừng, chống trả sách 2 lần, khóa mượn bản `maintenance` và tính quá hạn đúng ranh giới ngày máy chủ Việt Nam (`Asia/Ho_Chi_Minh`).
- `TC23`: Công tắc mô phỏng lỗi AI chuyển mượt sang tìm kiếm từ khóa dự phòng kèm thông báo rõ trên giao diện.
