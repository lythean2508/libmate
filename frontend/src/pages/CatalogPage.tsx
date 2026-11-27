import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AvailabilityBadge, EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { VasariShelfHero } from '../components/VasariShelfHero';
import { useAuth } from '../context/AuthContext';
import { SEED_BOOKS_WITH_AVAILABILITY } from '../data/bookCoversCatalog';
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

  const heroBooks = useMemo(() => {
    if (aiResponse && aiResponse.results.length > 0) {
      return aiResponse.results.map((r) => r.book);
    }
    return catalogResult.items.length > 0 ? catalogResult.items : SEED_BOOKS_WITH_AVAILABILITY;
  }, [aiResponse, catalogResult.items]);

  return (
    <div>
      {/* Full-Screen 3D Book Shelf Opening Hero */}
      <VasariShelfHero
        books={heroBooks}
        keyword={keyword}
        onKeywordChange={(val) => {
          setAiResponse(null);
          setKeyword(val);
        }}
        category={category}
        categories={categories}
        onCategoryChange={(cat) => {
          setAiResponse(null);
          setCategory(cat);
        }}
        onlyAvailable={onlyAvailable}
        onOnlyAvailableChange={setOnlyAvailable}
        aiQuery={aiQuery}
        onAiQueryChange={setAiQuery}
        onRunAiSearch={(customQ) => void handleRunAiSearch(undefined, customQ)}
        aiLoading={aiLoading}
        aiResponse={aiResponse}
        sampleAiQueries={SAMPLE_AI_QUERIES}
        totalMatched={catalogResult.total}
      />

      <div id="libmate-catalog-search" className="page-header">
        <div>
          <h1 className="page-title">Danh mục thư viện</h1>
          <p className="page-subtitle">
            Tra cứu 100 đầu sách bằng từ khóa không dấu hoặc mô tả nhu cầu tự nhiên.
          </p>
        </div>
      </div>

      {actionToast && (
        <div className="alert alert-info" role="status">
          {actionToast}
        </div>
      )}

      <div className="card catalog-filter-card">
        <div className="tabs">
          <button
            type="button"
            className={`tab-btn ${searchMode === 'keyword' ? 'active' : ''}`}
            onClick={() => setSearchMode('keyword')}
          >
            Tìm từ khóa &amp; Lọc chủ đề
          </button>
          <button
            type="button"
            className={`tab-btn ${searchMode === 'ai' ? 'active' : ''}`}
            onClick={() => setSearchMode('ai')}
          >
            Tìm theo nhu cầu bằng AI
          </button>
        </div>

        {searchMode === 'keyword' ? (
          <div className="form-grid" style={{ alignItems: 'end' }}>
            <div className="field">
              <label htmlFor="keywordInput">Tên sách hoặc tác giả</label>
              <input
                id="keywordInput"
                className="input"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Tìm tên sách hoặc tác giả..."
              />
            </div>

            <div className="field">
              <label htmlFor="categorySelect">Chủ đề</label>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem' }}>
                <input
                  type="checkbox"
                  checked={onlyAvailable}
                  onChange={(e) => setOnlyAvailable(e.target.checked)}
                />
                Chỉ hiện sách còn bản sẵn có
              </label>
            </div>
          </div>
        ) : (
          <div>
            <form onSubmit={(e) => void handleRunAiSearch(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="field">
                <label htmlFor="aiQueryInput">
                  Mô tả nhu cầu đọc hoặc chủ đề bạn quan tâm
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    id="aiQueryInput"
                    className="input"
                    style={{ flex: '1 1 320px' }}
                    value={aiQuery}
                    onChange={(e) => setAiQuery(e.target.value)}
                    placeholder="VD: Sách rèn sự tập trung khi ôn thi..."
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
                >
                  <input
                    type="checkbox"
                    checked={simulateOfflineFallback}
                    onChange={(e) => handleToggleSimulateFallback(e.target.checked)}
                  />
                  Mô phỏng lỗi mô hình AI (kiểm thử fallback)
                </label>
              </div>
            </form>

            <div style={{ marginTop: '0.75rem' }}>
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

      {/* KẾT QUẢ CHẾ ĐỘ TỪ KHÓA */}
      {searchMode === 'keyword' && (
        <>
          <div className="catalog-count-bar">
            Hiển thị <strong>{catalogResult.items.length}</strong> / <strong>{catalogResult.total}</strong> đầu sách
            {category !== 'ALL' ? ` · ${category}` : ''}
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
                    Thử tìm bằng AI
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
                        <div className="book-card-eyebrow">
                          <span>{book.category}</span>
                          <span>Kệ {book.shelf}</span>
                        </div>
                        <h2 className="book-card-title">
                          <Link to={`/books/${book.id}`}>{book.title}</Link>
                        </h2>
                        <div className="book-card-author">{book.author}</div>
                        <p className="book-desc-clamp">{book.description}</p>
                      </div>

                      <div className="book-card-footer">
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
                          <Link to={`/books/${book.id}`} className="btn btn-outline btn-sm">
                            Chi tiết →
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
                  <span style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--text-muted)' }}>
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

      {/* KẾT QUẢ CHẾ ĐỘ AI LOCAL */}
      {searchMode === 'ai' && (
        <div>
          {aiColdNotice && (
            <div className="alert alert-info" role="status">
              Đang khởi tạo bộ mã hóa ngữ nghĩa local lần đầu tiên...
            </div>
          )}

          {aiLoading && <LoadingState message="Đang đối chiếu ngữ nghĩa nhu cầu với chỉ mục 100 đầu sách..." />}
          {aiError && <ErrorState message={aiError} onRetry={() => void handleRunAiSearch()} />}

          {!aiLoading && aiResponse && (
            <div>
              {aiResponse.fallback_used && (
                <div className="alert alert-warning" role="alert">
                  <strong>Chế độ dự phòng từ khóa:</strong> {aiResponse.fallback_reason}
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
                        <div className="book-card-eyebrow" style={{ marginBottom: 0 }}>
                          <span>Gợi ý #{idx + 1} · {item.suggestion_tier}</span>
                          <span>· {item.book.category} · Kệ {item.book.shelf}</span>
                        </div>
                        <AvailabilityBadge
                          available={item.book.available_copies}
                          total={item.book.total_copies}
                        />
                      </div>

                      <h2 className="book-card-title" style={{ marginTop: '0.35rem' }}>
                        <Link to={`/books/${item.book.id}`}>{item.book.title}</Link>
                      </h2>
                      <div className="book-card-author" style={{ marginBottom: '0.55rem' }}>
                        {item.book.author}
                      </div>

                      <div className="reason-box" style={{ marginBottom: '0.65rem' }}>
                        <div>“{item.reason.excerpt}”</div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Đánh giá gợi ý:</span>
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

                        <Link to={`/books/${item.book.id}`} className="btn btn-outline btn-sm">
                          Xem chi tiết &amp; Đặt mượn →
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
