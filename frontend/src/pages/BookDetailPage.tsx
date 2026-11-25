import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AvailabilityBadge, ErrorState } from '../components/StateViews';
import { useAuth } from '../context/AuthContext';
import { libraryStore } from '../services/libraryStore';
import type { BookCopy, BookWithAvailability } from '../types/library';

export const BookDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { token, user, favoriteIds, toggleFavoriteBook, refreshUserAlerts } = useAuth();

  const [detail, setDetail] = useState<{
    book: BookWithAvailability;
    copies: BookCopy[];
    similar: BookWithAvailability[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [similarFeedback, setSimilarFeedback] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const loadDetail = useCallback(() => {
    if (!id) return;
    setError(null);
    try {
      const data = libraryStore.getBookDetail(id, token);
      setDetail(data);
      if (token) {
        setSimilarFeedback(libraryStore.getMyFeedbackMap(token, 'similar_book', id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được thông tin sách.');
    }
  }, [id, token]);

  useEffect(() => {
    setMessage(null);
    loadDetail();
  }, [loadDetail]);

  const handleBorrowRequest = () => {
    if (!id || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const req = libraryStore.submitBorrowRequest(token, id);
      refreshUserAlerts();
      loadDetail();
      setMessage({
        type: 'success',
        text: `Đã gửi yêu cầu mượn (${req.id}) thành công! Yêu cầu đang chờ không giữ cứng bản sao — vui lòng đến quầy thủ thư để nhận sách.`,
      });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không gửi được yêu cầu mượn.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSimilarFeedback = (similarBookId: string, useful: boolean) => {
    if (!id || !token) {
      setMessage({ type: 'error', text: 'Vui lòng đăng nhập để đánh giá sách tương tự.' });
      return;
    }
    libraryStore.submitRecommendationFeedback(token, {
      bookId: similarBookId,
      sourceType: 'similar_book',
      contextKey: id,
      useful,
    });
    setSimilarFeedback((prev) => ({ ...prev, [similarBookId]: useful }));
  };

  if (error) {
    return (
      <div>
        <ErrorState message={error} />
        <Link to="/" className="btn btn-outline">
          ← Quay lại danh mục
        </Link>
      </div>
    );
  }

  if (!detail) return null;

  const { book, copies, similar } = detail;
  const isFav = favoriteIds.has(book.id);

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/">← Quay lại danh mục sách</Link>
      </div>

      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`} role="alert">
          {message.text}
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
            <span className="badge badge-info">{book.category}</span>
            <span className="badge badge-neutral">Mã đầu sách: {book.id}</span>
            <span className="badge badge-neutral">Kệ: {book.shelf}</span>
            {!book.visible && <span className="badge badge-danger">Đang ẩn khỏi danh mục công khai</span>}
          </div>
          <AvailabilityBadge available={book.available_copies} total={book.total_copies} />
        </div>

        <h1 style={{ margin: '0.4rem 0', fontSize: '1.5rem' }}>{book.title}</h1>
        <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.9rem' }}>
          Tác giả: {book.author}
        </div>

        <p style={{ margin: '0 0 0.85rem', fontSize: '0.96rem' }}>{book.description}</p>

        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Nguồn metadata: {book.metadata_source} ({book.word_count} từ • Chỉ mục AI: {book.index_status === 'ready' ? 'Đã đồng bộ' : 'Chờ cập nhật'})
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {user ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting || book.available_copies <= 0}
                onClick={handleBorrowRequest}
              >
                {book.available_copies > 0 ? 'Gửi yêu cầu mượn đầu sách này' : 'Hiện hết bản sao sẵn có'}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => toggleFavoriteBook(book.id)}
              >
                {isFav ? '★ Bỏ khỏi Yêu thích' : '☆ Lưu vào Yêu thích'}
              </button>
            </>
          ) : (
            <Link to="/login" className="btn btn-primary">
              Đăng nhập để gửi yêu cầu mượn
            </Link>
          )}
        </div>
      </div>

      {/* Bảng danh sách bản sao vật lý (Phân biệt rõ Đầu sách vs Bản sao - F02 / T08) */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>
          Danh sách bản sao vật lý tại thư viện ({copies.length} bản)
        </h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã bản sao (`copy_code`)</th>
                <th>Trạng thái hiện tại</th>
                <th>Ghi chú tình trạng</th>
              </tr>
            </thead>
            <tbody>
              {copies.map((cp) => (
                <tr key={cp.id}>
                  <td>
                    <code>{cp.copy_code}</code>
                  </td>
                  <td>
                    {cp.status === 'available' && <span className="badge badge-success">Sẵn có trên kệ</span>}
                    {cp.status === 'borrowed' && <span className="badge badge-warning">Đang cho mượn</span>}
                    {cp.status === 'maintenance' && <span className="badge badge-danger">Đang bảo trì (không cho mượn)</span>}
                  </td>
                  <td>{cp.condition_note || 'Tốt'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gợi ý sách tương tự & phản hồi người đọc (F11 / T27 / TC25) */}
      <section>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.15rem' }}>
          Sách tương tự cùng nội dung / chủ đề (`F11`)
        </h2>
        <div className="grid-books">
          {similar.map((sim) => (
            <article key={sim.id} className="card book-card">
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span className="badge badge-info">{sim.category}</span>
                  <span className="badge badge-neutral">Kệ {sim.shelf}</span>
                </div>
                <h3 style={{ margin: '0.25rem 0', fontSize: '1rem' }}>
                  <Link to={`/books/${sim.id}`}>{sim.title}</Link>
                </h3>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{sim.author}</div>
                <p className="book-desc-clamp">{sim.description}</p>
              </div>

              <div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <AvailabilityBadge available={sim.available_copies} total={sim.total_copies} />
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${similarFeedback[sim.id] === true ? 'btn-success' : 'btn-outline'}`}
                    onClick={() => handleSimilarFeedback(sim.id, true)}
                  >
                    Hữu ích
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${similarFeedback[sim.id] === false ? 'btn-danger' : 'btn-outline'}`}
                    onClick={() => handleSimilarFeedback(sim.id, false)}
                  >
                    Chưa phù hợp
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
