import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AvailabilityBadge, EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { useAuth } from '../context/AuthContext';
import { libraryStore } from '../services/libraryStore';
import type { SemanticSearchResponse } from '../types/library';

const SAMPLE_AI_QUERIES = [
  'Em hay bị căng thẳng lo lắng trước kỳ thi, có sách nào giúp giảm áp lực không?',
  'Cách bỏ tật nước đến chân mới nhảy và rèn kỷ luật tự học mỗi ngày',
  'Sách giải thích dễ hiểu về lỗ đen vũ trụ và vụ nổ Big Bang',
  'sach huong dan tu lam thi nghiem vat ly stem tu chai nhua tai che',
];

export const CatalogPage: React.FC = () => {
  const { token, user, favoriteIds, toggleFavoriteBook } = useAuth();

  const [searchMode, setSearchMode] = useState<'keyword' | 'ai'>('keyword');
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('ALL');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [page, setPage] = useState(1);

  const [aiQuery, setAiQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiColdNotice, setAiColdNotice] = useState(false);
  const [aiResponse, setAiResponse] = useState<SemanticSearchResponse | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, boolean>>({});
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [simulateOfflineFallback, setSimulateOfflineFallback] = useState(
    () => libraryStore.getAiRuntimeState().simulateError
  );

  const categories = useMemo(() => libraryStore.getCategories(), []);

  // Tự động về trang 1 khi đổi từ khóa hoặc bộ lọc; nhưng giữ nguyên bộ lọc khi sang trang (TC06)
  useEffect(() => {
    setPage(1);
  }, [keyword, category, onlyAvailable]);

  const catalogResult = useMemo(
    () =>
      libraryStore.listCatalogBooks({
        query: keyword,
        category,
        onlyAvailable,
        page,
        pageSize: 12,
      }),
    [keyword, category, onlyAvailable, page]
  );

  const handleRunAiSearch = async (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const targetQuery = (customQuery ?? aiQuery).trim();
    if (customQuery !== undefined) setAiQuery(customQuery);

    setAiError(null);
    const runtime = libraryStore.getAiRuntimeState();
    setAiColdNotice(!runtime.warm && !runtime.simulateError);
    setAiLoading(true);

    try {
      const res = await libraryStore.searchSemantic(targetQuery, { onlyAvailable });
      setAiResponse(res);
      if (token && targetQuery) {
        setFeedbackMap(libraryStore.getMyFeedbackMap(token, 'semantic_search', targetQuery));
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Không thể thực hiện tìm kiếm AI.');
    } finally {
      setAiLoading(false);
      setAiColdNotice(false);
    }
  };

  const handleToggleSimulateFallback = (checked: boolean) => {
    libraryStore.setSimulateAiOfflineError(checked);
    setSimulateOfflineFallback(checked);
    if (aiQuery.trim()) {
      void handleRunAiSearch(undefined, aiQuery);
    }
  };

  const handleFeedback = (bookId: string, useful: boolean) => {
    if (!token || !aiResponse) {
      setActionToast('Vui lòng đăng nhập để ghi nhận đánh giá hữu ích.');
      return;
    }
    libraryStore.submitRecommendationFeedback(token, {
      bookId,
      sourceType: 'semantic_search',
      contextKey: aiResponse.query,
      useful,
    });
    setFeedbackMap((prev) => ({ ...prev, [bookId]: useful }));
    setActionToast('Đã lưu phản hồi chất lượng gợi ý AI.');
  };

  const handleFavorite = (bookId: string) => {
    try {
      const added = toggleFavoriteBook(bookId);
      setActionToast(added ? 'Đã thêm vào danh sách Yêu thích.' : 'Đã bỏ khỏi danh sách Yêu thích.');
    } catch (err) {
      setActionToast(err instanceof Error ? err.message : 'Cần đăng nhập.');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Danh mục sách &amp; Tìm kiếm thông minh</h1>
          <p className="page-subtitle">
            Tra cứu 100 đầu sách thư viện trường học bằng từ khóa (có/không dấu) hoặc mô tả nhu cầu tự nhiên với AI local miễn phí.
          </p>
        </div>
      </div>

      {actionToast && (
        <div className="alert alert-info" role="status">
          {actionToast}
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="tabs">
          <button
            type="button"
            className={`tab-btn ${searchMode === 'keyword' ? 'active' : ''}`}
            onClick={() => setSearchMode('keyword')}
          >
            Tìm từ khóa &amp; Lọc chủ đề (F04)
          </button>
          <button
            type="button"
            className={`tab-btn ${searchMode === 'ai' ? 'active' : ''}`}
            onClick={() => setSearchMode('ai')}
          >
            Tìm theo nhu cầu bằng AI Local (F10)
          </button>
        </div>

        {searchMode === 'keyword' ? (
          <div className="form-grid" style={{ alignItems: 'end' }}>
            <div className="field">
              <label htmlFor="keywordInput">Tên sách hoặc tác giả (hỗ trợ không dấu)</label>
              <input
                id="keywordInput"
                className="input"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="VD: Mắt Biếc, mat biec, Nguyễn Nhật Ánh, Python..."
              />
            </div>

            <div className="field">
              <label htmlFor="categorySelect">Chủ đề môn học / Tủ sách</label>
              <select
                id="categorySelect"
                className="select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="ALL">Tất cả chủ đề ({categories.length})</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ justifyContent: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={onlyAvailable}
                  onChange={(e) => setOnlyAvailable(e.target.checked)}
                />
                Chỉ hiện sách còn bản sẵn có trên kệ
              </label>
            </div>
          </div>
        ) : (
          <div>
            <form onSubmit={(e) => void handleRunAiSearch(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="field">
                <label htmlFor="aiQueryInput">
                  Mô tả nhu cầu đọc, vấn đề học tập hoặc nội dung bạn muốn tìm (Top 5 gợi ý từ danh mục)
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    id="aiQueryInput"
                    className="input"
                    style={{ flex: '1 1 320px' }}
                    value={aiQuery}
                    onChange={(e) => setAiQuery(e.target.value)}
                    placeholder="VD: Em muốn tìm sách rèn sự tập trung để không xao nhãng điện thoại khi ôn thi..."
                  />
                  <button type="submit" className="btn btn-primary" disabled={aiLoading}>
                    {aiLoading ? 'Đang phân tích...' : 'Tìm gợi ý AI'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.85rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={onlyAvailable}
                    onChange={(e) => setOnlyAvailable(e.target.checked)}
                  />
                  Chỉ gợi ý sách đang còn bản sẵn có
                </label>

                <label
                  style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', color: 'var(--text-muted)' }}
                  title="Dùng để kiểm thử ca TC23: Model lỗi hoặc chưa tải được -> tự chuyển về tìm từ khóa"
                >
                  <input
                    type="checkbox"
                    checked={simulateOfflineFallback}
                    onChange={(e) => handleToggleSimulateFallback(e.target.checked)}
                  />
                  Mô phỏng lỗi mô hình AI (kiểm thử fallback từ khóa - TC23)
                </label>
              </div>
            </form>

            <div style={{ marginTop: '0.75rem' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginRight: '0.4rem' }}>
                Thử nhanh câu hỏi mẫu:
              </span>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                {SAMPLE_AI_QUERIES.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => void handleRunAiSearch(undefined, sample)}
                  >
                    {sample.length > 52 ? `${sample.slice(0, 52)}...` : sample}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KẾT QUẢ CHẾ ĐỘ TỪ KHÓA (T08 / TC05 / TC06) */}
      {searchMode === 'keyword' && (
        <>
          <div style={{ marginBottom: '0.75rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Hiển thị <strong>{catalogResult.items.length}</strong> / tổng số{' '}
            <strong>{catalogResult.total}</strong> đầu sách phù hợp
            {category !== 'ALL' ? ` trong chủ đề "${category}"` : ''}.
          </div>

          {catalogResult.items.length === 0 ? (
            <EmptyState
              title="Không tìm thấy đầu sách phù hợp"
              description="Không có cuốn sách nào khớp với bộ lọc hiện tại. Hãy thử bỏ lọc hoặc chuyển sang chế độ Tìm theo nhu cầu bằng AI."
              action={
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setKeyword('');
                      setCategory('ALL');
                      setOnlyAvailable(false);
                    }}
                  >
                    Xóa bộ lọc
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setAiQuery(keyword);
                      setSearchMode('ai');
                    }}
                  >
                    Thử tìm bằng AI Local
                  </button>
                </div>
              }
            />
          ) : (
            <>
              <div className="grid-books">
                {catalogResult.items.map((book) => {
                  const isFav = favoriteIds.has(book.id);
                  return (
                    <article key={book.id} className="card book-card">
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.4rem' }}>
                          <span className="badge badge-info">{book.category}</span>
                          <span className="badge badge-neutral">Kệ {book.shelf}</span>
                        </div>
                        <h2 style={{ margin: '0.2rem 0', fontSize: '1.05rem' }}>
                          <Link to={`/books/${book.id}`}>{book.title}</Link>
                        </h2>
                        <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                          {book.author}
                        </div>
                        <p className="book-desc-clamp">{book.description}</p>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <AvailabilityBadge available={book.available_copies} total={book.total_copies} />
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          {user && (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              aria-label={isFav ? `Bỏ yêu thích ${book.title}` : `Lưu yêu thích ${book.title}`}
                              onClick={() => handleFavorite(book.id)}
                            >
                              {isFav ? '★ Đã lưu' : '☆ Yêu thích'}
                            </button>
                          )}
                          <Link to={`/books/${book.id}`} className="btn btn-primary btn-sm">
                            Chi tiết
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {catalogResult.totalPages > 1 && (
                <nav className="pagination" aria-label="Phân trang danh mục">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={catalogResult.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ← Trang trước
                  </button>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                    Trang {catalogResult.page} / {catalogResult.totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={catalogResult.page >= catalogResult.totalPages}
                    onClick={() => setPage((p) => Math.min(catalogResult.totalPages, p + 1))}
                  >
                    Trang sau →
                  </button>
                </nav>
              )}
            </>
          )}
        </>
      )}

      {/* KẾT QUẢ CHẾ ĐỘ AI LOCAL (T25 / T26 / AI05 / AI06 / TC19 / TC23) */}
      {searchMode === 'ai' && (
        <div>
          {aiColdNotice && (
            <div className="alert alert-info" role="status">
              <strong>Thông báo nạp mô hình lần đầu (Cold-start):</strong> Hệ thống đang khởi tạo bộ mã hóa ngữ nghĩa local lần đầu tiên. Các lượt tìm kiếm tiếp theo sẽ phản hồi tức thì.
            </div>
          )}

          {aiLoading && <LoadingState message="Đang đối chiếu ngữ nghĩa nhu cầu với chỉ mục 100 đầu sách..." />}
          {aiError && <ErrorState message={aiError} onRetry={() => void handleRunAiSearch()} />}

          {!aiLoading && aiResponse && (
            <div>
              {aiResponse.fallback_used && (
                <div className="alert alert-warning" role="alert">
                  <strong>Chế độ dự phòng từ khóa (`Fallback`):</strong> {aiResponse.fallback_reason}
                </div>
              )}

              {!aiResponse.fallback_used && aiResponse.model_cold_start_ms !== undefined && (
                <div className="alert alert-info">
                  Đã nạp sẵn sàng mô hình <code>{aiResponse.model_name}</code> (thời gian khởi động lần đầu: {aiResponse.model_cold_start_ms} ms). Lưu ý: Kết quả dưới đây là <strong>gợi ý tham khảo dựa trên metadata gốc</strong>, không xem điểm tương đồng là xác suất tuyệt đối (`AI06`).
                </div>
              )}

              {aiResponse.results.length === 0 ? (
                <EmptyState
                  title="Chưa có đầu sách phù hợp vượt ngưỡng gợi ý"
                  description={
                    aiResponse.below_threshold_message ||
                    'Danh mục thư viện hiện chưa có sách khớp sát nhu cầu này.'
                  }
                  action={
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        setKeyword(aiResponse.query);
                        setSearchMode('keyword');
                      }}
                    >
                      Chuyển sang tìm từ khóa thường
                    </button>
                  }
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                  {aiResponse.results.map((item, idx) => (
                    <article key={item.book.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="badge badge-info">Gợi ý #{idx + 1}</span>
                          <span className="badge badge-neutral">{item.suggestion_tier}</span>
                          <span className="badge badge-neutral">{item.book.category}</span>
                          <span className="badge badge-neutral">Kệ {item.book.shelf}</span>
                        </div>
                        <AvailabilityBadge
                          available={item.book.available_copies}
                          total={item.book.total_copies}
                        />
                      </div>

                      <h2 style={{ margin: '0.5rem 0 0.2rem', fontSize: '1.15rem' }}>
                        <Link to={`/books/${item.book.id}`}>{item.book.title}</Link>
                      </h2>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.55rem' }}>
                        Tác giả: <strong>{item.book.author}</strong>
                      </div>

                      {/* Lý do trích xuất hoàn toàn từ metadata gốc — không tự chế bằng LLM (T26 / AI05) */}
                      <div className="reason-box" style={{ marginBottom: '0.65rem' }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
                          Bằng chứng khớp từ metadata ({item.reason.matched_fields.join(', ')}):
                        </div>
                        <div>“{item.reason.excerpt}”</div>
                      </div>

                      <details style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '0.7rem' }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                          Xem toàn bộ mô tả gốc trong danh mục
                        </summary>
                        <p style={{ marginTop: '0.4rem' }}>{item.book.description}</p>
                      </details>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem' }}>
                          <span>Đánh giá gợi ý:</span>
                          <button
                            type="button"
                            className={`btn btn-sm ${feedbackMap[item.book.id] === true ? 'btn-success' : 'btn-outline'}`}
                            onClick={() => handleFeedback(item.book.id, true)}
                          >
                            Hữu ích
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${feedbackMap[item.book.id] === false ? 'btn-danger' : 'btn-outline'}`}
                            onClick={() => handleFeedback(item.book.id, false)}
                          >
                            Chưa phù hợp
                          </button>
                        </div>

                        <Link to={`/books/${item.book.id}`} className="btn btn-primary btn-sm">
                          Xem chi tiết &amp; Đặt mượn
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
