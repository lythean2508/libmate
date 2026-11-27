# LibMate — Ứng dụng Thư viện Trường học Tích hợp AI Local

Kho lưu trữ chính thức của dự án **LibMate** theo kế hoạch phát triển 8 tuần.

- **Thành viên phát triển:**
  - **Lý Thế An (`@lythean2508`):** Giao diện (`React + TypeScript`), luồng người dùng, danh mục 100 đầu sách, bộ 30 câu đánh giá AI tiếng Việt, kiểm thử giao diện/UAT, tài liệu hướng dẫn và tổ chức Pilot.
  - **Phạm Hiển:** Backend (`Python + FastAPI`), cơ sở dữ liệu (`SQLite + migration`), mô hình embedding AI local (`intfloat/multilingual-e5-small`), kiểm thử đồng thời/bảo mật và đóng gói vận hành/backup.

---

## 1. Mục tiêu & Quyết định phạm vi MVP

- **Mục tiêu cốt lõi:** Người đọc tìm đúng sách trong thư viện trường học (bằng từ khóa có/không dấu hoặc mô tả nhu cầu tự nhiên bằng tiếng Việt); thủ thư quản lý chính xác từng **bản sao vật lý (`copy_code`)** tách biệt với **đầu sách (`Book`)**, giao/trả sách an toàn và theo dõi quá hạn.
- **AI miễn phí 100% phí API:** Chạy mô hình ngữ nghĩa cục bộ trên CPU, chỉ đọc metadata được phép sử dụng (tên sách, tác giả, chủ đề, mô tả ngắn 80–200 từ). Không đọc toàn văn bản quyền, không gửi dữ liệu cá nhân học sinh lên đám mây.
- **Chưa triển khai trong MVP:** Chatbot toàn văn (`F16`), quét mã vạch/QR (`F15` — đưa vào backlog sau MVP), tiền phạt, gửi Email/SMS tự động, nhận diện khuôn mặt và SSO (`F17`).

---

## 2. Cấu trúc thư mục dự án

```text
libmate/
├── frontend/                              # Ứng dụng React + TypeScript + Vite (Phụ trách: Lý Thế An)
│   ├── src/
│   │   ├── components/                    # Layout đáp ứng Desktop/Mobile, StateViews, nhắc hạn trong app
│   │   ├── context/                       # Quản lý phiên đăng nhập, phân quyền màn hình & cảnh báo hạn
│   │   ├── data/seedCatalog.ts            # Dữ liệu 100 đầu sách, 201 bản sao & 30 câu đánh giá AI
│   │   ├── pages/                         # Danh mục/AI, Chi tiết, Lịch sử/Yêu cầu, Yêu thích, 3 màn Thủ thư, Hướng dẫn
│   │   ├── services/                      # libraryStore (nghiệp vụ chuẩn hóa) & semanticEngine (AI local + fallback)
│   │   ├── test/an_uat.test.tsx           # Bộ kiểm thử tự động Vitest cho toàn bộ ca kiểm thử của An
│   │   └── utils/vietnamese.ts            # Chuẩn hóa tiếng Việt không dấu, ngày quá hạn múi giờ VN, xuất CSV UTF-8 BOM
│   ├── scripts/runAiEval.ts               # Công cụ đo Hit@5 bộ 30 câu tiếng Việt (20 hiệu chỉnh / 10 giữ lại)
│   └── .env.example                       # Cấu hình mẫu không chứa bí mật (T46)
├── data/
│   ├── books_catalog_100.json / .csv      # T15: 100 đầu sách trường học (mô tả 93–127 từ/sách, có nguồn metadata)
│   ├── copies_seed.json                   # T15: 201 bản sao vật lý với mã copy_code duy nhất
│   ├── ai_eval_30_queries_vi.json / .csv  # T33: 30 câu hỏi tiếng Việt gán nhãn trước (20 calibration + 10 holdout)
│   ├── pilot_observation_template.csv     # T37–T38: Bảng ghi nhận thực tế cho 10 người dùng thử Pilot
│   ├── tien_do_cong_viec_ly_the_an.csv    # Bảng cập nhật tiến độ & bằng chứng 24 công việc của Lý Thế An
│   └── ket_qua_kiem_thu_ly_the_an.csv     # Bảng cập nhật kết quả 11 ca kiểm thử do Lý Thế An phụ trách
├── docs/
│   ├── 01-khao-sat-nguoi-dung-T01.md      # T01 & R01: Khảo sát thủ thư/người đọc & bảng ghi nhận thực địa
│   ├── 02-thiet-ke-luong-va-giao-dien-T02.md # T02: Luồng nghiệp vụ, phân quyền màn hình & hợp đồng API với Backend
│   ├── 03-bao-cao-danh-gia-ai-T33.md      # T33: Báo cáo tự động chạy bộ 30 câu tiếng Việt so với baseline từ khóa
│   ├── 04-kich-ban-va-bieu-mau-pilot-T37-T38.md # T37–T38: Hướng dẫn 10 tài khoản Pilot & phân loại lỗi ưu tiên
│   ├── 05-bao-cao-kiem-thu-uat-an-T43.md  # T43: Báo cáo kiểm thử UAT giao diện & bằng chứng thực thi
│   ├── 06-huong-dan-su-dung-T44.md        # T44: Hướng dẫn người đọc/thủ thư, quy tắc mượn/trả, FAQ & giới hạn AI
│   ├── 07-kich-ban-demo-va-bao-cao-du-an-T45.md # T45: Kịch bản demo 5 phút, vai trò 2 thành viên & backlog sau MVP
│   └── 08-checklist-review-backend-va-quan-ly-rui-ro-an.md # Checklist review 24 task của Phạm Hiển & quản lý 6 rủi ro của An
├── CONTRIBUTING.md                        # Quy tắc phối hợp, một task một nhánh Git & review chéo
└── .github/pull_request_template.md       # Mẫu Pull Request đối chiếu mã task và ca kiểm thử Excel
```

