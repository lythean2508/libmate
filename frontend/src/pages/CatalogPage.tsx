import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageCircle, Search } from 'lucide-react';
import { AvailabilityBadge, EmptyState } from '../components/StateViews';
import { BookCover, BookLanguage, BookSourceLink } from '../components/BookMedia';
import { useAuth } from '../context/AuthContext';
import { libraryStore } from '../services/libraryStore';

export const CatalogPage: React.FC = () => {
  const { user, favoriteIds, toggleFavoriteBook } = useAuth();
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('ALL');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const categories = useMemo(() => libraryStore.getCategories(), []);
  useEffect(() => { setPage(1); }, [keyword, category, onlyAvailable]);
  const catalog = useMemo(() => libraryStore.listCatalogBooks({ query: keyword, category, onlyAvailable, page, pageSize: 12 }), [keyword, category, onlyAvailable, page]);

  return <div>
    <div className="page-header"><div><span className="section-eyebrow">THẾ GIỚI TRÊN TỪNG TRANG SÁCH</span><h1 className="page-title">Danh mục thư viện</h1><p className="page-subtitle">Tìm cuốn sách tiếp theo cho hành trình khám phá của bạn.</p></div><Link to="/" className="btn btn-primary"><MessageCircle size={17} />Nhờ LibMate tìm sách</Link></div>
    {notice && <div className="alert alert-info" role="status">{notice}</div>}
    <div className="card catalog-filter-card"><div className="catalog-search-fields">
      <div className="field"><label htmlFor="keywordInput">Tên sách hoặc tác giả</label><div className="catalog-input-wrap"><Search size={18} /><input id="keywordInput" className="input" placeholder="Tìm sách, tác giả…" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></div></div>
      <div className="field"><label htmlFor="categorySelect">Chủ đề</label><select id="categorySelect" className="select" value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">Tất cả chủ đề</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
      <label className="catalog-available-filter"><input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} />Chỉ sách còn bản</label>
    </div></div>
    <div className="catalog-count-bar">{catalog.total} đầu sách · Trang {catalog.page} / {catalog.totalPages}</div>
    {catalog.items.length === 0 ? <EmptyState title="Chưa tìm thấy sách phù hợp" description="Thử tên sách không dấu, tác giả hoặc một chủ đề khác nhé." /> : <div className="grid-books">{catalog.items.map((book) => <article className="card book-card" key={book.id}>
      <div className="catalog-book-main"><BookCover book={book} /><div><div className="book-card-eyebrow">{book.category} · Kệ {book.shelf}</div><h2 className="book-card-title"><Link to={`/books/${book.id}`}>{book.title}</Link></h2><div className="book-card-author">{book.author}</div><p className="book-desc-clamp">{book.description}</p></div></div>
      <div className="book-source-row"><BookSourceLink book={book} /><BookLanguage book={book} /></div>
      <div className="book-card-footer"><AvailabilityBadge available={book.available_copies} total={book.total_copies} /><div className="catalog-card-actions">{user && <button className="btn btn-outline btn-sm" aria-label={`${favoriteIds.has(book.id) ? 'Bỏ yêu thích' : 'Lưu yêu thích'} ${book.title}`} onClick={() => { try { const added = toggleFavoriteBook(book.id); setNotice(added ? 'Đã thêm vào Yêu thích.' : 'Đã bỏ khỏi Yêu thích.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Không thể lưu sách.'); } }}><Heart size={15} fill={favoriteIds.has(book.id) ? 'currentColor' : 'none'} /></button>}<Link className="btn btn-outline btn-sm" to={`/books/${book.id}`}>Chi tiết</Link></div></div>
    </article>)}</div>}
    {catalog.totalPages > 1 && <nav className="pagination" aria-label="Phân trang danh mục"><button className="btn btn-outline btn-sm" disabled={catalog.page <= 1} onClick={() => setPage(catalog.page - 1)}>Trang trước</button><span>{catalog.page} / {catalog.totalPages}</span><button className="btn btn-outline btn-sm" disabled={catalog.page >= catalog.totalPages} onClick={() => setPage(catalog.page + 1)}>Trang sau</button></nav>}
  </div>;
};
