# T33 — Bộ 30 câu đánh giá AI tiếng Việt và Kết quả đối chiếu Baseline (`F10`, `AI07`, `AI08`, `R12`)

- **Phụ trách lập bộ câu hỏi & chạy kiểm chứng giao diện:** Lý Thế An (`lythean2508`)
- **Phối hợp hiệu chỉnh backend embedding (`T34`, `T47`):** Phạm Hiển
- **Quy mô danh mục:** `100` đầu sách tiếng Việt (`data/books_catalog_100.json`), mô tả `93–127` từ/sách.
- **Cấu trúc bộ câu hỏi (`data/ai_eval_30_queries_vi.json`):** `30` câu gán nhãn trước, chia tách nghiêm ngặt:
  - **Tập hiệu chỉnh (`calibration`):** `20` câu (`17` câu có sách phù hợp + `3` câu ngoài phạm vi không có sách phù hợp).
  - **Tập giữ lại độc lập (`holdout` — `R12`):** `10` câu (`9` câu có sách phù hợp + `1` câu ngoài phạm vi không có sách phù hợp).

> [!NOTE]
> Báo cáo dưới đây ghi nhận kết quả chạy thực tế của tầng **Local Vietnamese Semantic Engine** tích hợp sẵn trên Frontend so với **Baseline Tìm từ khóa**. Khi Phạm Hiển hoàn tất API `intfloat/multilingual-e5-small` trên FastAPI (`T29`, `T34`), cùng tập `data/ai_eval_30_queries_vi.json` này được dùng nguyên trạng để đo lại mà không sửa nhãn tập giữ lại (`R12`).

---

## 1. Tổng hợp chỉ số Hit@5 và Khả năng từ chối câu ngoài danh mục (`AI08`, `TC18`, `TC19`)

| Tập đánh giá | Nhóm câu hỏi | Tìm ngữ nghĩa AI (Hit@5) | Baseline Từ khóa (Hit@5) | So sánh với mục tiêu `AI08` (`>= 80%` & `>= Baseline`) |
| :--- | :--- | :--- | :--- | :--- |
| **Calibration (20 câu)** | Câu có sách phù hợp (`17` câu) | **17/17 (100.0%)** | 16/17 (94.1%) | Đạt vượt mức baseline |
| **Calibration (20 câu)** | Câu không có sách phù hợp (`3` câu) | **3/3 từ chối đúng** | 1/3 từ chối đúng | Đạt `TC19` (báo rõ chưa có sách vượt ngưỡng) |
| **Holdout độc lập (10 câu)** | Câu có sách phù hợp (`9` câu) | **9/9 (100.0%)** | 9/9 (100.0%) | **Đạt mục tiêu Hit@5 >= 80%** (`TC18`) |
| **Holdout độc lập (10 câu)** | Câu không có sách phù hợp (`1` câu) | **1/1 từ chối đúng** | 0/1 từ chối đúng | Đạt `TC19` |

- **Độ trễ truy vấn sau warm-up (100 đầu sách):** `p95 = 53.65 ms` (mục tiêu `AI09`: `<= 3000 ms`).

---

## 2. Bảng chi tiết từng câu hỏi trong bộ 30 câu (`Q01` – `Q30`)