---

## 3. Hướng dẫn cài đặt và chạy nhanh trên máy sạch

### Giao diện chat tìm sách

Trang chủ hiện là khung trò chuyện **LibMate**. Nhập “em muốn học toán”, “em muốn học lập trình Python” hoặc tên sách/tác giả; ứng dụng tự tìm sách trong danh mục, hiển thị mô tả, vị trí kệ, số bản còn lại và liên kết xem/đặt mượn. Hỗ trợ tiếng Việt không dấu, câu hỏi tiếp “còn sách nào khác không?”, lọc sách còn bản và bắt đầu cuộc trò chuyện mới. Danh mục đầy đủ ở `/catalog`.

Phần chat dùng **Gemini 3.5 Flash-Lite** bên ngoài qua API chính thức của Google. **Đăng nhập Google trước khi dùng AI** bằng nút Google ngay trong LibMate. Máy chủ xác minh ID token, tạo phiên cookie HttpOnly và kiểm tra phiên cho từng lần gọi AI. Chỉ gửi câu hỏi, tối đa 8 tin nhắn ngữ cảnh và metadata sách; không gửi thông tin tài khoản Google hay phiếu mượn cho Gemini. Các thẻ sách được đối chiếu với danh mục thật. Khi Gemini lỗi hoặc hết quota, ứng dụng ghi rõ đang dùng tìm kiếm thư viện dự phòng; yêu cầu đăng nhập vẫn được giữ nguyên.

Gemini có Free Tier với hạn mức theo tài khoản/dự án, không phải miễn phí không giới hạn. Dùng API key của dự án Free Tier nếu muốn chạy không tính phí. Xem [giá Gemini](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite). Google Sign-In dùng thông tin cơ bản `openid`, `email`, `profile`; không yêu cầu Gmail hay Drive. Tài khoản Google dùng cho AI; tài khoản thẻ thư viện hiện có tiếp tục dùng cho mượn/trả và vai trò thủ thư.

Tạo `frontend/.env.local` với các biến sau (tệp đã được Git bỏ qua; không đặt API key trong biến `VITE_*`):

```dotenv
GEMINI_API_KEY=your_private_gemini_key
GEMINI_MODEL=gemini-3.5-flash-lite
GOOGLE_CLIENT_ID=your_web_client.apps.googleusercontent.com
```

Trong Google Auth Platform, tạo OAuth client loại **Web application**, khai báo origins `http://localhost:5173` và `http://localhost:4173`. Khi ở chế độ Testing, thêm email dùng thử vào Test users. Khởi động lại Vite sau khi sửa cấu hình, rồi mở **http://localhost:5173/** (không dùng địa chỉ IP cho Google Sign-In). Không cần Client Secret cho luồng Google Identity Services này. Xem [thiết lập Google Sign-In](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

