import React, { useMemo, useState } from 'react';
import { AvailabilityBadge } from '../components/StateViews';
import { useAuth } from '../context/AuthContext';
import { libraryStore } from '../services/libraryStore';
import type { BookCopy, BookWithAvailability } from '../types/library';
import { countWords } from '../utils/vietnamese';

export const LibrarianBooksPage: React.FC = () => {
  const { token } = useAuth();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);

  // Form Đầu sách (Book) — phân biệt rõ với Bản sao (Copy) theo T09
  const [editingBookId, setEditingBookId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState('Khoa học thường thức');
  const [shelf, setShelf] = useState('D2-09');
  const [description, setDescription] = useState('');
  const [metadataSource, setMetadataSource] = useState(
    'Thủ thư biên tập nội bộ tại trường (metadata được phép sử dụng)'
  );
  const [visible, setVisible] = useState(true);

  // Ngăn quản lý Bản sao vật lý (Copy) của 1 đầu sách đang chọn
  const [selectedBookForCopies, setSelectedBookForCopies] = useState<{
    book: BookWithAvailability;
    copies: BookCopy[];
  } | null>(null);
  const [newCopyCode, setNewCopyCode] = useState('');
  const [newCopyCondition, setNewCopyCondition] = useState('Tốt');

  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const listData = useMemo(() => {
    void refreshTick;
    return libraryStore.listCatalogBooks({
      query: search,
      page,
      pageSize: 10,
      includeHiddenForLibrarianToken: token,
    });
  }, [search, page, token, refreshTick]);

  const resetBookForm = () => {
    setEditingBookId(undefined);
    setTitle('');
    setAuthor('');
    setCategory('Khoa học thường thức');
    setShelf('');
    setDescription('');
    setVisible(true);
  };

  const startEditBook = (book: BookWithAvailability) => {
    setEditingBookId(book.id);
    setTitle(book.title);
    setAuthor(book.author);
    setCategory(book.category);
    setShelf(book.shelf);
    setDescription(book.description);
    setMetadataSource(book.metadata_source);
    setVisible(book.visible);
    setAlertMsg(null);
  };

  const openCopyManager = (bookId: string) => {
    const detail = libraryStore.getBookDetail(bookId, token);
    setSelectedBookForCopies({ book: detail.book, copies: detail.copies });
    setNewCopyCode(`${detail.book.code}-${String.fromCharCode(65 + detail.copies.length)}`);
    setAlertMsg(null);
  };

  const handleSaveBook = (e: React.FormEvent) => {
    e.preventDefault();
    setAlertMsg(null);
    try {
      const saved = libraryStore.createOrUpdateBook(token, {
        id: editingBookId,
        title,
        author,
        category,
        shelf,
        description,
        metadata_source: metadataSource,
        visible,
      });
      setRefreshTick((t) => t + 1);
      if (!editingBookId) {
        openCopyManager(saved.id);
      }
      resetBookForm();
      setAlertMsg({
        type: 'success',
        text: `Đã lưu đầu sách "${saved.title}" (${saved.id}) và đồng bộ chỉ mục AI.`,
      });
    } catch (err) {
      setAlertMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi lưu đầu sách.',
      });
    }
  };

  const handleToggleVisible = (book: BookWithAvailability) => {
    setAlertMsg(null);
    try {
      const updated = libraryStore.createOrUpdateBook(token, {
        id: book.id,
        title: book.title,
        author: book.author,
        category: book.category,
        shelf: book.shelf,
        description: book.description,
        visible: !book.visible,
      });
      setRefreshTick((t) => t + 1);
      setAlertMsg({
        type: 'success',
        text: updated.visible
          ? `Đã hiển thị lại đầu sách "${updated.title}" trên danh mục.`
          : `Đã tạm ẩn "${updated.title}" khỏi danh mục và kết quả AI (giữ nguyên lịch sử mượn - TC08).`,
      });
    } catch (err) {
      setAlertMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không đổi được trạng thái hiển thị.',
      });
    }
  };

  const handleAddCopy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBookForCopies) return;
    setAlertMsg(null);
    try {
      const created = libraryStore.addBookCopy(token, {
        book_id: selectedBookForCopies.book.id,
        copy_code: newCopyCode,
        condition_note: newCopyCondition,
      });
      setRefreshTick((t) => t + 1);
      openCopyManager(selectedBookForCopies.book.id);
      setAlertMsg({
        type: 'success',
        text: `Đã thêm bản sao vật lý "${created.copy_code}" vào kho sách.`,
      });
    } catch (err) {
      setAlertMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi thêm bản sao.',
      });
    }
  };

  const handleToggleCopyMaintenance = (copy: BookCopy) => {
    if (!selectedBookForCopies) return;
    setAlertMsg(null);
    try {
      const next = copy.status === 'maintenance' ? 'available' : 'maintenance';
      libraryStore.updateCopyStatus(token, copy.id, next);
      setRefreshTick((t) => t + 1);
      openCopyManager(selectedBookForCopies.book.id);
      setAlertMsg({
        type: 'success',
        text: `Đã chuyển bản sao ${copy.copy_code} sang trạng thái ${next}.`,
      });
    } catch (err) {
      setAlertMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không cập nhật được bản sao.',
      });
    }
  };

  const descWords = countWords(description);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Quản lý Kho sách: Đầu sách &amp; Bản sao (`F05`, `T09`)</h1>
          <p className="page-subtitle">
            Tách biệt rõ thông tin <strong>Đầu sách (`Book`)</strong> với từng <strong>Mã bản sao vật lý (`copy_code`)</strong>. Không xóa cứng dữ liệu đã có lịch sử.
          </p>
        </div>
      </div>

      {alertMsg && (
        <div className={`alert ${alertMsg.type === 'success' ? 'alert-success' : 'alert-error'}`} role="alert">
          {alertMsg.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        {/* Cấp 1: Biểu mẫu Đầu sách */}
        <section className="card">
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.08rem' }}>
            {editingBookId ? `Sửa thông tin Đầu sách (${editingBookId})` : '1. Thêm / Cập nhật Đầu sách (Book)'}
          </h2>
          <form onSubmit={handleSaveBook} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="field">
              <label htmlFor="bookTitle">Tên đầu sách *</label>
              <input
                id="bookTitle"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nhập tên tác phẩm..."
                required
              />
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="bookAuthor">Tác giả *</label>
                <input
                  id="bookAuthor"
                  className="input"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="bookShelf">Vị trí kệ *</label>
                <input
                  id="bookShelf"
                  className="input"
                  value={shelf}
                  onChange={(e) => setShelf(e.target.value)}
                  placeholder="VD: A1-05"
                  required
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="bookCategory">Chủ đề *</label>
              <input
                id="bookCategory"
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="bookDesc">
                Mô tả nội dung phục vụ tìm kiếm AI ({descWords} từ — khuyến nghị 80–200 từ theo `AI01`)
              </label>
              <textarea
                id="bookDesc"
                className="textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tóm tắt nội dung có nguồn sử dụng hợp lệ, không dán toàn văn sách..."
              />
              {descWords > 0 && descWords < 80 && (
                <span style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>
                  Lưu ý: Mô tả dưới 80 từ sẽ được gắn cờ thiếu mô tả chi tiết (`missing_description`).
                </span>
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.88rem' }}>
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
              />
              Hiển thị công khai trên Danh mục và Tìm kiếm AI
            </label>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary">
                {editingBookId ? 'Lưu cập nhật đầu sách' : 'Tạo đầu sách mới'}
              </button>
              {editingBookId && (
                <button type="button" className="btn btn-outline" onClick={resetBookForm}>
                  Hủy sửa
                </button>
              )}
            </div>
          </form>
        </section>

        {/* Cấp 2: Quản lý Bản sao vật lý (Copy) */}
        <section className="card">
          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.08rem' }}>
            2. Quản lý Mã bản sao vật lý (`copy_code`)
          </h2>
          {!selectedBookForCopies ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Hãy bấm nút <strong>“Quản lý bản sao”</strong> ở một dòng sách bên dưới để thêm mã vạch/mã bản sao hoặc chuyển trạng thái bảo trì.
            </p>
          ) : (
            <div>
              <div style={{ marginBottom: '0.75rem' }}>
                Đang chọn đầu sách: <strong>{selectedBookForCopies.book.title}</strong> (
                <code>{selectedBookForCopies.book.id}</code>)
              </div>

              <form onSubmit={handleAddCopy} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                <input
                  aria-label="Mã bản sao mới"
                  className="input"
                  style={{ flex: '1 1 150px' }}
                  value={newCopyCode}
                  onChange={(e) => setNewCopyCode(e.target.value)}
                  placeholder="Mã duy nhất VD: VHVN-001-D"
                  required
                />
                <input
                  aria-label="Tình trạng bản sao"
                  className="input"
                  style={{ flex: '1 1 140px' }}
                  value={newCopyCondition}
                  onChange={(e) => setNewCopyCondition(e.target.value)}
                  placeholder="Ghi chú tình trạng"
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  + Thêm bản sao
                </button>
              </form>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mã bản sao</th>
                      <th>Trạng thái</th>
                      <th>Đổi bảo trì</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedBookForCopies.copies.map((cp) => (
                      <tr key={cp.id}>
                        <td>
                          <code>{cp.copy_code}</code>
                        </td>
                        <td>
                          {cp.status === 'available' && <span className="badge badge-success">Sẵn có</span>}
                          {cp.status === 'borrowed' && <span className="badge badge-warning">Đang mượn</span>}
                          {cp.status === 'maintenance' && <span className="badge badge-danger">Bảo trì</span>}
                        </td>
                        <td>
                          {cp.status === 'borrowed' ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Đang giao</span>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() => handleToggleCopyMaintenance(cp)}
                            >
                              {cp.status === 'maintenance' ? 'Đưa lại lên kệ' : 'Chuyển bảo trì'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Danh sách toàn bộ đầu sách cho Thủ thư */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.08rem' }}>
            Danh sách Đầu sách toàn trường ({listData.total})
          </h2>
          <input
            className="input"
            style={{ maxWidth: '320px' }}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm đầu sách để sửa hoặc thêm bản sao..."
          />
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên sách &amp; Tác giả</th>
                <th>Kệ</th>
                <th>Tồn kho bản sao</th>
                <th>Trạng thái hiển thị</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {listData.items.map((book) => (
                <tr key={book.id}>
                  <td>
                    <code>{book.id}</code>
                  </td>
                  <td>
                    <strong>{book.title}</strong>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      {book.author} • {book.category}
                    </div>
                  </td>
                  <td>{book.shelf}</td>
                  <td>
                    <AvailabilityBadge available={book.available_copies} total={book.total_copies} />
                    {book.maintenance_copies > 0 && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>
                        Bảo trì: {book.maintenance_copies}
                      </div>
                    )}
                  </td>
                  <td>
                    {book.visible ? (
                      <span className="badge badge-success">Đang hiển thị</span>
                    ) : (
                      <span className="badge badge-danger">Đang ẩn</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => startEditBook(book)}
                      >
                        Sửa sách
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => openCopyManager(book.id)}
                      >
                        Quản lý bản sao ({book.total_copies})
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => handleToggleVisible(book)}
                      >
                        {book.visible ? 'Ẩn' : 'Hiện'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {listData.totalPages > 1 && (
          <div className="pagination">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={listData.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Trước
            </button>
            <span style={{ fontSize: '0.88rem' }}>
              Trang {listData.page} / {listData.totalPages}
            </span>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={listData.page >= listData.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau →
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