| Mã | Tập | Loại câu | Truy vấn tiếng Việt | Nhãn kỳ vọng | Top 5 AI trả về | AI Đạt? | Top 5 Từ khóa | KW Đạt? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Q01` | `calibration` | `nhu_cau_tu_nhien` | Em hay bị căng thẳng lo lắng mất bình tĩnh trước kỳ thi học kỳ, có sách tâm lý nào giúp giảm áp lực không? | `B074, B088, B075` | `B074` | Đạt | `B074, B077, B078, B072, B084` | Đạt |
| `Q02` | `calibration` | `dong_nghia` | Cách bỏ tật nước đến chân mới nhảy, rèn kỷ luật tự giác mỗi ngày từng chút một | `B073, B081, B076` | `B073` | Đạt | `B073` | Đạt |
| `Q03` | `calibration` | `nhu_cau_tu_nhien` | Sách giải thích dễ hiểu về lỗ đen vũ trụ, vụ nổ Big Bang và thời gian cho học sinh phổ thông | `B033, B036, B039` | `B033` | Đạt | `B026, B063, B033, B022, B074` | Đạt |
| `Q04` | `calibration` | `nhu_cau_tu_nhien` | Mới bắt đầu học viết code Python cơ bản từ con số 0 theo chương trình tin học ở trường | `B053, B054` | `B053, B054, B056` | Đạt | `B053, B056, B060, B055, B057` | Đạt |
| `Q05` | `calibration` | `dong_nghia` | Truyện viết về tình cảm học trò đơn phương buồn man mác ở quê làng Đo Đo | `B001, B002` | `B001` | Đạt | `B065, B011, B001, B063, B076` | Đạt |
| `Q06` | `calibration` | `loi_go_khong_dau` | sach huong dan tu lam thi nghiem vat ly stem tu chai nhua tai che | `B040, B034` | `B040` | Đạt | `B040, B036, B034, B082, B035` | Đạt |
| `Q07` | `calibration` | `nhu_cau_tu_nhien` | Tài liệu lịch sử về chiến thắng Điện Biên Phủ và quyết định đánh chắc tiến chắc | `B064, B063` | `B064` | Đạt | `B064, B060, B028, B070` | Đạt |
| `Q08` | `calibration` | `nhu_cau_tu_nhien` | Làm sao để không bị điện thoại và mạng xã hội làm mất tập trung lúc ngồi vào bàn học? | `B081, B075, B073` | `B081` | Đạt | `B081, B056, B074, B098, B093` | Đạt |
| `Q09` | `calibration` | `dong_nghia` | Bí quyết bảo vệ mật khẩu tài khoản, nhận biết đường link lừa đảo trên mạng internet | `B056, B062` | `B056` | Đạt | `B056` | Đạt |
| `Q10` | `calibration` | `nhu_cau_tu_nhien` | Em chưa biết lớp 12 nên chọn ngành nghề đại học nào phù hợp tính cách và năng lực bản thân | `B079, B076` | `B079, B072` | Đạt | `B079, B093, B006, B018, B012` | Đạt |
| `Q11` | `calibration` | `nhu_cau_tu_nhien` | Giải thích các phản ứng hóa học đời thường trong nhà bếp như làm bánh nở hay xà phòng tẩy rửa | `B043, B051` | `B043` | Đạt | `B043, B087, B051, B049, B050` | Đạt |
| `Q12` | `calibration` | `dong_nghia` | Câu chuyện chú dế kiêu ngạo ân hận sau cái chết của Dế Choắt rồi đi chu du thiên hạ | `B003` | `B003` | Đạt | `B035, B037, B062, B042, B093` | Chưa đạt |
| `Q13` | `calibration` | `loi_go_khong_dau` | phuong phap giai toan hinh hoc khong gian va toa do oxyz lop 11 12 | `B026, B023` | `B026, B023` | Đạt | `B023, B026, B032, B030, B083` | Đạt |
| `Q14` | `calibration` | `nhu_cau_tu_nhien` | Tìm sách nói về chủ quyền quần đảo Hoàng Sa, Trường Sa và luật biển quốc tế | `B067, B066` | `B067` | Đạt | `B067, B041, B070, B059, B037` | Đạt |
| `Q15` | `calibration` | `nhu_cau_tu_nhien` | Cách vượt qua nỗi sợ run giọng khi đứng thuyết trình và tranh biện trước lớp | `B077, B078` | `B077` | Đạt | `B077, B063, B045, B069` | Đạt |
| `Q16` | `calibration` | `nhu_cau_tu_nhien` | Sách hướng dẫn lắp mạch điện tử Arduino cảm biến tưới cây tự động và làm robot dò đường | `B059, B040` | `B059` | Đạt | `B059, B074, B077, B019, B021` | Đạt |
| `Q17` | `calibration` | `dong_nghia` | Vì sao thức khuya học bài hại trí nhớ và vai trò của giấc ngủ đối với não bộ | `B088, B047, B075` | `B088, B047` | Đạt | `B088, B049, B073, B048, B067` | Đạt |
| `Q18` | `calibration` | `khong_co_sach` | Giáo trình kỹ thuật sửa chữa hộp số tự động ô tô tải hạng nặng và động cơ diesel tàu thủy | `(Rỗng - Không có)` | `(Từ chối dưới ngưỡng)` | Đạt | `B097, B037, B065, B093, B094` | Chưa đạt |
| `Q19` | `calibration` | `khong_co_sach` | Sách hướng dẫn đầu tư chứng khoán phái sinh đòn bẩy cao và giao dịch tiền mã hóa ngắn hạn | `(Rỗng - Không có)` | `(Từ chối dưới ngưỡng)` | Đạt | `B082, B099, B072, B085, B057` | Chưa đạt |
| `Q20` | `calibration` | `khong_co_sach` | Phác đồ phẫu thuật ghép gan chuyên sâu và gây mê hồi sức ngoại khoa bệnh viện tuyến cuối | `(Rỗng - Không có)` | `(Từ chối dưới ngưỡng)` | Đạt | `(Rỗng)` | Đạt |
| `Q21` | `holdout` | `nhu_cau_tu_nhien` | Em muốn học phương pháp ghi nhớ bài lâu bằng sơ đồ tư duy mindmap và ghi chép thông minh | `B100, B075` | `B100, B075` | Đạt | `B098, B100, B075, B096, B030` | Đạt |
| `Q22` | `holdout` | `dong_nghia` | Tiểu thuyết cảm động về người nông dân nghèo phải bán con bán chó giữa mùa sưu thuế trước cách mạng | `B006` | `B006` | Đạt | `B006` | Đạt |
| `Q23` | `holdout` | `nhu_cau_tu_nhien` | Tìm sách giải thích nguyên lý hoạt động của trí tuệ nhân tạo học máy và cách dùng AI không đạo văn | `B055, B062` | `B055, B062` | Đạt | `B055, B080, B062, B042, B054` | Đạt |
| `Q24` | `holdout` | `loi_go_khong_dau` | cach quan ly tien tieu vat tiet kiem chi tieu hop ly cho hoc sinh | `B080` | `B080` | Đạt | `B080, B040, B029, B042, B076` | Đạt |
| `Q25` | `holdout` | `nhu_cau_tu_nhien` | Tác hại của rác thải nhựa đại dương, hiệu ứng nhà kính và bảo vệ môi trường xanh ở trường | `B049, B052` | `B049, B052` | Đạt | `B052, B049, B046, B048, B047` | Đạt |
| `Q26` | `holdout` | `dong_nghia` | Hướng dẫn dùng Git chia nhánh quản lý mã nguồn khi làm bài tập lớn lập trình theo nhóm | `B061` | `B061, B053` | Đạt | `B061, B060, B053, B074, B036` | Đạt |
| `Q27` | `holdout` | `nhu_cau_tu_nhien` | Sách giúp ôn tập các thì ngữ pháp tiếng Anh, câu điều kiện và mệnh đề quan hệ thi tốt nghiệp | `B093, B095` | `B093, B094, B095` | Đạt | `B093, B043, B098, B035, B097` | Đạt |
| `Q28` | `holdout` | `nhu_cau_tu_nhien` | Kỹ năng sơ cứu khi bị bỏng, chảy máu cam, bong gân lúc tập thể dục và phòng chống đuối nước | `B082` | `B082` | Đạt | `B082` | Đạt |
| `Q29` | `holdout` | `dong_nghia` | Truyện thiếu nhi về cậu bé mồ côi đi theo gánh xiếc rong cùng cụ già nhân hậu và chú chó Capi | `B015` | `B015` | Đạt | `B090, B015, B045, B084, B066` | Đạt |
| `Q30` | `holdout` | `khong_co_sach` | Luật thuế thu nhập doanh nghiệp xuyên biên giới và kế toán kiểm toán tập đoàn đa quốc gia | `(Rỗng - Không có)` | `(Từ chối dưới ngưỡng)` | Đạt | `B046` | Chưa đạt |