Các endpoint `/api/ai/session` và `/api/ai/chat` chạy trong máy chủ Vite, dùng được với `npm run dev` và `npm run preview`. Nếu triển khai riêng tệp tĩnh `dist/`, cần triển khai thêm máy chủ cho các endpoint này. Hội thoại được giữ trong bộ nhớ khi mở chi tiết sách rồi quay lại; tải lại trang sẽ bắt đầu lại.

Các màn hình hiện dùng dữ liệu `localStorage`. Lớp `apiClient` đã có sẵn nhưng chưa được nối vào các màn hình, nên đổi `VITE_API_MODE=api` chưa tự động chuyển giao diện sang FastAPI/SQLite.

Yêu cầu: **Node.js >= 20** và **npm**.

```bash
# 1. Cài đặt thư viện Frontend
cd frontend
npm install

# 2. Chạy ứng dụng chế độ phát triển (mở được trên cả máy local và điện thoại cùng mạng LAN)
npm run dev

# 3. Chạy bộ kiểm thử tự động UAT (Vitest + Testing Library)
npm test

# 4. Chạy bộ đánh giá 30 câu hỏi tiếng Việt (sinh báo cáo docs/03-bao-cao-danh-gia-ai-T33.md)
npm run eval:ai

# 5. Đóng gói bản build sản phẩm
npm run build
```

---

## 4. Tài khoản thử nghiệm có sẵn

Danh mục đã đối chiếu gồm **100 sách thật**, với bìa lưu tại `frontend/public/covers/` và liên kết trực tiếp trên danh mục, kết quả chat, chi tiết, mục yêu thích. Có 7 ấn bản tiếng Anh được ghi rõ ngôn ngữ. Nguồn và dấu kiểm tra ảnh nằm trong `data/book_sources_100.json`; tên tập, bản truyện tranh và tác giả được đồng bộ trong dữ liệu seed. Liên kết dẫn đến trang giới thiệu, mua hoặc đọc sách tùy nguồn, không mặc định là toàn văn miễn phí.

Khi tải lại ứng dụng, các mục demo chưa được sửa sẽ tự cập nhật; tài khoản, mã sách, bản sao, kệ, trạng thái ẩn, phiếu mượn/trả và yêu thích được giữ lại. Những mục đã được thủ thư sửa tên, tác giả hoặc mô tả được giữ nguyên. Báo cáo đánh giá 30 câu T33 cũ dùng nhãn của danh mục demo, cần gán nhãn lại trước khi dùng để kết luận chất lượng tìm kiếm trên danh mục mới.

| Vai trò | Mã đăng nhập | Mật khẩu | Mục đích kiểm thử |
| :--- | :--- | :--- | :--- |
| **Thủ thư** | `LIB001` | `libmate123` | Toàn quyền Quầy giao/trả, Quản lý sách/bản sao, Báo cáo & Xuất CSV |
| **Người đọc 1** | `HS10A1` | `reader123` | Có sẵn phiếu quá hạn, phiếu đúng hạn, yêu cầu chờ & sách yêu thích |
| **Người đọc 2** | `HS11B2` | `reader123` | Có sách sắp đến hạn trả (≤ 3 ngày) để kiểm tra thanh nhắc hạn trong app |
| **10 Người thử Pilot** | `PILOT01` → `PILOT10` | `pilot123` | Dùng cho buổi thử nghiệm thực tế 10 người ở Tuần 7 (`T37`) |
| **Tài khoản bị khóa** | `HSKHOA` | `reader123` | Kiểm thử chặn đăng nhập / chặn gửi yêu cầu mượn (`T16`) |

---

## 5. Phối hợp tích hợp với Backend của Phạm Hiển

- Sao chép `frontend/.env.example` thành `frontend/.env`.
- Khi chạy độc lập để phát triển giao diện / demo sớm: giữ `VITE_API_MODE=mock`.
- Để ghép với FastAPI + SQLite (`http://localhost:8000`), cần nối các màn hình đang dùng `libraryStore` sang `apiClient`, rồi đổi `VITE_API_MODE=api` và đối chiếu hợp đồng endpoint tại [`docs/02-thiet-ke-luong-va-giao-dien-T02.md`](docs/02-thiet-ke-luong-va-giao-dien-T02.md).
