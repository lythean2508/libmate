import React from 'react';

export const GuidePage: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Hướng dẫn Sử dụng, Quy tắc Mượn/Trả &amp; Giới hạn AI (`T44`)</h1>
          <p className="page-subtitle">
            Tài liệu tra cứu nhanh dành cho Học sinh / Người đọc và Thủ thư trường học.
          </p>
        </div>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>1. Quy tắc mượn – trả sách trong MVP</h2>
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li>
            <strong>Giới hạn mượn đề xuất:</strong> Tối đa <strong>03 cuốn đang mượn</strong> cùng lúc trên mỗi thẻ bạn đọc.
          </li>
          <li>
            <strong>Thời hạn mượn đề xuất:</strong> <strong>14 ngày lịch</strong> tính từ ngày thủ thư xác nhận giao sách tại quầy. Đúng ngày đến hạn vẫn được tính là đúng hạn; sang ngày tiếp theo theo giờ máy chủ mới chuyển sang nhãn <em>Quá hạn</em> (`TC16`).
          </li>
          <li>
            <strong>Quy tắc đặt yêu cầu mượn:</strong> Yêu cầu mượn (`pending`) gắn với <em>Đầu sách</em>, chưa giữ cứng bản sao vật lý trên kệ để tránh giữ chỗ ảo. Mỗi bạn đọc chỉ gửi tối đa 1 yêu cầu đang chờ cho cùng một đầu sách (`TC09`).
          </li>
          <li>
            <strong>Nhận và trả sách:</strong> Thủ thư chọn đúng mã bản sao (`copy_code`) tại quầy để giao. Khi trả sách có hư hỏng, thủ thư tích chọn <em>Cần bảo trì</em> để hệ thống tạm khóa cho mượn bản sao đó (`TC15`).
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>2. Cách dùng Tìm kiếm AI Local &amp; Giới hạn cần biết</h2>
        <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li>
            <strong>Khi nào nên dùng Tìm theo nhu cầu AI?</strong> Khi bạn chưa biết tên sách cụ thể mà muốn mô tả vấn đề học tập, kỹ năng hoặc nội dung cần tìm bằng câu tiếng Việt tự nhiên.
          </li>
          <li>
            <strong>AI đọc dữ liệu gì?</strong> Mô hình embedding chạy hoàn toàn miễn phí trên CPU cục bộ, <strong>chỉ đọc tên sách, tác giả, chủ đề và mô tả ngắn đã được kiểm duyệt quyền sử dụng</strong>. Hệ thống không đọc toàn văn sách và không đưa dữ liệu cá nhân/lịch sử mượn của học sinh vào mô hình.
          </li>
          <li>
            <strong>Hiểu đúng kết quả gợi ý:</strong> Danh sách Top 5 là gợi ý tham khảo kèm trích dẫn nguyên văn từ mô tả gốc (`AI05`), không phải chatbot trả lời toàn văn và không coi điểm tương đồng cosine là xác suất chính xác 100% (`AI06`).
          </li>
          <li>
            <strong>Khi mô hình chưa nạp xong hoặc lỗi:</strong> Hệ thống tự động chuyển về tìm kiếm từ khóa dự phòng (`Fallback`) để việc tra cứu và mượn – trả không bao giờ bị gián đoạn (`TC23`).
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.15rem' }}>3. Câu hỏi thường gặp (FAQ)</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <strong>Hỏi: Tôi có thể hủy phiếu sau khi đã nhận sách tại quầy không?</strong>
            <div style={{ color: 'var(--text-muted)' }}>
              Đáp: Không. Bạn chỉ có thể bấm <em>Hủy yêu cầu</em> khi yêu cầu đang ở trạng thái <code>Đang chờ</code>. Khi đã nhận sách, phiếu chuyển sang <code>Đang mượn</code> và cần mang sách tới quầy thủ thư để xác nhận trả (`TC10`).
            </div>
          </div>
          <div>
            <strong>Hỏi: Hệ thống có gửi email hay tin nhắn SMS nhắc hạn trả không?</strong>
            <div style={{ color: 'var(--text-muted)' }}>
              Đáp: Trong phạm vi MVP miễn phí, thông báo sắp đến hạn (còn ≤ 3 ngày) và quá hạn được hiển thị bằng thanh cảnh báo trực tiếp ngay trong ứng dụng khi bạn đăng nhập (`F12`).
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
