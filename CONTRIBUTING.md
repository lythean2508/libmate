# Quy tắc phối hợp & Luồng Git — Dự án LibMate

Tài liệu này cụ thể hóa mục **"Cách phối hợp và quy tắc thay đổi"** trong kế hoạch phát triển LibMate giữa **Lý Thế An** (`lythean2508`) và **Phạm Hiển**.

## 1. Phân công vai trò
- **Lý Thế An (`lythean2508`):** Giao diện (`React + TypeScript`), luồng người dùng, danh mục 100 đầu sách, bộ 30 câu đánh giá AI tiếng Việt, kiểm thử giao diện/UAT, hướng dẫn sử dụng và tổ chức pilot.
- **Phạm Hiển:** Backend (`Python + FastAPI`), cơ sở dữ liệu (`SQLite + migration`), pipeline embedding AI local (`intfloat/multilingual-e5-small`), kiểm thử nghiệp vụ/đồng thời và đóng gói vận hành/backup.

## 2. Quy ước nhánh Git (Một task một nhánh)
- Nhánh chính: `main` (luôn ở trạng thái chạy được và qua bộ test).
- Mỗi công việc tạo một nhánh riêng theo mã task trong Excel:
  - Giao diện / dữ liệu / tài liệu (An): `task/T03-frontend-init`, `task/T08-catalog-ui`, `task/T15-catalog-100-books`, `task/T25-ai-search-ui`, ...
  - Backend / DB / AI (Hiển): `task/T06-fastapi-sqlite`, `task/T10-auth-api`, `task/T17-issue-transaction`, `task/T28-embedding-index`, ...

## 3. Quy tắc Review trước khi ghép (Merge)
- Mỗi tuần có **2 buổi kiểm tra ngắn (20 phút)** để đồng bộ API và tiến độ.
- Mọi Pull Request thay đổi **mô hình dữ liệu, phân quyền, tồn kho hoặc hợp đồng API** bắt buộc có review của thành viên còn lại trước khi merge vào `main`.
- Cuối mỗi tuần chạy tích hợp lại toàn bộ luồng hiện có; hết Tuần 4 phải đảm bảo luồng mượn – trả xuyên suốt trước khi mở rộng AI.
